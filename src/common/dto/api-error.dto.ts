import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({
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

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 400 })
  statusCode: number;
}
