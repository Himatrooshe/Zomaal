import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export type ShippingCompanyCode =
  | 'sendit'
  | 'quicklivraison'
  | 'forcelog'
  | 'ozoneexpress';

export class ShippingIntegrationCredentialsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  public_key?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secret_key?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customerId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;
}

export class ConnectShippingIntegrationDto {
  @ApiProperty({
    description:
      'Provider-specific credential object. Use only the fields returned in authFields for the selected company.',
    type: ShippingIntegrationCredentialsDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingIntegrationCredentialsDto)
  credentials: ShippingIntegrationCredentialsDto;
}

export class ShippingAuthFieldDto {
  @ApiProperty({ example: 'apiKey' })
  key: string;

  @ApiProperty({ example: 'API key' })
  label: string;

  @ApiProperty({ example: 'Enter your API key' })
  placeholder: string;

  @ApiProperty({ enum: ['text', 'secure_text'], example: 'secure_text' })
  inputType: 'text' | 'secure_text';

  @ApiProperty({ example: true })
  required: boolean;

  @ApiProperty({
    description:
      'When true, the frontend should mask the value and must not persist it in logs or analytics.',
    example: true,
  })
  sensitive: boolean;
}

export class ShippingCompanyDto {
  @ApiProperty({
    enum: ['sendit', 'quicklivraison', 'forcelog', 'ozoneexpress'],
    example: 'forcelog',
  })
  code: ShippingCompanyCode;

  @ApiProperty({ example: 'ForceLog' })
  name: string;

  @ApiProperty({ example: 'Moroccan delivery and COD service' })
  description: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  logoUrl: string | null;

  @ApiProperty({ enum: ['available'], example: 'available' })
  status: 'available';

  @ApiProperty({ example: false })
  connected: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    example: null,
  })
  connectedAt: string | null;

  @ApiProperty({ example: 'Enter the API key from your ForceLog account.' })
  instructions: string;

  @ApiProperty({ type: [ShippingAuthFieldDto] })
  authFields: ShippingAuthFieldDto[];
}

export class ShippingCountryDto {
  @ApiProperty({ example: 'MA' })
  code: string;

  @ApiProperty({ example: 'Morocco' })
  name: string;

  @ApiProperty({
    enum: ['available', 'coming_soon'],
    example: 'available',
  })
  status: 'available' | 'coming_soon';

  @ApiProperty({ example: 4 })
  availableCompanyCount: number;

  @ApiProperty({ type: [ShippingCompanyDto] })
  companies: ShippingCompanyDto[];
}

export class ShippingIntegrationsResponseDto {
  @ApiProperty({ type: [ShippingCountryDto] })
  countries: ShippingCountryDto[];
}

export class ShippingIntegrationConnectionResponseDto {
  @ApiProperty({
    enum: ['sendit', 'quicklivraison', 'forcelog', 'ozoneexpress'],
    example: 'forcelog',
  })
  companyCode: ShippingCompanyCode;

  @ApiProperty({ example: true })
  connected: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    example: '2026-07-16T10:30:00.000Z',
  })
  connectedAt: string | null;

  @ApiProperty({ example: 'ForceLog account is connected' })
  message: string;
}
