/**
 * Semana competitiva das ligas — ISO week no fuso de São Paulo.
 *
 * A virada NUNCA pode depender do relógio do aparelho: o backend calcula `weekKey`, `startAt` e
 * `endAt`, e o app só recebe os números. Este módulo é puro (roda igual no app e nas Functions)
 * para que os dois lados concordem sobre qual semana é "agora".
 *
 * Fuso: o Brasil aboliu o horário de verão em 2019, então America/Sao_Paulo é UTC-3 fixo.
 * Usar um offset constante (em vez de `Intl`) mantém o cálculo determinístico e testável nos dois
 * runtimes (Hermes e Node).
 */

export const SAO_PAULO_UTC_OFFSET_MINUTES = -180;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const OFFSET_MS = SAO_PAULO_UTC_OFFSET_MINUTES * MS_PER_MINUTE;

export const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Timestamp UTC da meia-noite de segunda-feira (em São Paulo) da semana que contém `atMs`.
 * É o instante em que a semana competitiva começa.
 */
function mondayStartMs(atMs: number): number {
  const local = atMs + OFFSET_MS;
  const localMidnight = Math.floor(local / MS_PER_DAY) * MS_PER_DAY;
  // 1970-01-01 foi uma quinta-feira (getUTCDay 4). Segunda = 1.
  const dayIndex = Math.floor(localMidnight / MS_PER_DAY);
  const isoDayFromMonday = (((dayIndex + 3) % 7) + 7) % 7; // 0 = segunda
  return localMidnight - isoDayFromMonday * MS_PER_DAY - OFFSET_MS;
}

/** Ano e semana ISO-8601 da segunda-feira que começa em `mondayMs`. */
function isoYearWeek(mondayMs: number): { year: number; week: number } {
  // A quinta-feira da semana define o ano ISO.
  const thursday = new Date(mondayMs + OFFSET_MS + 3 * MS_PER_DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / MS_PER_DAY / 7) + 1;
  return { year, week };
}

/** "2026-W37" para o instante informado (padrão: agora). */
export function weekKeyFor(atMs: number): string {
  const monday = mondayStartMs(atMs);
  const { year, week } = isoYearWeek(monday);
  return `${year}-W${pad2(week)}`;
}

/** Janela [startAt, endAt) da semana que contém `atMs`. */
export function weekWindowFor(atMs: number): { weekKey: string; startAt: number; endAt: number } {
  const startAt = mondayStartMs(atMs);
  return { weekKey: weekKeyFor(atMs), startAt, endAt: startAt + MS_PER_WEEK };
}

export function isValidWeekKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = WEEK_KEY_RE.exec(value);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= 53;
}

/**
 * Instante do início da semana identificada por `weekKey`.
 * Reconstrói a segunda-feira a partir da quinta-feira ISO, então bate exatamente com `weekKeyFor`.
 */
export function weekStartMs(weekKey: string): number {
  const m = WEEK_KEY_RE.exec(weekKey);
  if (!m) throw new Error(`weekKey inválida: ${weekKey}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan1 = Date.UTC(year, 0, 1);
  // Quinta-feira da semana 1 = a primeira quinta do ano.
  const jan1Day = (((new Date(jan1).getUTCDay() + 6) % 7) + 7) % 7; // 0 = segunda
  const firstThursday = jan1 + ((3 - jan1Day + 7) % 7) * MS_PER_DAY;
  const thursday = firstThursday + (week - 1) * MS_PER_WEEK;
  return thursday - 3 * MS_PER_DAY - OFFSET_MS;
}

export function weekWindow(weekKey: string): { weekKey: string; startAt: number; endAt: number } {
  const startAt = weekStartMs(weekKey);
  return { weekKey, startAt, endAt: startAt + MS_PER_WEEK };
}

export function nextWeekKey(weekKey: string): string {
  return weekKeyFor(weekStartMs(weekKey) + MS_PER_WEEK);
}

export function previousWeekKey(weekKey: string): string {
  return weekKeyFor(weekStartMs(weekKey) - MS_PER_DAY);
}

/** Negativo quando `a` é anterior a `b`. Comparação cronológica (não lexicográfica). */
export function compareWeekKeys(a: string, b: string): number {
  return weekStartMs(a) - weekStartMs(b);
}

/** Quantas semanas `weekKey` está atrás de `reference` (0 = mesma semana). */
export function weeksBetween(weekKey: string, reference: string): number {
  return Math.round((weekStartMs(reference) - weekStartMs(weekKey)) / MS_PER_WEEK);
}
