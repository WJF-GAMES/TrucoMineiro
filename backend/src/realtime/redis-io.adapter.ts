import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { ServerOptions } from 'socket.io';
import { moduleLogger } from '../common/logger';

const log = moduleLogger('ws');
const REDIS_BOOT_TIMEOUT_MS = Number(process.env.REDIS_BOOT_TIMEOUT_MS ?? 10_000);

/**
 * Adapter do Socket.IO. Com `REDIS_URL` (várias instâncias no Cloud Run), eventos e salas são
 * distribuídos via Redis pub/sub. Sem Redis, cada instância atende só os próprios sockets —
 * adequado para uma instância ou para Cloud Run com session affinity + `max-instances=1` no início.
 */
export class AppIoAdapter extends IoAdapter {
  private adapterFactory: ReturnType<typeof createAdapter> | null = null;
  private clients: ReturnType<typeof createClient>[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  async connectRedis(url: string) {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    // Erro de conexão costuma vir agregado (IPv4 + IPv6) e sem mensagem: registra o código.
    const onError = (e: Error & { code?: string }) =>
      log.error('redis_error', { error: e.message || e.code || e.name });
    pub.on('error', onError);
    sub.on('error', onError);
    this.clients = [pub, sub];
    // No boot, Redis fora do ar deve derrubar a revisão (o cliente tentaria para sempre). Depois de
    // conectado, quedas são tratadas pela reconexão automática do cliente (só logam `redis_error`).
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Redis indisponível no boot (REDIS_URL).')),
        REDIS_BOOT_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([Promise.all([pub.connect(), sub.connect()]), timeout]);
    } catch (e) {
      await Promise.all(this.clients.map((c) => c.disconnect().catch(() => undefined)));
      this.clients = [];
      throw e;
    } finally {
      clearTimeout(timer);
    }
    this.adapterFactory = createAdapter(pub, sub);
    log.info('redis_adapter_ready');
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.corsOrigins.length ? this.corsOrigins : true,
        credentials: false,
      },
      transports: ['websocket', 'polling'],
    });
    if (this.adapterFactory) server.adapter(this.adapterFactory);
    return server;
  }

  async closeRedis() {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}
