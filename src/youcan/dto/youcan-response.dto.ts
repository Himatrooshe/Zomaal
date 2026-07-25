import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class YouCanAuthorizationResponseDto {
  @ApiProperty({
    description:
      'Open this URL in a browser so the seller can authorize the YouCan connection.',
    example:
      'https://seller-area.youcan.shop/admin/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapi.example.com%2Fauth%2Fyoucan%2Fcallback&response_type=code&state=...&scope=*',
  })
  authorizationUrl!: string;

  @ApiProperty({
    type: [String],
    example: ['*'],
  })
  requestedScopes!: string[];

  @ApiProperty({
    example: '2026-07-25T12:10:00.000Z',
    description: 'Expiration of this single-use OAuth request.',
  })
  expiresAt!: string;
}

export class YouCanConnectionStatusDto {
  @ApiProperty({ example: true })
  connected!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '5a58178a-1142-450e-bfc6-6f9d8ba32656',
  })
  storeId!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Atlas Market',
  })
  displayName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'atlas-market.youcan.store',
  })
  storeDomain!: string | null;

  @ApiProperty({
    enum: [
      'not_connected',
      'active',
      'disconnected',
      'reauthorization_required',
    ],
    example: 'active',
  })
  status!:
    | 'not_connected'
    | 'active'
    | 'disconnected'
    | 'reauthorization_required';

  @ApiProperty({
    type: [String],
    example: ['*'],
  })
  grantedScopes!: string[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  installedAt!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  lastVerifiedAt!: string | null;

  @ApiProperty({ example: false })
  scopeUpdateRequired!: boolean;

  @ApiProperty({ example: 'YouCan store is connected' })
  message!: string;
}

export class YouCanStoreVerificationDto {
  @ApiProperty({ example: '5a58178a-1142-450e-bfc6-6f9d8ba32656' })
  storeId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'atlas-market',
  })
  slug!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Atlas Market',
  })
  name!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'atlas-market.youcan.store',
  })
  domain!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'USD' })
  currencyCode!: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true, example: true })
  isActive!: boolean | null;

  @ApiProperty({ example: true })
  verified!: boolean;
}
