import { IsString, IsPhoneNumber, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: '+14155551234' })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({ example: 'sms', enum: ['sms', 'whatsapp'] })
  @IsString()
  @IsIn(['sms', 'whatsapp'])
  channel!: 'sms' | 'whatsapp';
}
