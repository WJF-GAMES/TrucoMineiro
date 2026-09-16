import {
  leadingPlay,
  type GameEvent,
  type TablePlay,
  type Seat,
  type SeatView,
  type Team,
} from '@/domain/game';

/**
 * Apresentação da vaza na mesa.
 *
 * O motor resolve a vaza **no mesmo `applyAction`** da quarta carta: `currentRound` chega à UI
 * já vazio, e quando a mão termina a view seguinte já é de outra mão. Desenhar só `currentRound`
 * faz a última carta nunca aparecer e a mesa esvaziar antes de alguém entender quem levou.
 *
 * Este módulo reconstrói o que a mesa deve mostrar a partir dos eventos e da view — sem tocar no
 * motor (que é compartilhado com o servidor) e sem inventar regra: a carta vencedora vem do
 * `ROUND_ENDED`, e a "que está ganhando" usa a mesma comparação de força do `resolveRound`.
 *
 * Só derivações puras aqui; o hook `useTrickPresentation` cuida do relógio.
 */

export const TRICK_TIMING = {
  /** Carta saindo da mão/assento até o centro. */
  flyMs: 300,
  /**
   * Quarta carta na mesa, vencedora destacada (ou o aviso de cango), antes de recolher. Cobre o
   * aviso de cango com folga: ele precisa ser lido antes de a mesa limpar.
   */
  holdMs: 1_900,
  /** Cartas juntando e indo para quem levou. */
  collectMs: 420,
} as const;

/** Quanto os bots (IA local ou servidor) esperam depois de uma vaza fechar antes de jogar de novo. */
export const TRICK_RESOLVE_PAUSE_MS =
  TRICK_TIMING.flyMs + TRICK_TIMING.holdMs + TRICK_TIMING.collectMs + 120;

export type TrickPhase = 'open' | 'resolved' | 'collecting' | 'empty';

/**
 * O que um cango significou, segundo o motor (evento `TIE_BREAK_STARTED` ou o `HAND_ENDED`):
 * - `TIE_BREAK_STARTED`: 1ª cangou — a próxima vaza é de desempate;
 * - `TIE_BREAK_AGAIN`: cangou de novo no desempate — a terceira decide;
 * - `FIRST_TRICK_PREVAILS`: cangou depois de a 1ª ter vencedor — vale a primeira;
 * - `ALL_TIED`: as três cangaram — ninguém pontua.
 */
export type CangoNote =
  'TIE_BREAK_STARTED' | 'TIE_BREAK_AGAIN' | 'FIRST_TRICK_PREVAILS' | 'ALL_TIED';

/** Texto curto da mesa para cada cango ("Cangou" é o termo do jogo em todo o app). */
export const CANGO_COPY: Record<CangoNote, string> = {
  TIE_BREAK_STARTED: 'Cangou! Agora todos jogam a maior carta.',
  TIE_BREAK_AGAIN: 'Cangou de novo! A terceira decide.',
  FIRST_TRICK_PREVAILS: 'Cangou! Vale a primeira.',
  ALL_TIED: 'Cangou tudo! Ninguém pontua.',
};

/** Lê no lote do motor o que o cango da vaza `round` causou. `null` se o lote não diz. */
export function cangoNote(batch: readonly GameEvent[], round: number): CangoNote | null {
  for (const e of batch) {
    if (e.type === 'TIE_BREAK_STARTED' && e.round === round + 1)
      return e.continued ? 'TIE_BREAK_AGAIN' : 'TIE_BREAK_STARTED';
    if (e.type === 'HAND_ENDED') {
      if (e.result.reason === 'ALL_TIED') return 'ALL_TIED';
      if (e.result.decidedBy === 'FIRST_TRICK_ADVANTAGE') return 'FIRST_TRICK_PREVAILS';
    }
  }
  return null;
}

export interface TrickPresentation {
  phase: TrickPhase;
  /** Cartas que a mesa desenha agora (inclui a quarta enquanto a vaza está sendo mostrada). */
  plays: TablePlay[];
  /** Índice da vaza mostrada (0–2); `-1` com a mesa vazia. Estável de aberta para resolvida. */
  round: number;
  /** Assento cuja carta está ganhando numa vaza ainda aberta (`null` em empate ou mesa vazia). */
  leadingSeat: Seat | null;
  /** Resultado da vaza fechada, enquanto ela ainda está na mesa. */
  resolved: { winnerSeat: Seat; winner: Team | null; cango: CangoNote | null } | null;
  /** A vaza fechou a mão: a view já é da mão seguinte, então a mesa segura mais uma coisa — a mão. */
  handEnded: boolean;
  /** Instante (epoch ms) em que a mesa passa a recolher; `null` fora de `resolved`. */
  holdUntil: number | null;
  /** Idem para o fim do recolhimento. */
  clearAt: number | null;
}

export const EMPTY_TRICK: TrickPresentation = {
  phase: 'empty',
  plays: [],
  round: -1,
  leadingSeat: null,
  resolved: null,
  handEnded: false,
  holdUntil: null,
  clearAt: null,
};

function leading(plays: TablePlay[]): Seat | null {
  const lead = leadingPlay(plays);
  // Carta virada nunca aparece como "Ganhando": ela vale o mínimo.
  return lead && !lead.tied && !lead.covered ? lead.seat : null;
}

function openTrick(plays: TablePlay[], round: number): TrickPresentation {
  return { ...EMPTY_TRICK, phase: 'open', plays, round, leadingSeat: leading(plays) };
}

/**
 * Reconstrói as quatro cartas da vaza que acabou de fechar.
 * Se a mão continua, o motor guarda as jogadas em `view.rounds`; se a mão acabou a view já é de
 * outra mão, então juntamos o que a mesa mostrava com os `CARD_PLAYED` do lote.
 */
function resolvedPlays(
  prev: TrickPresentation,
  view: SeatView,
  batch: GameEvent[],
  roundIndex: number,
  handEnded: boolean,
): TablePlay[] {
  if (!handEnded) {
    const fromView = view.rounds[roundIndex]?.plays;
    if (fromView && fromView.length === 4) return fromView;
  }
  const merged = new Map<Seat, TablePlay>();
  prev.plays.forEach((p) => merged.set(p.seat, p));
  for (const e of batch) {
    if (e.type === 'ROUND_ENDED' && e.round < roundIndex) merged.clear();
    if (e.type === 'CARD_PLAYED')
      merged.set(e.seat, { seat: e.seat, card: e.card ?? null, covered: Boolean(e.covered) });
  }
  return [...merged.values()];
}

/**
 * Próxima apresentação a partir de uma view nova e do lote de eventos que veio com ela.
 * `batchIsNew` distingue "chegou um lote" de "a view mudou por outro motivo" (o hook passa isso).
 */
export function presentTrick(
  prev: TrickPresentation,
  view: SeatView,
  batch: GameEvent[],
  batchIsNew: boolean,
  now: number,
): TrickPresentation {
  // Vaza aberta: a verdade é a view. Isso também é o fast-forward de reconexão — se já há carta
  // nova na mesa, nada de segurar a anterior.
  if (view.currentRound.length > 0) return openTrick(view.currentRound, view.rounds.length);

  if (batchIsNew) {
    const lastRound = [...batch].reverse().find((e) => e.type === 'ROUND_ENDED');
    if (lastRound && lastRound.type === 'ROUND_ENDED') {
      const handEnded = batch.some((e) => e.type === 'HAND_ENDED');
      const plays = resolvedPlays(prev, view, batch, lastRound.round, handEnded);
      if (plays.length > 0) {
        const holdUntil = now + TRICK_TIMING.flyMs + TRICK_TIMING.holdMs;
        return {
          phase: 'resolved',
          plays,
          round: lastRound.round,
          leadingSeat: null,
          resolved: {
            winnerSeat: lastRound.winnerSeat,
            winner: lastRound.winner,
            cango: lastRound.winner === null ? cangoNote(batch, lastRound.round) : null,
          },
          handEnded,
          holdUntil,
          clearAt: holdUntil + TRICK_TIMING.collectMs,
        };
      }
    }
    // Lote sem vaza fechada e mesa vazia (truco, mão de onze, começo de mão): nada a segurar.
    if (prev.phase === 'open') return EMPTY_TRICK;
  }

  return advance(prev, now);
}

/** Só o relógio andou: passa de "segurando" para "recolhendo" e de "recolhendo" para vazio. */
export function advance(prev: TrickPresentation, now: number): TrickPresentation {
  if (prev.phase === 'resolved' && prev.holdUntil !== null && now >= prev.holdUntil) {
    return { ...prev, phase: 'collecting' };
  }
  if (prev.phase === 'collecting' && prev.clearAt !== null && now >= prev.clearAt) {
    return EMPTY_TRICK;
  }
  return prev;
}

/** A mesa está ocupada mostrando uma vaza fechada: ninguém joga, a cerimônia espera. */
export function isHolding(t: TrickPresentation): boolean {
  return t.phase === 'resolved' || t.phase === 'collecting';
}

/** Quando o hook deve acordar de novo para avançar a apresentação (`null` = nada agendado). */
export function nextWakeAt(t: TrickPresentation): number | null {
  if (t.phase === 'resolved') return t.holdUntil;
  if (t.phase === 'collecting') return t.clearAt;
  return null;
}
