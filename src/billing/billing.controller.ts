import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AllowWhenLocked } from './billing.decorators';
import { SubscriptionService } from './subscription.service';
import {
  BillingInvoiceListResponseDto,
  InvoiceListQueryDto,
  PlanResponseDto,
  SubscriptionResponseDto,
} from './dto/billing.dto';

// The whole billing area must keep working when the account is locked —
// that's where the merchant goes to fix it.
@ApiTags('Billing')
@ApiBearerAuth()
@AllowWhenLocked()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('billing')
export class BillingController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Plans & Pricing screen — active plans, cheapest first',
  })
  @ApiOkResponse({ type: [PlanResponseDto] })
  plans(): Promise<PlanResponseDto[]> {
    return this.subscriptions.listPlans();
  }

  @Get('subscription')
  @ApiOperation({
    summary: 'Plan & Billing screen, trial banner and locked overlay state',
    description:
      'Owners and staff can call this (staff need it to show the locked overlay). Staff get canManage=false.',
  })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  subscription(
    @CurrentUser() user: JwtPayload,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.getForUser(user.userId);
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel subscription — takes effect at the end of the paid period, no refund',
  })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiForbiddenResponse({
    description: 'Staff cannot manage billing.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Not on an active paid plan.',
    type: ApiErrorDto,
  })
  cancel(@CurrentUser() user: JwtPayload): Promise<SubscriptionResponseDto> {
    return this.subscriptions.cancel(user.userId);
  }

  @Post('subscription/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Undo a pending cancellation before the period ends',
  })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiForbiddenResponse({
    description: 'Staff cannot manage billing.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'No pending cancellation.',
    type: ApiErrorDto,
  })
  resume(@CurrentUser() user: JwtPayload): Promise<SubscriptionResponseDto> {
    return this.subscriptions.resume(user.userId);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Billing history (owner only), newest first' })
  @ApiOkResponse({ type: BillingInvoiceListResponseDto })
  @ApiForbiddenResponse({
    description: 'Staff cannot view billing history.',
    type: ApiErrorDto,
  })
  invoices(
    @CurrentUser() user: JwtPayload,
    @Query() query: InvoiceListQueryDto,
  ): Promise<BillingInvoiceListResponseDto> {
    return this.subscriptions.listInvoices(
      user.userId,
      query.page,
      query.limit,
    );
  }
}
