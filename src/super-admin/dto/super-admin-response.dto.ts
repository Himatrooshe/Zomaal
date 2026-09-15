import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ example: 'Password updated successfully' })
  message: string;
}

export class SuperAdminTokenPairDto {
  @ApiProperty({
    description: 'Super admin bearer token. Expires after 15 minutes.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Token used only with POST /admin/auth/refresh. Expires after 7 days.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;
}

export class SuperAdminSummaryDto {
  @ApiProperty({ example: 'b1f2c3d4-5678-90ab-cdef-1234567890ab' })
  id: string;

  @ApiProperty({ example: 'superadmin' })
  username: string;

  @ApiProperty({ example: '2026-09-12T09:00:00.000Z', nullable: true })
  lastLoginAt: string | null;
}

export class SuperAdminAuthResponseDto extends SuperAdminTokenPairDto {
  @ApiProperty({ type: SuperAdminSummaryDto })
  admin: SuperAdminSummaryDto;
}
