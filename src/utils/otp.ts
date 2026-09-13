/** Comprimento do código de verificação enviado pelo Firebase. */
export const OTP_LENGTH = 6;

/**
 * Deixa só dígitos e corta no tamanho do código.
 *
 * Serve para digitação, colagem ("123 456", "Seu código é 123456") e para o
 * preenchimento automático do sistema, que pode entregar o texto com espaços.
 */
export function sanitizeOtp(text: string, length: number = OTP_LENGTH): string {
  return text.replace(/\D/g, '').slice(0, length);
}
