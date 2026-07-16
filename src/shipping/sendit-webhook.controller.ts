import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
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
      'Public callback endpoint for Sendit. The JSON payload is accepted as supplied by the provider. Do not call this endpoint with a Zomaal bearer token.',
  })
  @ApiHeader({
    name: 'x-webhook-event',
    required: false,
    description: 'Sendit event name, when supplied by the provider.',
    example: 'delivery.updated',
  })
  @ApiBody({
    description:
      'Provider-defined event payload. Fields can vary according to event type.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        event: 'delivery.updated',
        code: 'DH123456',
        status: 'delivered',
      },
    },
  })
  @ApiOkResponse({
    description: 'Webhook accepted.',
    type: WebhookReceiptDto,
  })
  @ApiBadRequestResponse({
    description: 'Malformed JSON payload.',
    type: ApiErrorDto,
  })
  receiveWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: unknown,
  ) {
    return this.shippingService.receiveSenditWebhook(headers, payload);
  }
}
