import { teamOf, type GameEvent, type Team } from '@/domain/game';

/**
 * Análise da partida — o conteúdo liberado pelo Rewarded da tela de resultado.
 *
 * É derivada exclusivamente dos eventos que o motor já produziu, então não inventa nada e não
 * depende de rede. Função pura: entra `GameEvent[]`, sai um resumo serializável (ele viaja nos
 * parâmetros de navegação até a tela de resultado).
 */
export interface MatchAnalysis {
  handsPlayed: number;
  rounds: { won: number; lost: number; tied: number };
  truco: {
    calledByUs: number;
    calledByThem: number;
    acceptedByUs: number;
    acceptedByThem: number;
    raisedByUs: number;
    raisedByThem: number;
  };
  runs: { us: number; them: number };
  points: { us: number; them: number; fromRaisedHands: { us: number; them: number } };
  maoDeOnze: { acceptedByUs: number; declinedByUs: number };
  highestHandValue: number;
  cardsPlayed: number;
  /** Leituras em texto, prontas para a tela. */
  insights: string[];
}

export function buildMatchAnalysis(events: GameEvent[], myTeam: Team): MatchAnalysis {
  const a: MatchAnalysis = {
    handsPlayed: 0,
    rounds: { won: 0, lost: 0, tied: 0 },
    truco: {
      calledByUs: 0,
      calledByThem: 0,
      acceptedByUs: 0,
      acceptedByThem: 0,
      raisedByUs: 0,
      raisedByThem: 0,
    },
    runs: { us: 0, them: 0 },
    points: { us: 0, them: 0, fromRaisedHands: { us: 0, them: 0 } },
    maoDeOnze: { acceptedByUs: 0, declinedByUs: 0 },
    highestHandValue: 1,
    cardsPlayed: 0,
    insights: [],
  };

  // Valor corrente da mão: começa em 1 e sobe a cada truco aceito ou aumento.
  let handValue = 1;

  for (const e of events) {
    switch (e.type) {
      case 'HAND_STARTED':
        a.handsPlayed += 1;
        handValue = 1;
        break;
      case 'CARD_PLAYED':
        if (teamOf(e.seat) === myTeam) a.cardsPlayed += 1;
        break;
      case 'ROUND_ENDED':
        if (e.winner === null) a.rounds.tied += 1;
        else if (e.winner === myTeam) a.rounds.won += 1;
        else a.rounds.lost += 1;
        break;
      case 'TRUCO_REQUESTED':
        if (teamOf(e.seat) === myTeam) a.truco.calledByUs += 1;
        else a.truco.calledByThem += 1;
        break;
      case 'TRUCO_ACCEPTED':
        handValue = e.value;
        a.highestHandValue = Math.max(a.highestHandValue, e.value);
        if (teamOf(e.seat) === myTeam) a.truco.acceptedByUs += 1;
        else a.truco.acceptedByThem += 1;
        break;
      case 'TRUCO_RAISED':
        handValue = e.value;
        a.highestHandValue = Math.max(a.highestHandValue, e.value);
        if (teamOf(e.seat) === myTeam) a.truco.raisedByUs += 1;
        else a.truco.raisedByThem += 1;
        break;
      case 'RAN':
        if (teamOf(e.seat) === myTeam) a.runs.us += 1;
        else a.runs.them += 1;
        break;
      case 'MAO_DE_ONZE_ACCEPTED':
        if (e.team === myTeam) a.maoDeOnze.acceptedByUs += 1;
        break;
      case 'MAO_DE_ONZE_DECLINED':
        if (e.team === myTeam) a.maoDeOnze.declinedByUs += 1;
        break;
      case 'HAND_ENDED': {
        const { winner, points } = e.result;
        if (winner === null) break;
        if (winner === myTeam) a.points.us += points;
        else a.points.them += points;
        if (handValue > 1) {
          if (winner === myTeam) a.points.fromRaisedHands.us += points;
          else a.points.fromRaisedHands.them += points;
        }
        handValue = 1;
        break;
      }
      default:
        break;
    }
  }

  a.insights = buildInsights(a);
  return a;
}

function buildInsights(a: MatchAnalysis): string[] {
  const out: string[] = [];
  const totalRounds = a.rounds.won + a.rounds.lost + a.rounds.tied;

  if (totalRounds > 0) {
    const rate = Math.round((a.rounds.won / totalRounds) * 100);
    out.push(
      rate >= 55
        ? `Você venceu ${rate}% das rodadas: as cartas foram bem gastas, na hora certa.`
        : rate >= 40
          ? `Você venceu ${rate}% das rodadas — partida equilibrada, decidida nos detalhes.`
          : `Você venceu ${rate}% das rodadas. Tente segurar a carta mais forte para a segunda rodada.`,
    );
  }

  const ourCalls = a.truco.calledByUs;
  const theirCalls = a.truco.calledByThem;
  if (ourCalls === 0 && theirCalls > 0) {
    out.push(
      `A mesa pediu truco ${theirCalls}x e você nenhuma. Pedir depois de ganhar a primeira rodada é o blefe mais barato do jogo.`,
    );
  } else if (ourCalls > 0) {
    const won = a.points.fromRaisedHands.us;
    const lost = a.points.fromRaisedHands.them;
    out.push(
      won >= lost
        ? `Você pediu truco ${ourCalls}x e as mãos apostadas te renderam ${won} ponto(s) contra ${lost}. Agressividade pagou.`
        : `Você pediu truco ${ourCalls}x, mas as mãos apostadas custaram ${lost} ponto(s) contra ${won}. Vale medir melhor a mão antes de subir a aposta.`,
    );
  }

  if (a.runs.us > 0) {
    out.push(
      `Você correu ${a.runs.us}x. Correr com mão fraca economiza pontos — só cuidado para não virar leitura fácil para o adversário.`,
    );
  }

  if (a.highestHandValue >= 6) {
    out.push(`A mão mais cara da partida valeu ${a.highestHandValue} pontos. Partida quente.`);
  }

  if (a.maoDeOnze.acceptedByUs + a.maoDeOnze.declinedByUs > 0) {
    out.push(
      a.maoDeOnze.acceptedByUs > 0
        ? 'Você encarou a mão de onze. Com 11 pontos, aceitar vale 3 e pode fechar o jogo de uma vez.'
        : 'Você recusou a mão de onze e entregou 1 ponto. Contra adversário perto dos 12, encarar costuma ser o risco certo.',
    );
  }

  return out;
}
