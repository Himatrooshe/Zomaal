import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectAmeexDto {
  @ApiProperty({ description: 'Ameex API ID used in C-Api-Id.' })
  @IsString()
  @IsNotEmpty()
  apiId: string;

  @ApiProperty({
    description: 'Ameex API key used in C-Api-Key.',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class AmeexConnectionStatusDto {
  @ApiProperty() connected: boolean;
  @ApiProperty({ enum: ['ameex.ma'] }) provider: 'ameex.ma';
  @ApiProperty({ nullable: true, format: 'date-time' })
  connectedAt: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) lastSyncError?: string | null;
  @ApiProperty() message: string;
}
