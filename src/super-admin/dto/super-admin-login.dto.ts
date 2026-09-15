import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SuperAdminLoginDto {
  @ApiProperty({
    description: 'Super admin username configured through SUPERADMIN_USERNAME.',
    example: 'superadmin',
  })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({
    description: 'Super admin password configured through SUPERADMIN_PASSWORD.',
    minLength: 8,
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;
}
