import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiPropertyOptional({
    description:
      'Required only if the account already has a password set. Omit when setting a password for the first time (accounts created via OTP have none until now).',
    minLength: 8,
    format: 'password',
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  currentPassword?: string;

  @ApiProperty({ minLength: 8, format: 'password', writeOnly: true })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
