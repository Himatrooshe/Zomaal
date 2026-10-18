import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';

const FALLBACK_COUNTRY: CountryCode = 'MA';

let countryByName: Map<string, CountryCode> | null = null;

/** Store.country holds a name ("Morocco") or an ISO code ("MA"). */
export function resolveCountryCode(
  country: string | null | undefined,
  fallback: string | null | undefined = FALLBACK_COUNTRY,
): CountryCode {
  const known = new Set<string>(getCountries());
  const value = country?.trim() ?? '';
  if (value.length === 2 && known.has(value.toUpperCase())) {
    return value.toUpperCase() as CountryCode;
  }
  if (value) {
    const match = countryNames().get(value.toLowerCase());
    if (match) return match;
  }
  const fb = fallback?.trim().toUpperCase() ?? '';
  return known.has(fb) ? (fb as CountryCode) : FALLBACK_COUNTRY;
}

/** E.164 for a valid mobile-capable number, otherwise null. */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode,
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const international = value.startsWith('00') ? `+${value.slice(2)}` : value;
  const parsed = parsePhoneNumberFromString(international, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  const type = parsed.getType();
  if (type && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') {
    return null;
  }
  return parsed.number;
}

function countryNames(): Map<string, CountryCode> {
  if (countryByName) return countryByName;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  countryByName = new Map();
  for (const code of getCountries()) {
    const name = names.of(code);
    if (name) countryByName.set(name.toLowerCase(), code);
  }
  return countryByName;
}
