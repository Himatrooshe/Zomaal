import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Phone number in international E.164 format.',
    example: '+212612345678',
    pattern: '^\\+[1-9]\\d{7,14}$',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({
    description: 'Account password (minimum 8 characters).',
    example: 'your-password',
    minLength: 8,
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    description:
      '"Remember me". When true the refresh token lasts 30 days instead of 7, and keeps that lifetime on every refresh.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
