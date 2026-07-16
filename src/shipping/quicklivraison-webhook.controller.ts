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
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ShippingService } from './shipping.service';
import { WebhookReceiptDto } from './dto/webhook-response.dto';

@ApiTags('Provider Webhooks')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@Controller('shipping/quicklivraison/webhook')
export class QuickLivraisonWebhookController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a QuickLivraison webhook event',
    description:
      'Public callback endpoint for QuickLivraison. When QUICKLIVRAISON_WEBHOOK_SECRET is configured, the signature is verified against the exact raw request body.',
  })
  @ApiHeader({
    name: 'x-webhook-signature',
    required: false,
    description:
      'HMAC-SHA256 signature formatted as sha256=<hex>. Required when QUICKLIVRAISON_WEBHOOK_SECRET is configured.',
    example: 'sha256=75f0b6f1c3d7...',
  })
  @ApiBody({
    description:
      'Provider-defined event payload. Fields can vary according to event type.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        event: 'parcel.updated',
        trackingNumber: 'PARCEL_12345678',
        status: 'delivered',
      },
    },
  })
  @ApiOkResponse({
    description:
      'Webhook signature verified (when enabled) and event accepted.',
    type: WebhookReceiptDto,
  })
  @ApiBadRequestResponse({
    description: 'Malformed JSON payload.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Webhook signature is missing or invalid.',
    type: ApiErrorDto,
  })
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
