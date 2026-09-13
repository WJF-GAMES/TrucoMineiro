import { OTP_LENGTH, sanitizeOtp } from '../otp';

describe('sanitizeOtp', () => {
  it('keeps only digits', () => {
    expect(sanitizeOtp('123456')).toBe('123456');
    expect(sanitizeOtp('12a3b4')).toBe('1234');
    expect(sanitizeOtp('abc')).toBe('');
  });

  it('accepts a pasted code with spaces or extra text', () => {
    expect(sanitizeOtp('123 456')).toBe('123456');
    expect(sanitizeOtp('Seu código é 123456')).toBe('123456');
    expect(sanitizeOtp('123-456')).toBe('123456');
  });

  it('never exceeds the code length', () => {
    expect(sanitizeOtp('1234567890')).toHaveLength(OTP_LENGTH);
    expect(sanitizeOtp('1234567890')).toBe('123456');
    expect(sanitizeOtp('12345678', 4)).toBe('1234');
  });

  it('supports backspacing one digit at a time', () => {
    expect(sanitizeOtp('12345')).toBe('12345');
    expect(sanitizeOtp('1234')).toBe('1234');
    expect(sanitizeOtp('')).toBe('');
  });
});
