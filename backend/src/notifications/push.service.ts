import { Inject, Injectable } from '@nestjs/common';
import { NotificationType, Prisma, PushStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { AppConfig, CONFIG } from '../config/env';
import { moduleLogger } from '../common/logger';
import { MetricsService } from '../metrics/metrics.service';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';

const log = moduleLogger('push');

/** Tokens que o FCM declarou mortos: saem de `UserDevice` para não acumular. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const SEND_TIMEOUT_MS = 5_000;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  /** Reenviar a mesma coisa substitui a notificação anterior no aparelho. */
  collapseKey?: string;
  /** Validade no FCM: convite vencido não chega a quem liga o celular depois. */
  ttlMs?: number;
}

/**
 * Único ponto de envio de push (FCM via Admin SDK). Grava a notificação, avisa o app aberto pelo
 * WebSocket e entrega em todos os aparelhos do usuário em segundo plano. Falha ou lentidão do FCM
 * NUNCA derruba nem atrasa a operação que pediu o push (sala, convite, amizade).
 */
@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseAdminService,
    private readonly realtime: RealtimeService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async notify(userId: string, input: NotifyInput): Promise<PushStatus> {
    try {
      return await this.deliver(userId, input);
    } catch (e) {
      log.warn('notify_failed', { type: input.type, error: (e as Error).message });
      this.metrics.inc('push_failures_total', { type: input.type });
      return PushStatus.FAILED;
    }
  }

  private async deliver(userId: string, input: NotifyInput): Promise<PushStatus> {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as Prisma.InputJsonValue,
        collapseKey: input.collapseKey ?? null,
      },
    });
    this.realtime.toUser(userId, S2C.notification, {
      id: notification.id,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      createdAt: notification.createdAt.getTime(),
    });

    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { token: true },
    });
    const finish = async (status: PushStatus) => {
      await this.prisma.notification
        .update({ where: { id: notification.id }, data: { pushStatus: status } })
        .catch(() => undefined);
      this.metrics.inc('push_total', { type: input.type, status });
      return status;
    };
    if (!this.config.pushEnabled) return finish(PushStatus.SKIPPED);
    if (devices.length === 0) return finish(PushStatus.NO_DEVICE);
    // O FCM vai em segundo plano: FCM lento/fora não segura a requisição que pediu o push (a
    // notificação já está gravada e já saiu pelo WebSocket). O status final fica na linha.
    void this.send(
      devices.map((d) => d.token),
      input,
    )
      .then(finish)
      .catch((e: Error) => log.warn('notify_failed', { type: input.type, error: e.message }));
    return PushStatus.PENDING;
  }

  private async send(tokens: string[], input: NotifyInput): Promise<PushStatus> {
    const ttlSeconds = input.ttlMs ? Math.max(1, Math.round(input.ttlMs / 1000)) : undefined;
    const request = this.firebase.sendMulticast({
      tokens,
      notification: { title: input.title, body: input.body },
      data: { ...input.data, type: input.data.type ?? input.type.toLowerCase() },
      android: {
        priority: 'high',
        ...(input.ttlMs ? { ttl: input.ttlMs } : {}),
        ...(input.collapseKey
          ? { collapseKey: input.collapseKey, notification: { tag: input.collapseKey } }
          : {}),
      },
      apns: {
        headers: {
          ...(input.collapseKey ? { 'apns-collapse-id': input.collapseKey.slice(0, 64) } : {}),
          ...(ttlSeconds
            ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSeconds) }
            : {}),
        },
        payload: { aps: { sound: 'default' } },
      },
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('fcm timeout')), SEND_TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([request, timeout]);
      const dead = res.responses
        .map((r, i) =>
          !r.success && DEAD_TOKEN_CODES.has(r.error?.code ?? '') ? tokens[i]! : null,
        )
        .filter((t): t is string => t !== null);
      if (dead.length > 0) {
        await this.prisma.userDevice
          .deleteMany({ where: { token: { in: dead } } })
          .catch(() => undefined);
      }
      // Falha por token não lança exceção (ex.: credencial do FCM inválida): registra só os códigos.
      if (res.failureCount > 0) {
        const codes: Record<string, number> = {};
        for (const r of res.responses) {
          if (!r.success)
            codes[r.error?.code ?? 'unknown'] = (codes[r.error?.code ?? 'unknown'] ?? 0) + 1;
        }
        log.warn('fcm_send_failed', { type: input.type, failures: res.failureCount, codes });
        this.metrics.inc('push_failures_total', {}, res.failureCount);
      }
      return res.successCount > 0 ? PushStatus.SENT : PushStatus.FAILED;
    } catch (e) {
      log.warn('fcm_send_failed', { type: input.type, error: (e as Error).message });
      return PushStatus.FAILED;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
