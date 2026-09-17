import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/env';
import { JsonLogger, moduleLogger, setRootLogger } from './common/logger';
import { AppError } from './common/errors';
import { requestIdMiddleware } from './common/request-id.middleware';
import { MetricsService } from './metrics/metrics.service';
import { AppIoAdapter } from './realtime/redis-io.adapter';
import { markShuttingDown } from './health/health.controller';

const log = moduleLogger('bootstrap');

export async function createApp(): Promise<{ app: INestApplication; adapter: AppIoAdapter }> {
  // Falha cedo: segredo crítico faltando derruba o processo antes de aceitar tráfego.
  const config = loadConfig();
  const logger = new JsonLogger(config.logLevel, { service: 'truco-backend', instance: config.instanceId });
  setRootLogger(logger);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    rawBody: true,
    bufferLogs: false,
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Respostas dinâmicas por usuário: sem ETag/304 (o cliente sempre recebe o corpo).
  app.set('etag', false);
  app.useBodyParser('json', { limit: '256kb' });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.enableCors({
    // O app móvel não envia Origin; a lista vale para ferramentas web (build web, painel).
    origin: config.corsOrigins.length ? config.corsOrigins : config.nodeEnv === 'production' ? false : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id', 'x-firebase-appcheck'],
    maxAge: 600,
  });
  app.use(requestIdMiddleware(app.get(MetricsService)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => {
        // Mensagens próprias (em português) passam; as padrão do class-validator viram genéricas.
        let first = errors[0];
        while (first && !first.constraints && first.children?.length) first = first.children[0];
        const raw = first?.constraints ? Object.values(first.constraints)[0] : undefined;
        const message = raw && /[áéíóúãõç]|inválid/i.test(raw) ? raw : `Dados inválidos (${first?.property ?? 'payload'}).`;
        return new AppError('VALIDATION_FAILED', message, { field: first?.property, reason: raw });
      },
    }),
  );

  if (config.nodeEnv !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('Truco Mineiro API')
      .setDescription(
        'Backend autoritativo do Truco Mineiro. Autenticação: `Authorization: Bearer <Firebase ID Token>`. ' +
          'Respostas: `{ data }`; erros: `{ error: { code, kind, message, requestId } }`. ' +
          'Tempo real: Socket.IO no namespace `/rt` (ver docs/websocket.md).',
      )
      .setVersion('2.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }

  const adapter = new AppIoAdapter(app, config.corsOrigins);
  if (config.redisUrl) await adapter.connectRedis(config.redisUrl);
  app.useWebSocketAdapter(adapter);
  return { app, adapter };
}

async function main() {
  const { app, adapter } = await createApp();
  const config = loadConfig();
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  await app.listen(config.port, '0.0.0.0');
  log.info('listening', { port: config.port, env: config.nodeEnv, jobs: config.jobsMode, redis: Boolean(config.redisUrl) });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    markShuttingDown();
    log.info('shutdown_started', { signal });
    // Readiness já responde 503; dá tempo do balanceador tirar a instância antes de fechar.
    await new Promise((r) => setTimeout(r, Number(process.env.SHUTDOWN_DRAIN_MS ?? 3000)));
    try {
      await app.close(); // fecha sockets, timers, Prisma (OnModuleDestroy/OnApplicationShutdown)
      await adapter.closeRedis();
    } finally {
      log.info('shutdown_done');
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => log.error('unhandled_rejection', { reason: String(reason) }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(JSON.stringify({ severity: 'CRITICAL', message: 'boot_failed', error: (e as Error).message }));
    process.exit(1);
  });
}
