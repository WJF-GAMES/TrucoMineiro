/** 1250 -> "1.250" (pt-BR grouping) */
export function formatNumber(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatCurrencyBRL(cents: number): string {
  const v = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${v}`;
}

export function daysUntil(timestamp: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((timestamp - now) / 86_400_000));
}

export function pct(wins: number, matches: number): number {
  return matches === 0 ? 0 : Math.round((wins / matches) * 100);
}
