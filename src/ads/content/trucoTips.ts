/**
 * Conteúdo liberado pelo Rewarded da Principal.
 *
 * São dicas de estratégia — conteúdo, nunca vantagem competitiva. Assistir a um anúncio não dá
 * XP, pontos de liga, cartas nem qualquer benefício dentro da partida.
 */
export interface TrucoTip {
  id: string;
  title: string;
  body: string;
}

export const TRUCO_TIPS: readonly TrucoTip[] = [
  {
    id: 'primeira_rodada',
    title: 'Ganhe a primeira, respire o resto',
    body: 'Quem leva a primeira rodada joga as outras duas com vantagem: cangar a segunda já fecha a mão. Gaste sua carta mais forte na primeira quando a mão for mediana.',
  },
  {
    id: 'guardar_manilha',
    title: 'Manilha guardada vale mais',
    body: 'Com uma manilha e duas cartas fracas, perca a primeira de propósito com a mais fraca. Você entrega uma rodada, mas passa a mandar nas duas seguintes.',
  },
  {
    id: 'truco_de_pressao',
    title: 'Trucar não é só ter carta',
    body: 'Pedir truco logo depois de vencer a primeira rodada assusta: o adversário sabe que um cango já te dá a mão. É o momento em que o blefe custa mais barato.',
  },
  {
    id: 'ler_o_parceiro',
    title: 'Leia a carta do parceiro',
    body: 'Se o parceiro começa a rodada com carta baixa, ele está dizendo que a mão dele é fraca. Segure o truco e economize as suas cartas fortes.',
  },
  {
    id: 'mao_de_onze',
    title: 'Mão de onze é decisão de placar',
    body: 'Com 11 a favor, aceitar vale três pontos e pode fechar o jogo; recusar entrega só um. Olhe o placar do adversário antes das cartas: contra 11 a 11, quase sempre vale jogar.',
  },
  {
    id: 'blefe_com_ritmo',
    title: 'Ritmo entrega mais que carta',
    body: 'Jogar sempre na mesma velocidade esconde a sua mão. Demorar só quando está em dúvida é um sinal que bons adversários leem rápido.',
  },
  {
    id: 'empate_estrategico',
    title: 'Cango é aliado de quem vem na frente',
    body: 'Ganhou a primeira? Cangar a segunda já encerra a mão a seu favor. Jogue uma carta que cangue com a do adversário em vez de gastar a manilha. Mas se a primeira cangar, todo mundo joga a maior carta na seguinte.',
  },
  {
    id: 'correr_na_hora',
    title: 'Correr também é jogada',
    body: 'Fugir de um truco custa um ponto; insistir numa mão perdida pode custar três ou mais. Quando as duas cartas restantes são fracas, correr é economia, não covardia.',
  },
];

/** Escolhe a próxima dica de forma estável, sem repetir a anterior. */
export function nextTip(previousId: string | null): TrucoTip {
  const pool = previousId ? TRUCO_TIPS.filter((t) => t.id !== previousId) : TRUCO_TIPS;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? TRUCO_TIPS[0]!;
}
