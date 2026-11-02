import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AllowWhenLocked } from './billing.decorators';
import { StripeBillingService } from './stripe-billing.service';
import { StripeClientService } from './stripe-client.service';
import {
  StripeCheckoutDto,
  StripeCheckoutResponseDto,
} from './stripe-billing.dto';

@ApiTags('Billing — Stripe')
@AllowWhenLocked()
@Controller('billing/stripe')
export class StripeBillingController {
  constructor(
    private readonly billing: StripeBillingService,
    private readonly stripe: StripeClientService,
  ) {}

  @Post('checkout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Create or reuse owner-only sandbox subscription checkout',
    description:
      'Available only in isolated Stripe staging. Monthly plans only; one subscription per owner account.',
  })
  @ApiOkResponse({ type: StripeCheckoutResponseDto })
  checkout(@CurrentUser() user: JwtPayload, @Body() dto: StripeCheckoutDto) {
    return this.billing.checkout(user.userId, dto);
  }

  @Get('return')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Stripe browser return; never changes subscription access',
    description:
      'Redirects to the configured app URL for success or cancellation. The app must refresh subscription status; a browser return is not payment confirmation. Returns informational JSON when no app URL is configured.',
  })
  @ApiResponse({
    status: 303,
    description: 'Return to the configured app URL.',
  })
  @ApiOkResponse({
    description: 'Informational JSON when no app return URL is configured.',
  })
  complete(
    @Res({ passthrough: true }) response: Response,
    @Query('outcome') outcome?: string,
  ) {
    if (outcome === 'success' || outcome === 'cancel') {
      const target = this.stripe.appReturnUrl(outcome);
      if (target) {
        response.redirect(303, target);
        return;
      }
    }
    return {
      sandbox: true,
      message:
        outcome === 'cancel'
          ? 'Checkout canceled. No payment was confirmed.'
          : 'Checkout finished. Sign in to Zomaal staging to check payment and subscription status. Access changes only after verified payment.',
    };
  }
}

@ApiTags('Billing — Stripe')
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly billing: StripeBillingService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Receive signed Stripe sandbox events; no bearer token required',
  })
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.billing.webhook(
      request.rawBody ?? Buffer.alloc(0),
      signature ?? '',
    );
  }
}
