import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LightfunnelsAuthorizationResponseDto {
  @ApiProperty({
    description:
      'Open this URL in the browser so the merchant can authorize Lightfunnels.',
    example:
      'https://app.lightfunnels.com/admin/oauth?client_id=abc&redirect_uri=https%3A%2F%2Fapi.example.com%2Fauth%2Flightfunnels%2Fcallback&scope=orders%2Cfunnels&state=...',
  })
  authorizationUrl!: string;

  @ApiProperty({ type: [String], example: ['funnels', 'orders'] })
  requestedScopes!: string[];

  @ApiProperty({
    format: 'date-time',
    example: '2026-07-26T12:10:00.000Z',
  })
  expiresAt!: string;
}

export class LightfunnelsConnectionStatusDto {
  @ApiProperty({ example: true })
  connected!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'QWNjb3VudDoxMjM0',
  })
  accountId!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Atlas Market',
  })
  displayName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'atlas.lightfunnels.com',
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

  @ApiProperty({ type: [String], example: ['funnels', 'orders'] })
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

  @ApiProperty({ example: 'Lightfunnels account is connected' })
  message!: string;
}

export class LightfunnelsStoreDto {
  @ApiProperty({ example: 'U3RvcmU6MTIzNA==' })
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '1234' })
  uid!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Atlas Market',
  })
  name!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'atlas-market',
  })
  slug!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'atlas.lightfunnels.com',
  })
  domain!: string | null;
}

export class LightfunnelsVerificationDto {
  @ApiProperty({ example: 'QWNjb3VudDoxMjM0' })
  accountId!: string;

  @ApiProperty({ type: [LightfunnelsStoreDto] })
  stores!: LightfunnelsStoreDto[];

  @ApiProperty({ example: true })
  verified!: boolean;
}
