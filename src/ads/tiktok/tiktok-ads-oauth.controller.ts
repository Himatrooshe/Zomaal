import { Controller, Get, Header, HttpStatus, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { TikTokAuthCompleteResponseDto } from '../dto/ads-connection.dto';
import { TikTokAdsAuthService } from './tiktok-ads-auth.service';

@ApiTags('Ads — TikTok OAuth')
@ApiProduces('application/json')
@Controller('auth/tiktok')
export class TikTokAdsOAuthController {
  constructor(private readonly authService: TikTokAdsAuthService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete TikTok Ads OAuth authorization',
    description:
      'Public browser callback invoked by TikTok. Validates and consumes the single-use ' +
      'OAuth state, exchanges the auth code, and stores one AdsConnection per advertiser ' +
      'account TikTok granted access to. Do not add a Zomaal bearer token.',
  })
  @ApiQuery({ name: 'auth_code', required: false, type: String })
  @ApiQuery({ name: 'state', required: true, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiOkResponse({
    description: 'Connection result when no frontend success redirect is configured.',
    type: TikTokAuthCompleteResponseDto,
  })
  @ApiFoundResponse({
    description: 'Redirects to TIKTOK_ADS_AUTH_SUCCESS_REDIRECT_URL with tiktok_ads=connected.',
  })
  @ApiBadRequestResponse({ description: 'A required callback parameter is missing or malformed.', type: ApiErrorDto })
  @ApiUnauthorizedResponse({
    description: 'Authorization was rejected, or OAuth state is invalid, expired, or reused.',
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
