import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectQuickLivraisonDto {
  @ApiProperty({
    description:
      'Primary or subuser API key generated in the QuickLivraison customer dashboard. Zomaal validates it with QuickLivraison, encrypts it at rest, and never returns it.',
    example: 'sub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class QuickLivraisonConnectionStatusDto {
  @ApiProperty({
    description:
      'Whether the authenticated Zomaal user currently has stored QuickLivraison credentials.',
    example: true,
  })
  connected: boolean;

  @ApiProperty({
    description: 'Stable provider identifier.',
    enum: ['quicklivraison.ma'],
    example: 'quicklivraison.ma',
  })
  provider: 'quicklivraison.ma';

  @ApiProperty({
    description:
      'Detected credential type. Null when no QuickLivraison account is connected.',
    enum: ['primary', 'subuser'],
    example: 'subuser',
    nullable: true,
  })
  keyType: 'primary' | 'subuser' | null;

  @ApiProperty({
    description:
      'UTC time at which the current credential was connected or replaced. Null while disconnected.',
    example: '2026-07-15T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({
    description: 'Human-readable status summary.',
    example: 'QuickLivraison account is connected',
  })
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

  @ApiPropertyOptional({
    description:
      'Standard NestJS error label. Omitted when the raw provider error object is attached.',
    example: 'Bad Gateway',
  })
  error?: string;

  @ApiPropertyOptional({
    description:
      'HTTP status code. Omitted when the raw provider error object is attached.',
    example: 502,
  })
  statusCode?: number;

  @ApiPropertyOptional({
    description:
      'Provider error body when QuickLivraison returned structured JSON. This field is omitted when the response could not be parsed.',
    type: 'object',
    additionalProperties: true,
    example: {
      error_code: 401,
      error: 'The supplied API key is not valid',
    },
  })
  quicklivraison?: Record<string, unknown>;
}
