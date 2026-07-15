import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectSenditDto {
  @ApiProperty({
    description: "Public API key from the customer's Sendit account",
    example: 'sendit-public-key',
  })
  @IsString()
  @IsNotEmpty()
  public_key: string;

  @ApiProperty({
    description: "Secret API key from the customer's Sendit account",
    example: 'sendit-secret-key',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  secret_key: string;
}

export class SenditConnectionStatusDto {
  @ApiProperty({ example: true })
  connected: boolean;

  @ApiProperty({ enum: ['sendit.ma'], example: 'sendit.ma' })
  provider: 'sendit.ma';

  @ApiProperty({ example: 'Example Store', nullable: true, type: String })
  accountName: string | null;

  @ApiProperty({
    example: '2026-07-14T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({ example: 'Sendit account is connected' })
  message: string;
}

export class SenditConnectionErrorDto {
  @ApiProperty({
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

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({ example: 401 })
  statusCode: number;
}
