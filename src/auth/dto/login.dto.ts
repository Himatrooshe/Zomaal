import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Logger phone number in international E.164 format.',
    example: '+212600000001',
    pattern: '^\\+[1-9]\\d{7,14}$',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({
    description: 'Logger password configured through LOGGER_PASSWORD.',
    example: 'zomaal01@',
    minLength: 8,
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;
}
