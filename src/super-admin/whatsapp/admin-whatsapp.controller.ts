import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import {
  AdminWhatsAppCreditDto,
  AdminWhatsAppCreditResponseDto,
  PageQueryDto,
  SetWhatsAppPricingDto,
  WhatsAppBalanceHistoryResponseDto,
  WhatsAppPricingDto,
} from '../../whatsapp/dto/whatsapp.dto';
import { WhatsAppBalanceService } from '../../whatsapp/whatsapp-balance.service';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import { CurrentSuperAdmin } from '../decorators/current-super-admin.decorator';
import { SuperAdminJwtAuthGuard } from '../guards/super-admin-jwt-auth.guard';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';

@ApiTags('Admin WhatsApp')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin')
export class AdminWhatsAppController {
  constructor(
    private readonly balance: WhatsAppBalanceService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get('whatsapp/pricing')
  @ApiOperation({ summary: 'Zomaal price per WhatsApp message, per currency' })
  @ApiOkResponse({ type: [WhatsAppPricingDto] })
  listPricing() {
    return this.balance.listPricing();
  }

  @Put('whatsapp/pricing/:currency')
  @ApiOperation({
    summary: 'Set the price per message for a currency',
    description:
      'Applies to messages sent from now on. Stores are charged in their base currency; no price for a currency means its messages fail with PRICING_NOT_SET.',
  })
  @ApiParam({ name: 'currency', example: 'MAD' })
  @ApiOkResponse({ type: WhatsAppPricingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  async setPricing(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('currency') currency: string,
    @Body() dto: SetWhatsAppPricingDto,
  ) {
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      throw new BadRequestException('currency must be a 3-letter ISO code');
    }
    const pricing = await this.balance.setPricing(
      currency,
      dto.pricePerMessage,
      admin.adminId,
    );
    await this.activity.record(admin, {
      action: 'WHATSAPP_PRICING_SET',
      entityType: ActivityEntity.WHATSAPP_PRICING,
      entityId: pricing.currency,
      summary: `Set WhatsApp price to ${pricing.pricePerMessage} ${pricing.currency} per message`,
    });
    return pricing;
  }

  @Get('stores/:storeId/whatsapp/balance')
  @ApiOperation({ summary: "A store's WhatsApp balance and ledger" })
  @ApiOkResponse({ type: WhatsAppBalanceHistoryResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  history(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.balance.history(storeId, query.page ?? 1, query.limit ?? 20);
  }

  @Post('stores/:storeId/whatsapp/balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Credit (or adjust) a store’s WhatsApp balance',
    description:
      'Record a payment received outside the app. Amounts are in the store base currency. Retrying with the same idempotencyKey returns the original entry.',
  })
  @ApiOkResponse({ type: AdminWhatsAppCreditResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async credit(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: AdminWhatsAppCreditDto,
  ) {
    const result = await this.balance.adminCredit(storeId, dto, admin.adminId);
    if (!result.replayed) {
      await this.activity.record(admin, {
        action:
          dto.type === 'TOP_UP'
            ? 'WHATSAPP_BALANCE_TOP_UP'
            : 'WHATSAPP_BALANCE_ADJUSTED',
        entityType: ActivityEntity.WHATSAPP_BALANCE,
        entityId: storeId,
        summary: `${dto.type === 'TOP_UP' ? 'Topped up' : 'Adjusted'} WhatsApp balance by ${result.entry.amount} ${result.currency}`,
        metadata: { entryId: result.entry.id, balance: result.balance },
      });
    }
    return result;
  }
}
