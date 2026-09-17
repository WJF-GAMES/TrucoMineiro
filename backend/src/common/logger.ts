import { LoggerService } from '@nestjs/common';

/**
 * Logger estruturado (uma linha JSON por evento — o Cloud Logging entende `severity`).
 * Redige tudo o que não pode ir para log: tokens, telefones, OTP, cartas secretas.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const SECRET_KEYS = /^(authorization|token|idtoken|id_token|password|otp|code_verifier|secret|phone|phones|phonenumber|phone_number|hands|deck|state|privatekey|private_key|fcmtoken|x-firebase-appcheck)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') {
    // Telefone E.164 solto numa mensagem: só os 4 últimos dígitos.
    return value.replace(/\+\d{6,}(\d{4})/g, '+***$1').replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class JsonLogger implements LoggerService {
  private min: number;

  constructor(
    level: Level = 'info',
    private readonly base: Record<string, unknown> = {},
  ) {
    this.min = LEVELS[level];
  }

  setLevel(level: Level) {
    this.min = LEVELS[level];
  }

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    if (LEVELS[level] < this.min) return;
    const severity = level === 'warn' ? 'WARNING' : level.toUpperCase();
    const payload: Record<string, unknown> = {
      severity,
      time: new Date().toISOString(),
      ...this.base,
      ...(context ? { context } : {}),
    };
    if (typeof message === 'string') payload.message = redact(message);
    else if (message && typeof message === 'object') Object.assign(payload, redact(message) as object);
    else payload.message = String(message);
    if (extra) Object.assign(payload, redact(extra) as object);
    const line = JSON.stringify(payload);
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  log(message: unknown, context?: string) {
    this.write('info', message, typeof context === 'string' ? context : undefined);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, typeof context === 'string' ? context : undefined, trace ? { trace } : undefined);
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, typeof context === 'string' ? context : undefined);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, typeof context === 'string' ? context : undefined);
  }
  verbose(message: unknown, context?: string) {
    this.write('debug', message, typeof context === 'string' ? context : undefined);
  }
  event(level: Level, event: string, fields: Record<string, unknown> = {}, context?: string) {
    this.write(level, event, context, fields);
  }
}

let root = new JsonLogger((process.env.LOG_LEVEL as Level) ?? 'info');

export function setRootLogger(logger: JsonLogger) {
  root = logger;
}

/** Logger de módulo: `log.info('evento', { campos })`. */
export function moduleLogger(context: string) {
  return {
    debug: (event: string, fields?: Record<string, unknown>) => root.event('debug', event, fields, context),
    info: (event: string, fields?: Record<string, unknown>) => root.event('info', event, fields, context),
    warn: (event: string, fields?: Record<string, unknown>) => root.event('warn', event, fields, context),
    error: (event: string, fields?: Record<string, unknown>) => root.event('error', event, fields, context),
  };
}
