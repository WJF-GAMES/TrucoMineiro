import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Ambiente dos testes de integração: schema de TESTE isolado (nunca dev/staging/produção).
 * A URL vem de TEST_DATABASE_URL ou de `backend/.env.test` (fora do git). Os testes fazem
 * TRUNCATE no schema da URL, então ela precisa apontar para um schema dedicado, não "public".
 */
function readEnvTest(): string | undefined {
  const file = join(__dirname, '..', '..', '.env.test');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('TEST_DATABASE_URL='));
  return line
    ?.slice('TEST_DATABASE_URL='.length)
    .trim()
    .replace(/^"(.*)"$/, '$1');
}

function resolveTestUrl(): string {
  const url = process.env.TEST_DATABASE_URL || readEnvTest();
  if (!url) throw new Error('Defina TEST_DATABASE_URL (ou backend/.env.test). Veja backend/.env.example.');
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  if (schema === 'public') throw new Error('TEST_DATABASE_URL precisa de um schema dedicado (?schema=integration_test).');
  if (/prod|staging/i.test(url)) throw new Error('TEST_DATABASE_URL parece não ser de teste.');
  return url;
}

export const TEST_DATABASE_URL = resolveTestUrl();

export function applyTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    AUTH_MODE: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JOBS_MODE: 'off',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
    CONTACTS_PEPPER: 'test-pepper',
    ADMIN_SECRET: 'test-admin-secret',
    WEBHOOK_SCHEDULER_SECRET: 'test-webhook-secret',
    DISCONNECT_AI_GRACE_SECONDS: '1',
    BOT_FALLBACK_SECONDS: '0.05',
    PRIVATE_ROOM_WAIT_SECONDS: '30',
    MATCHMAKING_DISCONNECT_GRACE_SECONDS: '0.3',
    HTTP_RATE_LIMIT: '100000',
    SHUTDOWN_DRAIN_MS: '0',
  });
}
