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
  YouCanAuthorizationResponseDto,
  YouCanConnectionStatusDto,
  YouCanStoreVerificationDto,
} from './dto/youcan-response.dto';
import { YouCanAuthService } from './youcan-auth.service';
import { YouCanConnectionService } from './youcan-connection.service';

@ApiTags('YouCan')
@ApiProduces('application/json')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('youcan')
export class YouCanController {
  constructor(
    private readonly authService: YouCanAuthService,
    private readonly connectionService: YouCanConnectionService,
  ) {}

  @Post('auth/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting a YouCan seller account',
    description:
      'Returns a short-lived authorization URL. Open it in the seller’s browser; do not request it server-to-server.',
  })
  @ApiOkResponse({
    description: 'Single-use YouCan authorization URL created.',
    type: YouCanAuthorizationResponseDto,
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
    description: 'YouCan OAuth or token encryption is not configured.',
    type: ApiErrorDto,
  })
  begin(@CurrentUser() user: JwtPayload) {
    return this.authService.begin(user.userId);
  }

  @Get('connection')
  @ApiOperation({ summary: 'Get the current store’s YouCan connection status' })
  @ApiOkResponse({
    description:
      'Connection state. A missing connection is represented as not_connected.',
    type: YouCanConnectionStatusDto,
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
    summary: 'Verify the stored credentials with YouCan',
    description:
      'Refreshes the access token when needed and calls YouCan GET /me. Secret token fields are never returned.',
  })
  @ApiOkResponse({
    description: 'YouCan accepted the stored credentials.',
    type: YouCanStoreVerificationDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid Zomaal token or the YouCan account must be reauthorized.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'YouCan is not connected for the current store.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'YouCan returned an invalid response.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'YouCan is temporarily unavailable.',
    type: ApiErrorDto,
  })
  verify(@CurrentUser() user: JwtPayload) {
    return this.connectionService.verify(user.userId);
  }

  @Delete('connection')
  @ApiOperation({ summary: 'Remove locally stored YouCan credentials' })
  @ApiOkResponse({
    description: 'Local YouCan credentials removed.',
    type: YouCanConnectionStatusDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Zomaal store or YouCan connection not found.',
    type: ApiErrorDto,
  })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.connectionService.disconnect(user.userId);
  }
}

@ApiTags('YouCan OAuth')
@ApiProduces('application/json')
@Controller('auth/youcan')
export class YouCanOAuthController {
  constructor(private readonly authService: YouCanAuthService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete YouCan OAuth authorization',
    description:
      'Public browser callback invoked by YouCan. It validates and consumes the single-use OAuth state, exchanges the authorization code, verifies the store through GET /me, and encrypts the tokens. Do not add a Zomaal bearer token.',
  })
  @ApiQuery({ name: 'code', required: false, type: String })
  @ApiQuery({ name: 'state', required: true, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiOkResponse({
    description:
      'Connection status when no frontend success redirect is configured.',
    type: YouCanConnectionStatusDto,
  })
  @ApiFoundResponse({
    description:
      'Redirects to YOUCAN_AUTH_SUCCESS_REDIRECT_URL with youcan=connected.',
  })
  @ApiBadRequestResponse({
    description: 'A required callback parameter is missing or malformed.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Authorization was rejected or OAuth state is invalid, expired, or reused.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'The YouCan store is already connected to another Zomaal store.',
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
