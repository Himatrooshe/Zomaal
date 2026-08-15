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
      'Public callback endpoint for QuickLivraison. QUICKLIVRAISON_WEBHOOK_SECRET is required; the signature is verified against the exact raw request body before a tracked shipment and its timeline are updated idempotently.',
  })
  @ApiHeader({
    name: 'x-webhook-signature',
    required: true,
    description: 'Required HMAC-SHA256 signature formatted as sha256=<hex>.',
    example: 'sha256=75f0b6f1c3d7...',
  })
  @ApiBody({
    description: 'QuickLivraison status_changed event payload.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        event: 'status_changed',
        timestamp: '2026-05-22T15:00:00+01:00',
        data: {
          tracking_number: 'PARCEL_12345678',
          status: 'DELIVERED',
          status_second: null,
          new_status_code: 'DELIVERED',
          situation: 'PAID',
          price: 250,
          receiver_name: 'Ahmed',
          city: 'Casablanca',
          comment: 'Livré avec succès',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Webhook signature verified and the tracked shipment event accepted.',
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
