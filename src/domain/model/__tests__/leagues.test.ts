import {
  FIRST_LEAGUE_ID,
  LAST_LEAGUE_ID,
  LEAGUE_DEFINITIONS,
  LEAGUE_IDS,
  LEAGUE_NAMES,
  STARTING_LEAGUE_ID,
  isLeagueId,
  leagueAssetKey,
  leagueById,
  leagueByOrder,
  normalizeLeagueId,
  promotedLeagueId,
  relegatedLeagueId,
} from '../leagues';
import {
  MIN_WEEKLY_POINTS_FOR_PROMOTION,
  rankMembers,
  resolveWeeklyOutcomes,
  weeklyRuleText,
} from '../leagueRanking';
import type { LeagueId } from '../types';

const EXPECTED_ORDER: LeagueId[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'quartz',
  'topaz',
  'amethyst',
  'aquamarine',
  'tourmaline',
  'emerald',
  'sapphire',
  'ruby',
  'opal',
  'onyx',
  'obsidian',
  'diamond',
  'black_diamond',
  'imperial',
  'legendary',
  'legend_of_minas',
];

describe('escada de ligas', () => {
  it('tem exatamente 20 ligas na ordem oficial', () => {
    expect(LEAGUE_IDS).toEqual(EXPECTED_ORDER);
    expect(LEAGUE_DEFINITIONS).toHaveLength(20);
  });

  it('numera de 1 a 20 e encadeia anterior/próxima sem buraco', () => {
    LEAGUE_DEFINITIONS.forEach((league, i) => {
      expect(league.order).toBe(i + 1);
      expect(league.previousLeagueId).toBe(i === 0 ? null : EXPECTED_ORDER[i - 1]);
      expect(league.nextLeagueId).toBe(i === 19 ? null : EXPECTED_ORDER[i + 1]);
      expect(league.isFirst).toBe(i === 0);
      expect(league.isLast).toBe(i === 19);
      expect(leagueByOrder(league.order)).toBe(league);
    });
  });

  it('usa os nomes em português da spec', () => {
    expect(LEAGUE_NAMES.bronze).toBe('Bronze');
    expect(LEAGUE_NAMES.silver).toBe('Prata');
    expect(LEAGUE_NAMES.gold).toBe('Ouro');
    expect(LEAGUE_NAMES.platinum).toBe('Platina');
    expect(LEAGUE_NAMES.aquamarine).toBe('Água-marinha');
    expect(LEAGUE_NAMES.black_diamond).toBe('Diamante Negro');
    expect(LEAGUE_NAMES.legend_of_minas).toBe('Lenda de Minas');
  });

  it('deriva a assetKey do id', () => {
    expect(leagueAssetKey('gold')).toBe('shield_gold');
    expect(leagueAssetKey('legend_of_minas')).toBe('shield_legend_of_minas');
    LEAGUE_DEFINITIONS.forEach((l) => expect(l.assetKey).toBe(`shield_${l.id}`));
  });

  it('começa em Bronze e termina em Lenda de Minas', () => {
    expect(FIRST_LEAGUE_ID).toBe('bronze');
    expect(LAST_LEAGUE_ID).toBe('legend_of_minas');
    expect(STARTING_LEAGUE_ID).toBe('bronze');
  });
});

describe('normalização de id', () => {
  it('aceita os ids válidos', () => {
    EXPECTED_ORDER.forEach((id) => expect(isLeagueId(id)).toBe(true));
  });

  it('converte os ids antigos em português', () => {
    expect(normalizeLeagueId('prata')).toBe('silver');
    expect(normalizeLeagueId('ouro')).toBe('gold');
    expect(normalizeLeagueId('diamante')).toBe('diamond');
    expect(normalizeLeagueId('bronze')).toBe('bronze');
  });

  it('cai em Bronze diante de lixo, em vez de quebrar a tela', () => {
    expect(normalizeLeagueId(undefined)).toBe('bronze');
    expect(normalizeLeagueId('')).toBe('bronze');
    expect(normalizeLeagueId(7)).toBe('bronze');
    expect(leagueById(null).id).toBe('bronze');
  });
});

describe('promoção e rebaixamento', () => {
  it('cobre as 19 transições de subida', () => {
    for (let i = 0; i < EXPECTED_ORDER.length - 1; i++) {
      expect(promotedLeagueId(EXPECTED_ORDER[i]!)).toBe(EXPECTED_ORDER[i + 1]);
    }
  });

  it('cobre as 19 transições de descida', () => {
    for (let i = EXPECTED_ORDER.length - 1; i > 0; i--) {
      expect(relegatedLeagueId(EXPECTED_ORDER[i]!)).toBe(EXPECTED_ORDER[i - 1]);
    }
  });

  it('nunca pula liga', () => {
    EXPECTED_ORDER.forEach((id) => {
      const up = leagueById(promotedLeagueId(id)).order;
      const here = leagueById(id).order;
      expect(up - here).toBeLessThanOrEqual(1);
    });
  });

  it('Bronze é piso e Lenda de Minas é teto', () => {
    expect(relegatedLeagueId('bronze')).toBe('bronze');
    expect(promotedLeagueId('legend_of_minas')).toBe('legend_of_minas');
  });
});

// --- Ranking / resultado da semana ---------------------------------------------------------

const member = (uid: string, weeklyPoints: number, extra: Partial<{ tiebreakScore: number; wins: number; joinedAt: number }> = {}) => ({
  uid,
  weeklyPoints,
  tiebreakScore: extra.tiebreakScore ?? 0,
  wins: extra.wins ?? 0,
  joinedAt: extra.joinedAt ?? 0,
});

describe('rankMembers', () => {
  it('ordena por pontos, desempate, vitórias, chegada e uid', () => {
    const ranked = rankMembers([
      member('c', 100),
      member('a', 100, { tiebreakScore: 5 }),
      member('b', 200),
      member('d', 100, { joinedAt: -1 }),
    ]);
    expect(ranked.map((m) => m.uid)).toEqual(['b', 'a', 'd', 'c']);
    expect(ranked.map((m) => m.rank)).toEqual([1, 2, 3, 4]);
  });

  it('é estável e determinístico com todos os campos empatados', () => {
    const input = ['z', 'm', 'a'].map((u) => member(u, 10));
    expect(rankMembers(input).map((m) => m.uid)).toEqual(['a', 'm', 'z']);
    expect(rankMembers([...input].reverse()).map((m) => m.uid)).toEqual(['a', 'm', 'z']);
  });

  it('não muta a lista original', () => {
    const input = [member('b', 1), member('a', 2)];
    rankMembers(input);
    expect(input.map((m) => m.uid)).toEqual(['b', 'a']);
  });
});

describe('resolveWeeklyOutcomes', () => {
  const group = (size: number, points = (i: number) => (size - i) * 10) =>
    Array.from({ length: size }, (_, i) => member(`u${String(i).padStart(3, '0')}`, points(i)));

  it('grupo de 20: 5 sobem, 10 ficam, 5 descem', () => {
    const out = resolveWeeklyOutcomes('gold', group(20));
    expect(out.filter((o) => o.result === 'promoted')).toHaveLength(5);
    expect(out.filter((o) => o.result === 'stayed')).toHaveLength(10);
    expect(out.filter((o) => o.result === 'relegated')).toHaveLength(5);
    expect(out[0]!.nextLeagueId).toBe('platinum');
    expect(out[19]!.nextLeagueId).toBe('silver');
  });

  it('grupo de 21: zona de rebaixamento vai do 17º ao 21º', () => {
    const out = resolveWeeklyOutcomes('gold', group(21));
    const relegated = out.filter((o) => o.result === 'relegated').map((o) => o.finalRank);
    expect(relegated).toEqual([17, 18, 19, 20, 21]);
  });

  it('Bronze não rebaixa ninguém para fora da escada', () => {
    const out = resolveWeeklyOutcomes('bronze', group(20));
    const bottom = out.filter((o) => o.finalRank >= 16);
    expect(bottom.every((o) => o.result === 'bottom_league')).toBe(true);
    expect(bottom.every((o) => o.nextLeagueId === 'bronze')).toBe(true);
  });

  it('Lenda de Minas não promove ninguém para fora da escada', () => {
    const out = resolveWeeklyOutcomes('legend_of_minas', group(20));
    const top = out.filter((o) => o.finalRank <= 5);
    expect(top.every((o) => o.result === 'top_league')).toBe(true);
    expect(top.every((o) => o.nextLeagueId === 'legend_of_minas')).toBe(true);
  });

  it('quem não pontuou na semana não sobe de liga', () => {
    const out = resolveWeeklyOutcomes('gold', group(20, () => 0));
    expect(out.filter((o) => o.result === 'promoted')).toHaveLength(0);
    expect(out.filter((o) => o.result === 'relegated')).toHaveLength(5);
    expect(out[0]!.nextLeagueId).toBe('gold');
  });

  it('basta 1 ponto para valer a promoção', () => {
    const members = group(20, (i) => (i === 0 ? MIN_WEEKLY_POINTS_FOR_PROMOTION : 0));
    const out = resolveWeeklyOutcomes('gold', members);
    expect(out.filter((o) => o.result === 'promoted')).toHaveLength(1);
  });

  it('a soma dos resultados sempre cobre o grupo inteiro, de 1 a 60 jogadores', () => {
    for (let size = 1; size <= 60; size++) {
      const out = resolveWeeklyOutcomes('gold', group(size));
      expect(out).toHaveLength(size);
      expect(new Set(out.map((o) => o.finalRank)).size).toBe(size);
      expect(new Set(out.map((o) => o.uid)).size).toBe(size);
      const up = out.filter((o) => o.result === 'promoted').length;
      const down = out.filter((o) => o.result === 'relegated').length;
      expect(up + down).toBeLessThanOrEqual(size);
    }
  });

  it('percorre a escada inteira subindo e descendo', () => {
    let league: LeagueId = 'bronze';
    for (let i = 0; i < 19; i++) {
      league = resolveWeeklyOutcomes(league, group(20))[0]!.nextLeagueId;
    }
    expect(league).toBe('legend_of_minas');
    for (let i = 0; i < 19; i++) {
      const out = resolveWeeklyOutcomes(league, group(20));
      league = out[out.length - 1]!.nextLeagueId;
    }
    expect(league).toBe('bronze');
  });
});

describe('weeklyRuleText', () => {
  it('usa os números que o backend mandou', () => {
    expect(weeklyRuleText({ promotionCount: 5, relegationCount: 5 })).toContain(
      'Os 5 primeiros sobem de liga e os 5 últimos descem',
    );
    expect(weeklyRuleText({ promotionCount: 1, relegationCount: 1 })).toContain(
      'O 1º colocado sobe de liga e o último desce',
    );
  });

  it('explica quando o grupo é pequeno demais', () => {
    expect(weeklyRuleText({ promotionCount: 0, relegationCount: 0 })).toContain('pequeno demais');
  });
});
