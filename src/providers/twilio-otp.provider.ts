import {
  Injectable,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { OtpProvider } from '../interfaces/otp-provider.interface';

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
      throw new InternalServerErrorException('Failed to send OTP');
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
      this.logger.error(
        `Error verifying OTP for ${this.maskPhone(phone)}: ${String(error)}`,
      );
      return false;
    }
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
