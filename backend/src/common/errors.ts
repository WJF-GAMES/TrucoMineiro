/**
 * Erros previsíveis da API. Todo erro de negócio sai como
 * `{ error: { code, kind, message, requestId } }` com o status HTTP da categoria (`kind`).
 * `code` é estável e específico (o app pode decidir por ele); `kind` é a família (compatível com a
 * semântica que o app já usava no backend antigo).
 */

export type ErrorKind =
  | 'invalid-argument'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'aborted'
  | 'unavailable'
  | 'internal';

export const KIND_STATUS: Record<ErrorKind, number> = {
  'invalid-argument': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  aborted: 409,
  'failed-precondition': 412,
  'resource-exhausted': 429,
  internal: 500,
  unavailable: 503,
};

export const ERROR_CODES = {
  VALIDATION_FAILED: 'invalid-argument',
  NOT_FOUND: 'not-found',
  AUTH_TOKEN_MISSING: 'unauthenticated',
  AUTH_TOKEN_INVALID: 'unauthenticated',
  AUTH_TOKEN_EXPIRED: 'unauthenticated',
  AUTH_TOKEN_REVOKED: 'unauthenticated',
  APP_CHECK_INVALID: 'unauthenticated',
  ADMIN_FORBIDDEN: 'permission-denied',
  FORBIDDEN: 'permission-denied',
  USER_NOT_FOUND: 'not-found',
  PROFILE_INCOMPLETE: 'failed-precondition',
  NICKNAME_INVALID: 'invalid-argument',
  PLAYER_NOT_FOUND: 'not-found',
  RATE_LIMITED: 'resource-exhausted',
  CONTACTS_QUOTA_EXCEEDED: 'resource-exhausted',
  CONTACTS_UNAVAILABLE: 'failed-precondition',
  FRIEND_SELF: 'invalid-argument',
  FRIEND_ALREADY: 'already-exists',
  FRIEND_REQUEST_EXISTS: 'already-exists',
  FRIEND_REQUEST_NOT_FOUND: 'not-found',
  FRIEND_REQUEST_NOT_YOURS: 'permission-denied',
  FRIEND_BLOCKED: 'permission-denied',
  NOT_FRIENDS: 'permission-denied',
  INVITE_TOKEN_INVALID: 'not-found',
  LEAGUE_UNAVAILABLE: 'unavailable',
  ROOM_NOT_FOUND: 'not-found',
  ROOM_FULL: 'resource-exhausted',
  ROOM_STARTED: 'failed-precondition',
  ROOM_STARTING: 'failed-precondition',
  ROOM_NOT_WAITING: 'failed-precondition',
  ROOM_NOT_HOST: 'permission-denied',
  ROOM_NOT_MEMBER: 'permission-denied',
  ROOM_NOT_READY: 'failed-precondition',
  ROOM_WAITING_INVITES: 'failed-precondition',
  ROOM_CODE_EXHAUSTED: 'internal',
  ROOM_CANCELLED: 'not-found',
  ROOM_FRIENDS_INVALID: 'invalid-argument',
  INVITE_NOT_FOUND: 'not-found',
  INVITE_EXPIRED: 'not-found',
  ALREADY_IN_MATCH: 'failed-precondition',
  MATCHMAKING_FAILED: 'internal',
  MATCH_NOT_FOUND: 'not-found',
  MATCH_FINISHED: 'failed-precondition',
  NOT_IN_MATCH: 'permission-denied',
  NOT_YOUR_SEAT: 'permission-denied',
  NOT_YOUR_TURN: 'failed-precondition',
  INVALID_ACTION: 'failed-precondition',
  INVALID_CARD: 'failed-precondition',
  AI_REPLAY_MISMATCH: 'invalid-argument',
  MATCH_NOT_FINISHED: 'failed-precondition',
  MATCH_TOO_LONG: 'invalid-argument',
  WEBHOOK_UNKNOWN_PROVIDER: 'not-found',
  WEBHOOK_SIGNATURE_INVALID: 'unauthenticated',
  WEBHOOK_TIMESTAMP_INVALID: 'unauthenticated',
  WEBHOOK_REPLAY: 'already-exists',
  CONFLICT: 'aborted',
  SERVICE_UNAVAILABLE: 'unavailable',
  INTERNAL_ERROR: 'internal',
} as const satisfies Record<string, ErrorKind>;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly kind: ErrorKind;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.kind = ERROR_CODES[code];
  }

  get status(): number {
    return KIND_STATUS[this.kind];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Mensagens exibidas ao jogador (mesmo texto do backend antigo). */
export const MESSAGES = {
  unavailable: 'Este convite não está mais disponível.',
  cancelled: 'Esta sala foi cancelada.',
  full: 'A sala já está completa.',
  started: 'A partida já começou.',
  finished: 'Esta partida já terminou.',
  starting: 'A partida está começando. Tente de novo em instantes.',
  busy: 'Você já está em uma partida.',
  profileIncomplete: 'Complete seu cadastro antes de jogar.',
  rateLimited: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
} as const;
