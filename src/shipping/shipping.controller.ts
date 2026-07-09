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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

@ApiTags('Shipping')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('sendit/connection')
  @ApiOperation({ summary: 'Check Sendit account connection' })
  @ApiResponse({ status: 200, description: 'Sendit account is connected' })
  checkSenditConnection() {
    return this.shippingService.checkSenditConnection();
  }

  @Get('sendit/deliveries')
  @ApiOperation({ summary: 'List Sendit deliveries' })
  listSenditDeliveries(@Query() query: SenditListQueryDto) {
    return this.shippingService.listSenditDeliveries(query);
  }

  @Post('sendit/deliveries')
  @ApiOperation({ summary: 'Create a Sendit delivery' })
  createSenditDelivery(@Body() payload: SenditDeliveryDto) {
    return this.shippingService.createSenditDelivery(payload);
  }

  @Get('sendit/deliveries/statuses')
  @ApiOperation({ summary: 'List Sendit delivery statuses' })
  listSenditDeliveryStatuses() {
    return this.shippingService.listSenditDeliveryStatuses();
  }

  @Post('sendit/deliveries/labels')
  @ApiOperation({ summary: 'Print Sendit delivery labels' })
  printSenditDeliveryLabels(@Body() payload: SenditLabelsDto) {
    return this.shippingService.printSenditDeliveryLabels(payload);
  }

  @Get('sendit/deliveries/:code')
  @ApiOperation({ summary: 'Get Sendit delivery details' })
  getSenditDelivery(@Param('code') code: string) {
    return this.shippingService.getSenditDelivery(code);
  }

  @Put('sendit/deliveries/:code')
  @ApiOperation({ summary: 'Update a Sendit delivery' })
  updateSenditDelivery(
    @Param('code') code: string,
    @Body() payload: SenditDeliveryDto,
  ) {
    return this.shippingService.updateSenditDelivery(code, payload);
  }

  @Delete('sendit/deliveries/:code')
  @ApiOperation({ summary: 'Delete a Sendit delivery' })
  deleteSenditDelivery(@Param('code') code: string) {
    return this.shippingService.deleteSenditDelivery(code);
  }

  @Get('sendit/districts')
  @ApiOperation({ summary: 'List Sendit districts/cities' })
  listSenditDistricts(@Query() query: SenditDistrictQueryDto) {
    return this.shippingService.listSenditDistricts(query);
  }

  @Get('sendit/districts/pickup-cities')
  @ApiOperation({ summary: 'List Sendit pickup cities' })
  listSenditPickupCities() {
    return this.shippingService.listSenditPickupCities();
  }

  @Get('sendit/districts/:id')
  @ApiOperation({ summary: 'Get Sendit district details' })
  getSenditDistrict(@Param('id', ParseIntPipe) id: number) {
    return this.shippingService.getSenditDistrict(id);
  }

  @Get('sendit/pickups')
  @ApiOperation({ summary: 'List Sendit pickups' })
  listSenditPickups(@Query() query: SenditListQueryDto) {
    return this.shippingService.listSenditPickups(query);
  }

  @Post('sendit/pickups')
  @ApiOperation({ summary: 'Create a Sendit pickup' })
  createSenditPickup(@Body() payload: SenditPickupDto) {
    return this.shippingService.createSenditPickup(payload);
  }

  @Get('sendit/pickups/:code')
  @ApiOperation({ summary: 'Get Sendit pickup details' })
  getSenditPickup(@Param('code') code: string) {
    return this.shippingService.getSenditPickup(code);
  }

  @Put('sendit/pickups/:code')
  @ApiOperation({ summary: 'Update a Sendit pickup' })
  updateSenditPickup(
    @Param('code') code: string,
    @Body() payload: SenditUpdatePickupDto,
  ) {
    return this.shippingService.updateSenditPickup(code, payload);
  }

  @Delete('sendit/pickups/:code')
  @ApiOperation({ summary: 'Delete a Sendit pickup' })
  deleteSenditPickup(@Param('code') code: string) {
    return this.shippingService.deleteSenditPickup(code);
  }

  @Get('sendit/returns')
  @ApiOperation({ summary: 'List Sendit returns' })
  listSenditReturns(@Query() query: SenditListQueryDto) {
    return this.shippingService.listSenditReturns(query);
  }

  @Post('sendit/returns')
  @ApiOperation({ summary: 'Create a Sendit return request' })
  createSenditReturn(@Body() payload: SenditReturnDto) {
    return this.shippingService.createSenditReturn(payload);
  }

  @Get('sendit/returns/:code')
  @ApiOperation({ summary: 'Get Sendit return details' })
  getSenditReturn(@Param('code') code: string) {
    return this.shippingService.getSenditReturn(code);
  }

  @Put('sendit/returns/:code')
  @ApiOperation({ summary: 'Update a Sendit return request' })
  updateSenditReturn(
    @Param('code') code: string,
    @Body() payload: SenditUpdateReturnDto,
  ) {
    return this.shippingService.updateSenditReturn(code, payload);
  }

  @Delete('sendit/returns/:code')
  @ApiOperation({ summary: 'Delete a Sendit return request' })
  deleteSenditReturn(@Param('code') code: string) {
    return this.shippingService.deleteSenditReturn(code);
  }

  @Get('sendit/webhook/latest')
  @ApiOperation({
    summary: 'Get latest Sendit webhook received by this server',
  })
  @ApiResponse({ status: 200, description: 'Returns latest webhook payload' })
  getLatestSenditWebhook() {
    return this.shippingService.getLatestSenditWebhook();
  }

  @Get('quicklivraison/webhook/latest')
  @ApiOperation({
    summary: 'Get latest QuickLivraison webhook received by this server',
  })
  @ApiResponse({ status: 200, description: 'Returns latest webhook payload' })
  getLatestQuickLivraisonWebhook() {
    return this.shippingService.getLatestQuickLivraisonWebhook();
  }
}
