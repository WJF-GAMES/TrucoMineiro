/**
 * Hand value ladder. The product requirement defines the calls
 * Truco, Seis, Nove, Doze: a hand starts at 1 point and climbs 3, 6, 9, 12.
 */
export const STAKE_LADDER: readonly number[] = [1, 3, 6, 9, 12];

export const STAKE_NAMES: Record<number, string> = {
  3: 'Truco',
  6: 'Seis',
  9: 'Nove',
  12: 'Doze',
};

export const TARGET_SCORE = 12;

/** Score at which "mao de onze" applies (one point short of winning). */
export const MAO_DE_ONZE_SCORE = TARGET_SCORE - 1;

export function nextStake(current: number): number | null {
  const idx = STAKE_LADDER.indexOf(current);
  if (idx < 0) throw new Error(`Unknown stake ${current}`);
  return STAKE_LADDER[idx + 1] ?? null;
}

export function stakeName(value: number): string {
  return STAKE_NAMES[value] ?? String(value);
}
