import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Prisma, WebhookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { AppError } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { safeEqual } from '../auth/admin.guard';
import { JobsService } from '../jobs/jobs.service';
import { MetricsService } from '../metrics/metrics.service';

const log = moduleLogger('webhooks');

/** Janela aceita entre o carimbo do evento e o relógio do servidor (anti-replay, HMAC). */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;
/**
 * OIDC: as novas tentativas do Cloud Scheduler repetem o horário AGENDADO, então a janela é maior.
 * O token do Google (assinado, com validade de 1 h e audiência fixa) já limita o reuso, e o id
 * `job@horário` impede processar duas vezes.
 */
export const OIDC_SCHEDULE_TOLERANCE_MS = 60 * 60_000;
/** Evento em PROCESSING há mais que isso: a instância morreu no meio; o retry reprocessa. */
export const WEBHOOK_STALE_PROCESSING_MS = 15 * 60_000;

export interface WebhookRequest {
  headers: Record<string, string | undefined>;
  rawBody: Buffer | undefined;
  body: unknown;
}

interface VerifiedEvent {
  externalEventId: string;
  type: string;
  payload: Record<string, unknown>;
}

interface Provider {
  verify(req: WebhookRequest): Promise<VerifiedEvent>;
  process(event: VerifiedEvent): Promise<unknown>;
}

/**
 * Assinatura HMAC: `x-webhook-signature: v1=<hex(HMAC_SHA256(secret, "<timestamp>.<id>.<corpo cru>"))>`.
 * O id do evento entra na assinatura: trocar o `x-webhook-id` de uma requisição capturada invalida.
 */
export function signWebhook(
  secret: string,
  timestamp: number,
  eventId: string,
  rawBody: string,
): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${eventId}.${rawBody}`).digest('hex')}`;
}

/**
 * Webhooks: integrações e eventos assíncronos que chegam de fora. Hoje o provedor real é o
 * **Cloud Scheduler** (dispara os jobs de manutenção quando o backend roda em Cloud Run com
 * `JOBS_MODE=external`). O Firebase Auth NÃO tem webhook: a autenticação é sempre pelo ID Token.
 *
 * Todo evento: assinatura/token verificado → carimbo dentro da janela → id externo registrado em
 * `WebhookEvent` (único por provedor: replay e retry não processam duas vezes) → resposta rápida →
 * processamento → status final.
 */
@Injectable()
export class WebhooksService {
  private readonly providers: Record<string, Provider>;
  private readonly oidc = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.providers = { scheduler: this.schedulerProvider() };
  }

  private schedulerProvider(): Provider {
    return {
      verify: async (req) => {
        const auth = await this.authenticateScheduler(req);
        // Conteúdo só é olhado depois da autenticação.
        const body = (req.body ?? {}) as Record<string, unknown>;
        const job = typeof body.job === 'string' ? body.job : '';
        if (!this.jobs.isJob(job)) throw new AppError('VALIDATION_FAILED', 'job inválido.');
        const payload = (
          body.payload && typeof body.payload === 'object' ? body.payload : {}
        ) as Record<string, unknown>;
        const externalEventId = auth.eventId ?? `${job}@${auth.scheduledAt}`.slice(0, 200);
        return { externalEventId, type: job, payload };
      },
      process: (event) => this.jobs.run(event.type as never, event.payload),
    };
  }

  /**
   * Autentica e devolve o id externo do evento: HMAC → `x-webhook-id`; OIDC → `<job>@<horário
   * agendado>` (sem o header do nome do job, quem chama usa o `job` do corpo).
   */
  private async authenticateScheduler(
    req: WebhookRequest,
  ): Promise<{ eventId: string | null; scheduledAt: string | null }> {
    const signature = req.headers['x-webhook-signature'];
    if (signature) {
      const secret = this.config.webhookSecrets.scheduler;
      if (!secret)
        throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Provedor sem segredo configurado.');
      const ts = Number(req.headers['x-webhook-timestamp']);
      this.checkTimestamp(ts, WEBHOOK_TOLERANCE_MS);
      const id = req.headers['x-webhook-id'] ?? '';
      if (!id || id.length > 200)
        throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'x-webhook-id ausente.');
      const expected = signWebhook(secret, ts, id, req.rawBody?.toString('utf8') ?? '');
      if (!safeEqual(signature, expected))
        throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Assinatura inválida.');
      return { eventId: id, scheduledAt: null };
    }
    // Cloud Scheduler → Cloud Run: token OIDC assinado pelo Google.
    const oidc = this.config.schedulerOidc;
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!oidc || !bearer)
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Credencial do webhook ausente.');
    try {
      const ticket = await this.oidc.verifyIdToken({ idToken: bearer, audience: oidc.audience });
      const claims = ticket.getPayload();
      if (!claims?.email_verified || claims.email !== oidc.serviceAccount) throw new Error('email');
    } catch {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Token do webhook inválido.');
    }
    const scheduled = req.headers['x-cloudscheduler-scheduletime'];
    const ts = scheduled ? Date.parse(scheduled) : NaN;
    this.checkTimestamp(ts, OIDC_SCHEDULE_TOLERANCE_MS);
    const jobName = req.headers['x-cloudscheduler-jobname'];
    return {
      eventId: jobName ? `${jobName.slice(0, 120)}@${scheduled}`.slice(0, 200) : null,
      scheduledAt: scheduled ?? null,
    };
  }

  private checkTimestamp(ts: number, toleranceMs: number) {
    if (!Number.isFinite(ts) || Math.abs(now() - ts) > toleranceMs)
      throw new AppError('WEBHOOK_TIMESTAMP_INVALID', 'Carimbo de tempo fora da janela.');
  }

  /**
   * Registra e processa. Devolve rápido: o processamento continua em segundo plano e o status
   * final fica no `WebhookEvent`.
   */
  async receive(
    providerName: string,
    req: WebhookRequest,
  ): Promise<{ accepted: boolean; duplicate: boolean; eventId?: string }> {
    const provider = this.providers[providerName];
    if (!provider) throw new AppError('WEBHOOK_UNKNOWN_PROVIDER', 'Provedor desconhecido.');
    let event: VerifiedEvent;
    try {
      event = await provider.verify(req);
    } catch (e) {
      this.metrics.inc('webhooks_total', { provider: providerName, status: 'rejected' });
      log.warn('webhook_rejected', { provider: providerName, code: (e as AppError).code });
      throw e;
    }
    let record: { id: string };
    try {
      record = await this.prisma.webhookEvent.create({
        data: {
          provider: providerName,
          externalEventId: event.externalEventId,
          type: event.type,
          status: WebhookStatus.PROCESSING,
          lastAttemptAt: new Date(now()),
        },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Retry/replay do mesmo evento: só reprocessa se a tentativa anterior falhou.
        const prev = await this.prisma.webhookEvent.update({
          where: {
            provider_externalEventId: {
              provider: providerName,
              externalEventId: event.externalEventId,
            },
          },
          data: { attemptCount: { increment: 1 } },
        });
        const stuck =
          prev.status === WebhookStatus.PROCESSING &&
          prev.lastAttemptAt.getTime() < now() - WEBHOOK_STALE_PROCESSING_MS;
        if (prev.status !== WebhookStatus.FAILED && !stuck) {
          this.metrics.inc('webhooks_total', { provider: providerName, status: 'duplicate' });
          return { accepted: true, duplicate: true, eventId: prev.id };
        }
        // Só um retry concorrente assume a nova tentativa (condição no status + hora anterior).
        const claimed = await this.prisma.webhookEvent.updateMany({
          where: { id: prev.id, status: prev.status, lastAttemptAt: prev.lastAttemptAt },
          data: { status: WebhookStatus.PROCESSING, error: null, lastAttemptAt: new Date(now()) },
        });
        if (claimed.count === 0) return { accepted: true, duplicate: true, eventId: prev.id };
        record = { id: prev.id };
      } else throw e;
    }
    void this.processAsync(providerName, provider, event, record.id);
    this.metrics.inc('webhooks_total', { provider: providerName, status: 'accepted' });
    return { accepted: true, duplicate: false, eventId: record.id };
  }

  private async processAsync(
    providerName: string,
    provider: Provider,
    event: VerifiedEvent,
    id: string,
  ) {
    try {
      await provider.process(event);
      await this.prisma.webhookEvent.update({
        where: { id },
        data: { status: WebhookStatus.PROCESSED, processedAt: new Date(now()) },
      });
    } catch (e) {
      log.error('webhook_processing_failed', {
        provider: providerName,
        type: event.type,
        error: (e as Error).message,
      });
      await this.prisma.webhookEvent
        .update({
          where: { id },
          data: { status: WebhookStatus.FAILED, error: (e as Error).message.slice(0, 500) },
        })
        .catch(() => undefined);
    }
  }

  async status(id: string) {
    return this.prisma.webhookEvent.findUnique({ where: { id } });
  }
}
