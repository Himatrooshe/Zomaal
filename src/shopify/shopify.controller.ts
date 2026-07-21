import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  ShopifyAuthorizationResponseDto,
  ShopifyConnectionStatusDto,
  ShopifyDisconnectResponseDto,
  ShopifyShopVerificationDto,
} from './dto/shopify-response.dto';
import { StartShopifyAuthDto } from './dto/start-shopify-auth.dto';
import { ShopifyAuthService } from './shopify-auth.service';
import { ShopifyConnectionService } from './shopify-connection.service';

@ApiTags('Shopify')
@ApiProduces('application/json')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shopify')
export class ShopifyController {
  constructor(
    private readonly authService: ShopifyAuthService,
    private readonly connectionService: ShopifyConnectionService,
  ) {}

  @Post('auth/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting a Shopify store',
    description:
      'Requires a Zomaal access token and an existing Zomaal store. Returns a short-lived Shopify authorization URL. The frontend must navigate the browser to that URL; it must not call the URL server-to-server.',
  })
  @ApiBody({
    type: StartShopifyAuthDto,
    examples: {
      permanentDomain: {
        summary: 'Permanent Shopify domain',
        value: { shopDomain: 'atlas-market.myshopify.com' },
      },
      handle: {
        summary: 'Shop handle',
        value: { shopDomain: 'atlas-market' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Single-use authorization URL created.',
    type: ShopifyAuthorizationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The current user has not created a Zomaal store.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'The Shopify shop is already connected to a different Zomaal store.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Shopify integration or token encryption is not configured.',
    type: ApiErrorDto,
  })
  begin(@CurrentUser() user: JwtPayload, @Body() payload: StartShopifyAuthDto) {
    return this.authService.begin(user.userId, payload.shopDomain);
  }

  @Get('connection')
  @ApiOperation({
    summary: 'Get the current store’s Shopify connection status',
  })
  @ApiOkResponse({
    description:
      'Connection state. A missing connection is returned as `not_connected`, not as 404.',
    type: ShopifyConnectionStatusDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The current user has not created a Zomaal store.',
    type: ApiErrorDto,
  })
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.connectionService.getStatus(user.userId);
  }

  @Post('connection/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the connection against Shopify',
    description:
      'Refreshes the offline access token when necessary, calls the GraphQL Admin API, and returns non-secret shop identity fields.',
  })
  @ApiOkResponse({
    description: 'Shopify accepted the stored credentials.',
    type: ShopifyShopVerificationDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid Zomaal token or Shopify must be reauthorized after its refresh token expired/revoked.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Shopify is not connected for the current store.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'Shopify returned an invalid response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Shopify is temporarily unavailable.',
    type: ApiErrorDto,
  })
  verify(@CurrentUser() user: JwtPayload) {
    return this.connectionService.verify(user.userId);
  }

  @Delete('connection')
  @ApiOperation({
    summary: 'Remove Shopify credentials from Zomaal',
    description:
      'Deletes the locally stored access and refresh tokens. The merchant must also uninstall the app in Shopify Admin to revoke the Shopify installation.',
  })
  @ApiOkResponse({
    description: 'Local Shopify credentials removed.',
    type: ShopifyDisconnectResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Zomaal store or Shopify connection not found.',
    type: ApiErrorDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.connectionService.disconnect(user.userId);
  }
}

@ApiTags('Shopify OAuth')
@ApiProduces('application/json')
@Controller('auth/shopify')
export class ShopifyOAuthController {
  constructor(private readonly authService: ShopifyAuthService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete Shopify authorization',
    description:
      'Public browser callback invoked by Shopify. It validates the timestamp, HMAC, permanent shop domain, and single-use OAuth state before exchanging the code for encrypted expiring offline tokens. Do not add a Zomaal bearer token.',
  })
  @ApiQuery({ name: 'code', required: true, type: String })
  @ApiQuery({ name: 'hmac', required: true, type: String })
  @ApiQuery({ name: 'host', required: false, type: String })
  @ApiQuery({ name: 'shop', required: true, type: String })
  @ApiQuery({ name: 'state', required: true, type: String })
  @ApiQuery({ name: 'timestamp', required: true, type: String })
  @ApiOkResponse({
    description:
      'Connection status when no frontend success redirect is configured.',
    type: ShopifyConnectionStatusDto,
  })
  @ApiFoundResponse({
    description:
      'Redirects to SHOPIFY_AUTH_SUCCESS_REDIRECT_URL with `shopify=connected`.',
    headers: {
      Location: {
        description: 'Configured frontend integration settings page.',
        schema: {
          type: 'string',
          example:
            'http://localhost:5173/settings/integrations/shopify?shopify=connected',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Required callback parameter is missing or malformed.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid HMAC, stale timestamp, invalid/reused state, invalid shop, or rejected authorization code.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'The Shopify store is already connected to another Zomaal store.',
    type: ApiErrorDto,
  })
  async callback(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.authService.complete(query);
      const redirectUrl = this.authService.getSuccessRedirectUrl();
      if (redirectUrl) {
        response.redirect(HttpStatus.FOUND, redirectUrl);
        return;
      }
      return result;
    } catch (error) {
      const redirectUrl = this.authService.getFailureRedirectUrl();
      if (redirectUrl) {
        response.redirect(HttpStatus.FOUND, redirectUrl);
        return;
      }
      throw error;
    }
  }
}
