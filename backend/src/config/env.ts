/**
 * Configuração do backend lida uma vez do ambiente e validada no boot.
 * Em produção/staging, faltar um segredo crítico derruba o processo antes de aceitar tráfego.
 */

export type NodeEnv = 'development' | 'test' | 'staging' | 'production';
/** `firebase`: Firebase Admin verifica o ID Token. `test`: tokens `test:<uid>:<phone>` (só NODE_ENV=test/development). */
export type AuthMode = 'firebase' | 'test';
/** `cron`: esta instância roda os jobs agendados. `external`: jobs chegam pelo webhook do Cloud Scheduler. `off`: nenhum. */
export type JobsMode = 'cron' | 'external' | 'off';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  instanceId: string;
  databaseUrl: string;
  redisUrl: string | null;
  firebaseProjectId: string;
  firebaseServiceAccountJson: string | null;
  authMode: AuthMode;
  enforceAppCheck: boolean;
  contactsPepper: string;
  adminSecret: string;
  webhookSecrets: Record<string, string>;
  jobsMode: JobsMode;
  corsOrigins: string[];
  pushEnabled: boolean;
  /** Prazos da sala com amigos e da presença (segundos no ambiente, ms aqui). */
  lobbyWaitMs: number;
  inviteTtlMs: number;
  disconnectAiGraceMs: number;
  botFallbackMs: number;
  schedulerPollMs: number;
  /** Cloud Scheduler → Cloud Run autenticado por token OIDC do Google. */
  schedulerOidc: { audience: string; serviceAccount: string } | null;
  /** Busca de partida sem renovação por mais que isso expira (app morto no meio da busca). */
  matchmakingMaxSearchMs: number;
  /** Sem nenhum socket por esse tempo, a busca do usuário é cancelada. */
  matchmakingDisconnectGraceMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  slowQueryMs: number;
}

/** Identidade desta instância (estável durante o processo). */
const PROCESS_INSTANCE_ID = `${process.env.K_REVISION ?? 'local'}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function seconds(value: string | undefined, fallback: number): number {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallback * 1000;
}

function required(env: NodeJS.ProcessEnv, name: string, strict: boolean, fallback: string): string {
  const v = env[name]?.trim();
  if (v) return v;
  if (strict) throw new Error(`Configuração ausente: ${name}`);
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as NodeEnv;
  if (!['development', 'test', 'staging', 'production'].includes(nodeEnv))
    throw new Error(`NODE_ENV inválido: ${nodeEnv}`);
  const strict = nodeEnv === 'production' || nodeEnv === 'staging';

  const authMode = (env.AUTH_MODE ?? 'firebase') as AuthMode;
  if (authMode !== 'firebase' && authMode !== 'test')
    throw new Error(`AUTH_MODE inválido: ${authMode}`);
  if (authMode === 'test' && strict)
    throw new Error('AUTH_MODE=test é proibido em staging/produção.');
  if (strict && env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error('FIREBASE_AUTH_EMULATOR_HOST não pode estar definido em staging/produção.');

  const jobsMode = (env.JOBS_MODE ?? 'cron') as JobsMode;
  if (!['cron', 'external', 'off'].includes(jobsMode))
    throw new Error(`JOBS_MODE inválido: ${jobsMode}`);

  const pepper = required(env, 'CONTACTS_PEPPER', strict, 'dev-only-pepper');
  if (strict && pepper.length < 32)
    throw new Error('CONTACTS_PEPPER precisa de pelo menos 32 caracteres.');
  const adminSecret = required(env, 'ADMIN_SECRET', strict, 'dev-admin-secret');
  if (strict && adminSecret.length < 32)
    throw new Error('ADMIN_SECRET precisa de pelo menos 32 caracteres.');

  const webhookSecrets: Record<string, string> = {};
  const scheduler = env.WEBHOOK_SCHEDULER_SECRET?.trim();
  if (scheduler) webhookSecrets.scheduler = scheduler;
  const oidcAudience = env.WEBHOOK_SCHEDULER_OIDC_AUDIENCE?.trim() || null;
  const oidcServiceAccount = env.WEBHOOK_SCHEDULER_SERVICE_ACCOUNT?.trim() || null;
  if (Boolean(oidcAudience) !== Boolean(oidcServiceAccount))
    throw new Error(
      'WEBHOOK_SCHEDULER_OIDC_AUDIENCE e WEBHOOK_SCHEDULER_SERVICE_ACCOUNT vão juntos.',
    );
  if (strict && scheduler && scheduler.length < 32)
    throw new Error('WEBHOOK_SCHEDULER_SECRET precisa de pelo menos 32 caracteres.');
  if (strict && jobsMode === 'external' && !scheduler && !oidcAudience)
    throw new Error(
      'JOBS_MODE=external exige WEBHOOK_SCHEDULER_SECRET ou OIDC do Cloud Scheduler.',
    );

  const levels = ['debug', 'info', 'warn', 'error'] as const;
  const logLevel = (levels as readonly string[]).includes(env.LOG_LEVEL ?? '')
    ? (env.LOG_LEVEL as AppConfig['logLevel'])
    : nodeEnv === 'test'
      ? 'warn'
      : 'info';

  return {
    nodeEnv,
    port: Number(env.PORT ?? 3000),
    instanceId: (env.INSTANCE_ID ?? PROCESS_INSTANCE_ID).slice(0, 64),
    databaseUrl: required(env, 'DATABASE_URL', true, ''),
    redisUrl: env.REDIS_URL?.trim() || null,
    firebaseProjectId: required(env, 'FIREBASE_PROJECT_ID', strict, 'truco-mineiro-wjf'),
    firebaseServiceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null,
    authMode,
    enforceAppCheck: env.ENFORCE_APP_CHECK === 'true',
    contactsPepper: pepper,
    adminSecret,
    webhookSecrets,
    schedulerOidc: oidcAudience
      ? { audience: oidcAudience, serviceAccount: oidcServiceAccount! }
      : null,
    jobsMode,
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    pushEnabled: env.PUSH_ENABLED !== 'false' && nodeEnv !== 'test',
    lobbyWaitMs: seconds(env.PRIVATE_ROOM_WAIT_SECONDS, 30),
    inviteTtlMs: seconds(env.ROOM_INVITE_TTL_SECONDS, 10 * 60),
    disconnectAiGraceMs: seconds(env.DISCONNECT_AI_GRACE_SECONDS, 8),
    botFallbackMs: seconds(env.BOT_FALLBACK_SECONDS, 3),
    schedulerPollMs: Number(env.SCHEDULER_POLL_MS ?? 1000),
    matchmakingMaxSearchMs: seconds(env.MATCHMAKING_MAX_SEARCH_SECONDS, 150),
    matchmakingDisconnectGraceMs: seconds(env.MATCHMAKING_DISCONNECT_GRACE_SECONDS, 15),
    logLevel,
    slowQueryMs: Number(env.SLOW_QUERY_MS ?? 200),
  };
}

export const CONFIG = Symbol('APP_CONFIG');
