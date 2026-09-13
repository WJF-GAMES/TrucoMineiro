import { buildMatchAnalysis } from '../matchAnalysis';
import type { GameEvent } from '@/domain/game';

/** Carta qualquer: a análise só olha quem jogou, não o valor. */
const card = { id: '4P', rank: '4', suit: 'P' } as unknown as GameEvent extends {
  type: 'CARD_PLAYED';
  card: infer C;
}
  ? C
  : never;

describe('buildMatchAnalysis', () => {
  it('devolve um resumo vazio e coerente quando não há eventos', () => {
    const a = buildMatchAnalysis([], 0);
    expect(a.handsPlayed).toBe(0);
    expect(a.rounds).toEqual({ won: 0, lost: 0, tied: 0 });
    expect(a.highestHandValue).toBe(1);
    expect(a.insights).toEqual([]);
  });

  it('conta rodadas do ponto de vista do meu time', () => {
    const events: GameEvent[] = [
      { type: 'HAND_STARTED', number: 1, dealerSeat: 3, firstSeat: 0 },
      { type: 'ROUND_ENDED', round: 1, winner: 0, winnerSeat: 0 },
      { type: 'ROUND_ENDED', round: 2, winner: 1, winnerSeat: 1 },
      { type: 'ROUND_ENDED', round: 3, winner: null, winnerSeat: 2 },
    ];
    expect(buildMatchAnalysis(events, 0).rounds).toEqual({ won: 1, lost: 1, tied: 1 });
    expect(buildMatchAnalysis(events, 1).rounds).toEqual({ won: 1, lost: 1, tied: 1 });
  });

  it('separa trucos pedidos por mim e contra mim pelo assento', () => {
    const events: GameEvent[] = [
      { type: 'HAND_STARTED', number: 1, dealerSeat: 3, firstSeat: 0 },
      { type: 'TRUCO_REQUESTED', seat: 0, value: 3 },
      { type: 'TRUCO_ACCEPTED', seat: 1, value: 3 },
      { type: 'TRUCO_REQUESTED', seat: 1, value: 3 },
      { type: 'TRUCO_RAISED', seat: 2, value: 6 },
    ];
    const a = buildMatchAnalysis(events, 0);
    // Assentos 0 e 2 são o meu time; 1 e 3 são adversários.
    expect(a.truco.calledByUs).toBe(1);
    expect(a.truco.calledByThem).toBe(1);
    expect(a.truco.acceptedByThem).toBe(1);
    expect(a.truco.raisedByUs).toBe(1);
    expect(a.highestHandValue).toBe(6);
  });

  it('atribui pontos de mãos apostadas ao time que venceu', () => {
    const events: GameEvent[] = [
      { type: 'HAND_STARTED', number: 1, dealerSeat: 3, firstSeat: 0 },
      { type: 'TRUCO_REQUESTED', seat: 0, value: 3 },
      { type: 'TRUCO_ACCEPTED', seat: 1, value: 3 },
      { type: 'HAND_ENDED', result: { winner: 0, points: 3, reason: 'ROUNDS' }, scores: [3, 0] },
      // Mão seguinte sem truco: o valor tem de voltar a 1.
      { type: 'HAND_STARTED', number: 2, dealerSeat: 0, firstSeat: 1 },
      { type: 'HAND_ENDED', result: { winner: 1, points: 1, reason: 'ROUNDS' }, scores: [3, 1] },
    ];
    const a = buildMatchAnalysis(events, 0);
    expect(a.handsPlayed).toBe(2);
    expect(a.points).toEqual({ us: 3, them: 1, fromRaisedHands: { us: 3, them: 0 } });
  });

  it('conta fugas e mão de onze do meu time', () => {
    const events: GameEvent[] = [
      { type: 'HAND_STARTED', number: 1, dealerSeat: 3, firstSeat: 0 },
      { type: 'RAN', seat: 2, points: 1, winner: 1 },
      { type: 'MAO_DE_ONZE_ACCEPTED', team: 0 },
      { type: 'MAO_DE_ONZE_DECLINED', team: 1, winner: 0 },
    ];
    const a = buildMatchAnalysis(events, 0);
    expect(a.runs).toEqual({ us: 1, them: 0 });
    expect(a.maoDeOnze).toEqual({ acceptedByUs: 1, declinedByUs: 0 });
  });

  it('conta apenas as cartas jogadas pelo meu time', () => {
    const events: GameEvent[] = [
      { type: 'CARD_PLAYED', seat: 0, card },
      { type: 'CARD_PLAYED', seat: 1, card },
      { type: 'CARD_PLAYED', seat: 2, card },
    ];
    expect(buildMatchAnalysis(events, 0).cardsPlayed).toBe(2);
  });

  it('gera leituras em texto a partir dos números', () => {
    const events: GameEvent[] = [
      { type: 'HAND_STARTED', number: 1, dealerSeat: 3, firstSeat: 0 },
      { type: 'ROUND_ENDED', round: 1, winner: 0, winnerSeat: 0 },
      { type: 'ROUND_ENDED', round: 2, winner: 0, winnerSeat: 2 },
      { type: 'TRUCO_REQUESTED', seat: 1, value: 3 },
    ];
    const insights = buildMatchAnalysis(events, 0).insights;
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.join(' ')).toContain('truco');
  });
});
