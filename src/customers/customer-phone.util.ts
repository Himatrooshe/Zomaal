import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';
import { resolveCountryCode } from '../whatsapp/whatsapp-phone.util';

/** Customer identity includes landlines; it must not use WhatsApp's mobile-only filter. */
export function customerPhoneIdentity(
  raw: string | null | undefined,
  country: string | null | undefined = 'MA',
) {
  const value = raw?.trim();
  if (!value) return null;
  // Preserve non-phone legacy references verbatim; never collapse their digits
  // onto a real person's phone (old manual imports can contain placeholders).
  if (!/^[+\d\s().-]+$/.test(value))
    return { phone: value, digitAliases: [value.replace(/\D/g, '')] };
  const defaultCountry: CountryCode = resolveCountryCode(country);
  const international = value.startsWith('00') ? `+${value.slice(2)}` : value;
  let parsed = parsePhoneNumberFromString(international, {
    defaultCountry,
    extract: false,
  });
  if (!parsed?.isValid() && !/^[+0]/.test(international))
    parsed = parsePhoneNumberFromString(
      `+${international.replace(/\D/g, '')}`,
      { extract: false },
    );
  if (!parsed?.isValid())
    return { phone: value, digitAliases: [value.replace(/\D/g, '')] };
  return {
    phone: parsed.number,
    digitAliases: [
      ...new Set([
        parsed.number.slice(1),
        `00${parsed.number.slice(1)}`,
        parsed.nationalNumber,
        parsed.formatNational().replace(/\D/g, ''),
        value.replace(/\D/g, ''),
      ]),
    ],
  };
}
