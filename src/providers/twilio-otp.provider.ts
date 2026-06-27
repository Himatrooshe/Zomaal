import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { OtpProvider } from '../interfaces/otp-provider.interface';

@Injectable()
export class TwilioOtpProvider implements OtpProvider {
  private readonly logger = new Logger(TwilioOtpProvider.name);
  private twilioClient: Twilio;
  private serviceSid: string;

  constructor(private configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.serviceSid = this.configService.get<string>('TWILIO_SERVICE_SID') || '';

    if (!accountSid || !authToken || !this.serviceSid) {
      this.logger.error('Twilio credentials missing in environment variables');
    }

    this.twilioClient = new Twilio(accountSid, authToken);
  }

  async sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<void> {
    try {
      this.logger.log(`Sending OTP to ${phone} via ${channel}`);
      await this.twilioClient.verify.v2
        .services(this.serviceSid)
        .verifications.create({ to: phone, channel });
    } catch (error) {
      this.logger.error(`Error sending OTP to ${phone}: ${error}`);
      throw new InternalServerErrorException('Failed to send OTP');
    }
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    try {
      const verificationCheck = await this.twilioClient.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({ to: phone, code: otp });

      return verificationCheck.status === 'approved';
    } catch (error) {
      this.logger.error(`Error verifying OTP for ${phone}: ${error}`);
      return false;
    }
  }
}
