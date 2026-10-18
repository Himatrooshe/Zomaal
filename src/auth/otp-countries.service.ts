import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import type { OtpChannel } from './dto/send-otp.dto';

export interface OtpCountry {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  sms: boolean;
  whatsapp: boolean;
}

const FALLBACK_DEFAULT_COUNTRY = 'MA';

/**
 * Countries the phone picker can offer, with the OTP channels that work for
 * each. Channel blocks mirror the OTP provider's own geo permissions and are
 * configured per environment (OTP_SMS_DISABLED_COUNTRIES /
 * OTP_WHATSAPP_DISABLED_COUNTRIES, comma-separated ISO codes).
 */
@Injectable()
export class OtpCountriesService {
  private readonly smsDisabled: Set<string>;
  private readonly whatsappDisabled: Set<string>;
  private readonly defaultCountry: string;
  private cached: OtpCountry[] | null = null;

  constructor(configService: ConfigService) {
    this.smsDisabled = parseCountryList(
      configService.get<string>('OTP_SMS_DISABLED_COUNTRIES'),
    );
    this.whatsappDisabled = parseCountryList(
      configService.get<string>('OTP_WHATSAPP_DISABLED_COUNTRIES'),
    );
    const configured = configService
      .get<string>('OTP_DEFAULT_COUNTRY')
      ?.trim()
      .toUpperCase();
    this.defaultCountry =
      configured && isKnownCountry(configured)
        ? configured
        : FALLBACK_DEFAULT_COUNTRY;
  }

  list(): { defaultCountry: string; countries: OtpCountry[] } {
    if (!this.cached) {
      const names = new Intl.DisplayNames(['en'], { type: 'region' });
      this.cached = getCountries()
        .map((code) => ({
          code,
          name: names.of(code) ?? code,
          dialCode: `+${getCountryCallingCode(code)}`,
          flag: flagEmoji(code),
          sms: !this.smsDisabled.has(code),
          whatsapp: !this.whatsappDisabled.has(code),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    }
    return { defaultCountry: this.defaultCountry, countries: this.cached };
  }

  /** Rejects before calling the provider when the channel is off for the number's country. */
  assertChannelAvailable(phone: string, channel: OtpChannel): void {
    const country = parsePhoneNumberFromString(phone)?.country;
    if (!country) return;
    const disabled =
      channel === 'whatsapp' ? this.whatsappDisabled : this.smsDisabled;
    if (disabled.has(country)) {
      const channelName = channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
      throw new BadRequestException(
        `${channelName} verification is not available for this country`,
      );
    }
  }
}

function parseCountryList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(isKnownCountry),
  );
}

function isKnownCountry(code: string): code is CountryCode {
  return (getCountries() as string[]).includes(code);
}

function flagEmoji(code: string): string {
  return String.fromCodePoint(
    ...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}
