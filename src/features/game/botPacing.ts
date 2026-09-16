import { TRICK_RESOLVE_PAUSE_MS } from './trickPresentation';

/**
 * Quanto um bot "pensa" antes de agir — o mesmo ritmo nos dois modos.
 *
 * Com um valor fixo e curto os três bots respondiam sempre no mesmo compasso e a mesa passava
 * sensação de pressa: ninguém joga em 900 ms, toda vez. A base é mais folgada e cada jogada ganha
 * uma variação própria, derivada da versão da partida — estável entre renders do mesmo estado (o
 * efeito não pode reagendar sozinho) e reproduzível.
 *
 * Vive fora de `useAiGame`/`useOnlineGame` porque os dois pacejam bots e estavam divergindo: o
 * offline já tinha sido afrouxado e o online continuava nos 900 ms originais.
 */
const BASE = {
  /** Jogar uma carta, pedir/responder truco. */
  play: 1_300,
  /** Entre uma mistura/corte e o seguinte. */
  ceremony: 1_250,
} as const;

const JITTER = { play: 700, ceremony: 500 } as const;

/** Depois de uma vaza fechar a mesa ainda mostra a quarta carta, a vencedora e o recolhimento. */
export const ROUND_END_PAUSE_MS = TRICK_RESOLVE_PAUSE_MS;

/** Variação determinística em [0, span) a partir da versão da partida. */
function jitter(version: number, span: number): number {
  // Hash inteiro simples: versões vizinhas não caem em valores vizinhos.
  const h = Math.imul(version ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return (h % 1000) * (span / 1000);
}

/**
 * Pausa antes da próxima ação de bot.
 *
 * `roundEnded` cobre o fim de vaza/mão: aí quem manda no tempo é a apresentação da vaza, não o
 * "pensar" do bot — a mesa ainda está mostrando a carta vencedora e recolhendo.
 */
export function botPauseMs(version: number, kind: 'play' | 'ceremony', roundEnded = false): number {
  if (roundEnded) return ROUND_END_PAUSE_MS;
  return BASE[kind] + jitter(version, JITTER[kind]);
}
