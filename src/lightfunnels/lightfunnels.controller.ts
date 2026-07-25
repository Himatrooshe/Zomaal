import {
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
  ApiConflictResponse,
  ApiFoundResponse,
  ApiForbiddenResponse,
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
  LightfunnelsAuthorizationResponseDto,
  LightfunnelsConnectionStatusDto,
  LightfunnelsVerificationDto,
} from './dto/lightfunnels-response.dto';
import { LightfunnelsAuthService } from './lightfunnels-auth.service';
import { LightfunnelsConnectionService } from './lightfunnels-connection.service';

@ApiTags('Lightfunnels')
@ApiProduces('application/json')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lightfunnels')
export class LightfunnelsController {
  constructor(
    private readonly authService: LightfunnelsAuthService,
    private readonly connectionService: LightfunnelsConnectionService,
  ) {}

  @Post('auth/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting a Lightfunnels account',
    description:
      'Returns a short-lived consent URL. Open it in the merchant browser.',
  })
  @ApiOkResponse({
    description: 'Single-use Lightfunnels authorization URL created.',
    type: LightfunnelsAuthorizationResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The current user has not created a Zomaal store.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Lightfunnels OAuth or token encryption is not configured.',
    type: ApiErrorDto,
  })
  begin(@CurrentUser() user: JwtPayload) {
    return this.authService.begin(user.userId);
  }

  @Get('connection')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get the current store’s Lightfunnels connection status',
  })
  @ApiOkResponse({
    description:
      'Connection state. A missing connection is represented as not_connected.',
    type: LightfunnelsConnectionStatusDto,
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
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Verify stored credentials with Lightfunnels',
    description:
      'Calls the Lightfunnels GraphQL account/stores query. Secret token fields are never returned.',
  })
  @ApiOkResponse({
    description: 'Lightfunnels accepted the stored credentials.',
    type: LightfunnelsVerificationDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid Zomaal token or Lightfunnels must be reauthorized.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The token is missing the funnels scope.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Lightfunnels is not connected for the current store.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'Lightfunnels returned an invalid GraphQL response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Lightfunnels is temporarily unavailable.',
    type: ApiErrorDto,
  })
  verify(@CurrentUser() user: JwtPayload) {
    return this.connectionService.verify(user.userId);
  }

  @Delete('connection')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Remove locally stored Lightfunnels credentials',
  })
  @ApiOkResponse({
    description: 'Local Lightfunnels credentials removed.',
    type: LightfunnelsConnectionStatusDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Zomaal store or Lightfunnels connection not found.',
    type: ApiErrorDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.connectionService.disconnect(user.userId);
  }
}

@ApiTags('Lightfunnels OAuth')
@ApiProduces('application/json')
@Controller('auth/lightfunnels')
export class LightfunnelsOAuthController {
  constructor(private readonly authService: LightfunnelsAuthService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete Lightfunnels OAuth authorization',
    description:
      'Public callback invoked by Lightfunnels. It consumes the single-use state, exchanges the code, verifies the account through GraphQL, and encrypts the permanent access token. Do not add a Zomaal bearer token.',
  })
  @ApiQuery({ name: 'code', required: false, type: String })
  @ApiQuery({ name: 'state', required: true, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiOkResponse({
    description:
      'Connection status when no frontend success redirect is configured.',
    type: LightfunnelsConnectionStatusDto,
  })
  @ApiFoundResponse({
    description:
      'Redirects to LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL with lightfunnels=connected.',
  })
  @ApiBadRequestResponse({
    description: 'A required callback parameter is missing or malformed.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Authorization was rejected or OAuth state/code is invalid, expired, or reused.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'The Lightfunnels account is already connected to another Zomaal store.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The token is missing a required Lightfunnels account scope.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'Lightfunnels returned an invalid response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Lightfunnels is temporarily unavailable.',
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
