import { getAppCheckToken } from '@/services/firebase/appCheck';
import { getIdToken } from '@/services/firebase/auth';
import { ApiConfigError, endpoints } from './config';

/**
 * Cliente HTTP único do app. Nenhuma tela chama `fetch` direto.
 *  - base URL por ambiente (`config.ts`)
 *  - `Authorization: Bearer <Firebase ID Token>`; 401 por token vencido → renova e repete uma vez
 *  - timeout por requisição
 *  - repetição automática só onde é seguro (GET, ou POST com Idempotency-Key)
 *  - erro padronizado em `ApiError` (`code` = família, `errorCode` = código específico do servidor)
 */

export type ApiErrorKind =
  | 'invalid-argument'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'aborted'
  | 'unavailable'
  | 'deadline-exceeded'
  | 'internal'
  | 'unknown';

export class ApiError extends Error {
  constructor(
    /** Família do erro (mesma semântica que o app já usava). */
    public code: ApiErrorKind,
    message: string,
    /** Código específico do backend (ex.: `ROOM_FULL`, `NOT_YOUR_TURN`). */
    public errorCode: string = 'UNKNOWN',
    public status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [400, 1200];

export function friendlyMessage(kind: ApiErrorKind, raw?: string): string {
  switch (kind) {
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Sem conexão com o servidor. Tente novamente.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case 'internal':
    case 'unknown':
      return 'Algo deu errado. Tente novamente.';
    default:
      return raw || 'Operação não permitida.';
  }
}

interface ErrorPayload {
  error?: { code?: string; kind?: string; message?: string };
}

export function toApiError(status: number, body: unknown): ApiError {
  const e = (body as ErrorPayload | null)?.error;
  const kind = (e?.kind as ApiErrorKind | undefined) ?? (status >= 500 ? 'internal' : 'unknown');
  return new ApiError(kind, friendlyMessage(kind, e?.message), e?.code ?? 'UNKNOWN', status);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** Torna o POST repetível (o servidor devolve a mesma resposta para a mesma chave). */
  idempotencyKey?: string;
  /** Rotas que não exigem sessão. */
  anonymous?: boolean;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Testes. */
export function setFetch(f: Fetch) {
  fetchImpl = f;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once<T>(path: string, opts: RequestOptions, forceRefresh: boolean): Promise<T> {
  let base: string;
  try {
    base = endpoints().apiUrl;
  } catch (e) {
    throw new ApiError('internal', (e as ApiConfigError).message, 'CLIENT_MISCONFIGURED');
  }
  const qs = opts.query
    ? Object.entries(opts.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  if (!opts.anonymous) {
    const token = await getIdToken(forceRefresh);
    if (!token) throw new ApiError('unauthenticated', friendlyMessage('unauthenticated'), 'AUTH_TOKEN_MISSING', 401);
    headers.authorization = `Bearer ${token}`;
    const appCheck = await getAppCheckToken();
    if (appCheck) headers['x-firebase-appcheck'] = appCheck;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new ApiError(
      aborted ? 'deadline-exceeded' : 'unavailable',
      friendlyMessage(aborted ? 'deadline-exceeded' : 'unavailable'),
      aborted ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw toApiError(res.status, json);
  return ((json as { data?: T } | null)?.data ?? null) as T;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const retryable = (opts.method ?? 'GET') === 'GET' || Boolean(opts.idempotencyKey);
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(path, opts, refreshed);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      // Token vencido/revogado: renova uma vez e repete (seguro — nada foi executado).
      if (e.status === 401 && !refreshed && !opts.anonymous && e.errorCode.startsWith('AUTH_TOKEN')) {
        refreshed = true;
        attempt--;
        continue;
      }
      // Com Idempotency-Key, CONFLICT = a tentativa anterior ainda está sendo processada: repetir é
      // seguro (o servidor devolve a mesma resposta quando ela terminar).
      const transient =
        e.code === 'unavailable' ||
        e.code === 'deadline-exceeded' ||
        e.status === 503 ||
        (Boolean(opts.idempotencyKey) && e.errorCode === 'CONFLICT');
      if (!retryable || !transient || attempt >= RETRY_DELAYS_MS.length) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body: unknown = {}, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Chave de idempotência para uma intenção do usuário (retries seguros). */
export function idempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
