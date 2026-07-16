import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectSenditDto {
  @ApiProperty({
    description:
      'Public API key generated in the Sendit merchant dashboard under Settings → API integrations.',
    example: 'sendit-public-key',
  })
  @IsString()
  @IsNotEmpty()
  public_key: string;

  @ApiProperty({
    description:
      'Secret API key paired with public_key. It is validated with Sendit, encrypted at rest, never logged, and never returned.',
    example: 'sendit-secret-key',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  secret_key: string;
}

export class SenditConnectionStatusDto {
  @ApiProperty({
    description:
      'Whether this Zomaal user currently has stored Sendit credentials.',
    example: true,
  })
  connected: boolean;

  @ApiProperty({
    description: 'Canonical provider identifier.',
    enum: ['sendit.ma'],
    example: 'sendit.ma',
  })
  provider: 'sendit.ma';

  @ApiProperty({
    description:
      'Account/store name returned by Sendit when the credentials were verified; null when disconnected or unavailable.',
    example: 'Example Store',
    nullable: true,
    type: String,
  })
  accountName: string | null;

  @ApiProperty({
    description:
      'ISO 8601 time when the active credentials were connected; null when disconnected.',
    example: '2026-07-14T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({
    description: 'Human-readable connection state.',
    example: 'Sendit account is connected',
  })
  message: string;
}

export class SenditConnectionErrorDto {
  @ApiProperty({
    description:
      'Authentication failure. This may refer to the Zomaal access token or credentials rejected by Sendit.',
    oneOf: [
      { type: 'string', example: 'Sendit credentials were rejected' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['public_key should not be empty'],
      },
    ],
  })
  message: string | string[];

  @ApiProperty({ description: 'HTTP error label.', example: 'Unauthorized' })
  error: string;

  @ApiProperty({ description: 'HTTP response status.', example: 401 })
  statusCode: number;
}
