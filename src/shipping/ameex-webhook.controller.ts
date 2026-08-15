import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { AmeexShipmentService } from './ameex-shipment.service';
import { AmeexWebhookDto } from './dto/ameex-parcel.dto';

@ApiTags('Provider Webhooks')
@ApiConsumes('application/x-www-form-urlencoded', 'application/json')
@ApiProduces('application/json')
@Controller('shipping/ameex/webhook')
export class AmeexWebhookController {
  constructor(private readonly shipments: AmeexShipmentService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive an Ameex parcel status webhook',
    description:
      'Ameex sends form-urlencoded updates only for parcels created through its API. The documented contract does not provide a signature.',
  })
  @ApiBody({ type: AmeexWebhookDto })
  @ApiOkResponse({
    schema: {
      example: { received: true, matchedShipments: 1 },
    },
  })
  receive(@Body() payload: AmeexWebhookDto) {
    return this.shipments.processWebhook(payload);
  }
}
