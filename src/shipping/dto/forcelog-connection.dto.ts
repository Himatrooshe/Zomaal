import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectForceLogDto {
  @ApiProperty({
    description: 'Customer API key obtained from the ForceLog account.',
    example: 'your-forcelog-api-key',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class ForceLogConnectionStatusDto {
  @ApiProperty({ example: true })
  connected: boolean;

  @ApiProperty({ enum: ['forcelog.ma'], example: 'forcelog.ma' })
  provider: 'forcelog.ma';

  @ApiProperty({
    example: '2026-07-16T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({ example: 'ForceLog account is connected' })
  message: string;
}
