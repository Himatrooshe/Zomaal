import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SenditPaginationDto {
  @ApiProperty({
    description: 'Current one-based page number.',
    example: 1,
  })
  current_page: number;

  @ApiProperty({
    description: 'Maximum number of records returned on this page.',
    example: 20,
  })
  per_page: number;

  @ApiProperty({
    description: 'Total number of records available.',
    example: 42,
  })
  total: number;

  @ApiProperty({
    description: 'Last available page number.',
    example: 3,
  })
  last_page: number;
}

export class SenditDeliveryResourceDto {
  @ApiProperty({
    description: 'Sendit delivery/tracking code.',
    example: 'DH000123456MA',
  })
  code: string;

  @ApiPropertyOptional({
    description: 'Current provider status code or label.',
    example: 'NEW',
  })
  status?: string;

  @ApiProperty({
    description: 'Sendit pickup district identifier.',
    example: 1,
  })
  pickup_district_id: number;

  @ApiProperty({
    description: 'Sendit destination district identifier.',
    example: 58,
  })
  district_id: number;

  @ApiProperty({ description: 'Recipient full name.', example: 'Sara Amrani' })
  name: string;

  @ApiProperty({
    description: 'Cash-on-delivery amount in Moroccan dirhams (MAD).',
    example: 349.9,
  })
  amount: number;

  @ApiProperty({
    description: 'Recipient delivery address.',
    example: '12 Rue Al Massira, Maarif, Casablanca',
  })
  address: string;

  @ApiProperty({
    description: 'Recipient telephone number.',
    example: '0612345678',
  })
  phone: string;

  @ApiPropertyOptional({
    description: 'Merchant delivery instructions.',
    example: 'Call before delivery.',
    nullable: true,
  })
  comment?: string | null;

  @ApiPropertyOptional({
    description: 'Merchant-defined order reference.',
    example: 'ORDER-2026-0042',
    nullable: true,
  })
  reference?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the recipient may open the parcel (0 or 1).',
    enum: [0, 1],
    example: 1,
  })
  allow_open?: number;

  @ApiPropertyOptional({
    description: 'Whether the recipient may try the product (0 or 1).',
    enum: [0, 1],
    example: 0,
  })
  allow_try?: number;

  @ApiPropertyOptional({
    description: 'ISO 8601 creation timestamp supplied by Sendit.',
    example: '2026-07-17T09:15:00.000Z',
    format: 'date-time',
  })
  created_at?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 update timestamp supplied by Sendit.',
    example: '2026-07-17T10:30:00.000Z',
    format: 'date-time',
  })
  updated_at?: string;
}

export class SenditDistrictResourceDto {
  @ApiProperty({ description: 'Sendit district identifier.', example: 58 })
  id: number;

  @ApiProperty({
    description: 'District/city display name.',
    example: 'Casablanca - Maarif',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Delivery fee in Moroccan dirhams when supplied by Sendit.',
    example: 25,
  })
  price?: number;

  @ApiPropertyOptional({
    description: 'Whether this district can be used as a pickup location.',
    example: true,
  })
  pickup?: boolean;
}

export class SenditPickupResourceDto {
  @ApiProperty({
    description: 'Sendit pickup request code.',
    example: 'PU000123456MA',
  })
  code: string;

  @ApiPropertyOptional({
    description: 'Current pickup status code or label.',
    example: 'PENDING',
  })
  status?: string;

  @ApiProperty({ description: 'Pickup district identifier.', example: 1 })
  district_id: number;

  @ApiProperty({ description: 'Pickup contact name.', example: 'Zomaal Store' })
  name: string;

  @ApiProperty({
    description: 'Pickup contact telephone number.',
    example: '0612345678',
  })
  phone: string;

  @ApiProperty({
    description: 'Address where parcels should be collected.',
    example: '45 Boulevard Zerktouni, Casablanca',
  })
  address: string;

  @ApiProperty({
    description: 'Pickup instructions.',
    example: 'Collect from reception after 14:00.',
  })
  note: string;

  @ApiPropertyOptional({
    description: 'Comma-separated delivery codes attached to the pickup.',
    example: 'DH000123456MA,DH000123457MA',
  })
  deliveries?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 creation timestamp supplied by Sendit.',
    example: '2026-07-17T09:15:00.000Z',
    format: 'date-time',
  })
  created_at?: string;
}

export class SenditReturnResourceDto {
  @ApiProperty({
    description: 'Sendit return request code.',
    example: 'RT000123456MA',
  })
  code: string;

  @ApiProperty({
    description: 'Return destination type.',
    enum: ['WAREHOUSE', 'HOME'],
    example: 'HOME',
  })
  type: 'WAREHOUSE' | 'HOME';

  @ApiPropertyOptional({
    description: 'Current return status code or label.',
    example: 'PENDING',
  })
  status?: string;

  @ApiProperty({ description: 'Return district identifier.', example: 1 })
  district_id: number;

  @ApiProperty({ description: 'Return contact name.', example: 'Zomaal Store' })
  name: string;

  @ApiProperty({
    description: 'Return contact telephone number.',
    example: '0612345678',
  })
  phone: string;

  @ApiPropertyOptional({
    description: 'Return destination address.',
    example: '45 Boulevard Zerktouni, Casablanca',
    nullable: true,
  })
  address?: string | null;

  @ApiProperty({
    description: 'Return instructions.',
    example: 'Return sealed parcels to reception.',
  })
  note: string;

  @ApiProperty({
    description: 'Comma-separated delivery codes included in this return.',
    example: 'DH000123456MA,DH000123457MA',
  })
  deliveries: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 creation timestamp supplied by Sendit.',
    example: '2026-07-17T09:15:00.000Z',
    format: 'date-time',
  })
  created_at?: string;
}

export class SenditDeliveryStatusResourceDto {
  @ApiPropertyOptional({
    description: 'Provider status identifier.',
    example: 1,
  })
  id?: number;

  @ApiProperty({ description: 'Provider status code.', example: 'DELIVERED' })
  code: string;

  @ApiProperty({
    description: 'Human-readable provider status label.',
    example: 'Delivered',
  })
  name: string;
}

export class SenditActionResponseDto {
  @ApiProperty({
    description: 'Whether Sendit completed the action.',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Human-readable result returned by Sendit.',
    example: 'Operation completed successfully',
  })
  message: string;

  @ApiPropertyOptional({
    description:
      'Optional provider-owned result data. Sendit may add fields without changing this proxy API.',
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { code: 'DH000123456MA' },
  })
  data?: Record<string, unknown> | null;
}

export class SenditDeliveryResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Delivery retrieved successfully' })
  message: string;

  @ApiProperty({ type: SenditDeliveryResourceDto })
  data: SenditDeliveryResourceDto;
}

export class SenditDeliveryListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Deliveries retrieved successfully' })
  message: string;

  @ApiProperty({ type: [SenditDeliveryResourceDto] })
  data: SenditDeliveryResourceDto[];

  @ApiPropertyOptional({ type: SenditPaginationDto })
  pagination?: SenditPaginationDto;
}

export class SenditDistrictResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'District retrieved successfully' })
  message: string;

  @ApiProperty({ type: SenditDistrictResourceDto })
  data: SenditDistrictResourceDto;
}

export class SenditDistrictListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Districts retrieved successfully' })
  message: string;

  @ApiProperty({ type: [SenditDistrictResourceDto] })
  data: SenditDistrictResourceDto[];

  @ApiPropertyOptional({ type: SenditPaginationDto })
  pagination?: SenditPaginationDto;
}

export class SenditPickupResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Pickup retrieved successfully' })
  message: string;

  @ApiProperty({ type: SenditPickupResourceDto })
  data: SenditPickupResourceDto;
}

export class SenditPickupListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Pickups retrieved successfully' })
  message: string;

  @ApiProperty({ type: [SenditPickupResourceDto] })
  data: SenditPickupResourceDto[];

  @ApiPropertyOptional({ type: SenditPaginationDto })
  pagination?: SenditPaginationDto;
}

export class SenditReturnResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Return retrieved successfully' })
  message: string;

  @ApiProperty({ type: SenditReturnResourceDto })
  data: SenditReturnResourceDto;
}

export class SenditReturnListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Returns retrieved successfully' })
  message: string;

  @ApiProperty({ type: [SenditReturnResourceDto] })
  data: SenditReturnResourceDto[];

  @ApiPropertyOptional({ type: SenditPaginationDto })
  pagination?: SenditPaginationDto;
}

export class SenditDeliveryStatusListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Delivery statuses retrieved successfully' })
  message: string;

  @ApiProperty({ type: [SenditDeliveryStatusResourceDto] })
  data: SenditDeliveryStatusResourceDto[];
}

export class SenditLabelsResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Labels generated successfully' })
  message: string;

  @ApiProperty({
    description:
      'Provider-owned label result. Depending on Sendit configuration this can contain a download URL, encoded document, or label metadata.',
    oneOf: [
      { type: 'string', example: 'https://app.sendit.ma/labels/batch.pdf' },
      {
        type: 'object',
        additionalProperties: true,
        example: {
          url: 'https://app.sendit.ma/labels/batch.pdf',
          format: 'thermal',
        },
      },
    ],
  })
  data: string | Record<string, unknown>;
}

export class SenditValidationErrorDto {
  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Validation failed' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['page must not be less than 1'],
      },
    ],
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 400 })
  statusCode: number;
}

export class SenditNotConnectedErrorDto {
  @ApiProperty({
    example: 'Connect your Sendit account before using this feature',
  })
  message: string;

  @ApiProperty({ example: 'Conflict' })
  error: string;

  @ApiProperty({ example: 409 })
  statusCode: number;
}

export class SenditUpstreamErrorDto {
  @ApiProperty({ example: 'Sendit request failed with status 422' })
  message: string;

  @ApiProperty({ example: 'Bad Gateway' })
  error: string;

  @ApiProperty({ example: 502 })
  statusCode: number;

  @ApiPropertyOptional({
    description: 'Original error payload returned by Sendit, when available.',
    type: 'object',
    additionalProperties: true,
    example: {
      success: false,
      message: 'The selected district is invalid.',
    },
  })
  sendit?: Record<string, unknown>;
}

export class SenditServiceUnavailableErrorDto {
  @ApiProperty({ example: 'Unable to decrypt Sendit credentials' })
  message: string;

  @ApiProperty({ example: 'Service Unavailable' })
  error: string;

  @ApiProperty({ example: 503 })
  statusCode: number;
}
