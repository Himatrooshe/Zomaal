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
      'Token used only with POST /auth/refresh. Expires after 7 days.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;
}

export class AuthTokensResponseDto extends TokenPairDto {
  @ApiProperty({
    description: 'Whether the user has completed store onboarding.',
    example: false,
  })
  isProfileCompleted: boolean;
}
