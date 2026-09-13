/**
 * Log de desenvolvimento da mesa (CARD_PLAYED, TRICK_RESOLVED, TURN_CHANGED, TIMEOUT, cerimônia).
 * Some em produção: `__DEV__` é constante de build, o bundler remove o corpo.
 */
export function devLog(tag: string, ...args: unknown[]): void {
  if (__DEV__) console.log(`[table] ${tag}`, ...args);
}
