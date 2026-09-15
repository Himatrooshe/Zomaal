import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShopProductStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class ListShopProductsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ShopProductStatus })
  @IsOptional()
  @IsEnum(ShopProductStatus)
  status?: ShopProductStatus;

  @ApiPropertyOptional({
    description: 'Case-insensitive match on name or SKU.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
