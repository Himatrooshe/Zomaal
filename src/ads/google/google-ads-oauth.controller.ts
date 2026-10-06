import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Query,
  Res,
} from '@nestjs/common';
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
import { GoogleAdsAuthCompleteResponseDto } from '../dto/google-ads.dto';
import { GoogleAdsAuthService } from './google-ads-auth.service';

@ApiTags('Ads — Google OAuth')
@ApiProduces('application/json')
@Controller('auth/google-ads')
export class GoogleAdsOAuthController {
  constructor(private readonly authService: GoogleAdsAuthService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete Google Ads OAuth authorization',
    description:
      'Public browser callback invoked by Google. Consumes the single-use state, exchanges the ' +
      'code, and stores one AdsConnection per accessible advertiser account. Do not add a Zomaal bearer token.',
  })
  @ApiQuery({ name: 'code', required: false, type: String })
  @ApiQuery({ name: 'state', required: true, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiOkResponse({
    description:
      'Connection result when no frontend success redirect is configured.',
    type: GoogleAdsAuthCompleteResponseDto,
  })
  @ApiFoundResponse({
    description:
      'Redirects to GOOGLE_ADS_AUTH_SUCCESS_REDIRECT_URL with google_ads=connected (or the failure URL with google_ads=failed).',
  })
  @ApiBadRequestResponse({
    description:
      'Missing parameter, scope not granted, or no advertiser account.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Authorization was rejected, or OAuth state is invalid, expired, or reused.',
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
