import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SuperAdminChangePasswordDto {
  @ApiProperty({
    description: 'Current super admin password.',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({
    description: 'New super admin password.',
    minLength: 8,
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}
