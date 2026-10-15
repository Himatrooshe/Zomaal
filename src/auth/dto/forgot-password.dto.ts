import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OTP_CHANNELS, type OtpChannel } from './send-otp.dto';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotPasswordRequestDto {
  @ApiProperty({
    description: 'Phone number of the account, in E.164 format.',
    example: '+212612345678',
    pattern: '^\\+[1-9]\\d{7,14}$',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiPropertyOptional({
    description: 'OTP delivery channel.',
    enum: OTP_CHANNELS,
    default: 'sms',
  })
  @IsOptional()
  @IsIn(OTP_CHANNELS, { message: 'channel must be sms or whatsapp' })
  channel?: OtpChannel;
}

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'resetToken returned by POST /auth/forgot-password/verify. Valid for 10 minutes and usable once.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  resetToken!: string;

  @ApiProperty({ minLength: 8, format: 'password', writeOnly: true })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
