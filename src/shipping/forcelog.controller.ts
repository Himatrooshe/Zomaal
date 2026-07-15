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
  ConnectForceLogDto,
  ForceLogConnectionStatusDto,
} from './dto/forcelog-connection.dto';
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
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal bearer token.',
  type: ApiErrorDto,
})
export class ForceLogController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Check ForceLog account connection',
    description:
      'Returns whether the authenticated Zomaal user has a stored ForceLog API key. This status check does not call ForceLog.',
  })
  @ApiOkResponse({
    description: 'Current user ForceLog connection status.',
    type: ForceLogConnectionStatusDto,
  })
  checkConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkForceLogConnection(user.userId);
  }

  @Post('connection')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: "Connect or replace the current user's ForceLog account",
    description:
      'Validates the API key against the authenticated ForceLog cities endpoint, then encrypts and stores it for the authenticated Zomaal user. The API key is never returned.',
  })
  @ApiBody({ type: ConnectForceLogDto })
  @ApiCreatedResponse({
    description: 'API key verified and ForceLog account connected.',
    type: ForceLogConnectionStatusDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing, empty, or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'ForceLog rejected the API key or returned an invalid response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'ForceLog is unreachable or credential encryption is unavailable.',
    type: ApiErrorDto,
  })
  connect(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectForceLogDto,
  ) {
    return this.shippingService.connectForceLog(user.userId, payload);
  }

  @Delete('connection')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: "Disconnect the current user's ForceLog account",
    description:
      'Deletes the encrypted API key stored for the authenticated Zomaal user. This operation is idempotent.',
  })
  @ApiOkResponse({
    description: 'ForceLog account disconnected.',
    type: ForceLogConnectionStatusDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectForceLog(user.userId);
  }

  @Post('parcels')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Add a ForceLog parcel' })
  addParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogParcelDto,
  ) {
    return this.shippingService.addForceLogParcel(user.userId, payload);
  }

  @Get('parcels/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get ForceLog parcel details' })
  getParcel(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shippingService.getForceLogParcel(user.userId, code);
  }

  @Post('parcels/relaunch')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Relaunch ForceLog parcel to a new customer' })
  relaunchParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogRelaunchDto,
  ) {
    return this.shippingService.relaunchForceLogParcel(user.userId, payload);
  }

  @Post('parcels/relaunch-zone')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Relaunch ForceLog parcel to a new city' })
  relaunchParcelZone(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogRelaunchZoneDto,
  ) {
    return this.shippingService.relaunchForceLogParcelZone(
      user.userId,
      payload,
    );
  }

  @Delete('parcels/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Delete a ForceLog parcel with NEW_PARCEL status' })
  deleteParcel(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shippingService.deleteForceLogParcel(user.userId, code);
  }

  @Get('parcels/:code/sticker')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get ForceLog parcel sticker as base64 PDF' })
  getParcelSticker(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getForceLogParcelSticker(user.userId, code);
  }

  @Post('pickups')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create a ForceLog pickup request' })
  createPickup(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogPickupDto,
  ) {
    return this.shippingService.createForceLogPickup(user.userId, payload);
  }

  @Get('cities')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List ForceLog cities' })
  getCities(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getForceLogCities(user.userId);
  }

  @Get('stock')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List ForceLog stock products' })
  getStock(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getForceLogStock(user.userId);
  }

  @Post('stock/products')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Add a ForceLog stock product' })
  addProduct(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogProductDto,
  ) {
    return this.shippingService.addForceLogProduct(user.userId, payload);
  }

  @Post('returns/eligible')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get ForceLog parcels eligible for return' })
  getReturnEligibleParcels(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getForceLogReturnEligibleParcels(user.userId);
  }

  @Post('returns')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Request ForceLog parcel return' })
  requestReturn(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogReturnRequestDto,
  ) {
    return this.shippingService.requestForceLogReturn(user.userId, payload);
  }
}
