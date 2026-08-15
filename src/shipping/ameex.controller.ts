import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AmeexClient } from './ameex.client';
import { AmeexConnectionService } from './ameex-connection.service';
import { AmeexShipmentService } from './ameex-shipment.service';
import { AmeexOverviewService } from './ameex-overview.service';
import {
  AmeexConnectionStatusDto,
  ConnectAmeexDto,
} from './dto/ameex-connection.dto';
import { AmeexParcelDto } from './dto/ameex-parcel.dto';
import {
  AmeexShipmentQueryDto,
  AmeexSyncQueryDto,
} from './dto/ameex-shipment-query.dto';
import { AmeexOverviewQueryDto } from './dto/ameex-overview-query.dto';

@ApiTags('Shipping - Ameex')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('shipping/ameex')
export class AmeexController {
  constructor(
    private readonly connection: AmeexConnectionService,
    private readonly client: AmeexClient,
    private readonly shipments: AmeexShipmentService,
    private readonly overview: AmeexOverviewService,
  ) {}

  @Get('connection')
  @ApiOperation({ summary: 'Check Ameex connection' })
  @ApiOkResponse({ type: AmeexConnectionStatusDto })
  getConnection(@CurrentUser() user: JwtPayload) {
    return this.connection.getStatus(user.userId);
  }

  @Post('connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and connect an Ameex account' })
  @ApiOkResponse({ type: AmeexConnectionStatusDto })
  connect(@CurrentUser() user: JwtPayload, @Body() payload: ConnectAmeexDto) {
    return this.connection.connect(user.userId, payload);
  }

  @Delete('connection')
  @ApiOperation({ summary: 'Disconnect Ameex' })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.connection.disconnect(user.userId);
  }

  @Get('statuses')
  @ApiOperation({ summary: 'Get Ameex parcel statuses' })
  async statuses(@CurrentUser() user: JwtPayload) {
    return this.client.getStatuses(
      await this.connection.getCredentials(user.userId),
    );
  }

  @Post('parcels')
  @ApiOperation({ summary: 'Create and locally store an Ameex parcel' })
  @ApiCreatedResponse({
    schema: { type: 'object', additionalProperties: true },
  })
  async addParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: AmeexParcelDto,
  ) {
    const response = await this.client.addParcel(
      await this.connection.getCredentials(user.userId),
      payload,
    );
    await this.shipments.persistCreatedParcel(user.userId, payload, response);
    return response;
  }

  @Get('provider/parcels/:code')
  @ApiOperation({ summary: 'Get raw Ameex parcel information' })
  async providerInfo(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    const response = await this.client.getParcelInfo(
      await this.connection.getCredentials(user.userId),
      code,
    );
    await this.shipments.reconcileInfo(user.userId, code, response);
    return response;
  }

  @Get('provider/parcels/:code/tracking')
  @ApiOperation({ summary: 'Get raw Ameex tracking history' })
  async providerTracking(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    const response = await this.client.getTracking(
      await this.connection.getCredentials(user.userId),
      code,
    );
    await this.shipments.reconcileTracking(user.userId, code, response);
    return response;
  }

  @Get('shipments')
  @ApiOperation({ summary: 'List locally stored Ameex shipments' })
  list(@CurrentUser() user: JwtPayload, @Query() query: AmeexShipmentQueryDto) {
    return this.shipments.list(user.userId, query);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get Ameex overview analytics' })
  getOverview(
    @CurrentUser() user: JwtPayload,
    @Query() query: AmeexOverviewQueryDto,
  ) {
    return this.overview.getOverview(user.userId, query);
  }

  @Post('shipments/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Import and synchronize Ameex shipments',
    description:
      'Imports remote Ameex parcel-list pages, then mass-tracks up to 25 active local shipments. This endpoint is intended for the frontend Sync Now action and does not require a cron job.',
  })
  sync(@CurrentUser() user: JwtPayload, @Query() query: AmeexSyncQueryDto) {
    return this.shipments.sync(user.userId, query);
  }

  @Post('shipments/:code/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh or import one Ameex shipment' })
  refresh(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shipments.refresh(user.userId, code);
  }

  @Get('shipments/:code/timeline')
  @ApiOperation({ summary: 'Get an Ameex shipment timeline' })
  timeline(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shipments.timeline(user.userId, code);
  }

  @Get('shipments/:code')
  @ApiOperation({ summary: 'Get one locally stored Ameex shipment' })
  shipment(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shipments.get(user.userId, code);
  }
}
