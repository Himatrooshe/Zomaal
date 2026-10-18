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

  @ApiProperty({
    description:
      'Whether the account has a password. False right after OTP sign-up — show Set Password (PATCH /users/me/password without currentPassword).',
    example: false,
  })
  hasPassword: boolean;
}

export class OtpCountryDto {
  @ApiProperty({ description: 'ISO 3166-1 alpha-2 code.', example: 'MA' })
  code: string;

  @ApiProperty({ description: 'English country name.', example: 'Morocco' })
  name: string;

  @ApiProperty({
    description: 'International dialling code, prefixed with +.',
    example: '+212',
  })
  dialCode: string;

  @ApiProperty({ description: 'Flag emoji.', example: '🇲🇦' })
  flag: string;

  @ApiProperty({
    description:
      'Whether an OTP can be sent by SMS to numbers from this country. When false, hide or disable the SMS option.',
  })
  sms: boolean;

  @ApiProperty({
    description:
      'Whether an OTP can be sent by WhatsApp to numbers from this country.',
  })
  whatsapp: boolean;
}

export class OtpCountriesResponseDto {
  @ApiProperty({
    description: 'Country to preselect in the phone picker.',
    example: 'MA',
  })
  defaultCountry: string;

  @ApiProperty({
    type: [OtpCountryDto],
    description: 'All countries, sorted by name.',
  })
  countries: OtpCountryDto[];
}

export class PasswordChangedResponseDto extends TokenPairDto {
  @ApiProperty({ example: 'Password updated successfully' })
  message: string;
}
