/** Log de anúncios: só existe em desenvolvimento (item 86 do plano). */
export function adLog(scope: string, message: string, extra?: unknown) {
  if (!__DEV__) return;
  const tag = scope ? `[ADS][${scope}]` : '[ADS]';
  if (extra !== undefined) console.log(tag, message, extra);
  else console.log(tag, message);
}
