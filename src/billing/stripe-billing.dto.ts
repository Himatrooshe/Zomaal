import { ApiProperty } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class StripeCheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  interval!: BillingInterval;
}

export class StripeCheckoutResponseDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty() checkoutUrl!: string;
  @ApiProperty() expiresAt!: string;
}
