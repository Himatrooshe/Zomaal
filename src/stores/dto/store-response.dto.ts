import { ApiProperty } from '@nestjs/swagger';

export class StoreResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  ownerName: string;

  @ApiProperty({ example: 'John Electronics' })
  businessName: string;

  @ApiProperty({ example: '123 Main Street' })
  address: string;

  @ApiProperty({ example: 'Casablanca' })
  city: string;

  @ApiProperty({ example: 'Morocco' })
  country: string;

  @ApiProperty({
    example: 'https://example.com/logo.png',
    nullable: true,
    type: String,
  })
  logoUrl: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-07-16T10:30:00.000Z', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-16T10:30:00.000Z', format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  userId: string;
}
