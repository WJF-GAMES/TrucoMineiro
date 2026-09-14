import {
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  TARGET_GROUP_SIZE,
  needsRebalance,
  planGroupSizes,
  planRebalance,
  splitEvenly,
  zonesForGroupSize,
} from '../leagueGroups';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('planGroupSizes', () => {
  it.each([
    [1, [1]],
    [5, [5]],
    [10, [10]],
    [14, [14]],
    [15, [15]],
    [20, [20]],
    [21, [21]], // nunca 20 + 1
    [22, [22]],
    [29, [29]],
    [30, [15, 15]],
    [31, [16, 15]],
    [39, [20, 19]],
    [40, [20, 20]],
    [41, [21, 20]],
    [45, [23, 22]],
    [59, [20, 20, 19]],
    [60, [20, 20, 20]],
    [61, [21, 20, 20]],
    [79, [20, 20, 20, 19]],
    [80, [20, 20, 20, 20]],
    [81, [21, 20, 20, 20]],
  ])('distribui %i jogadores como %j', (total, expected) => {
    expect(planGroupSizes(total)).toEqual(expected);
  });

  it('não cria grupo para zero jogadores', () => {
    expect(planGroupSizes(0)).toEqual([]);
  });

  it('mantém todos os jogadores em algum grupo, de 1 a 1000', () => {
    for (let n = 1; n <= 1000; n++) {
      const sizes = planGroupSizes(n);
      expect(sum(sizes)).toBe(n);
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThan(0);
    }
  });

  it('respeita MIN_GROUP_SIZE sempre que existe mais de um grupo', () => {
    for (let n = 1; n <= 1000; n++) {
      const sizes = planGroupSizes(n);
      if (sizes.length > 1) expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_GROUP_SIZE);
    }
  });

  it('nunca deixa mais de 1 jogador de diferença entre grupos', () => {
    for (let n = 1; n <= 1000; n++) {
      const sizes = planGroupSizes(n);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('fica perto do alvo assim que há gente suficiente', () => {
    for (let n = 30; n <= 1000; n++) {
      const sizes = planGroupSizes(n);
      const worst = Math.max(...sizes.map((s) => Math.abs(s - TARGET_GROUP_SIZE)));
      expect(worst).toBeLessThanOrEqual(5);
    }
  });

  it('com 1000 jogadores usa 50 grupos de 20', () => {
    expect(planGroupSizes(1000)).toEqual(Array(50).fill(20));
  });
});

describe('splitEvenly', () => {
  it('devolve as partes maiores primeiro', () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(9, 3)).toEqual([3, 3, 3]);
    expect(splitEvenly(0, 3)).toEqual([]);
    expect(splitEvenly(5, 0)).toEqual([]);
  });
});

describe('zonesForGroupSize', () => {
  it('grupo de 20: 1-5 sobem, 16-20 descem', () => {
    expect(zonesForGroupSize(20)).toMatchObject({
      promotionCount: 5,
      relegationCount: 5,
      promotionStart: 1,
      promotionEnd: 5,
      relegationStart: 16,
      relegationEnd: 20,
    });
  });

  it('grupo de 21 mantém 5 e 5, exibindo o 21º de verdade', () => {
    expect(zonesForGroupSize(21)).toMatchObject({
      promotionEnd: 5,
      relegationStart: 17,
      relegationEnd: 21,
    });
  });

  it('grupo de 29 usa a mesma regra', () => {
    expect(zonesForGroupSize(29)).toMatchObject({ promotionEnd: 5, relegationStart: 25 });
  });

  it('reduz as zonas em grupos pequenos', () => {
    expect(zonesForGroupSize(14)).toMatchObject({ promotionCount: 3, relegationCount: 3 });
    expect(zonesForGroupSize(10)).toMatchObject({ promotionCount: 3, relegationCount: 3 });
    expect(zonesForGroupSize(9)).toMatchObject({ promotionCount: 2, relegationCount: 2 });
    expect(zonesForGroupSize(5)).toMatchObject({ promotionCount: 2, relegationCount: 2 });
    expect(zonesForGroupSize(4)).toMatchObject({ promotionCount: 1, relegationCount: 1 });
  });

  it('nunca sobrepõe as zonas, de 0 a 200 jogadores', () => {
    for (let size = 0; size <= 200; size++) {
      const z = zonesForGroupSize(size);
      expect(z.promotionCount + z.relegationCount).toBeLessThanOrEqual(size);
      if (z.promotionCount > 0 && z.relegationCount > 0) {
        expect(z.promotionEnd).toBeLessThan(z.relegationStart);
      }
      expect(z.relegationEnd).toBeLessThanOrEqual(size);
    }
  });

  it('grupo de 1 jogador não promove nem rebaixa', () => {
    expect(zonesForGroupSize(1)).toMatchObject({ promotionCount: 0, relegationCount: 0 });
  });
});

describe('needsRebalance', () => {
  it('não mexe enquanto o plano continua o mesmo', () => {
    expect(needsRebalance([20], 21)).toBe(false);
    expect(needsRebalance([25], 25)).toBe(false);
    expect(needsRebalance([20, 20], 41)).toBe(false);
  });

  it('rebalanceia quando o plano pede outra quantidade de grupos', () => {
    expect(needsRebalance([29], 30)).toBe(true);
    expect(needsRebalance([15, 15], 29)).toBe(true);
  });

  it('rebalanceia quando um grupo estoura o teto de tolerância', () => {
    expect(needsRebalance([MAX_GROUP_SIZE + 1], MAX_GROUP_SIZE + 1)).toBe(true);
  });

  it('cria grupo quando não existe nenhum e há jogadores', () => {
    expect(needsRebalance([], 1)).toBe(true);
    expect(needsRebalance([], 0)).toBe(false);
  });
});

describe('planRebalance', () => {
  const ids = (prefix: string, n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i + from}`);

  it('cria o primeiro grupo quando ainda não existe nenhum', () => {
    const plan = planRebalance([], ids('u', 7), (i) => `new-${i}`);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.memberIds).toHaveLength(7);
    expect(plan.groups[0]!.groupId).toBe('new-0');
  });

  it('quebra um grupo de 30 em dois de 15 mexendo o mínimo', () => {
    const members = ids('u', 30);
    const plan = planRebalance(
      [{ groupId: 'g1', memberIds: members }],
      members,
      (i) => `g${i + 1}`,
    );
    expect(plan.groups.map((g) => g.memberIds.length)).toEqual([15, 15]);
    expect(plan.groups[0]!.groupId).toBe('g1');
    // Só os 15 que saíram do grupo original se movem.
    expect(Object.keys(plan.moves)).toHaveLength(15);
  });

  it('mantém todo mundo e nunca duplica ninguém', () => {
    const members = ids('u', 137);
    const current = [
      { groupId: 'a', memberIds: members.slice(0, 60) },
      { groupId: 'b', memberIds: members.slice(60, 100) },
      { groupId: 'c', memberIds: members.slice(100) },
    ];
    const plan = planRebalance(current, members, (i) => `new-${i}`);
    const placed = plan.groups.flatMap((g) => g.memberIds);
    expect(placed).toHaveLength(members.length);
    expect(new Set(placed).size).toBe(members.length);
    expect([...placed].sort()).toEqual([...members].sort());
  });

  it('remove grupos que sobraram quando a liga encolhe', () => {
    const members = ids('u', 20);
    const current = [
      { groupId: 'a', memberIds: members.slice(0, 10) },
      { groupId: 'b', memberIds: members.slice(10) },
    ];
    const plan = planRebalance(current, members, (i) => `new-${i}`);
    expect(plan.groups).toHaveLength(1);
    expect(plan.removedGroupIds).toEqual(['b']);
  });

  it('descarta membros que não estão mais elegíveis', () => {
    const plan = planRebalance(
      [{ groupId: 'a', memberIds: ['u1', 'u2', 'saiu'] }],
      ['u1', 'u2'],
      (i) => `new-${i}`,
    );
    expect(plan.groups[0]!.memberIds.sort()).toEqual(['u1', 'u2']);
  });

  it('é idempotente: rodar de novo sobre o próprio resultado não move ninguém', () => {
    const members = ids('u', 83);
    const first = planRebalance([{ groupId: 'g0', memberIds: members }], members, (i) => `g${i}`);
    const second = planRebalance(first.groups, members, (i) => `g${i}`);
    expect(second.moves).toEqual({});
    expect(second.removedGroupIds).toEqual([]);
  });
});
