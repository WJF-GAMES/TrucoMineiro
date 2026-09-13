import { AsYouType, parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

export interface Country {
  code: CountryCode;
  name: string;
  dial: string;
  flag: string; // emoji flag is used only inside the country picker text, not as an asset
}

export const COUNTRIES: Country[] = [
  { code: 'BR', name: 'Brasil', dial: '+55', flag: '🇧🇷' },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹' },
  { code: 'US', name: 'Estados Unidos', dial: '+1', flag: '🇺🇸' },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷' },
  { code: 'UY', name: 'Uruguai', dial: '+598', flag: '🇺🇾' },
  { code: 'PY', name: 'Paraguai', dial: '+595', flag: '🇵🇾' },
];

/** Maximum national digits accepted per country (keeps formatting meaningful). */
const MAX_NATIONAL_DIGITS: Partial<Record<CountryCode, number>> = {
  BR: 11,
  PT: 9,
  US: 10,
  AR: 10,
  UY: 8,
  PY: 9,
};

export function maxNationalDigits(country: CountryCode): number {
  return MAX_NATIONAL_DIGITS[country] ?? 15;
}



/**
 * Brazilian display mask: "(61) 9.9628-9726" for mobile (11 digits) and
 * "(61) 9628-9726" for landline (10 digits). Mask is presentation only.
 */
function formatBrazilian(digits: string): string {
  const d = digits.slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  // Brazilian mobile numbers start with 9 after the area code and show the dot separator.
  if (rest.startsWith('9')) {
    if (rest.length === 1) return `(${ddd}) 9`;
    if (rest.length <= 5) return `(${ddd}) 9.${rest.slice(1)}`;
    return `(${ddd}) 9.${rest.slice(1, 5)}-${rest.slice(5, 9)}`;
  }
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
}

/** Formats the national number as the user types. Extra digits are ignored. */
export function formatAsYouType(national: string, country: CountryCode): string {
  const digits = national.replace(/\D/g, '').slice(0, maxNationalDigits(country));
  if (country === 'BR') return formatBrazilian(digits);
  return new AsYouType(country).input(digits);
}

/**
 * Exemplo mostrado no campo vazio: só dígitos 9, já na máscara de cada país,
 * para o usuário ver o formato sem achar que é um número real.
 */
export const PHONE_PLACEHOLDER: Partial<Record<CountryCode, string>> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, formatAsYouType('9'.repeat(maxNationalDigits(c.code)), c.code)]),
);

/**
 * Returns the number in E.164 ("+5561996289726") or null when invalid.
 * Every mask character is stripped before parsing — Firebase always receives digits only.
 */
export function toE164(national: string, country: CountryCode): string | null {
  const digits = national.replace(/\D/g, '');
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(digits, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // libphonenumber returns E.164
}

/** Masks a phone for display: (61) 9.****-9726 */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  if (parsed.country === 'BR') {
    const d = parsed.nationalNumber;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 3)}.****-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ****-${d.slice(6)}`;
  }
  return parsed.formatNational().replace(/\d(?=\d{4})/g, (_m, i: number) => (i > 4 ? '*' : _m));
}
