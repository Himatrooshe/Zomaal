import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OzoneExpressProductDto {
  @ApiProperty({
    description:
      'Product reference exactly as registered in the OzoneExpress stock catalog.',
    example: 'SKU-SHOE-BLK-42',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    description: 'Quantity of this stock product included in the parcel.',
    example: 2,
    type: Number,
  })
  @IsNumber()
  qnty: number;
}

export class OzoneExpressParcelDto {
  @ApiPropertyOptional({
    description:
      'Merchant-supplied tracking/reference number. Omit it to let OzoneExpress assign a tracking number when supported by the connected account.',
    example: 'ZOM-ORDER-1001',
  })
  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @ApiProperty({
    description: 'Full name of the parcel recipient.',
    example: 'Sara El Amrani',
  })
  @IsString()
  receiver: string;

  @ApiProperty({
    description:
      'Recipient phone number as accepted by OzoneExpress. A Moroccan national-format number is shown in the example.',
    example: '0612345678',
  })
  @IsString()
  phone: string;

  @ApiProperty({
    description:
      'OzoneExpress city identifier. Resolve it with GET /shipping/ozoneexpress/cities before creating a parcel.',
    example: '1',
  })
  @IsString()
  city: string;

  @ApiProperty({
    description: 'Complete street address used for final delivery.',
    example: '123 Rue Al Massira, Maarif, Casablanca',
  })
  @IsString()
  address: string;

  @ApiProperty({
    description:
      'Cash-on-delivery amount in Moroccan dirhams (MAD). Use 0 for a prepaid parcel.',
    example: 250,
    minimum: 0,
    type: Number,
  })
  @IsNumber()
  price: number;

  @ApiProperty({
    description:
      'Fulfillment mode: 1 uses products held in OzoneExpress stock; 0 requests pickup/non-stock handling.',
    enum: [0, 1],
    example: 0,
    type: Number,
  })
  @IsIn([0, 1])
  stock: 0 | 1;

  @ApiPropertyOptional({
    description: 'Delivery instructions forwarded to OzoneExpress.',
    example: 'Call the recipient before delivery',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Description of the parcel contents.',
    example: 'One pair of running shoes',
  })
  @IsOptional()
  @IsString()
  nature?: string;

  @ApiPropertyOptional({
    description:
      'Package inspection policy: 1 allows the recipient to open the package; 2 does not.',
    enum: [1, 2],
    example: 2,
    type: Number,
  })
  @IsOptional()
  @IsIn([1, 2])
  open?: 1 | 2;

  @ApiPropertyOptional({
    description: 'Fragile handling flag: 1 means fragile; 0 means standard.',
    enum: [0, 1],
    example: 0,
    type: Number,
  })
  @IsOptional()
  @IsIn([0, 1])
  fragile?: 0 | 1;

  @ApiPropertyOptional({
    description:
      'Replacement/exchange flag: 1 identifies a replacement parcel; 0 is a normal shipment.',
    enum: [0, 1],
    example: 0,
    type: Number,
  })
  @IsOptional()
  @IsIn([0, 1])
  replace?: 0 | 1;

  @ApiPropertyOptional({
    description:
      'Stock product lines. Supply this list when stock is 1; omit it for pickup/non-stock parcels.',
    type: [OzoneExpressProductDto],
    example: [{ ref: 'SKU-SHOE-BLK-42', qnty: 2 }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OzoneExpressProductDto)
  products?: OzoneExpressProductDto[];
}

export class OzoneExpressTrackingDto {
  @ApiProperty({
    description:
      'One tracking number or an array of tracking numbers. Use an array to retrieve multiple tracking histories in one request.',
    oneOf: [
      { type: 'string', example: 'OZ123456789MA' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['OZ123456789MA', 'OZ987654321MA'],
      },
    ],
  })
  trackingNumber: string | string[];
}

export class OzoneExpressDeliveryNoteParcelsDto {
  @ApiProperty({
    description:
      'Delivery-note reference returned by POST /shipping/ozoneexpress/delivery-notes.',
    example: 'DN-2026-000123',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    description:
      'OzoneExpress parcel tracking codes to attach to the delivery note.',
    type: [String],
    minItems: 1,
    example: ['OZ123456789MA', 'OZ987654321MA'],
  })
  @IsArray()
  @IsString({ each: true })
  codes: string[];
}

export class OzoneExpressDeliveryNoteRefDto {
  @ApiProperty({
    description:
      'Delivery-note reference returned by POST /shipping/ozoneexpress/delivery-notes.',
    example: 'DN-2026-000123',
  })
  @IsString()
  ref: string;
}

export class OzoneExpressDeliveryNotePdfLinksDto {
  @ApiProperty({
    description: 'Delivery-note reference used to build the links.',
    example: 'DN-2026-000123',
  })
  ref: string;

  @ApiProperty({
    description: 'Standard delivery-note PDF URL.',
    example:
      'https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref=DN-2026-000123',
    format: 'uri',
  })
  pdfStandard: string;

  @ApiProperty({
    description: 'A4 parcel-label PDF URL.',
    example:
      'https://client.ozoneexpress.ma/pdf-delivery-note-tickets?dn-ref=DN-2026-000123',
    format: 'uri',
  })
  labelsA4: string;

  @ApiProperty({
    description: '10 x 10 cm parcel-label PDF URL.',
    example:
      'https://client.ozoneexpress.ma/pdf-delivery-note-tickets-4-4?dn-ref=DN-2026-000123',
    format: 'uri',
  })
  labels10x10: string;
}
