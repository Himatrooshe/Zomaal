import {
  IsString,
  IsPhoneNumber,
  IsIn,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const OTP_CHANNELS = ['sms', 'whatsapp'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export class SendOtpDto {
  @ApiProperty({
    description: 'User phone number in international E.164 format.',
    example: '+212612345678',
    pattern: '^\\+[1-9]\\d{7,14}$',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiPropertyOptional({
    description: 'OTP delivery channel (the WhatsApp / SMS toggle).',
    example: 'sms',
    enum: OTP_CHANNELS,
    default: 'sms',
  })
  @IsOptional()
  @IsString()
  @IsIn(OTP_CHANNELS, { message: 'channel must be sms or whatsapp' })
  channel?: OtpChannel;
}
