import {
  IsString,
  IsPhoneNumber,
  IsIn,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Q1.2: OTP goes by SMS only for now; WhatsApp delivery is not offered yet.
export const OTP_CHANNELS = ['sms'] as const;
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
    description: 'OTP delivery channel. Only SMS is available for now.',
    example: 'sms',
    enum: OTP_CHANNELS,
    default: 'sms',
  })
  @IsOptional()
  @IsString()
  @IsIn(OTP_CHANNELS, { message: 'channel must be sms' })
  channel?: OtpChannel;
}
