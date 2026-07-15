import { IsString, IsPhoneNumber, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({
    description: 'User phone number in international E.164 format.',
    example: '+212612345678',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({
    description: 'OTP delivery channel.',
    example: 'sms',
    enum: ['sms', 'whatsapp'],
  })
  @IsString()
  @IsIn(['sms', 'whatsapp'])
  channel!: 'sms' | 'whatsapp';
}
