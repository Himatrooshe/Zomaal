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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  ConnectQuickLivraisonDto,
  QuickLivraisonConnectionErrorDto,
  QuickLivraisonConnectionStatusDto,
} from './dto/quicklivraison-connection.dto';
import { QuickLivraisonBulkDeliveryDto } from './dto/quicklivraison-bulk-delivery.dto';
import { QuickLivraisonDeliveryDto } from './dto/quicklivraison-delivery.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping - QuickLivraison')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping/quicklivraison')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal bearer token.',
  type: ApiErrorDto,
})
export class QuickLivraisonController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({
    summary: 'Check QuickLivraison account connection',
    description:
      'Returns whether the authenticated Zomaal user has a stored QuickLivraison API key. This status check does not call QuickLivraison.',
  })
  @ApiOkResponse({
    description: 'Current user QuickLivraison connection status.',
    type: QuickLivraisonConnectionStatusDto,
  })
  checkConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkQuickLivraisonConnection(user.userId);
  }

  @Post('connection')
  @ApiOperation({
    summary: "Connect or replace the current user's QuickLivraison account",
    description:
      'Validates a primary or subuser API key with QuickLivraison, then encrypts and stores it for the authenticated Zomaal user. The API key is never returned.',
  })
  @ApiCreatedResponse({
    description: 'API key verified and QuickLivraison account connected.',
    type: QuickLivraisonConnectionStatusDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing, empty, or unexpected request fields.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'QuickLivraison rejected the API key or returned an invalid response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'QuickLivraison is unreachable or credential encryption is unavailable.',
  })
  @ApiBody({ type: ConnectQuickLivraisonDto })
  connect(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectQuickLivraisonDto,
  ) {
    return this.shippingService.connectQuickLivraison(user.userId, payload);
  }

  @Delete('connection')
  @ApiOperation({
    summary: "Disconnect the current user's QuickLivraison account",
    description:
      'Deletes the encrypted API key stored for the authenticated Zomaal user. This operation is idempotent.',
  })
  @ApiOkResponse({
    description: 'QuickLivraison account disconnected.',
    type: QuickLivraisonConnectionStatusDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectQuickLivraison(user.userId);
  }

  @Post('deliveries')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create a QuickLivraison delivery' })
  @ApiBody({ type: QuickLivraisonDeliveryDto })
  @ApiOkResponse({
    description:
      'Provider response. The exact envelope is controlled by QuickLivraison.',
    schema: {
      example: {
        success: 'Colis ajouté avec succès.',
        tracking_number: 'PARCEL_12345678',
      },
    },
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
  })
  createDelivery(
    @CurrentUser() user: JwtPayload,
    @Body() payload: QuickLivraisonDeliveryDto,
  ) {
    return this.shippingService.createQuickLivraisonDelivery(
      user.userId,
      payload,
    );
  }

  @Post('deliveries/bulk')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create QuickLivraison deliveries in bulk' })
  @ApiBody({ type: QuickLivraisonBulkDeliveryDto })
  @ApiOkResponse({ description: 'QuickLivraison bulk creation response.' })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
  })
  createBulkDeliveries(
    @CurrentUser() user: JwtPayload,
    @Body() payload: QuickLivraisonBulkDeliveryDto,
  ) {
    return this.shippingService.createQuickLivraisonBulkDeliveries(
      user.userId,
      payload,
    );
  }

  @Get('deliveries')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List QuickLivraison deliveries' })
  @ApiOkResponse({
    description: 'Raw delivery list returned by QuickLivraison.',
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
  })
  listDeliveries(@CurrentUser() user: JwtPayload) {
    return this.shippingService.listQuickLivraisonDeliveries(user.userId);
  }

  @Get('deliveries/:trackingNumber')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Track a QuickLivraison delivery by tracking number',
  })
  @ApiParam({ name: 'trackingNumber', example: 'PARCEL_12345678' })
  @ApiOkResponse({
    description: 'Raw parcel details returned by QuickLivraison.',
  })
  trackDelivery(@Param('trackingNumber') trackingNumber: string) {
    return this.shippingService.trackQuickLivraisonDelivery(trackingNumber);
  }

  @Get('products')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List QuickLivraison products in stock' })
  @ApiOkResponse({
    description: 'Raw stock product list returned by QuickLivraison.',
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
  })
  getProducts(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getQuickLivraisonProducts(user.userId);
  }

  @Get('cities')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List QuickLivraison city IDs' })
  @ApiOkResponse({
    description: 'Raw city ID list returned by QuickLivraison.',
  })
  getCities() {
    return this.shippingService.getQuickLivraisonCities();
  }

  @Get('cities/fees-delays')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'List QuickLivraison cities with fees and delays' })
  @ApiOkResponse({
    description:
      'Raw city, fee, and delivery-delay list returned by QuickLivraison.',
  })
  getCitiesWithFeesAndDelays() {
    return this.shippingService.getQuickLivraisonCitiesWithFeesAndDelays();
  }
}
