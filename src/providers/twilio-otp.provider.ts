import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { OtpProvider } from '../interfaces/otp-provider.interface';

// Twilio Verify error codes we turn into a clear client response.
// https://www.twilio.com/docs/api/errors
const TWILIO_INVALID_NUMBER = new Set([60200, 21211, 21614]);
const TWILIO_LANDLINE = 60205;
const TWILIO_COUNTRY_BLOCKED = new Set([60605, 60220]);
const TWILIO_DELIVERY_BLOCKED = 60410;
const TWILIO_TOO_MANY_SENDS = 60203;
const TWILIO_TOO_MANY_CHECKS = 60202;
const TWILIO_VERIFICATION_NOT_FOUND = 20404;
const TWILIO_RATE_LIMITED = 20429;

@Injectable()
export class TwilioOtpProvider implements OtpProvider {
  private readonly logger = new Logger(TwilioOtpProvider.name);
  private twilioClient: Twilio | null = null;
  private serviceSid = '';

  constructor(private configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.serviceSid =
      this.configService.get<string>('TWILIO_SERVICE_SID') ?? '';

    if (!accountSid || !authToken || !this.serviceSid) {
      this.logger.error('Twilio credentials missing in environment variables');
      return;
    }

    this.twilioClient = new Twilio(accountSid, authToken);
  }

  async sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<void> {
    const client = this.getClient();

    try {
      this.logger.log(`Sending OTP to ${this.maskPhone(phone)} via ${channel}`);
      await client.verify.v2
        .services(this.serviceSid)
        .verifications.create({ to: phone, channel });
    } catch (error) {
      this.logger.error(
        `Error sending OTP to ${this.maskPhone(phone)}: ${String(error)}`,
      );
      throw this.toSendException(twilioErrorCode(error));
    }
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const client = this.getClient();

    try {
      const verificationCheck = await client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({ to: phone, code: otp });

      return verificationCheck.status === 'approved';
    } catch (error) {
      const code = twilioErrorCode(error);
      // No pending verification: the code expired, was already used, or was
      // never sent — to the user this is simply a wrong/expired code.
      if (code === TWILIO_VERIFICATION_NOT_FOUND) {
        return false;
      }
      this.logger.error(
        `Error verifying OTP for ${this.maskPhone(phone)}: ${String(error)}`,
      );
      if (code === TWILIO_TOO_MANY_CHECKS) {
        throw new HttpException(
          'Too many wrong codes. Please request a new OTP.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        'Could not verify the code right now. Please try again.',
      );
    }
  }

  private toSendException(code: number | undefined): HttpException {
    if (code !== undefined && TWILIO_INVALID_NUMBER.has(code)) {
      return new BadRequestException('This phone number is not valid');
    }
    if (code === TWILIO_LANDLINE) {
      return new BadRequestException(
        'This number cannot receive SMS. Use a mobile number.',
      );
    }
    if (code !== undefined && TWILIO_COUNTRY_BLOCKED.has(code)) {
      return new BadRequestException(
        'SMS verification is not available for this country',
      );
    }
    if (code === TWILIO_DELIVERY_BLOCKED) {
      return new BadRequestException(
        'We could not send a code to this number. Please contact support.',
      );
    }
    if (code === TWILIO_TOO_MANY_SENDS || code === TWILIO_RATE_LIMITED) {
      return new HttpException(
        'Too many OTP requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return new ServiceUnavailableException(
      'Could not send the code right now. Please try again.',
    );
  }

  private getClient(): Twilio {
    if (!this.twilioClient || !this.serviceSid) {
      throw new ServiceUnavailableException('OTP service is not configured');
    }

    return this.twilioClient;
  }

  private maskPhone(phone: string): string {
    return phone.replace(/\d(?=\d{2})/g, '*');
  }
}

function twilioErrorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}
