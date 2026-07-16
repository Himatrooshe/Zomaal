import {
  applyDecorators,
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
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
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
import {
  SenditActionResponseDto,
  SenditDeliveryListResponseDto,
  SenditDeliveryResponseDto,
  SenditDeliveryStatusListResponseDto,
  SenditDistrictListResponseDto,
  SenditDistrictResponseDto,
  SenditLabelsResponseDto,
  SenditNotConnectedErrorDto,
  SenditPickupListResponseDto,
  SenditPickupResponseDto,
  SenditReturnListResponseDto,
  SenditReturnResponseDto,
  SenditServiceUnavailableErrorDto,
  SenditUpstreamErrorDto,
  SenditValidationErrorDto,
} from './dto/sendit-response.dto';
import { ShippingService } from './shipping.service';

const senditAuthorizationDescription =
  '**Authorization header:** `Bearer <accessToken>`. Use the Zomaal access token returned by `/auth/login` or `/auth/verify-otp`; a refresh token is not accepted. In Swagger UI, click **Authorize** and paste the access token only.';

function ApiSenditProviderErrors() {
  return applyDecorators(
    ApiConflictResponse({
      description:
        'The authenticated user has not connected a Sendit account yet.',
      type: SenditNotConnectedErrorDto,
    }),
    ApiBadGatewayResponse({
      description:
        'Sendit returned a non-success response, malformed JSON, or an incomplete payload. Provider details are included when available.',
      type: SenditUpstreamErrorDto,
    }),
    ApiServiceUnavailableResponse({
      description:
        'Stored Sendit credentials cannot be decrypted or credential encryption is misconfigured.',
      type: SenditServiceUnavailableErrorDto,
    }),
  );
}

function ApiSenditValidationError(description: string) {
  return ApiBadRequestResponse({
    description,
    type: SenditValidationErrorDto,
  });
}

function ApiSenditListQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      description: 'One-based result page. Defaults to the provider default.',
      schema: { type: 'integer', minimum: 1, example: 1 },
    }),
    ApiQuery({
      name: 'querystring',
      required: false,
      description:
        'Provider search text, such as a code, name, phone number, or merchant reference.',
      schema: { type: 'string', example: 'ORDER-2026-0042' },
    }),
  );
}

@ApiTags('Shipping - Sendit')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('shipping')
@ApiUnauthorizedResponse({
  description:
    'Authentication failed. Every route requires a valid Zomaal access token; provider-backed routes can also return 401 when Sendit rejects the stored credentials.',
  type: SenditConnectionErrorDto,
  examples: {
    missingOrInvalidAccessToken: {
      summary: 'Missing, expired, or invalid Zomaal access token',
      value: {
        message: 'Unauthorized',
        error: 'Unauthorized',
        statusCode: 401,
      },
    },
    senditCredentialsRejected: {
      summary: 'Stored Sendit credentials were rejected',
      value: {
        message: 'Sendit request was not authorized',
        error: 'Unauthorized',
        statusCode: 401,
      },
    },
  },
})
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('sendit/connection')
  @ApiOperation({
    summary: 'Check Sendit account connection',
    operationId: 'getSenditConnectionStatus',
    description: `${senditAuthorizationDescription}\n\nReturns whether the authenticated Zomaal user has encrypted Sendit credentials stored. This status check reads Zomaal's database and does not call Sendit. A disconnected account is a successful \`200\` response with \`connected: false\`.`,
  })
  @ApiOkResponse({
    description: 'Current user Sendit connection status.',
    type: SenditConnectionStatusDto,
    examples: {
      connected: {
        summary: 'Sendit account connected',
        value: {
          connected: true,
          provider: 'sendit.ma',
          accountName: 'Zomaal Store',
          connectedAt: '2026-07-17T09:15:00.000Z',
          message: 'Sendit account is connected',
        },
      },
      disconnected: {
        summary: 'No Sendit account connected',
        value: {
          connected: false,
          provider: 'sendit.ma',
          accountName: null,
          connectedAt: null,
          message: 'Sendit account is not connected',
        },
      },
    },
  })
  checkSenditConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkSenditConnection(user.userId);
  }

  @Post('sendit/connection')
  @ApiOperation({
    summary: "Connect or replace the current user's Sendit account",
    operationId: 'connectSenditAccount',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Validates the supplied public and secret API keys against Sendit, then encrypts and stores them for the authenticated Zomaal user. Calling this route again atomically replaces the previous credentials. Neither key is returned.`,
  })
  @ApiBody({
    type: ConnectSenditDto,
    required: true,
    description:
      'Sendit API credentials generated from the merchant dashboard. Both fields are required; unknown fields are rejected.',
  })
  @ApiCreatedResponse({
    description: 'Sendit credentials verified and account connected.',
    type: SenditConnectionStatusDto,
    example: {
      connected: true,
      provider: 'sendit.ma',
      accountName: 'Zomaal Store',
      connectedAt: '2026-07-17T09:15:00.000Z',
      message: 'Sendit account is connected',
    },
  })
  @ApiBadRequestResponse({
    description:
      'The JSON body is missing, contains empty credentials, uses the wrong types, or includes unexpected fields.',
    type: SenditValidationErrorDto,
    example: {
      message: ['public_key should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    },
  })
  @ApiBadGatewayResponse({
    description:
      'Sendit is reachable but returned an invalid or failed response.',
    type: SenditUpstreamErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'The SHIPPING_CREDENTIAL_ENCRYPTION_KEY deployment secret is missing or invalid.',
    type: SenditServiceUnavailableErrorDto,
  })
  connectSendit(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectSenditDto,
  ) {
    return this.shippingService.connectSendit(user.userId, payload);
  }

  @Delete('sendit/connection')
  @ApiOperation({
    summary: "Disconnect the current user's Sendit account",
    operationId: 'disconnectSenditAccount',
    description: `${senditAuthorizationDescription}\n\nDeletes the authenticated user's encrypted Sendit credentials and cached provider access token. This operation is idempotent: it returns the same disconnected state when no connection exists.`,
  })
  @ApiOkResponse({
    description:
      'Sendit account disconnected; also succeeds when it was already disconnected.',
    type: SenditConnectionStatusDto,
    example: {
      connected: false,
      provider: 'sendit.ma',
      accountName: null,
      connectedAt: null,
      message: 'Sendit account disconnected',
    },
  })
  disconnectSendit(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectSendit(user.userId);
  }

  @Get('sendit/deliveries')
  @ApiOperation({
    summary: 'List Sendit deliveries',
    operationId: 'listSenditDeliveries',
    description: `${senditAuthorizationDescription}\n\nReturns a provider-backed, paginated delivery list. Use \`querystring\` for Sendit's free-text search. The response is forwarded from Sendit and can contain additional provider fields.`,
  })
  @ApiSenditListQuery()
  @ApiOkResponse({
    description:
      'Sendit delivery collection. Provider-owned resource fields may be added over time.',
    type: SenditDeliveryListResponseDto,
  })
  @ApiSenditValidationError(
    'page must be an integer greater than or equal to 1, and querystring must be text.',
  )
  @ApiSenditProviderErrors()
  listSenditDeliveries(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditListQueryDto,
  ) {
    return this.shippingService.listSenditDeliveries(user.userId, query);
  }

  @Post('sendit/deliveries')
  @ApiOperation({
    summary: 'Create a Sendit delivery',
    operationId: 'createSenditDelivery',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Creates a cash-on-delivery shipment in Sendit. District IDs must come from the district endpoints. The resulting Sendit tracking code is returned in the provider response.`,
  })
  @ApiBody({
    type: SenditDeliveryDto,
    required: true,
    description:
      'Complete recipient, route, amount, and parcel-option details. Unknown fields are rejected.',
  })
  @ApiCreatedResponse({
    description: 'Delivery created by Sendit.',
    type: SenditDeliveryResponseDto,
  })
  @ApiSenditValidationError(
    'The delivery body is missing required fields, contains wrong data types, uses option flags outside 0/1, or includes unexpected fields.',
  )
  @ApiSenditProviderErrors()
  createSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditDeliveryDto,
  ) {
    return this.shippingService.createSenditDelivery(user.userId, payload);
  }

  @Get('sendit/deliveries/statuses')
  @ApiOperation({
    summary: 'List Sendit delivery statuses',
    operationId: 'listSenditDeliveryStatuses',
    description: `${senditAuthorizationDescription}\n\nReturns Sendit's current delivery-status catalog for displaying and interpreting shipment state.`,
  })
  @ApiOkResponse({
    description: 'Current delivery statuses defined by Sendit.',
    type: SenditDeliveryStatusListResponseDto,
  })
  @ApiSenditProviderErrors()
  listSenditDeliveryStatuses(@CurrentUser() user: JwtPayload) {
    return this.shippingService.listSenditDeliveryStatuses(user.userId);
  }

  @Post('sendit/deliveries/labels')
  @ApiOperation({
    summary: 'Generate Sendit delivery labels',
    operationId: 'generateSenditDeliveryLabels',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Generates an A4 or 10x10 cm thermal label batch for one or more comma-separated Sendit delivery codes.`,
  })
  @ApiBody({
    type: SenditLabelsDto,
    required: true,
    description: 'Delivery codes and the requested print layout.',
  })
  @ApiCreatedResponse({
    description:
      'Labels generated. Sendit controls whether label data is returned as a URL, encoded content, or metadata.',
    type: SenditLabelsResponseDto,
  })
  @ApiSenditValidationError(
    'codesToPrint must be a comma-separated string and printFormat must be numeric 0 (A4) or 1 (thermal).',
  )
  @ApiSenditProviderErrors()
  printSenditDeliveryLabels(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditLabelsDto,
  ) {
    return this.shippingService.printSenditDeliveryLabels(user.userId, payload);
  }

  @Get('sendit/deliveries/:code')
  @ApiOperation({
    summary: 'Get a Sendit delivery',
    operationId: 'getSenditDelivery',
    description: `${senditAuthorizationDescription}\n\nReturns the latest provider details for one delivery. A Sendit not-found response is normalized by this proxy as \`502 Bad Gateway\` with the provider payload attached.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit delivery/tracking code.',
    schema: { type: 'string', example: 'DH000123456MA' },
  })
  @ApiOkResponse({
    description: 'Latest delivery details returned by Sendit.',
    type: SenditDeliveryResponseDto,
  })
  @ApiSenditProviderErrors()
  getSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getSenditDelivery(user.userId, code);
  }

  @Put('sendit/deliveries/:code')
  @ApiOperation({
    summary: 'Replace a Sendit delivery',
    operationId: 'updateSenditDelivery',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Replaces the editable delivery details for the supplied Sendit code. This is a full update: send the complete delivery payload, including unchanged required fields.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit delivery/tracking code to update.',
    schema: { type: 'string', example: 'DH000123456MA' },
  })
  @ApiBody({
    type: SenditDeliveryDto,
    required: true,
    description: 'Complete replacement delivery details.',
  })
  @ApiOkResponse({
    description: 'Delivery updated by Sendit.',
    type: SenditDeliveryResponseDto,
  })
  @ApiSenditValidationError(
    'The replacement body is incomplete, contains wrong data types, uses option flags outside 0/1, or includes unexpected fields.',
  )
  @ApiSenditProviderErrors()
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
  @ApiOperation({
    summary: 'Delete a Sendit delivery',
    operationId: 'deleteSenditDelivery',
    description: `${senditAuthorizationDescription}\n\nRequests deletion of the supplied delivery in Sendit. Whether a delivery can be deleted depends on its provider status.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit delivery/tracking code to delete.',
    schema: { type: 'string', example: 'DH000123456MA' },
  })
  @ApiOkResponse({
    description: 'Provider confirmation that the delivery was deleted.',
    type: SenditActionResponseDto,
  })
  @ApiSenditProviderErrors()
  deleteSenditDelivery(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.deleteSenditDelivery(user.userId, code);
  }

  @Get('sendit/districts')
  @ApiOperation({
    summary: 'List Sendit districts and cities',
    operationId: 'listSenditDistricts',
    description: `${senditAuthorizationDescription}\n\nReturns Sendit destination districts used by delivery and return requests. Search by city/district name or set \`pickup-district=1\` to restrict the list to pickup-enabled locations.`,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'One-based result page. Defaults to the provider default.',
    schema: { type: 'integer', minimum: 1, example: 1 },
  })
  @ApiQuery({
    name: 'querystring',
    required: false,
    description: 'District or city search text.',
    schema: { type: 'string', example: 'Casablanca' },
  })
  @ApiQuery({
    name: 'pickup-district',
    required: false,
    description: 'Set to 1 to filter for Sendit pickup-enabled districts.',
    schema: { type: 'integer', example: 1 },
  })
  @ApiOkResponse({
    description: 'Sendit district collection.',
    type: SenditDistrictListResponseDto,
  })
  @ApiSenditValidationError(
    'page and pickup-district must be integers (page must be at least 1), and querystring must be text.',
  )
  @ApiSenditProviderErrors()
  listSenditDistricts(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditDistrictQueryDto,
  ) {
    return this.shippingService.listSenditDistricts(user.userId, query);
  }

  @Get('sendit/districts/pickup-cities')
  @ApiOperation({
    summary: 'List Sendit pickup cities',
    operationId: 'listSenditPickupCities',
    description: `${senditAuthorizationDescription}\n\nReturns only locations that can be used as \`pickup_district_id\` when creating a delivery or pickup request.`,
  })
  @ApiOkResponse({
    description: 'Sendit pickup-enabled district collection.',
    type: SenditDistrictListResponseDto,
  })
  @ApiSenditProviderErrors()
  listSenditPickupCities(@CurrentUser() user: JwtPayload) {
    return this.shippingService.listSenditPickupCities(user.userId);
  }

  @Get('sendit/districts/:id')
  @ApiOperation({
    summary: 'Get a Sendit district',
    operationId: 'getSenditDistrict',
    description: `${senditAuthorizationDescription}\n\nReturns one Sendit district by numeric provider ID. A provider not-found response is normalized as \`502 Bad Gateway\`.`,
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'Numeric Sendit district identifier.',
    schema: { type: 'integer', example: 58 },
  })
  @ApiOkResponse({
    description: 'Sendit district details.',
    type: SenditDistrictResponseDto,
  })
  @ApiSenditValidationError('id must be a valid integer.')
  @ApiSenditProviderErrors()
  getSenditDistrict(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shippingService.getSenditDistrict(user.userId, id);
  }

  @Get('sendit/pickups')
  @ApiOperation({
    summary: 'List Sendit pickup requests',
    operationId: 'listSenditPickups',
    description: `${senditAuthorizationDescription}\n\nReturns the authenticated merchant's provider-backed pickup requests with optional pagination and free-text search.`,
  })
  @ApiSenditListQuery()
  @ApiOkResponse({
    description: 'Sendit pickup-request collection.',
    type: SenditPickupListResponseDto,
  })
  @ApiSenditValidationError(
    'page must be an integer greater than or equal to 1, and querystring must be text.',
  )
  @ApiSenditProviderErrors()
  listSenditPickups(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditListQueryDto,
  ) {
    return this.shippingService.listSenditPickups(user.userId, query);
  }

  @Post('sendit/pickups')
  @ApiOperation({
    summary: 'Create a Sendit pickup request',
    operationId: 'createSenditPickup',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Requests collection from a pickup-enabled district and can attach delivery or movement codes.`,
  })
  @ApiBody({
    type: SenditPickupDto,
    required: true,
    description:
      'Pickup contact, location, instructions, and optional parcel codes.',
  })
  @ApiCreatedResponse({
    description: 'Pickup request created by Sendit.',
    type: SenditPickupResponseDto,
  })
  @ApiSenditValidationError(
    'The pickup body is missing required fields, contains wrong data types, or includes unexpected fields.',
  )
  @ApiSenditProviderErrors()
  createSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditPickupDto,
  ) {
    return this.shippingService.createSenditPickup(user.userId, payload);
  }

  @Get('sendit/pickups/:code')
  @ApiOperation({
    summary: 'Get a Sendit pickup request',
    operationId: 'getSenditPickup',
    description: `${senditAuthorizationDescription}\n\nReturns the latest Sendit details for one pickup request.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit pickup request code.',
    schema: { type: 'string', example: 'PU000123456MA' },
  })
  @ApiOkResponse({
    description: 'Latest pickup details returned by Sendit.',
    type: SenditPickupResponseDto,
  })
  @ApiSenditProviderErrors()
  getSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getSenditPickup(user.userId, code);
  }

  @Put('sendit/pickups/:code')
  @ApiOperation({
    summary: 'Update a Sendit pickup request',
    operationId: 'updateSenditPickup',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Updates only the supplied editable pickup fields; omitted fields are left to Sendit's update semantics.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit pickup request code to update.',
    schema: { type: 'string', example: 'PU000123456MA' },
  })
  @ApiBody({
    type: SenditUpdatePickupDto,
    required: true,
    description: 'Pickup fields to update. Every field is optional.',
  })
  @ApiOkResponse({
    description: 'Pickup request updated by Sendit.',
    type: SenditPickupResponseDto,
  })
  @ApiSenditValidationError(
    'An update field has the wrong data type or the body contains unexpected fields.',
  )
  @ApiSenditProviderErrors()
  updateSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() payload: SenditUpdatePickupDto,
  ) {
    return this.shippingService.updateSenditPickup(user.userId, code, payload);
  }

  @Delete('sendit/pickups/:code')
  @ApiOperation({
    summary: 'Delete a Sendit pickup request',
    operationId: 'deleteSenditPickup',
    description: `${senditAuthorizationDescription}\n\nRequests deletion of the supplied pickup in Sendit. Whether it can be deleted depends on its provider status.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit pickup request code to delete.',
    schema: { type: 'string', example: 'PU000123456MA' },
  })
  @ApiOkResponse({
    description: 'Provider confirmation that the pickup was deleted.',
    type: SenditActionResponseDto,
  })
  @ApiSenditProviderErrors()
  deleteSenditPickup(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.deleteSenditPickup(user.userId, code);
  }

  @Get('sendit/returns')
  @ApiOperation({
    summary: 'List Sendit return requests',
    operationId: 'listSenditReturns',
    description: `${senditAuthorizationDescription}\n\nReturns the authenticated merchant's provider-backed return requests with optional pagination and free-text search.`,
  })
  @ApiSenditListQuery()
  @ApiOkResponse({
    description: 'Sendit return-request collection.',
    type: SenditReturnListResponseDto,
  })
  @ApiSenditValidationError(
    'page must be an integer greater than or equal to 1, and querystring must be text.',
  )
  @ApiSenditProviderErrors()
  listSenditReturns(
    @CurrentUser() user: JwtPayload,
    @Query() query: SenditListQueryDto,
  ) {
    return this.shippingService.listSenditReturns(user.userId, query);
  }

  @Post('sendit/returns')
  @ApiOperation({
    summary: 'Create a Sendit return request',
    operationId: 'createSenditReturn',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Requests return of one or more existing deliveries to a Sendit warehouse or merchant address.`,
  })
  @ApiBody({
    type: SenditReturnDto,
    required: true,
    description:
      'Return destination, contact details, instructions, and delivery codes.',
  })
  @ApiCreatedResponse({
    description: 'Return request created by Sendit.',
    type: SenditReturnResponseDto,
  })
  @ApiSenditValidationError(
    'The return body is missing required fields, contains wrong data types, uses an unsupported type, or includes unexpected fields.',
  )
  @ApiSenditProviderErrors()
  createSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Body() payload: SenditReturnDto,
  ) {
    return this.shippingService.createSenditReturn(user.userId, payload);
  }

  @Get('sendit/returns/:code')
  @ApiOperation({
    summary: 'Get a Sendit return request',
    operationId: 'getSenditReturn',
    description: `${senditAuthorizationDescription}\n\nReturns the latest Sendit details for one return request.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit return request code.',
    schema: { type: 'string', example: 'RT000123456MA' },
  })
  @ApiOkResponse({
    description: 'Latest return-request details returned by Sendit.',
    type: SenditReturnResponseDto,
  })
  @ApiSenditProviderErrors()
  getSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
  ) {
    return this.shippingService.getSenditReturn(user.userId, code);
  }

  @Put('sendit/returns/:code')
  @ApiOperation({
    summary: 'Update a Sendit return request',
    operationId: 'updateSenditReturn',
    description: `${senditAuthorizationDescription}\n\n**Content-Type header:** \`application/json\`. Updates only the supplied editable return fields; omitted fields are left to Sendit's update semantics.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit return request code to update.',
    schema: { type: 'string', example: 'RT000123456MA' },
  })
  @ApiBody({
    type: SenditUpdateReturnDto,
    required: true,
    description: 'Return fields to update. Every field is optional.',
  })
  @ApiOkResponse({
    description: 'Return request updated by Sendit.',
    type: SenditReturnResponseDto,
  })
  @ApiSenditValidationError(
    'An update field has the wrong data type, type is unsupported, or the body contains unexpected fields.',
  )
  @ApiSenditProviderErrors()
  updateSenditReturn(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() payload: SenditUpdateReturnDto,
  ) {
    return this.shippingService.updateSenditReturn(user.userId, code, payload);
  }

  @Delete('sendit/returns/:code')
  @ApiOperation({
    summary: 'Delete a Sendit return request',
    operationId: 'deleteSenditReturn',
    description: `${senditAuthorizationDescription}\n\nRequests deletion of the supplied return in Sendit. Whether it can be deleted depends on its provider status.`,
  })
  @ApiParam({
    name: 'code',
    required: true,
    description: 'Sendit return request code to delete.',
    schema: { type: 'string', example: 'RT000123456MA' },
  })
  @ApiOkResponse({
    description: 'Provider confirmation that the return was deleted.',
    type: SenditActionResponseDto,
  })
  @ApiSenditProviderErrors()
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
