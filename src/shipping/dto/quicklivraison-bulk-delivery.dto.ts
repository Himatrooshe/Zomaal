import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { QuickLivraisonDeliveryDto } from './quicklivraison-delivery.dto';

export class QuickLivraisonBulkDeliveryDto {
  @ApiProperty({
    description:
      'Deliveries to submit in one provider request. Every item follows the same rules as a single QuickLivraison delivery.',
    type: [QuickLivraisonDeliveryDto],
    minItems: 1,
    example: [
      {
        district_id: 123,
        name: 'Sara El Amrani',
        amount: 250,
        phone: '0612345678',
        address: '123 Rue Al Massira, Maarif, Casablanca',
        code: 'ORDER-1001',
        note: 'Call the recipient before delivery',
        open: false,
        try: false,
        echange: false,
        prd_name: 'Running shoes',
        qte_prd: 1,
      },
      {
        district_id: 456,
        name: 'Youssef Alaoui',
        amount: 399,
        phone: '0623456789',
        address: '45 Avenue Mohammed V, Rabat',
        code: 'ORDER-1002',
        received_quantity: { '42': 2 },
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuickLivraisonDeliveryDto)
  parcels: QuickLivraisonDeliveryDto[];
}
