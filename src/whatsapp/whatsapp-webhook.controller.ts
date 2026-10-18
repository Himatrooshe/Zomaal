import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@ApiTags('WhatsApp Webhooks')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhooks: WhatsAppWebhookService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  @ApiOperation({
    summary: 'Meta webhook verification handshake',
    description:
      'Meta calls this when the callback URL is saved in the app dashboard; returns hub.challenge when hub.verify_token matches.',
  })
  @ApiQuery({ name: 'hub.mode', required: true })
  @ApiQuery({ name: 'hub.verify_token', required: true })
  @ApiQuery({ name: 'hub.challenge', required: true })
  @ApiOkResponse({ description: 'The hub.challenge value, as plain text.' })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    return this.webhooks.verifySubscription(mode, token, challenge);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive WhatsApp Cloud API webhooks',
    description:
      'Message delivery statuses, template approval updates and account updates. X-Hub-Signature-256 is verified against the raw body with the Meta app secret.',
  })
  @ApiHeader({ name: 'X-Hub-Signature-256', required: true })
  @ApiOkResponse({ description: 'Verified and acknowledged.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    return this.webhooks.handle(signature, request.rawBody);
  }
}
