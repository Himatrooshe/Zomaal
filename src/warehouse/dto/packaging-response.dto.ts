import { ApiProperty } from '@nestjs/swagger';

export class OwnedPackagingMaterialResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'Variant identifier from the Zomaal packaging shop catalog.',
    example: 'shop-box-large-brown',
  })
  zomaalShopVariantId: string;

  @ApiProperty({ example: 'Large corrugated box' })
  name: string;

  @ApiProperty({ nullable: true, example: 'BOX-LARGE-BROWN' })
  sku: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Authenticated relative image URL. Null when the shop catalog item has no image.',
    example: '/warehouse/packaging/2d5e2688-0818-429a-bb03-8351130c60ea/image',
  })
  imageUrl: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  inventoryItemId: string | null;

  @ApiProperty({
    description:
      'On-hand minus reserved and damaged quantities across locations.',
    example: 20,
  })
  available: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}
