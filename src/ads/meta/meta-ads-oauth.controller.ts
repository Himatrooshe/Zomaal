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
import { MetaAdsAuthCompleteResponseDto } from '../dto/meta-ads.dto';
import { MetaAdsAuthService } from './meta-ads-auth.service';

@ApiTags('Ads — Meta OAuth')
@ApiProduces('application/json')
@Controller('auth/meta-ads')
export class MetaAdsOAuthController {
  constructor(private readonly authService: MetaAdsAuthService) {}

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete Meta Ads (Facebook Login) authorization',
    description:
      'Public browser callback invoked by Facebook. Consumes the single-use state, exchanges the ' +
      'code for a long-lived token, and stores one AdsConnection per active ad account. Do not add a Zomaal bearer token.',
  })
  @ApiQuery({ name: 'code', required: false, type: String })
  @ApiQuery({ name: 'state', required: true, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiOkResponse({
    description:
      'Connection result when no frontend success redirect is configured.',
    type: MetaAdsAuthCompleteResponseDto,
  })
  @ApiFoundResponse({
    description:
      'Redirects to META_ADS_AUTH_SUCCESS_REDIRECT_URL with meta_ads=connected (or the failure URL with meta_ads=failed).',
  })
  @ApiBadRequestResponse({
    description:
      'Missing parameter, ads access not granted, or no active ad account.',
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
