import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectQuickLivraisonDto {
  @ApiProperty({
    description:
      'Primary or subuser API key generated in the QuickLivraison customer dashboard.',
    example: 'sub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class QuickLivraisonConnectionStatusDto {
  @ApiProperty({ example: true })
  connected: boolean;

  @ApiProperty({ enum: ['quicklivraison.ma'], example: 'quicklivraison.ma' })
  provider: 'quicklivraison.ma';

  @ApiProperty({
    enum: ['primary', 'subuser'],
    example: 'subuser',
    nullable: true,
  })
  keyType: 'primary' | 'subuser' | null;

  @ApiProperty({
    example: '2026-07-15T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({ example: 'QuickLivraison account is connected' })
  message: string;
}

export class QuickLivraisonConnectionErrorDto {
  @ApiProperty({
    oneOf: [
      {
        type: 'string',
        example: 'QuickLivraison request failed with status 401',
      },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['apiKey should not be empty'],
      },
    ],
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Gateway' })
  error: string;

  @ApiProperty({ example: 502 })
  statusCode: number;
}
