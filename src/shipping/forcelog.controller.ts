import {
  applyDecorators,
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

const forceLogAuthDescription =
  'Requires `Authorization: Bearer <accessToken>`. In Swagger UI, click **Authorize** and paste the Zomaal access token only.';

const providerObjectSchema = {
  type: 'object' as const,
  additionalProperties: true,
};

function ApiForceLogProviderErrors() {
  return applyDecorators(
    ApiConflictResponse({
      description:
        'The authenticated user has not connected a ForceLog account.',
      type: ApiErrorDto,
    }),
    ApiBadGatewayResponse({
      description:
        'ForceLog rejected the request or returned an invalid provider response.',
      type: ApiErrorDto,
    }),
    ApiServiceUnavailableResponse({
      description:
        'ForceLog is unreachable or the stored credential cannot be decrypted.',
      type: ApiErrorDto,
    }),
  );
}

@ApiTags('Shipping - ForceLog')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('shipping/forcelog')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal bearer token.',
  type: ApiErrorDto,
})
export class ForceLogController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({
    summary: 'Check ForceLog account connection',
    operationId: 'getForceLogConnectionStatus',
    description: `${forceLogAuthDescription} Returns whether the current user has an encrypted ForceLog API key stored. The key is never returned and this check does not call ForceLog.`,
  })
  @ApiOkResponse({
    description: 'Current user ForceLog connection status.',
    type: ForceLogConnectionStatusDto,
  })
  checkConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkForceLogConnection(user.userId);
  }

  @Post('connection')
  @ApiOperation({
    summary: "Connect or replace the current user's ForceLog account",
    operationId: 'connectForceLogAccount',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Validates the key with ForceLog, then encrypts and stores it. Reconnecting replaces the previous key; the plaintext key is never returned.`,
  })
  @ApiBody({
    type: ConnectForceLogDto,
    required: true,
    examples: {
      apiKey: {
        summary: 'ForceLog customer API key',
        value: { apiKey: 'your-forcelog-api-key' },
      },
    },
  })
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
  @ApiOperation({
    summary: "Disconnect the current user's ForceLog account",
    operationId: 'disconnectForceLogAccount',
    description: `${forceLogAuthDescription} Deletes the encrypted API key. The operation is idempotent and does not delete anything in ForceLog.`,
  })
  @ApiOkResponse({
    description: 'ForceLog account disconnected.',
    type: ForceLogConnectionStatusDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectForceLog(user.userId);
  }

  @Post('parcels')
  @ApiOperation({
    summary: 'Add a ForceLog parcel',
    operationId: 'createForceLogParcel',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Creates a parcel using the connected ForceLog account. The provider response is returned unchanged.`,
  })
  @ApiBody({ type: ForceLogParcelDto, required: true })
  @ApiCreatedResponse({
    description: 'Parcel accepted by ForceLog.',
    schema: {
      ...providerObjectSchema,
      example: {
        success: true,
        code: 'FL000123456',
        message: 'Parcel added successfully',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'The parcel payload is invalid or contains unknown fields.',
    type: ApiErrorDto,
  })
  @ApiForceLogProviderErrors()
  addParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogParcelDto,
  ) {
    return this.shippingService.addForceLogParcel(user.userId, payload);
  }

  @Get('parcels/:code')
  @ApiOperation({
    summary: 'Get ForceLog parcel details',
    operationId: 'getForceLogParcel',
    description: `${forceLogAuthDescription} Looks up one parcel by its ForceLog code.`,
  })
  @ApiParam({
    name: 'code',
    description: 'ForceLog parcel code.',
    example: 'FL000123456',
  })
  @ApiOkResponse({
    description: 'ForceLog parcel details.',
    schema: {
      ...providerObjectSchema,
      example: {
        CODE: 'FL000123456',
        ORDER_NUM: 'ORDER-1001',
        STATUS: 'NEW_PARCEL',
        RECEIVE: 'Sara El Amrani',
        PHONE: '0612345678',
        CITY: 'Casablanca',
        COD: 250,
      },
    },
  })
  @ApiForceLogProviderErrors()
  getParcel(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shippingService.getForceLogParcel(user.userId, code);
  }

  @Post('parcels/relaunch')
  @ApiOperation({
    summary: 'Relaunch a ForceLog parcel to a new customer',
    operationId: 'relaunchForceLogParcel',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Reuses an existing parcel code with updated recipient and COD details.`,
  })
  @ApiBody({ type: ForceLogRelaunchDto, required: true })
  @ApiCreatedResponse({
    description: 'Parcel relaunch accepted by ForceLog.',
    schema: {
      ...providerObjectSchema,
      example: { success: true, code: 'FL000123456' },
    },
  })
  @ApiBadRequestResponse({
    description: 'The relaunch payload is invalid or contains unknown fields.',
    type: ApiErrorDto,
  })
  @ApiForceLogProviderErrors()
  relaunchParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogRelaunchDto,
  ) {
    return this.shippingService.relaunchForceLogParcel(user.userId, payload);
  }

  @Post('parcels/relaunch-zone')
  @ApiOperation({
    summary: 'Relaunch a ForceLog parcel to a new city',
    operationId: 'relaunchForceLogParcelZone',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Relaunches an existing parcel and changes its destination city.`,
  })
  @ApiBody({ type: ForceLogRelaunchZoneDto, required: true })
  @ApiCreatedResponse({
    description: 'Zone relaunch accepted by ForceLog.',
    schema: {
      ...providerObjectSchema,
      example: { success: true, code: 'FL000123456', city: 'CASABLANCA' },
    },
  })
  @ApiBadRequestResponse({
    description: 'The zone-relaunch payload is invalid.',
    type: ApiErrorDto,
  })
  @ApiForceLogProviderErrors()
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
  @ApiOperation({
    summary: 'Delete a ForceLog parcel with NEW_PARCEL status',
    operationId: 'deleteForceLogParcel',
    description: `${forceLogAuthDescription} ForceLog only permits deletion while the parcel is still in NEW_PARCEL status.`,
  })
  @ApiParam({
    name: 'code',
    description: 'ForceLog parcel code.',
    example: 'FL000123456',
  })
  @ApiOkResponse({
    description: 'Parcel deleted by ForceLog.',
    schema: { ...providerObjectSchema, example: { success: true } },
  })
  @ApiForceLogProviderErrors()
  deleteParcel(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.shippingService.deleteForceLogParcel(user.userId, code);
  }

  @Get('parcels/:code/sticker')
  @ApiOperation({
    summary: 'Get a ForceLog parcel sticker as base64 PDF',
    operationId: 'getForceLogParcelSticker',
    description: `${forceLogAuthDescription} Returns the provider PDF encoded as base64 so JSON clients can store or decode it.`,
  })
  @ApiParam({
    name: 'code',
    description: 'ForceLog parcel code.',
    example: 'FL000123456',
  })
  @ApiOkResponse({
    description: 'Base64-encoded parcel sticker.',
    schema: {
      type: 'object',
      required: ['contentType', 'encoding', 'data'],
      properties: {
        contentType: { type: 'string', example: 'application/pdf' },
        encoding: { type: 'string', enum: ['base64'], example: 'base64' },
        data: { type: 'string', format: 'byte', example: 'JVBERi0xLjQK...' },
      },
    },
  })
  @ApiForceLogProviderErrors()
  getParcelSticker(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getForceLogParcelSticker(user.userId, code);
  }

  @Post('pickups')
  @ApiOperation({
    summary: 'Create a ForceLog pickup request',
    operationId: 'createForceLogPickup',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Requests collection of parcels from the supplied address.`,
  })
  @ApiBody({ type: ForceLogPickupDto, required: true })
  @ApiCreatedResponse({
    description: 'Pickup request accepted by ForceLog.',
    schema: {
      ...providerObjectSchema,
      example: { success: true, pickupCode: 'PU000123456' },
    },
  })
  @ApiBadRequestResponse({
    description: 'The pickup payload is invalid or contains unknown fields.',
    type: ApiErrorDto,
  })
  @ApiForceLogProviderErrors()
  createPickup(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogPickupDto,
  ) {
    return this.shippingService.createForceLogPickup(user.userId, payload);
  }

  @Get('cities')
  @ApiOperation({
    summary: 'List ForceLog cities',
    operationId: 'listForceLogCities',
    description: `${forceLogAuthDescription} Returns the provider city identifiers required by parcel, pickup, and return payloads.`,
  })
  @ApiOkResponse({
    description: 'ForceLog city catalog.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        example: { ID: '1', NAME: 'Casablanca' },
      },
    },
  })
  @ApiForceLogProviderErrors()
  getCities(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getForceLogCities(user.userId);
  }

  @Get('stock')
  @ApiOperation({
    summary: 'List ForceLog stock products',
    operationId: 'listForceLogStock',
    description: `${forceLogAuthDescription} Returns products and variants currently registered in the connected ForceLog stock account.`,
  })
  @ApiOkResponse({
    description: 'ForceLog stock products.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        example: {
          ID: 42,
          PRODUCT_NAME: 'Running shoes',
          QUANTITY: 15,
          BARCODE: 'SKU-001',
        },
      },
    },
  })
  @ApiForceLogProviderErrors()
  getStock(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getForceLogStock(user.userId);
  }

  @Post('stock/products')
  @ApiOperation({
    summary: 'Add a ForceLog stock product',
    operationId: 'createForceLogStockProduct',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Creates a product with either a direct quantity or optional variants.`,
  })
  @ApiBody({ type: ForceLogProductDto, required: true })
  @ApiCreatedResponse({
    description: 'Stock product accepted by ForceLog.',
    schema: {
      ...providerObjectSchema,
      example: { success: true, productId: 42 },
    },
  })
  @ApiBadRequestResponse({
    description: 'The stock-product payload is invalid.',
    type: ApiErrorDto,
  })
  @ApiForceLogProviderErrors()
  addProduct(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogProductDto,
  ) {
    return this.shippingService.addForceLogProduct(user.userId, payload);
  }

  @Post('returns/eligible')
  @ApiOperation({
    summary: 'Get ForceLog parcels eligible for return',
    operationId: 'listForceLogReturnEligibleParcels',
    description: `${forceLogAuthDescription} Requests the connected account's parcels that can currently be included in a return request. This endpoint has no request body.`,
  })
  @ApiCreatedResponse({
    description: 'Parcels eligible for return.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        example: { CODE: 'FL000123456', STATUS: 'RETURN_ELIGIBLE' },
      },
    },
  })
  @ApiForceLogProviderErrors()
  getReturnEligibleParcels(@CurrentUser() user: JwtPayload) {
    return this.shippingService.getForceLogReturnEligibleParcels(user.userId);
  }

  @Post('returns')
  @ApiOperation({
    summary: 'Request a ForceLog parcel return',
    operationId: 'createForceLogReturn',
    description: `${forceLogAuthDescription} Requires \`Content-Type: application/json\`. Creates one return request for one or more eligible parcel codes.`,
  })
  @ApiBody({ type: ForceLogReturnRequestDto, required: true })
  @ApiCreatedResponse({
    description: 'Return request accepted by ForceLog.',
    schema: {
      ...providerObjectSchema,
      example: { success: true, returnCode: 'RT000123456' },
    },
  })
  @ApiBadRequestResponse({
    description: 'The return payload is invalid or contains no parcel codes.',
    type: ApiErrorDto,
  })
  @ApiForceLogProviderErrors()
  requestReturn(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ForceLogReturnRequestDto,
  ) {
    return this.shippingService.requestForceLogReturn(user.userId, payload);
  }
}
