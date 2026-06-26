import { Injectable, Logger } from '@nestjs/common';
import { OtpProvider } from '../interfaces/otp-provider.interface';

@Injectable()
export class MockOtpProvider implements OtpProvider {
  private readonly logger = new Logger(MockOtpProvider.name);

  async sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<void> {
    // For development, we simply log it and don't actually send a real SMS
    this.logger.log(`[Mock] Sending OTP to ${phone} via ${channel}`);
    // In the real implementation, this would call Twilio API
    return Promise.resolve();
  }
}
