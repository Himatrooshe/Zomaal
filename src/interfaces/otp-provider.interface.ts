export interface OtpProvider {
  sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<void>;
}
