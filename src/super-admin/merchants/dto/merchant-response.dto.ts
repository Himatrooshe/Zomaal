import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ example: 'Merchant account deleted' })
  message: string;
}

export class MerchantResponseDto {
  @ApiProperty({ description: 'The User id (login identity).' })
  id: string;
  @ApiProperty() phone: string;
  @ApiProperty() storeId: string;
  @ApiProperty() businessName: string;
  @ApiProperty() ownerName: string;
  @ApiProperty() address: string;
  @ApiProperty() city: string;
  @ApiProperty() country: string;
  @ApiProperty() baseCurrency: string;
  @ApiProperty({ nullable: true }) logoUrl: string | null;
  @ApiProperty() connectionCount: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() onboardingComplete: boolean;
  @ApiProperty() productCount: number;
  @ApiProperty() customerCount: number;
  @ApiProperty() staffCount: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
