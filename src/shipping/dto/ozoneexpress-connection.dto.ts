import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectOzoneExpressDto {
  @ApiProperty({
    description: 'Customer identifier from the OzoneExpress account/API page.',
    example: '12345',
  })
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({
    description: 'API key from the OzoneExpress account/API page.',
    example: 'your-ozoneexpress-api-key',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class OzoneExpressConnectionStatusDto {
  @ApiProperty({ example: true })
  connected: boolean;

  @ApiProperty({ enum: ['ozoneexpress.ma'], example: 'ozoneexpress.ma' })
  provider: 'ozoneexpress.ma';

  @ApiProperty({
    example: '2026-07-16T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({ example: 'OzoneExpress account is connected' })
  message: string;
}
