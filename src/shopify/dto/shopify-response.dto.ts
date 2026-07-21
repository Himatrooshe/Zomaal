import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShopifyAuthorizationResponseDto {
  @ApiProperty({
    description:
      'Send the browser to this URL to let the merchant approve the Shopify connection.',
    example:
      'https://atlas-market.myshopify.com/admin/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapi.example.com%2Fauth%2Fshopify%2Fcallback&state=...',
  })
  authorizationUrl!: string;

  @ApiProperty({
    example: 'atlas-market.myshopify.com',
    description: 'Normalized permanent Shopify shop domain.',
  })
  shopDomain!: string;

  @ApiProperty({
    example: '2026-07-19T12:10:00.000Z',
    description: 'Expiration of the single-use OAuth authorization request.',
  })
  expiresAt!: string;
}

export class ShopifyConnectionStatusDto {
  @ApiProperty({ example: true })
  connected!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'atlas-market.myshopify.com',
  })
  shopDomain!: string | null;

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
    example: ['read_orders', 'write_orders', 'read_products'],
  })
  grantedScopes!: string[];

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-07-19T12:00:00.000Z',
  })
  installedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-07-19T12:05:00.000Z',
  })
  lastVerifiedAt!: string | null;

  @ApiProperty({
    example: false,
    description:
      'True when the configured scope list contains scopes missing from the granted token.',
  })
  scopeUpdateRequired!: boolean;

  @ApiProperty({
    example: 'Shopify store is connected',
  })
  message!: string;
}

export class ShopifyDisconnectResponseDto extends ShopifyConnectionStatusDto {
  @ApiProperty({
    example:
      'Shopify credentials removed from Zomaal. Uninstall the app in Shopify Admin to revoke the installation.',
  })
  declare message: string;
}

export class ShopifyShopVerificationDto {
  @ApiProperty({ example: 'gid://shopify/Shop/123456789' })
  id!: string;

  @ApiProperty({ example: 'Atlas Market' })
  name!: string;

  @ApiProperty({ example: 'atlas-market.myshopify.com' })
  myshopifyDomain!: string;

  @ApiProperty({ example: 'USD' })
  currencyCode!: string;

  @ApiProperty({ example: true })
  verified!: boolean;
}

export class ShopifyWebhookReceiptDto {
  @ApiProperty({ example: true })
  received!: boolean;

  @ApiProperty({ example: false })
  duplicate!: boolean;

  @ApiProperty({ example: 'APP_UNINSTALLED' })
  topic!: string;

  @ApiProperty({ example: 'b54557e4-bdd9-4b37-8a5f-bf7d70bcd043' })
  webhookId!: string;
}
