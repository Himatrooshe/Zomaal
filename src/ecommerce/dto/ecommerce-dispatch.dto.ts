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

  @ApiPropertyOptional({ description: 'Courier-specific options and payload' })
  @IsObject()
  options: Record<string, any>;
}

export class EcommerceDispatchResponseDto {
  @ApiProperty({ description: 'Tracking number returned by the provider' })
  trackingNumber: string;

  @ApiProperty({ description: 'Status of the dispatch' })
  status: string;
}
