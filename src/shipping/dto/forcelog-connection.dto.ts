import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectForceLogDto {
  @ApiProperty({
    description:
      'Customer API key copied from the ForceLog merchant account. Zomaal validates it, encrypts it at rest, and never returns it in a response.',
    example: 'fl_live_7b1c2d3e4f5a6b7c',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class ForceLogConnectionStatusDto {
  @ApiProperty({
    description: 'Whether the current Zomaal user has a stored ForceLog key.',
    example: true,
  })
  connected: boolean;

  @ApiProperty({
    description: 'Stable provider identifier.',
    enum: ['forcelog.ma'],
    example: 'forcelog.ma',
  })
  provider: 'forcelog.ma';

  @ApiProperty({
    description:
      'UTC time at which the current credentials were stored; `null` when disconnected.',
    example: '2026-07-16T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({
    description: 'Human-readable connection state.',
    example: 'ForceLog account is connected',
  })
  message: string;
}
