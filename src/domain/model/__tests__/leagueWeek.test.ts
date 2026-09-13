import {
  compareWeekKeys,
  isValidWeekKey,
  nextWeekKey,
  previousWeekKey,
  weekKeyFor,
  weekStartMs,
  weekWindow,
  weekWindowFor,
  weeksBetween,
} from '../leagueWeek';

/** Instante UTC correspondente a uma data/hora de São Paulo (UTC-3 fixo desde 2019). */
const sp = (iso: string) => Date.parse(`${iso}-03:00`);

describe('weekKeyFor', () => {
  it('usa a semana ISO', () => {
    expect(weekKeyFor(sp('2026-09-13T12:00:00'))).toBe('2026-W37');
    expect(weekKeyFor(sp('2026-01-01T12:00:00'))).toBe('2026-W01');
  });

  it('vira exatamente à meia-noite de segunda em São Paulo', () => {
    // Domingo 23:59:59 ainda é a semana que acaba.
    expect(weekKeyFor(sp('2026-09-13T23:59:59'))).toBe('2026-W37');
    // Segunda 00:00:00 já é a semana seguinte.
    expect(weekKeyFor(sp('2026-09-14T00:00:00'))).toBe('2026-W38');
  });

  it('não depende do relógio local: 21:00 UTC de domingo já é segunda em SP? não', () => {
    // 2026-09-14T00:00 SP === 2026-09-14T03:00Z
    expect(weekKeyFor(Date.parse('2026-09-14T02:59:59Z'))).toBe('2026-W37');
    expect(weekKeyFor(Date.parse('2026-09-14T03:00:00Z'))).toBe('2026-W38');
  });

  it('trata a virada de ano ISO', () => {
    // 2027-01-01 é uma sexta; a semana ISO ainda é a 53 de 2026.
    expect(weekKeyFor(sp('2027-01-01T12:00:00'))).toBe('2026-W53');
    expect(weekKeyFor(sp('2027-01-04T12:00:00'))).toBe('2027-W01');
  });
});

describe('weekStartMs / weekWindow', () => {
  it('faz round-trip com weekKeyFor', () => {
    let t = sp('2024-01-01T00:00:00');
    for (let i = 0; i < 400; i++) {
      const key = weekKeyFor(t);
      expect(weekKeyFor(weekStartMs(key))).toBe(key);
      t += 7 * 86_400_000 + 3_600_000; // avança semanas com um deslocamento qualquer
    }
  });

  it('a janela dura exatamente 7 dias e começa numa segunda 00:00 de SP', () => {
    const { startAt, endAt } = weekWindow('2026-W37');
    expect(endAt - startAt).toBe(7 * 86_400_000);
    expect(new Date(startAt).toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  it('weekWindowFor devolve a janela que contém o instante', () => {
    const at = sp('2026-09-10T18:30:00');
    const w = weekWindowFor(at);
    expect(w.weekKey).toBe('2026-W37');
    expect(at).toBeGreaterThanOrEqual(w.startAt);
    expect(at).toBeLessThan(w.endAt);
  });

  it('janelas consecutivas se encaixam sem buraco nem sobreposição', () => {
    let key = '2025-W50';
    for (let i = 0; i < 60; i++) {
      const a = weekWindow(key);
      const b = weekWindow(nextWeekKey(key));
      expect(b.startAt).toBe(a.endAt);
      key = b.weekKey;
    }
  });
});

describe('navegação entre semanas', () => {
  it('avança e volta', () => {
    expect(nextWeekKey('2026-W37')).toBe('2026-W38');
    expect(previousWeekKey('2026-W38')).toBe('2026-W37');
    expect(nextWeekKey('2026-W52')).toBe('2026-W53');
    expect(nextWeekKey('2026-W53')).toBe('2027-W01');
    expect(previousWeekKey('2027-W01')).toBe('2026-W53');
  });

  it('compara cronologicamente, não em texto', () => {
    expect(compareWeekKeys('2026-W53', '2027-W01')).toBeLessThan(0);
    expect(compareWeekKeys('2026-W37', '2026-W37')).toBe(0);
    expect(weeksBetween('2026-W37', '2026-W40')).toBe(3);
    expect(weeksBetween('2026-W53', '2027-W01')).toBe(1);
  });
});

describe('isValidWeekKey', () => {
  it.each(['2026-W01', '2026-W53'])('aceita %s', (k) => expect(isValidWeekKey(k)).toBe(true));
  it.each(['2026-W00', '2026-W54', '2026-37', 'W37', '', null, 42])('rejeita %s', (k) =>
    expect(isValidWeekKey(k)).toBe(false),
  );
});
