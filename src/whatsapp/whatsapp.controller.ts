import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RequirePlanFeature } from '../billing/billing.decorators';
import { PLAN_FEATURES } from '../billing/plan-features';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  ConnectWhatsAppDto,
  PageQueryDto,
  UpdateStatusSettingDto,
  UpdateWhatsAppConnectionDto,
  WhatsAppAnalyticsQueryDto,
  WhatsAppAnalyticsResponseDto,
  WhatsAppBalanceHistoryResponseDto,
  WhatsAppConfigResponseDto,
  WhatsAppConnectResponseDto,
  WhatsAppConnectionResponseDto,
  WhatsAppDashboardResponseDto,
  WhatsAppDisconnectResponseDto,
  WhatsAppMessagesQueryDto,
  WhatsAppMessagesResponseDto,
  WhatsAppStatusSettingDto,
  WhatsAppStatusSettingsResponseDto,
  TemplateProvisionSummaryDto,
  WhatsAppTemplatesResponseDto,
} from './dto/whatsapp.dto';
import { WHATSAPP_TRIGGERS } from './whatsapp.constants';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppInsightsService } from './whatsapp-insights.service';
import { WhatsAppSettingsService } from './whatsapp-settings.service';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({
  description: 'Caller is not the store owner, or the plan has no WhatsApp.',
  type: ApiErrorDto,
})
@RequirePlanFeature(PLAN_FEATURES.WHATSAPP)
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly connections: WhatsAppConnectionService,
    private readonly settings: WhatsAppSettingsService,
    private readonly insights: WhatsAppInsightsService,
  ) {}

  @Get('config')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Embedded Signup settings for the Connect WhatsApp button',
    description:
      'Use appId + graphApiVersion for FB.init and configId for FB.login({ config_id, response_type: "code", override_default_response_type: true }). enabled=false hides the feature.',
  })
  @ApiOkResponse({ type: WhatsAppConfigResponseDto })
  config(): WhatsAppConfigResponseDto {
    return this.connections.config();
  }

  @Get('connection')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: "The store's WhatsApp number connection" })
  @ApiOkResponse({ type: WhatsAppConnectionResponseDto })
  getConnection(@CurrentUser() user: JwtPayload) {
    return this.connections.getConnection(user.userId);
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish Embedded Signup and connect the merchant number',
    description:
      'Exchanges the code, checks the number belongs to the WABA, subscribes the WABA to Zomaal webhooks, registers the number for Cloud API, and submits Zomaal message templates (8 statuses × en/ar/fr) to Meta for approval. Reconnecting replaces the previous number.',
  })
  @ApiOkResponse({ type: WhatsAppConnectResponseDto })
  @ApiBadRequestResponse({
    description: 'Phone number is not in that WABA, or invalid body.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Number already connected to another store.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'Meta rejected the request.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'WhatsApp is not enabled on the server, or Meta is unavailable.',
    type: ApiErrorDto,
  })
  connect(@CurrentUser() user: JwtPayload, @Body() dto: ConnectWhatsAppDto) {
    return this.connections.connect(user.userId, dto);
  }

  @Patch('connection')
  @ApiOperation({ summary: 'Change the language of customer messages' })
  @ApiOkResponse({ type: WhatsAppConnectionResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  updateConnection(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateWhatsAppConnectionDto,
  ) {
    return this.connections.updateLanguage(user.userId, dto.language);
  }

  @Delete('connection')
  @ApiOperation({
    summary: 'Disconnect WhatsApp',
    description:
      'Unsubscribes the WABA, deletes the stored token and cancels scheduled messages. The balance is kept.',
  })
  @ApiOkResponse({ type: WhatsAppDisconnectResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.connections.disconnect(user.userId);
  }

  @Get('status-settings')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Which courier statuses send a message, and after what delay',
  })
  @ApiOkResponse({ type: WhatsAppStatusSettingsResponseDto })
  listStatusSettings(@CurrentUser() user: JwtPayload) {
    return this.settings.listStatusSettings(user.userId);
  }

  @Put('status-settings/:trigger')
  @ApiOperation({
    summary: 'Turn one status message on/off or change its delay',
  })
  @ApiParam({ name: 'trigger', enum: WHATSAPP_TRIGGERS })
  @ApiOkResponse({ type: WhatsAppStatusSettingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  updateStatusSetting(
    @CurrentUser() user: JwtPayload,
    @Param('trigger') trigger: string,
    @Body() dto: UpdateStatusSettingDto,
  ) {
    return this.settings.updateStatusSetting(user.userId, trigger, dto);
  }

  @Get('templates')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Zomaal templates with text and Meta approval status',
  })
  @ApiOkResponse({ type: WhatsAppTemplatesResponseDto })
  listTemplates(@CurrentUser() user: JwtPayload) {
    return this.settings.listTemplates(user.userId);
  }

  @Post('templates/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resubmit missing templates and refresh approval statuses from Meta',
  })
  @ApiOkResponse({ type: TemplateProvisionSummaryDto })
  @ApiConflictResponse({ description: 'Not connected.', type: ApiErrorDto })
  syncTemplates(@CurrentUser() user: JwtPayload) {
    return this.connections.syncTemplates(user.userId);
  }

  @Get('dashboard')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Balance, price per message and today’s counts' })
  @ApiOkResponse({ type: WhatsAppDashboardResponseDto })
  dashboard(@CurrentUser() user: JwtPayload) {
    return this.insights.dashboard(user.userId);
  }

  @Get('balance/history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Balance ledger: top-ups, message charges, refunds',
  })
  @ApiOkResponse({ type: WhatsAppBalanceHistoryResponseDto })
  balanceHistory(
    @CurrentUser() user: JwtPayload,
    @Query() query: PageQueryDto,
  ) {
    return this.insights.balanceHistory(
      user.userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('messages')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Message log, newest first' })
  @ApiOkResponse({ type: WhatsAppMessagesResponseDto })
  messages(
    @CurrentUser() user: JwtPayload,
    @Query() query: WhatsAppMessagesQueryDto,
  ) {
    return this.insights.messages(user.userId, {
      status: query.status,
      trigger: query.trigger,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Get('analytics')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Sent / delivered / read / failed and cost over a range',
  })
  @ApiOkResponse({ type: WhatsAppAnalyticsResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  analytics(
    @CurrentUser() user: JwtPayload,
    @Query() query: WhatsAppAnalyticsQueryDto,
  ) {
    return this.insights.analytics(user.userId, query.from, query.to);
  }
}
