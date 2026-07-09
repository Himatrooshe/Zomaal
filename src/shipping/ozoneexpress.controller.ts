import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
export class OzoneExpressController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({ summary: 'Check OzoneExpress account connection' })
  checkConnection() {
    return this.shippingService.checkOzoneExpressConnection();
  }

  @Post('parcels')
  @ApiOperation({ summary: 'Add an OzoneExpress parcel' })
  addParcel(@Body() payload: OzoneExpressParcelDto) {
    return this.shippingService.addOzoneExpressParcel(payload);
  }

  @Get('parcels/:trackingNumber')
  @ApiOperation({ summary: 'Get OzoneExpress parcel information' })
  getParcelInfo(@Param('trackingNumber') trackingNumber: string) {
    return this.shippingService.getOzoneExpressParcelInfo(trackingNumber);
  }

  @Post('tracking')
  @ApiOperation({ summary: 'Track one or more OzoneExpress parcels' })
  track(@Body() payload: OzoneExpressTrackingDto) {
    return this.shippingService.trackOzoneExpress(payload.trackingNumber);
  }

  @Post('delivery-notes')
  @ApiOperation({ summary: 'Create an OzoneExpress delivery note' })
  createDeliveryNote() {
    return this.shippingService.createOzoneExpressDeliveryNote();
  }

  @Post('delivery-notes/parcels')
  @ApiOperation({ summary: 'Add parcels to an OzoneExpress delivery note' })
  addParcelsToDeliveryNote(
    @Body() payload: OzoneExpressDeliveryNoteParcelsDto,
  ) {
    return this.shippingService.addOzoneExpressParcelsToDeliveryNote(payload);
  }

  @Post('delivery-notes/save')
  @ApiOperation({ summary: 'Save an OzoneExpress delivery note' })
  saveDeliveryNote(@Body() payload: OzoneExpressDeliveryNoteRefDto) {
    return this.shippingService.saveOzoneExpressDeliveryNote(payload.ref);
  }

  @Get('delivery-notes/:ref/pdf-links')
  @ApiOperation({ summary: 'Get OzoneExpress delivery note PDF links' })
  getDeliveryNotePdfLinks(@Param('ref') ref: string) {
    return this.shippingService.getOzoneExpressDeliveryNotePdfLinks(ref);
  }

  @Get('cities')
  @ApiOperation({ summary: 'List OzoneExpress cities' })
  getCities() {
    return this.shippingService.getOzoneExpressCities();
  }
}
