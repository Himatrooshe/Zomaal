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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ShippingService } from './shipping.service';
import { WebhookReceiptDto } from './dto/webhook-response.dto';

@ApiTags('Provider Webhooks')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@Controller('shipping/sendit/webhook')
export class SenditWebhookController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a Sendit webhook event',
    description:
      'Public callback endpoint for Sendit delivery status updates. The X-Sendit-Signature HMAC-SHA256 signature is verified against the exact raw request body using the API secret associated with the stored shipment. Do not call this endpoint with a Zomaal bearer token.',
  })
  @ApiHeader({
    name: 'X-Sendit-Signature',
    required: true,
    description:
      'Lowercase hexadecimal HMAC-SHA256 of the exact request body, generated with the API secret selected when configuring the Sendit webhook.',
    example: '75f0b6f1c3d7...',
  })
  @ApiBody({
    description: 'Sendit delivery status update payload.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        event: 'delivery.status.update',
        code: 'DHF420101C',
        oldStatus: 'UNREACHABLE',
        newStatus: 'POSTPONED',
        lastActionAt: '2025-06-11 16:05:05',
        message: 'Programmé par le client',
        proofImage:
          'https://app.sendit.ma/storage/deliveries/June2025/proof.jpg',
        deliverBy: '2025-06-12',
        counterUnreachable: 1,
      },
    },
  })
  @ApiOkResponse({
    description: 'Webhook signature verified and shipment event persisted.',
    type: WebhookReceiptDto,
  })
  @ApiBadRequestResponse({
    description: 'Malformed JSON or unsupported/incomplete Sendit payload.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Signature is missing, invalid, or does not match the Sendit connection associated with the shipment.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description:
      'The delivery code is not one of the Sendit shipments tracked by Zomaal.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The associated Sendit credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  receiveWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.shippingService.receiveSenditWebhook(
      headers,
      payload,
      request.rawBody,
    );
  }
}
