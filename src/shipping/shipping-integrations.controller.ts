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
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  ConnectShippingIntegrationDto,
  ShippingIntegrationConnectionResponseDto,
  ShippingIntegrationsResponseDto,
} from './dto/shipping-integration.dto';
import { ShippingIntegrationsService } from './shipping-integrations.service';

const companyCodes = [
  'sendit',
  'quicklivraison',
  'forcelog',
  'ozoneexpress',
] as const;

@ApiTags('Shipping Integrations')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('shipping/integrations')
@ApiUnauthorizedResponse({
  description: 'Missing, invalid, expired, or non-access Zomaal bearer token.',
  type: ApiErrorDto,
})
export class ShippingIntegrationsController {
  constructor(
    private readonly shippingIntegrations: ShippingIntegrationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Load the complete shipping integration catalog',
    description:
      'Frontend bootstrap endpoint. Returns countries, available companies, the current user’s connection state, instructions, and the exact fields needed to build each credentials form. No credential values are ever returned. The frontend can navigate and search the returned catalog locally without additional API calls.',
  })
  @ApiOkResponse({
    description: 'Complete frontend shipping catalog.',
    type: ShippingIntegrationsResponseDto,
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.shippingIntegrations.list(user.userId);
  }

  @Post(':companyCode/connection')
  @ApiOperation({
    summary: 'Connect or replace a shipping company account',
    description:
      'Submit only the credential fields declared in authFields for the selected company. Values marked inputType=secure_text must be masked by the frontend and excluded from logs and analytics. Credentials are validated by the provider before encrypted storage.',
  })
  @ApiParam({
    name: 'companyCode',
    enum: companyCodes,
    example: 'forcelog',
  })
  @ApiBody({
    description:
      'Provider-specific credentials. The companyCode path dropdown and request example dropdown are independent in Swagger UI; select the matching named request example below.',
    schema: {
      oneOf: [
        {
          title: 'Sendit credentials',
          type: 'object',
          required: ['credentials'],
          additionalProperties: false,
          properties: {
            credentials: {
              type: 'object',
              required: ['public_key', 'secret_key'],
              additionalProperties: false,
              properties: {
                public_key: {
                  type: 'string',
                  example: 'sendit-public-key',
                },
                secret_key: {
                  type: 'string',
                  writeOnly: true,
                  example: 'sendit-secret-key',
                },
              },
            },
          },
        },
        {
          title: 'QuickLivraison credentials',
          type: 'object',
          required: ['credentials'],
          additionalProperties: false,
          properties: {
            credentials: {
              type: 'object',
              required: ['apiKey'],
              additionalProperties: false,
              properties: {
                apiKey: {
                  type: 'string',
                  writeOnly: true,
                  example: 'sub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                },
              },
            },
          },
        },
        {
          title: 'ForceLog credentials',
          type: 'object',
          required: ['credentials'],
          additionalProperties: false,
          properties: {
            credentials: {
              type: 'object',
              required: ['apiKey'],
              additionalProperties: false,
              properties: {
                apiKey: {
                  type: 'string',
                  writeOnly: true,
                  example: 'your-forcelog-api-key',
                },
              },
            },
          },
        },
        {
          title: 'OzoneExpress credentials',
          type: 'object',
          required: ['credentials'],
          additionalProperties: false,
          properties: {
            credentials: {
              type: 'object',
              required: ['customerId', 'apiKey'],
              additionalProperties: false,
              properties: {
                customerId: { type: 'string', example: '12345' },
                apiKey: {
                  type: 'string',
                  writeOnly: true,
                  example: 'your-ozoneexpress-api-key',
                },
              },
            },
          },
        },
      ],
    },
    examples: {
      sendit: {
        summary: 'Sendit credentials',
        value: {
          credentials: {
            public_key: 'sendit-public-key',
            secret_key: 'sendit-secret-key',
          },
        },
      },
      quicklivraison: {
        summary: 'QuickLivraison credentials',
        value: {
          credentials: {
            apiKey: 'sub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          },
        },
      },
      forcelog: {
        summary: 'ForceLog credentials',
        value: {
          credentials: {
            apiKey: 'your-forcelog-api-key',
          },
        },
      },
      ozoneexpress: {
        summary: 'OzoneExpress credentials',
        value: {
          credentials: {
            customerId: '12345',
            apiKey: 'your-ozoneexpress-api-key',
          },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Provider credentials verified and connection saved.',
    type: ShippingIntegrationConnectionResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Missing, empty, unexpected, or provider-inappropriate credential field.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Unknown or unsupported shipping company code.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'The provider returned an invalid or failed response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The provider is unreachable or encryption is unavailable.',
    type: ApiErrorDto,
  })
  connect(
    @CurrentUser() user: JwtPayload,
    @Param('companyCode') companyCode: string,
    @Body() payload: ConnectShippingIntegrationDto,
  ) {
    return this.shippingIntegrations.connect(
      user.userId,
      companyCode,
      payload.credentials,
    );
  }

  @Delete(':companyCode/connection')
  @ApiOperation({
    summary: 'Disconnect a shipping company account',
    description:
      'Deletes the authenticated user’s encrypted credentials for the selected company. This operation is idempotent.',
  })
  @ApiParam({
    name: 'companyCode',
    enum: companyCodes,
    example: 'forcelog',
  })
  @ApiOkResponse({
    description: 'Shipping company account disconnected.',
    type: ShippingIntegrationConnectionResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Unknown or unsupported shipping company code.',
    type: ApiErrorDto,
  })
  disconnect(
    @CurrentUser() user: JwtPayload,
    @Param('companyCode') companyCode: string,
  ) {
    return this.shippingIntegrations.disconnect(user.userId, companyCode);
  }
}
