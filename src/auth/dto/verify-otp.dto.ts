import { IsString, IsPhoneNumber, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'The same E.164 phone number used to request the OTP.',
    example: '+212612345678',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({
    description: 'Six-digit verification code.',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp!: string;
}
