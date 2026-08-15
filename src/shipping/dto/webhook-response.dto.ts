import { ApiProperty } from '@nestjs/swagger';

export class WebhookReceiptDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Provider webhook received' })
  message: string;
}
