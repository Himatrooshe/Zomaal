import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping')
@ApiExcludeController()
@Controller('shipping/sendit/webhook')
export class SenditWebhookController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Sendit webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  receiveWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: unknown,
  ) {
    return this.shippingService.receiveSenditWebhook(headers, payload);
  }
}
