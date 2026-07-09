import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ForceLogParcelDto,
  ForceLogRelaunchDto,
  ForceLogRelaunchZoneDto,
} from './dto/forcelog-parcel.dto';
import { ForceLogPickupDto } from './dto/forcelog-pickup.dto';
import { ForceLogProductDto } from './dto/forcelog-product.dto';
import { ForceLogReturnRequestDto } from './dto/forcelog-return.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping - ForceLog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping/forcelog')
export class ForceLogController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({ summary: 'Check ForceLog account connection' })
  checkConnection() {
    return this.shippingService.checkForceLogConnection();
  }

  @Post('parcels')
  @ApiOperation({ summary: 'Add a ForceLog parcel' })
  addParcel(@Body() payload: ForceLogParcelDto) {
    return this.shippingService.addForceLogParcel(payload);
  }

  @Get('parcels/:code')
  @ApiOperation({ summary: 'Get ForceLog parcel details' })
  getParcel(@Param('code') code: string) {
    return this.shippingService.getForceLogParcel(code);
  }

  @Post('parcels/relaunch')
  @ApiOperation({ summary: 'Relaunch ForceLog parcel to a new customer' })
  relaunchParcel(@Body() payload: ForceLogRelaunchDto) {
    return this.shippingService.relaunchForceLogParcel(payload);
  }

  @Post('parcels/relaunch-zone')
  @ApiOperation({ summary: 'Relaunch ForceLog parcel to a new city' })
  relaunchParcelZone(@Body() payload: ForceLogRelaunchZoneDto) {
    return this.shippingService.relaunchForceLogParcelZone(payload);
  }

  @Delete('parcels/:code')
  @ApiOperation({ summary: 'Delete a ForceLog parcel with NEW_PARCEL status' })
  deleteParcel(@Param('code') code: string) {
    return this.shippingService.deleteForceLogParcel(code);
  }

  @Get('parcels/:code/sticker')
  @ApiOperation({ summary: 'Get ForceLog parcel sticker as base64 PDF' })
  getParcelSticker(@Param('code') code: string) {
    return this.shippingService.getForceLogParcelSticker(code);
  }

  @Post('pickups')
  @ApiOperation({ summary: 'Create a ForceLog pickup request' })
  createPickup(@Body() payload: ForceLogPickupDto) {
    return this.shippingService.createForceLogPickup(payload);
  }

  @Get('cities')
  @ApiOperation({ summary: 'List ForceLog cities' })
  getCities() {
    return this.shippingService.getForceLogCities();
  }

  @Get('stock')
  @ApiOperation({ summary: 'List ForceLog stock products' })
  getStock() {
    return this.shippingService.getForceLogStock();
  }

  @Post('stock/products')
  @ApiOperation({ summary: 'Add a ForceLog stock product' })
  addProduct(@Body() payload: ForceLogProductDto) {
    return this.shippingService.addForceLogProduct(payload);
  }

  @Post('returns/eligible')
  @ApiOperation({ summary: 'Get ForceLog parcels eligible for return' })
  getReturnEligibleParcels() {
    return this.shippingService.getForceLogReturnEligibleParcels();
  }

  @Post('returns')
  @ApiOperation({ summary: 'Request ForceLog parcel return' })
  requestReturn(@Body() payload: ForceLogReturnRequestDto) {
    return this.shippingService.requestForceLogReturn(payload);
  }
}
