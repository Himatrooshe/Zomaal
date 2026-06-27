export interface OtpProvider {
  sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<void>;
  verifyOtp(phone: string, otp: string): Promise<boolean>;
}
