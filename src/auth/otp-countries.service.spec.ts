import { BadRequestException } from '@nestjs/common';
import { OtpCountriesService } from './otp-countries.service';

function build(env: Record<string, string> = {}) {
  const configService = { get: jest.fn((key: string) => env[key]) };
  return new OtpCountriesService(configService as never);
}

describe('OtpCountriesService', () => {
  it('lists countries with dial code, flag and channels, sorted by name', () => {
    const { defaultCountry, countries } = build().list();

    expect(defaultCountry).toBe('MA');
    expect(countries.find((c) => c.code === 'MA')).toEqual({
      code: 'MA',
      name: 'Morocco',
      dialCode: '+212',
      flag: '🇲🇦',
      sms: true,
      whatsapp: true,
    });
    const names = countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('marks channels disabled per configured country', () => {
    const service = build({
      OTP_SMS_DISABLED_COUNTRIES: 'ma, xx',
      OTP_WHATSAPP_DISABLED_COUNTRIES: 'FR',
      OTP_DEFAULT_COUNTRY: 'fr',
    });
    const { defaultCountry, countries } = service.list();

    expect(defaultCountry).toBe('FR');
    const morocco = countries.find((c) => c.code === 'MA')!;
    expect([morocco.sms, morocco.whatsapp]).toEqual([false, true]);
    const france = countries.find((c) => c.code === 'FR')!;
    expect([france.sms, france.whatsapp]).toEqual([true, false]);
  });

  it('falls back to MA when the default country is unknown', () => {
    expect(build({ OTP_DEFAULT_COUNTRY: 'ZZ' }).list().defaultCountry).toBe(
      'MA',
    );
  });

  it('rejects a disabled channel before the provider is called', () => {
    const service = build({ OTP_SMS_DISABLED_COUNTRIES: 'MA' });

    expect(() =>
      service.assertChannelAvailable('+212612345678', 'sms'),
    ).toThrow(
      new BadRequestException(
        'SMS verification is not available for this country',
      ),
    );
    expect(() =>
      service.assertChannelAvailable('+212612345678', 'whatsapp'),
    ).not.toThrow();
    expect(() =>
      service.assertChannelAvailable('+33612345678', 'sms'),
    ).not.toThrow();
  });
});
