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
  ConnectOzoneExpressDto,
  OzoneExpressConnectionErrorDto,
  OzoneExpressConnectionStatusDto,
} from './dto/ozoneexpress-connection.dto';
import {
  OzoneExpressDeliveryNoteParcelsDto,
  OzoneExpressDeliveryNotePdfLinksDto,
  OzoneExpressDeliveryNoteRefDto,
  OzoneExpressParcelDto,
  OzoneExpressTrackingDto,
} from './dto/ozoneexpress-parcel.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping - OzoneExpress')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('shipping/ozoneexpress')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal bearer token.',
  type: ApiErrorDto,
})
export class OzoneExpressController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({
    summary: 'Check OzoneExpress account connection',
    operationId: 'getOzoneExpressConnectionStatus',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns whether the authenticated Zomaal user has stored OzoneExpress credentials. This status check does not call OzoneExpress and never returns the customer ID or API key.',
  })
  @ApiOkResponse({
    description: 'Current user OzoneExpress connection status.',
    type: OzoneExpressConnectionStatusDto,
  })
  checkConnection(@CurrentUser() user: JwtPayload) {
    return this.shippingService.checkOzoneExpressConnection(user.userId);
  }

  @Post('connection')
  @ApiOperation({
    summary: "Connect or replace the current user's OzoneExpress account",
    operationId: 'connectOzoneExpressAccount',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. Validates the customer ID and API key using the read-only parcel-info endpoint, then encrypts and stores both values. Reconnecting replaces the previous credentials. Credentials are never returned.',
  })
  @ApiBody({
    type: ConnectOzoneExpressDto,
    description:
      'OzoneExpress customer identifier and API key to validate and store for the authenticated user.',
    examples: {
      accountCredentials: {
        summary: 'OzoneExpress account credentials',
        value: {
          customerId: '12345',
          apiKey: 'your-ozoneexpress-api-key',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Credentials verified and OzoneExpress account connected.',
    type: OzoneExpressConnectionStatusDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing, empty, or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid Zomaal token or rejected OzoneExpress credentials.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'OzoneExpress returned an invalid or failed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or credential encryption is unavailable.',
    type: ApiErrorDto,
  })
  connect(
    @CurrentUser() user: JwtPayload,
    @Body() payload: ConnectOzoneExpressDto,
  ) {
    return this.shippingService.connectOzoneExpress(user.userId, payload);
  }

  @Delete('connection')
  @ApiOperation({
    summary: "Disconnect the current user's OzoneExpress account",
    operationId: 'disconnectOzoneExpressAccount',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Deletes the encrypted customer ID and API key stored for the authenticated user. This operation is idempotent: disconnecting an already disconnected account still succeeds.',
  })
  @ApiOkResponse({
    description: 'OzoneExpress account disconnected.',
    type: OzoneExpressConnectionStatusDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.shippingService.disconnectOzoneExpress(user.userId);
  }

  @Post('parcels')
  @ApiOperation({
    summary: 'Add an OzoneExpress parcel',
    operationId: 'createOzoneExpressParcel',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. The authenticated user must connect OzoneExpress first. Zomaal maps this JSON payload to the provider field names and injects the stored credentials server-side.',
  })
  @ApiBody({
    type: OzoneExpressParcelDto,
    description:
      'Recipient, cash-on-delivery, handling, and fulfillment details.',
    examples: {
      pickupParcel: {
        summary: 'Pickup/non-stock cash-on-delivery parcel',
        value: {
          trackingNumber: 'ZOM-ORDER-1001',
          receiver: 'Sara El Amrani',
          phone: '0612345678',
          city: '1',
          address: '123 Rue Al Massira, Maarif, Casablanca',
          price: 250,
          stock: 0,
          note: 'Call the recipient before delivery',
          nature: 'One pair of running shoes',
          open: 2,
          fragile: 0,
          replace: 0,
        },
      },
      stockParcel: {
        summary: 'OzoneExpress stock-fulfilled parcel',
        value: {
          receiver: 'Sara El Amrani',
          phone: '0612345678',
          city: '1',
          address: '123 Rue Al Massira, Maarif, Casablanca',
          price: 250,
          stock: 1,
          open: 2,
          fragile: 0,
          replace: 0,
          products: [{ ref: 'SKU-SHOE-BLK-42', qnty: 2 }],
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Parcel accepted. Zomaal returns the OzoneExpress JSON response unchanged, so the provider may add fields to this envelope.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        CHECK_API: {
          RESULT: 'SUCCESS',
          MESSAGE: 'Valide API Key',
        },
        'ADD-PARCEL': {
          RESULT: 'SUCCESS',
          MESSAGE: 'Parcel added successfully',
          'TRACKING-NUMBER': 'OZ123456789MA',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'A required parcel field is missing/invalid or an unexpected field was sent.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The current user has not connected an OzoneExpress account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'OzoneExpress rejected the request or returned a malformed/failed response. When available, the provider body is included in `ozoneexpress`.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or the stored credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  addParcel(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressParcelDto,
  ) {
    return this.shippingService.addOzoneExpressParcel(user.userId, payload);
  }

  @Get('parcels/:trackingNumber')
  @ApiOperation({
    summary: 'Get OzoneExpress parcel information',
    operationId: 'getOzoneExpressParcel',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Retrieves the current provider record for one parcel from the connected OzoneExpress account.',
  })
  @ApiParam({
    name: 'trackingNumber',
    description:
      'OzoneExpress tracking number returned when the parcel was created.',
    example: 'OZ123456789MA',
    type: String,
  })
  @ApiOkResponse({
    description:
      'Parcel information returned unchanged by OzoneExpress. Provider-controlled fields may be added.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        CHECK_API: {
          RESULT: 'SUCCESS',
          MESSAGE: 'Valide API Key',
        },
        'PARCEL-INFO': {
          'TRACKING-NUMBER': 'OZ123456789MA',
          RECEIVER: 'Sara El Amrani',
          PHONE: '0612345678',
          CITY: 'Casablanca',
          ADDRESS: '123 Rue Al Massira, Maarif, Casablanca',
          PRICE: 250,
          STATUS: 'IN_PROGRESS',
        },
      },
    },
  })
  @ApiConflictResponse({
    description: 'The current user has not connected an OzoneExpress account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'OzoneExpress rejected the tracking number or returned a malformed/failed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or the stored credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  getParcelInfo(
    @CurrentUser() user: JwtPayload,
    @Param('trackingNumber') trackingNumber: string,
  ) {
    return this.shippingService.getOzoneExpressParcelInfo(
      user.userId,
      trackingNumber,
    );
  }

  @Post('tracking')
  @ApiOperation({
    summary: 'Track one or more OzoneExpress parcels',
    operationId: 'trackOzoneExpressParcels',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. Accepts either one provider tracking number or an array. The authenticated user must connect OzoneExpress first.',
  })
  @ApiBody({
    type: OzoneExpressTrackingDto,
    description: 'Single-parcel or multi-parcel tracking request.',
    examples: {
      oneParcel: {
        summary: 'Track one parcel',
        value: { trackingNumber: 'OZ123456789MA' },
      },
      multipleParcels: {
        summary: 'Track multiple parcels',
        value: {
          trackingNumber: ['OZ123456789MA', 'OZ987654321MA'],
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Tracking data returned unchanged by OzoneExpress. A multi-tracking request can return multiple provider records.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        CHECK_API: {
          RESULT: 'SUCCESS',
          MESSAGE: 'Valide API Key',
        },
        TRACKING: [
          {
            'TRACKING-NUMBER': 'OZ123456789MA',
            STATUS: 'IN_PROGRESS',
            MESSAGE: 'Parcel is in transit',
            UPDATED_AT: '2026-07-17T12:15:00.000Z',
          },
        ],
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'trackingNumber is missing, has an unsupported shape, or an unexpected field was sent.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The current user has not connected an OzoneExpress account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'OzoneExpress returned a malformed or failed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or the stored credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  track(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressTrackingDto,
  ) {
    return this.shippingService.trackOzoneExpress(
      user.userId,
      payload.trackingNumber,
    );
  }

  @Post('delivery-notes')
  @ApiOperation({
    summary: 'Create an OzoneExpress delivery note',
    operationId: 'createOzoneExpressDeliveryNote',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Opens a new delivery note for the connected OzoneExpress account. The response reference is required by the add-parcels, save, and PDF-link endpoints.',
  })
  @ApiCreatedResponse({
    description:
      'Delivery note opened. Zomaal returns the provider response unchanged.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        CHECK_API: {
          RESULT: 'SUCCESS',
          MESSAGE: 'Valide API Key',
        },
        'ADD-DELIVERY-NOTE': {
          RESULT: 'SUCCESS',
          MESSAGE: 'Delivery note created',
          REF: 'DN-2026-000123',
        },
      },
    },
  })
  @ApiConflictResponse({
    description: 'The current user has not connected an OzoneExpress account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'OzoneExpress returned a malformed or failed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or the stored credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  createDeliveryNote(@CurrentUser() user: JwtPayload) {
    return this.shippingService.createOzoneExpressDeliveryNote(user.userId);
  }

  @Post('delivery-notes/parcels')
  @ApiOperation({
    summary: 'Add parcels to an OzoneExpress delivery note',
    operationId: 'addOzoneExpressParcelsToDeliveryNote',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. Attaches existing OzoneExpress parcel tracking codes to an open delivery note.',
  })
  @ApiBody({
    type: OzoneExpressDeliveryNoteParcelsDto,
    description: 'Open delivery-note reference and the parcel codes to attach.',
    examples: {
      addTwoParcels: {
        summary: 'Attach two parcels',
        value: {
          ref: 'DN-2026-000123',
          codes: ['OZ123456789MA', 'OZ987654321MA'],
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Parcels attached. Zomaal returns the provider response unchanged.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        CHECK_API: {
          RESULT: 'SUCCESS',
          MESSAGE: 'Valide API Key',
        },
        'ADD-PARCEL-TO-DELIVERY-NOTE': {
          RESULT: 'SUCCESS',
          MESSAGE: 'Parcels added to delivery note',
          REF: 'DN-2026-000123',
          CODES: ['OZ123456789MA', 'OZ987654321MA'],
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The delivery-note reference/codes are invalid or an unexpected field was sent.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The current user has not connected an OzoneExpress account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'OzoneExpress rejected the reference/codes or returned a malformed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or the stored credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  addParcelsToDeliveryNote(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressDeliveryNoteParcelsDto,
  ) {
    return this.shippingService.addOzoneExpressParcelsToDeliveryNote(
      user.userId,
      payload,
    );
  }

  @Post('delivery-notes/save')
  @ApiOperation({
    summary: 'Save an OzoneExpress delivery note',
    operationId: 'saveOzoneExpressDeliveryNote',
    description:
      'Requires `Authorization: Bearer <accessToken>` and `Content-Type: application/json`. Finalizes/saves an open delivery note after its parcels have been attached.',
  })
  @ApiBody({
    type: OzoneExpressDeliveryNoteRefDto,
    description: 'Open delivery-note reference to save.',
    examples: {
      saveNote: {
        summary: 'Save a delivery note',
        value: { ref: 'DN-2026-000123' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Delivery note saved. Zomaal returns the provider response unchanged.',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        CHECK_API: {
          RESULT: 'SUCCESS',
          MESSAGE: 'Valide API Key',
        },
        'SAVE-DELIVERY-NOTE': {
          RESULT: 'SUCCESS',
          MESSAGE: 'Delivery note saved',
          REF: 'DN-2026-000123',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The delivery-note reference is missing/invalid or an unexpected field was sent.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The current user has not connected an OzoneExpress account.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'OzoneExpress rejected the reference or returned a malformed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OzoneExpress is unreachable or the stored credentials cannot be decrypted.',
    type: ApiErrorDto,
  })
  saveDeliveryNote(
    @CurrentUser() user: JwtPayload,
    @Body() payload: OzoneExpressDeliveryNoteRefDto,
  ) {
    return this.shippingService.saveOzoneExpressDeliveryNote(
      user.userId,
      payload.ref,
    );
  }

  @Get('delivery-notes/:ref/pdf-links')
  @ApiOperation({
    summary: 'Get OzoneExpress delivery note PDF links',
    operationId: 'getOzoneExpressDeliveryNotePdfLinks',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Builds the standard delivery-note and label PDF URLs for a saved OzoneExpress delivery note. The response contains links; it does not stream a PDF.',
  })
  @ApiParam({
    name: 'ref',
    description:
      'Saved OzoneExpress delivery-note reference. Reserved URL characters must be percent-encoded.',
    example: 'DN-2026-000123',
    type: String,
  })
  @ApiOkResponse({
    description: 'Standard, A4-label, and 10 x 10 cm label PDF URLs.',
    type: OzoneExpressDeliveryNotePdfLinksDto,
  })
  getDeliveryNotePdfLinks(@Param('ref') ref: string) {
    return this.shippingService.getOzoneExpressDeliveryNotePdfLinks(ref);
  }

  @Get('cities')
  @ApiOperation({
    summary: 'List OzoneExpress cities',
    operationId: 'listOzoneExpressCities',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns provider city identifiers. Use one of these values as `city` when creating a parcel. No connected OzoneExpress account is required.',
  })
  @ApiOkResponse({
    description:
      'OzoneExpress city data returned unchanged. The provider may return an array or an object envelope and may add fields.',
    schema: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        { type: 'object', additionalProperties: true },
      ],
      example: [
        { ID: '1', NAME: 'Casablanca' },
        { ID: '2', NAME: 'Rabat' },
      ],
    },
  })
  @ApiBadGatewayResponse({
    description: 'OzoneExpress returned a malformed or failed response.',
    type: OzoneExpressConnectionErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'OzoneExpress is currently unreachable.',
    type: ApiErrorDto,
  })
  getCities() {
    return this.shippingService.getOzoneExpressCities();
  }
}
