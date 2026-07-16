import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectOzoneExpressDto {
  @ApiProperty({
    description:
      'Customer identifier from the OzoneExpress account/API page. It is treated as a string so leading zeros are preserved.',
    example: '12345',
  })
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({
    description:
      'API key from the OzoneExpress account/API page. Zomaal validates it, encrypts it at rest, and never returns it.',
    example: 'your-ozoneexpress-api-key',
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class OzoneExpressConnectionStatusDto {
  @ApiProperty({
    description:
      'Whether the authenticated Zomaal user currently has stored OzoneExpress credentials.',
    example: true,
  })
  connected: boolean;

  @ApiProperty({
    description: 'Stable provider identifier.',
    enum: ['ozoneexpress.ma'],
    example: 'ozoneexpress.ma',
  })
  provider: 'ozoneexpress.ma';

  @ApiProperty({
    description:
      'UTC time at which the current credentials were connected or replaced. Null while disconnected.',
    example: '2026-07-16T10:30:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  connectedAt: string | null;

  @ApiProperty({
    description: 'Human-readable status summary.',
    example: 'OzoneExpress account is connected',
  })
  message: string;
}

export class OzoneExpressConnectionErrorDto {
  @ApiProperty({
    oneOf: [
      {
        type: 'string',
        example: 'OzoneExpress request failed with status 401',
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
      'Provider error body when OzoneExpress returned structured JSON. This field is omitted when the response could not be parsed.',
    type: 'object',
    additionalProperties: true,
    example: {
      CHECK_API: {
        RESULT: 'ERROR',
        MESSAGE: 'Please verify your API Key',
      },
    },
  })
  ozoneexpress?: Record<string, unknown>;
}
