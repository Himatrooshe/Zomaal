import { IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectStoreDto {
  @ApiProperty({
    description: 'Store id to make current (must be owned by the caller).',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  storeId!: string;
}
