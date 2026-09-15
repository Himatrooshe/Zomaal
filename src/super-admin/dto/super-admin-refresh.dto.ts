import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SuperAdminRefreshTokenDto {
  @ApiProperty({
    description:
      'Refresh token returned by POST /admin/auth/login or the previous refresh call. Send it in the JSON body, not in the Authorization header.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
