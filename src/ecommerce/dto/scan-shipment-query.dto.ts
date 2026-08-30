import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ScanShipmentQueryDto {
  @ApiProperty({
    description:
      'Exact text decoded by the scanner. Either a Zomaal-generated shipment QR ' +
      '(JSON payload containing productCode/orderId/trackingNumber) or a raw ' +
      "courier tracking number read off the carrier's own barcode. Both resolve " +
      'to the same order.',
    example: 'SH92831',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  value: string;
}
