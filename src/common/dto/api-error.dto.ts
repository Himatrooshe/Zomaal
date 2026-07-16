import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({
    description:
      'Human-readable error detail. Validation failures return one or more messages.',
    oneOf: [
      { type: 'string', example: 'Invalid or expired OTP' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['phone must be a valid phone number'],
      },
    ],
  })
  message: string | string[];

  @ApiProperty({
    description: 'HTTP error reason phrase.',
    example: 'Bad Request',
  })
  error: string;

  @ApiProperty({ description: 'HTTP status code.', example: 400 })
  statusCode: number;
}
