import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { QuickLivraisonDeliveryDto } from './quicklivraison-delivery.dto';

export class QuickLivraisonBulkDeliveryDto {
  @ApiProperty({ type: [QuickLivraisonDeliveryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuickLivraisonDeliveryDto)
  parcels: QuickLivraisonDeliveryDto[];
}
