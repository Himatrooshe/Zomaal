import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class SenditReturnDto {
  @ApiProperty({
    description:
      'Return destination. WAREHOUSE sends parcels to Sendit storage; HOME sends them to the supplied merchant address.',
    enum: ['WAREHOUSE', 'HOME'],
    example: 'HOME',
  })
  @IsIn(['WAREHOUSE', 'HOME'])
  type: 'WAREHOUSE' | 'HOME';

  @ApiProperty({
    description:
      'Sendit destination district ID for the return. Required by the provider for both return types.',
    example: 1,
  })
  @IsInt()
  district_id: number;

  @ApiProperty({
    description: 'Return contact or business name.',
    example: 'Zomaal Store',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Return contact telephone number.',
    example: '0612345678',
  })
  @IsString()
  phone: string;

  @ApiPropertyOptional({
    description:
      'Return destination address, normally supplied for HOME returns.',
    example: '45 Boulevard Zerktouni, Casablanca',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({
    description: 'Instructions for handling the returned parcels.',
    example: 'Return sealed parcels to reception.',
  })
  @IsString()
  note: string;

  @ApiProperty({
    description: 'Comma-separated Sendit delivery codes to return.',
    example: 'DH000123456MA,DH000123457MA',
  })
  @IsString()
  deliveries: string;
}

export class SenditUpdateReturnDto {
  @ApiPropertyOptional({
    description: 'Updated return destination type.',
    enum: ['WAREHOUSE', 'HOME'],
    example: 'HOME',
  })
  @IsOptional()
  @IsIn(['WAREHOUSE', 'HOME'])
  type?: 'WAREHOUSE' | 'HOME';

  @ApiPropertyOptional({
    description: 'Updated return contact or business name.',
    example: 'Zomaal Store',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated return contact telephone number.',
    example: '0612345678',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Updated return destination address.',
    example: '45 Boulevard Zerktouni, Casablanca',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'Updated return instructions.',
    example: 'Return sealed parcels to reception.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Replacement comma-separated delivery-code list.',
    example: 'DH000123456MA,DH000123457MA',
  })
  @IsOptional()
  @IsString()
  deliveries?: string;
}
