import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class StartShopifyAuthDto {
  @ApiProperty({
    description:
      'The permanent Shopify shop domain or shop handle. Custom storefront domains are not accepted.',
    examples: ['atlas-market.myshopify.com', 'atlas-market'],
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  @Matches(
    /^(?:https?:\/\/)?[a-zA-Z0-9][a-zA-Z0-9-]*(?:\.myshopify\.com)?\/?$/,
    {
      message:
        'shopDomain must be a Shopify handle or a valid *.myshopify.com domain',
    },
  )
  shopDomain!: string;
}
