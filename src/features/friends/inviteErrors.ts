import { ApiError } from '@/services/api';

/** Mensagens de convite de sala (sem dependência de navegação: usadas também em hooks). */
export const INVITE_UNAVAILABLE = 'Este convite não está mais disponível.';

const ERROR_TEXT: Record<string, string> = {
  'not-found': INVITE_UNAVAILABLE,
  'resource-exhausted': 'A sala já está completa.',
  'failed-precondition': 'A partida já começou.',
  unavailable: 'Sem conexão. Verifique sua internet e tente de novo.',
};

/** Mensagem do servidor quando ela existe (ele sabe se foi cancelada, cheia, em outra partida…). */
export function inviteErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Não foi possível entrar na sala.';
  if (e.code === 'unavailable') return ERROR_TEXT.unavailable!;
  return e.message && e.message !== 'Algo deu errado. Tente novamente.'
    ? e.message
    : (ERROR_TEXT[e.code] ?? 'Não foi possível entrar na sala.');
}
