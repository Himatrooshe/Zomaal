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
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
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
@ApiConsumes('application/json')
@ApiProduces('application/json')
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
    operationId: 'getQuickLivraisonConnectionStatus',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns whether the authenticated Zomaal user has a stored QuickLivraison API key. This status check does not call QuickLivraison and never returns the stored key.',
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
    operationId: 'connectQuickLivraisonAccount',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. Validates a primary or subuser API key with QuickLivraison, then encrypts and stores it for the authenticated Zomaal user. Reconnecting replaces the previous credential. The API key is never returned.',
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
    type: ApiErrorDto,
  })
  @ApiBody({
    type: ConnectQuickLivraisonDto,
    description:
      'QuickLivraison credential to validate and store for the authenticated user.',
    examples: {
      subuser: {
        summary: 'Subuser API key',
        value: { apiKey: 'sub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      },
      primary: {
        summary: 'Primary account API key',
        value: { apiKey: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      },
    },
  })
  connect(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectQuickLivraisonDto,
  ) {
    return this.shippingService.connectQuickLivraison(user.userId, payload);
  }

  @Delete('connection')
  @ApiOperation({
    summary: "Disconnect the current user's QuickLivraison account",
    operationId: 'disconnectQuickLivraisonAccount',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Deletes the encrypted API key stored for the authenticated Zomaal user. This operation is idempotent: disconnecting an already disconnected account still succeeds.',
  })
  @ApiOkResponse({
    description: 'QuickLivraison account disconnected.',
    type: QuickLivraisonConnectionStatusDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectQuickLivraison(user.userId);
  }

  @Post('deliveries')
  @ApiOperation({
    summary: 'Create a QuickLivraison delivery',
    operationId: 'createQuickLivraisonDelivery',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. The authenticated user must connect QuickLivraison first. Zomaal injects the stored provider API key server-side; never include `api_key` in this payload. The successful body is passed through from QuickLivraison.',
  })
  @ApiBody({
    type: QuickLivraisonDeliveryDto,
    description:
      'Recipient, cash-on-delivery, fulfillment, and optional exchange details.',
    examples: {
      nonStock: {
        summary: 'Non-stock cash-on-delivery parcel',
        value: {
          district_id: 123,
          name: 'Sara El Amrani',
          amount: 250,
          phone: '0612345678',
          address: '123 Rue Al Massira, Maarif, Casablanca',
          code: 'ORDER-1001',
          note: 'Call the recipient before delivery',
          open: false,
          try: false,
          echange: false,
          prd_name: 'Running shoes',
          qte_prd: 1,
        },
      },
      stock: {
        summary: 'Stock-fulfilled parcel',
        value: {
          district_id: 123,
          name: 'Sara El Amrani',
          amount: 250,
          phone: '0612345678',
          address: '123 Rue Al Massira, Maarif, Casablanca',
          code: 'ORDER-1001',
          received_quantity: { '42': 2 },
        },
      },
      exchange: {
        summary: 'Exchange parcel',
        value: {
          district_id: 123,
          name: 'Sara El Amrani',
          amount: 0,
          phone: '0612345678',
          address: '123 Rue Al Massira, Maarif, Casablanca',
          code: 'EXCHANGE-1001',
          echange: true,
          echange_colis: 'PARCEL_87654321',
          prd_name: 'Replacement running shoes',
          qte_prd: 1,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Delivery accepted. Zomaal returns the QuickLivraison JSON response unchanged, so the provider may add fields to this envelope.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        success: 'Colis ajouté avec succès.',
        tracking_number: 'PARCEL_12345678',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'A required delivery field is missing/invalid or an unexpected field was sent.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'QuickLivraison rejected the request or returned a malformed/failed response. When available, the raw provider error is included in `quicklivraison`.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'QuickLivraison is unreachable or the stored credential cannot be decrypted.',
    type: ApiErrorDto,
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
  @ApiOperation({
    summary: 'Create QuickLivraison deliveries in bulk',
    operationId: 'createQuickLivraisonDeliveriesBulk',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. Submits one or more deliveries in a single provider request. The authenticated user must connect QuickLivraison first; Zomaal injects the stored API key server-side.',
  })
  @ApiBody({
    type: QuickLivraisonBulkDeliveryDto,
    description:
      'A non-empty parcel array. Each item uses the single-delivery schema.',
  })
  @ApiCreatedResponse({
    description:
      'Bulk request accepted. Zomaal returns the QuickLivraison JSON response unchanged, so the provider may add fields.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        success: 'Colis ajoutés avec succès.',
        parcels: [
          {
            code: 'ORDER-1001',
            tracking_number: 'PARCEL_12345678',
          },
          {
            code: 'ORDER-1002',
            tracking_number: 'PARCEL_87654321',
          },
        ],
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The parcel array is empty, an item is invalid, or an unexpected field was sent.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'QuickLivraison rejected the bulk request or returned a malformed/failed response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'QuickLivraison is unreachable or the stored credential cannot be decrypted.',
    type: ApiErrorDto,
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
  @ApiOperation({
    summary: 'List QuickLivraison deliveries',
    operationId: 'listQuickLivraisonDeliveries',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns the delivery collection from the connected QuickLivraison account. The provider currently controls pagination and the pass-through response envelope.',
  })
  @ApiOkResponse({
    description:
      'QuickLivraison delivery list returned unchanged. The response may be either an array or a provider envelope containing the array.',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        { type: 'object', additionalProperties: true },
      ],
      example: [
        {
          tracking_number: 'PARCEL_12345678',
          code: 'ORDER-1001',
          name: 'Sara El Amrani',
          phone: '0612345678',
          amount: 250,
          status: 'En cours',
          created_at: '2026-07-17T09:00:00.000Z',
        },
      ],
    },
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'QuickLivraison returned a malformed or failed response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'QuickLivraison is unreachable or the stored credential cannot be decrypted.',
    type: ApiErrorDto,
  })
  listDeliveries(@CurrentUser() user: JwtPayload) {
    return this.shippingService.listQuickLivraisonDeliveries(user.userId);
  }

  @Get('deliveries/:trackingNumber')
  @ApiOperation({
    summary: 'Track a QuickLivraison delivery by tracking number',
    operationId: 'getQuickLivraisonDeliveryTracking',
    description:
      "Requires `Authorization: Bearer <accessToken>`. Looks up one parcel using the provider tracking number. This provider endpoint does not use the user's stored QuickLivraison key, but the Zomaal route remains protected.",
  })
  @ApiParam({
    name: 'trackingNumber',
    description:
      'QuickLivraison tracking number returned when the delivery was created.',
    example: 'PARCEL_12345678',
    type: String,
  })
  @ApiOkResponse({
    description:
      'Parcel details returned unchanged by QuickLivraison. Provider-controlled fields may be added.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        tracking_number: 'PARCEL_12345678',
        code: 'ORDER-1001',
        status: 'En cours de livraison',
        recipient: 'Sara El Amrani',
        city: 'Casablanca',
        amount: 250,
        updated_at: '2026-07-17T12:15:00.000Z',
      },
    },
  })
  @ApiBadGatewayResponse({
    description:
      'The tracking number was rejected or QuickLivraison returned a malformed/failed response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'QuickLivraison is currently unreachable.',
    type: ApiErrorDto,
  })
  trackDelivery(@Param('trackingNumber') trackingNumber: string) {
    return this.shippingService.trackQuickLivraisonDelivery(trackingNumber);
  }

  @Get('products')
  @ApiOperation({
    summary: 'List QuickLivraison products in stock',
    operationId: 'listQuickLivraisonProducts',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns stock product identifiers for the connected account. Use those identifiers as the keys in `received_quantity` when creating a stock-fulfilled delivery.',
  })
  @ApiOkResponse({
    description:
      'QuickLivraison product list returned unchanged. The provider may return either an array or an object envelope.',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        { type: 'object', additionalProperties: true },
      ],
      example: [
        {
          id: 42,
          name: 'Running shoes - black - size 42',
          quantity: 18,
        },
      ],
    },
  })
  @ApiConflictResponse({
    description: 'The current user has not connected a QuickLivraison account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'QuickLivraison returned a malformed or failed response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'QuickLivraison is unreachable or the stored credential cannot be decrypted.',
    type: ApiErrorDto,
  })
  getProducts(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getQuickLivraisonProducts(user.userId);
  }

  @Get('cities')
  @ApiOperation({
    summary: 'List QuickLivraison city IDs',
    operationId: 'listQuickLivraisonCities',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns provider city/district identifiers. Use one of these values as `district_id` when creating a delivery. No connected QuickLivraison account is required.',
  })
  @ApiOkResponse({
    description:
      'QuickLivraison city list returned unchanged. The provider may return either an array or an object envelope.',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        { type: 'object', additionalProperties: true },
      ],
      example: [
        { id: 123, name: 'Casablanca' },
        { id: 456, name: 'Rabat' },
      ],
    },
  })
  @ApiBadGatewayResponse({
    description: 'QuickLivraison returned a malformed or failed response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'QuickLivraison is currently unreachable.',
    type: ApiErrorDto,
  })
  getCities() {
    return this.shippingService.getQuickLivraisonCities();
  }

  @Get('cities/fees-delays')
  @ApiOperation({
    summary: 'List QuickLivraison cities with fees and delays',
    operationId: 'listQuickLivraisonCityFeesAndDelays',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns QuickLivraison destination identifiers together with provider pricing and estimated delivery time. No connected QuickLivraison account is required.',
  })
  @ApiOkResponse({
    description:
      'QuickLivraison city, fee, and delay data returned unchanged. The provider may add fields or wrap the list in an object.',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        { type: 'object', additionalProperties: true },
      ],
      example: [
        {
          id: 123,
          city: 'Casablanca',
          fee: 35,
          delay: '24-48h',
        },
      ],
    },
  })
  @ApiBadGatewayResponse({
    description: 'QuickLivraison returned a malformed or failed response.',
    type: QuickLivraisonConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'QuickLivraison is currently unreachable.',
    type: ApiErrorDto,
  })
  getCitiesWithFeesAndDelays() {
    return this.shippingService.getQuickLivraisonCitiesWithFeesAndDelays();
  }
}
