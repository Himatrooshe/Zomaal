import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  ConnectSenditDto,
  SenditConnectionErrorDto,
  SenditConnectionStatusDto,
} from './dto/sendit-connection.dto';
import { SenditDeliveryDto } from './dto/sendit-delivery.dto';
import { SenditDistrictQueryDto } from './dto/sendit-district-query.dto';
import { SenditLabelsDto } from './dto/sendit-labels.dto';
import { SenditListQueryDto } from './dto/sendit-list-query.dto';
import {
  SenditPickupDto,
  SenditUpdatePickupDto,
} from './dto/sendit-pickup.dto';
import {
  SenditReturnDto,
  SenditUpdateReturnDto,
} from './dto/sendit-return.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping - Sendit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('sendit/connection')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Check Sendit account connection',
    description:
      'Returns whether the authenticated Zomaal user has stored Sendit credentials. This status check does not call Sendit.',
  })
  @ApiOkResponse({
    description: 'Current user Sendit connection status',
    type: SenditConnectionStatusDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal Bearer token',
    type: SenditConnectionErrorDto,
  })
  checkSenditConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkSenditConnection(user.userId);
  }

  @Post('sendit/connection')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: "Connect or replace the current user's Sendit account",
    description:
      'Validates the supplied API public and secret keys with Sendit, then encrypts and stores them for the authenticated Zomaal user. The secret is never returned.',
  })
  @ApiCreatedResponse({
    description: 'Sendit credentials verified and account connected',
    type: SenditConnectionStatusDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing, empty, or unexpected request fields',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid Zomaal token or rejected Sendit credentials',
    type: SenditConnectionErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'Sendit is reachable but returned an invalid or failed response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Credential encryption is not configured correctly.',
    type: ApiErrorDto,
  })
  connectSendit(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectSenditDto,
  ) {
    return this.shippingService.connectSendit(user.userId, payload);
  }

  @Delete('sendit/connection')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: "Disconnect the current user's Sendit account",
    description:
      "Deletes the authenticated user's stored Sendit credentials and cached Sendit access token. This operation is idempotent.",
  })
  @ApiOkResponse({
    description: 'Sendit account disconnected (also succeeds if not connected)',
    type: SenditConnectionStatusDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal Bearer token',
    type: SenditConnectionErrorDto,
  })
  disconnectSendit(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectSendit(user.userId);
  }

  @Get('sendit/deliveries')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List Sendit deliveries' })
  listSenditDeliveries(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditListQueryDto,
  ) {
    return this.shippingService.listSenditDeliveries(user.userId, query);
  }

  @Post('sendit/deliveries')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create a Sendit delivery' })
  createSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditDeliveryDto,
  ) {
    return this.shippingService.createSenditDelivery(user.userId, payload);
  }

  @Get('sendit/deliveries/statuses')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List Sendit delivery statuses' })
  listSenditDeliveryStatuses(@CurrentUser() user: JwtPayload) {
    return this.shippingService.listSenditDeliveryStatuses(user.userId);
  }

  @Post('sendit/deliveries/labels')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Print Sendit delivery labels' })
  printSenditDeliveryLabels(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditLabelsDto,
  ) {
    return this.shippingService.printSenditDeliveryLabels(user.userId, payload);
  }

  @Get('sendit/deliveries/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get Sendit delivery details' })
  getSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getSenditDelivery(user.userId, code);
  }

  @Put('sendit/deliveries/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Update a Sendit delivery' })
  updateSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() payload: SenditDeliveryDto,
  ) {
    return this.shippingService.updateSenditDelivery(
      user.userId,
      code,
      payload,
    );
  }

  @Delete('sendit/deliveries/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Delete a Sendit delivery' })
  deleteSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.deleteSenditDelivery(user.userId, code);
  }

  @Get('sendit/districts')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List Sendit districts/cities' })
  listSenditDistricts(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditDistrictQueryDto,
  ) {
    return this.shippingService.listSenditDistricts(user.userId, query);
  }

  @Get('sendit/districts/pickup-cities')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List Sendit pickup cities' })
  listSenditPickupCities(@CurrentUser() user: JwtPayload) {
    return this.shippingService.listSenditPickupCities(user.userId);
  }

  @Get('sendit/districts/:id')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get Sendit district details' })
  getSenditDistrict(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shippingService.getSenditDistrict(user.userId, id);
  }

  @Get('sendit/pickups')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List Sendit pickups' })
  listSenditPickups(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditListQueryDto,
  ) {
    return this.shippingService.listSenditPickups(user.userId, query);
  }

  @Post('sendit/pickups')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create a Sendit pickup' })
  createSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditPickupDto,
  ) {
    return this.shippingService.createSenditPickup(user.userId, payload);
  }

  @Get('sendit/pickups/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get Sendit pickup details' })
  getSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getSenditPickup(user.userId, code);
  }

  @Put('sendit/pickups/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Update a Sendit pickup' })
  updateSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() payload: SenditUpdatePickupDto,
  ) {
    return this.shippingService.updateSenditPickup(user.userId, code, payload);
  }

  @Delete('sendit/pickups/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Delete a Sendit pickup' })
  deleteSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.deleteSenditPickup(user.userId, code);
  }

  @Get('sendit/returns')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List Sendit returns' })
  listSenditReturns(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditListQueryDto,
  ) {
    return this.shippingService.listSenditReturns(user.userId, query);
  }

  @Post('sendit/returns')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create a Sendit return request' })
  createSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditReturnDto,
  ) {
    return this.shippingService.createSenditReturn(user.userId, payload);
  }

  @Get('sendit/returns/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get Sendit return details' })
  getSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getSenditReturn(user.userId, code);
  }

  @Put('sendit/returns/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Update a Sendit return request' })
  updateSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() payload: SenditUpdateReturnDto,
  ) {
    return this.shippingService.updateSenditReturn(user.userId, code, payload);
  }

  @Delete('sendit/returns/:code')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Delete a Sendit return request' })
  deleteSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.deleteSenditReturn(user.userId, code);
  }

  @Get('sendit/webhook/latest')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Get latest Sendit webhook received by this server',
  })
  @ApiResponse({ status: 200, description: 'Returns latest webhook payload' })
  getLatestSenditWebhook() {
    return this.shippingService.getLatestSenditWebhook();
  }

  @Get('quicklivraison/webhook/latest')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Get latest QuickLivraison webhook received by this server',
  })
  @ApiResponse({ status: 200, description: 'Returns latest webhook payload' })
  getLatestQuickLivraisonWebhook() {
    return this.shippingService.getLatestQuickLivraisonWebhook();
  }
}
