import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TwilioOtpProvider } from './twilio-otp.provider';

const SYNTHETIC_PHONE = '+212612345678';

function twilioError(code: number) {
  return Object.assign(new Error(`twilio ${code}`), { code, status: 400 });
}

function build() {
  const verifications = { create: jest.fn() };
  const verificationChecks = { create: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === 'TWILIO_ACCOUNT_SID'
        ? 'ACtest'
        : key === 'TWILIO_SERVICE_SID'
          ? 'VAtest'
          : 'test-token',
    ),
  };
  const provider = new TwilioOtpProvider(config as never);
  Object.assign(provider, {
    twilioClient: {
      verify: {
        v2: { services: () => ({ verifications, verificationChecks }) },
      },
    },
  });
  return { provider, verifications, verificationChecks };
}

describe('TwilioOtpProvider.sendOtp', () => {
  it('sends an SMS verification', async () => {
    const { provider, verifications } = build();
    verifications.create.mockResolvedValue({ status: 'pending' });

    await provider.sendOtp(SYNTHETIC_PHONE, 'sms');

    expect(verifications.create).toHaveBeenCalledWith({
      to: SYNTHETIC_PHONE,
      channel: 'sms',
    });
  });

  it.each([
    [60605, 'SMS verification is not available for this country'],
    [60205, 'This number cannot receive SMS. Use a mobile number.'],
    [60200, 'This phone number is not valid'],
  ])('maps Twilio %i to a 400', async (code, message) => {
    const { provider, verifications } = build();
    verifications.create.mockRejectedValue(twilioError(code));

    const error = await provider
      .sendOtp(SYNTHETIC_PHONE, 'sms')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(message);
  });

  it('names the WhatsApp channel in a country-blocked error', async () => {
    const { provider, verifications } = build();
    verifications.create.mockRejectedValue(twilioError(60605));

    await expect(provider.sendOtp(SYNTHETIC_PHONE, 'whatsapp')).rejects.toThrow(
      'WhatsApp verification is not available for this country',
    );
  });

  it('maps Twilio max send attempts to a 429', async () => {
    const { provider, verifications } = build();
    verifications.create.mockRejectedValue(twilioError(60203));

    const error = await provider
      .sendOtp(SYNTHETIC_PHONE, 'sms')
      .catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('maps an unknown failure to a 503', async () => {
    const { provider, verifications } = build();
    verifications.create.mockRejectedValue(new Error('socket hang up'));

    await expect(
      provider.sendOtp(SYNTHETIC_PHONE, 'sms'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('TwilioOtpProvider.verifyOtp', () => {
  it('returns true only when Twilio approves the code', async () => {
    const { provider, verificationChecks } = build();
    verificationChecks.create.mockResolvedValueOnce({ status: 'approved' });
    verificationChecks.create.mockResolvedValueOnce({ status: 'pending' });

    await expect(provider.verifyOtp(SYNTHETIC_PHONE, '123456')).resolves.toBe(
      true,
    );
    await expect(provider.verifyOtp(SYNTHETIC_PHONE, '000000')).resolves.toBe(
      false,
    );
  });

  it('treats an expired or already-used verification as a wrong code', async () => {
    const { provider, verificationChecks } = build();
    verificationChecks.create.mockRejectedValue(twilioError(20404));

    await expect(provider.verifyOtp(SYNTHETIC_PHONE, '123456')).resolves.toBe(
      false,
    );
  });

  it('maps Twilio max check attempts to a 429', async () => {
    const { provider, verificationChecks } = build();
    verificationChecks.create.mockRejectedValue(twilioError(60202));

    const error = await provider
      .verifyOtp(SYNTHETIC_PHONE, '123456')
      .catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('maps a provider outage to a 503 instead of "wrong code"', async () => {
    const { provider, verificationChecks } = build();
    verificationChecks.create.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(
      provider.verifyOtp(SYNTHETIC_PHONE, '123456'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
