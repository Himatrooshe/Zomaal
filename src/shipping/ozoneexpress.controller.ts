import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  ConnectOzoneExpressDto,
  OzoneExpressConnectionStatusDto,
} from './dto/ozoneexpress-connection.dto';
import {
  OzoneExpressDeliveryNoteParcelsDto,
  OzoneExpressDeliveryNoteRefDto,
  OzoneExpressParcelDto,
  OzoneExpressTrackingDto,
} from './dto/ozoneexpress-parcel.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping - OzoneExpress')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping/ozoneexpress')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal bearer token.',
  type: ApiErrorDto,
})
export class OzoneExpressController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({
    summary: 'Check OzoneExpress account connection',
    description:
      'Returns whether the authenticated Zomaal user has stored OzoneExpress credentials. This status check does not call OzoneExpress.',
  })
  @ApiOkResponse({
    description: 'Current user OzoneExpress connection status.',
    type: OzoneExpressConnectionStatusDto,
  })
  checkConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkOzoneExpressConnection(user.userId);
  }

  @Post('connection')
  @ApiOperation({
    summary: "Connect or replace the current user's OzoneExpress account",
    description:
      'Validates the customer ID and API key using the read-only parcel-info endpoint, then encrypts and stores both values. Credentials are never returned.',
  })
  @ApiBody({ type: ConnectOzoneExpressDto })
  @ApiCreatedResponse({
    description: 'Credentials verified and OzoneExpress account connected.',
    type: OzoneExpressConnectionStatusDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing, empty, or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid Zomaal token or rejected OzoneExpress credentials.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'OzoneExpress returned an invalid or failed response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or credential encryption is unavailable.',
    type: ApiErrorDto,
  })
  connect(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectOzoneExpressDto,
  ) {
    return this.shippingService.connectOzoneExpress(user.userId, payload);
  }

  @Delete('connection')
  @ApiOperation({
    summary: "Disconnect the current user's OzoneExpress account",
    description:
      'Deletes the encrypted customer ID and API key. This operation is idempotent.',
  })
  @ApiOkResponse({
    description: 'OzoneExpress account disconnected.',
    type: OzoneExpressConnectionStatusDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectOzoneExpress(user.userId);
  }

  @Post('parcels')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Add an OzoneExpress parcel' })
  addParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressParcelDto,
  ) {
    return this.shippingService.addOzoneExpressParcel(user.userId, payload);
  }

  @Get('parcels/:trackingNumber')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get OzoneExpress parcel information' })
  getParcelInfo(
    @CurrentUser() user: JwtPayload,
    @Param('trackingNumber') trackingNumber: string,
  ) {
    return this.shippingService.getOzoneExpressParcelInfo(
      user.userId,
      trackingNumber,
    );
  }

  @Post('tracking')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Track one or more OzoneExpress parcels' })
  track(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressTrackingDto,
  ) {
    return this.shippingService.trackOzoneExpress(
      user.userId,
      payload.trackingNumber,
    );
  }

  @Post('delivery-notes')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create an OzoneExpress delivery note' })
  createDeliveryNote(@CurrentUser() user: JwtPayload) {
    return this.shippingService.createOzoneExpressDeliveryNote(user.userId);
  }

  @Post('delivery-notes/parcels')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Add parcels to an OzoneExpress delivery note' })
  addParcelsToDeliveryNote(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressDeliveryNoteParcelsDto,
  ) {
    return this.shippingService.addOzoneExpressParcelsToDeliveryNote(
      user.userId,
      payload,
    );
  }

  @Post('delivery-notes/save')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Save an OzoneExpress delivery note' })
  saveDeliveryNote(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressDeliveryNoteRefDto,
  ) {
    return this.shippingService.saveOzoneExpressDeliveryNote(
      user.userId,
      payload.ref,
    );
  }

  @Get('delivery-notes/:ref/pdf-links')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get OzoneExpress delivery note PDF links' })
  getDeliveryNotePdfLinks(@Param('ref') ref: string) {
    return this.shippingService.getOzoneExpressDeliveryNotePdfLinks(ref);
  }

  @Get('cities')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List OzoneExpress cities' })
  getCities() {
    return this.shippingService.getOzoneExpressCities();
  }
}
