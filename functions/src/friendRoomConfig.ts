/**
 * Prazos da sala montada com amigos. Vêm do ambiente das Functions (`functions/.env`) para poderem
 * ser ajustados sem mexer no código; os valores abaixo são os padrões.
 *
 * O tempo de espera do lobby não tem nada a ver com o relógio de 30 s da jogada.
 */
function seconds(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallback * 1000;
}

/** Espera dos convidados antes de completar com IA e começar (lobby). */
export const LOBBY_WAIT_MS = seconds('PRIVATE_ROOM_WAIT_SECONDS', 30);
/** Validade do convite: até aqui o convidado ainda entra, inclusive assumindo a vaga da IA. */
export const INVITE_TTL_MS = seconds('ROOM_INVITE_TTL_SECONDS', 10 * 60);
/** Intervalo mínimo entre dois pushes do mesmo convite. */
export const PUSH_COOLDOWN_MS = 15_000;
/** Quanto tempo um humano pode ficar desconectado na vez dele antes de a IA jogar por ele. */
export const DISCONNECT_AI_GRACE_MS = seconds('DISCONNECT_AI_GRACE_SECONDS', 8);
/** Sala de amigos parada no lobby por mais que isto é fechada pela limpeza. */
export const STALE_LOBBY_MS = 10 * 60_000;
/** Máximo de amigos por convite (a mesa 2x2 tem 3 vagas além do dono). */
export const MAX_ROOM_FRIENDS = 3;

/** Um convite por sala + convidado: reabrir/reenviar nunca cria um segundo. */
export const inviteIdOf = (code: string, uid: string) => `${code}_${uid}`;
