import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ShippingService } from './shipping.service';

@ApiTags('Webhooks')
@Controller('shipping/quicklivraison/webhook')
export class QuickLivraisonWebhookController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive QuickLivraison webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  receiveWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.shippingService.receiveQuickLivraisonWebhook(
      headers,
      payload,
      request.rawBody,
    );
  }
}
