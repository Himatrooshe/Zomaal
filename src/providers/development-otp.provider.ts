import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpProvider } from '../interfaces/otp-provider.interface';

@Injectable()
export class DevelopmentOtpProvider implements OtpProvider {
  private readonly logger = new Logger(DevelopmentOtpProvider.name);

  constructor(private readonly configService: ConfigService) {}

  sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<void> {
    void phone;
    void channel;
    this.logger.warn(
      `Development OTP requested. Use code ${this.getCode()}; no message was sent.`,
    );
    return Promise.resolve();
  }

  verifyOtp(phone: string, otp: string): Promise<boolean> {
    void phone;
    return Promise.resolve(otp === this.getCode());
  }

  private getCode(): string {
    return this.configService.get<string>('DEV_OTP_CODE', '123456');
  }
}
