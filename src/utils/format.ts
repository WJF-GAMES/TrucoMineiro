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

/**
 * "2d 14h 32min" — contagem regressiva da semana de liga.
 * Recebe milissegundos já calculados a partir do relógio do servidor (nunca do aparelho).
 */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min`;
  return 'Encerrando...';
}

/** 1 -> "I", 4 -> "IV". Usado na "Divisão I" do card da liga. */
export function romanNumeral(value: number): string {
  const n = Math.max(1, Math.floor(value));
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let rest = n;
  let out = '';
  for (const [value_, symbol] of table) {
    while (rest >= value_) {
      out += symbol;
      rest -= value_;
    }
  }
  return out;
}
