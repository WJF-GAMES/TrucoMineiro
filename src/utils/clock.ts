/** Relógio de parede isolado: hooks derivam prazos por decisão sem `Date.now()` solto no render. */
export function nowMs(): number {
  return Date.now();
}
