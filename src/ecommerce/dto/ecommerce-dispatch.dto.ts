import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject } from 'class-validator';

export enum ShippingProvider {
  SENDIT = 'SENDIT',
  QUICKLIVRAISON = 'QUICKLIVRAISON',
  FORCELOG = 'FORCELOG',
  OZONEEXPRESS = 'OZONEEXPRESS',
}

export class EcommerceDispatchDto {
  @ApiProperty({
    enum: ShippingProvider,
    description: 'Courier to dispatch to',
  })
  @IsEnum(ShippingProvider)
  provider: ShippingProvider;

  @ApiPropertyOptional({
    description:
      'Courier routing options. Sendit requires pickupDistrictId and destinationDistrictId. QuickLivraison requires destinationDistrictId. ForceLog and OzoneExpress accept destinationCity when the source order city is not the provider city identifier. allowOpen and allowTry are optional booleans.',
    example: {
      pickupDistrictId: 1,
      destinationDistrictId: 58,
      destinationCity: 'Casablanca',
      allowOpen: false,
      allowTry: false,
    },
  })
  @IsObject()
  options: Record<string, unknown>;
}

export class EcommerceDispatchResponseDto {
  @ApiProperty({ description: 'Tracking number returned by the provider' })
  trackingNumber: string;

  @ApiProperty({ description: 'Status of the dispatch' })
  status: string;

  @ApiProperty({ enum: ShippingProvider })
  provider: ShippingProvider;

  @ApiProperty({ description: 'Stable Zomaal merchant parcel reference' })
  merchantTracking: string;
}
