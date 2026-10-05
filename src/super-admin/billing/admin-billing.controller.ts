import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { CurrentSuperAdmin } from '../decorators/current-super-admin.decorator';
import { SuperAdminJwtAuthGuard } from '../guards/super-admin-jwt-auth.guard';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import { PlansService } from '../../billing/plans.service';
import { SubscriptionService } from '../../billing/subscription.service';
import {
  ActivateSubscriptionDto,
  AdminSubscriptionResponseDto,
  CreatePlanDto,
  ExtendTrialDto,
  PlanResponseDto,
  UpdatePlanDto,
} from '../../billing/dto/billing.dto';

@ApiTags('Admin Billing')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin')
export class AdminBillingController {
  constructor(
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'All plans, including inactive ones' })
  @ApiOkResponse({ type: [PlanResponseDto] })
  listPlans(): Promise<PlanResponseDto[]> {
    return this.plans.listAll();
  }

  @Post('plans')
  @ApiOperation({
    summary: 'Create a plan (prices are set here, never hardcoded)',
  })
  @ApiOkResponse({ type: PlanResponseDto })
  @ApiConflictResponse({
    description: 'Code already used, or no price set.',
    type: ApiErrorDto,
  })
  async createPlan(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: CreatePlanDto,
  ): Promise<PlanResponseDto> {
    const plan = await this.plans.create(dto);
    await this.activity.record(admin, {
      action: 'PLAN_CREATED',
      entityType: ActivityEntity.PLAN,
      entityId: plan.id,
      summary: `Created plan ${plan.code}`,
    });
    return plan;
  }

  @Patch('plans/:planId')
  @ApiOperation({
    summary: 'Update a plan',
    description:
      'Price changes apply to future payments only. Set isActive=false to stop selling a plan without affecting current subscribers.',
  })
  @ApiOkResponse({ type: PlanResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async updatePlan(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<PlanResponseDto> {
    const plan = await this.plans.update(planId, dto);
    await this.activity.record(admin, {
      action: 'PLAN_UPDATED',
      entityType: ActivityEntity.PLAN,
      entityId: plan.id,
      summary: `Updated plan ${plan.code}`,
      metadata: { changes: Object.keys(dto) },
    });
    return plan;
  }

  @Get('merchants/:userId/subscription')
  @ApiOperation({ summary: "A merchant's subscription and billing history" })
  @ApiOkResponse({ type: AdminSubscriptionResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  getSubscription(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.subscriptions.adminView(userId);
  }

  @Post('merchants/:userId/subscription/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record a payment received outside the app and activate / extend the plan',
    description:
      'Used until a payment gateway is integrated. Renewing the same plan before it ends extends from the current period end. Adds a billing-history entry.',
  })
  @ApiOkResponse({ type: AdminSubscriptionResponseDto })
  @ApiNotFoundResponse({
    description: 'Merchant or plan not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Plan not sold at that interval.',
    type: ApiErrorDto,
  })
  async activate(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ActivateSubscriptionDto,
  ) {
    const { invoice } = await this.subscriptions.activateManually(
      userId,
      { ...dto, paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined },
      admin.adminId,
    );
    await this.activity.record(admin, {
      action: 'SUBSCRIPTION_ACTIVATED',
      entityType: ActivityEntity.SUBSCRIPTION,
      entityId: userId,
      summary: `Recorded ${invoice.amount} ${invoice.currency} for ${invoice.planName} (${invoice.interval.toLowerCase()})`,
      metadata: { invoiceId: invoice.id, periodEnd: invoice.periodEnd },
    });
    return this.subscriptions.adminView(userId);
  }

  @Post('merchants/:userId/subscription/extend-trial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Give a merchant extra free-trial days' })
  @ApiOkResponse({ type: AdminSubscriptionResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'Already on a paid plan.',
    type: ApiErrorDto,
  })
  async extendTrial(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ExtendTrialDto,
  ) {
    const sub = await this.subscriptions.extendTrial(userId, dto.days);
    await this.activity.record(admin, {
      action: 'TRIAL_EXTENDED',
      entityType: ActivityEntity.SUBSCRIPTION,
      entityId: userId,
      summary: `Extended trial by ${dto.days} day(s)`,
      metadata: { accessEndsAt: sub.accessEndsAt.toISOString() },
    });
    return this.subscriptions.adminView(userId);
  }
}
