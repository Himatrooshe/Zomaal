import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ example: 'OTP sent successfully' })
  message: string;
}

export class TokenPairDto {
  @ApiProperty({
    description: 'Zomaal bearer token. Expires after 15 minutes.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Token used only with POST /auth/refresh. Expires after 7 days, or 30 days when logged in with rememberMe.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;
}

export class PasswordResetTokenResponseDto {
  @ApiProperty({
    description:
      'Send to POST /auth/forgot-password/reset with the new password. Usable once.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  resetToken: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T18:10:00.000Z' })
  expiresAt: string;
}

export class AuthTokensResponseDto extends TokenPairDto {
  @ApiProperty({
    description: 'Whether the user has completed store onboarding.',
    example: false,
  })
  isProfileCompleted: boolean;
}
