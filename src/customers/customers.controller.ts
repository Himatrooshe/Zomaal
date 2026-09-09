import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentStoreAccess } from '../access/current-store-access.decorator';
import type { StoreAccess } from '../access/store-access.service';
import { PERMISSIONS } from '../access/permissions';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { CustomersService } from './customers.service';
import { CustomerRiskService } from './customer-risk.service';
import { CustomerListQueryDto } from './dto/customer-list-query.dto';
import {
  CustomerDetailResponseDto,
  CustomerListResponseDto,
} from './dto/customer-response.dto';
import {
  AddToBlacklistDto,
  BlacklistScreenResponseDto,
  BlacklistSettingsDto,
  UpdateBlacklistSettingsDto,
} from './dto/blacklist.dto';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly risk: CustomerRiskService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  @ApiOperation({ summary: 'Customers list — search, totals, high-risk flag' })
  @ApiOkResponse({ type: CustomerListResponseDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.view permission.',
    type: ApiErrorDto,
  })
  list(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: CustomerListQueryDto,
  ): Promise<CustomerListResponseDto> {
    return this.customers.list(access.storeId, query);
  }

  @Get('blacklist/settings')
  @RequirePermission(PERMISSIONS.CUSTOMERS_BLACKLIST)
  @ApiOperation({ summary: 'Blacklist Settings screen — current risk limits' })
  @ApiOkResponse({ type: BlacklistSettingsDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.blacklist permission.',
    type: ApiErrorDto,
  })
  getBlacklistSettings(
    @CurrentStoreAccess() access: StoreAccess,
  ): Promise<BlacklistSettingsDto> {
    return this.risk.getSettings(access.storeId);
  }

  @Put('blacklist/settings')
  @RequirePermission(PERMISSIONS.CUSTOMERS_BLACKLIST)
  @ApiOperation({ summary: 'Blacklist Settings screen — Save Settings' })
  @ApiOkResponse({ type: BlacklistSettingsDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.blacklist permission.',
    type: ApiErrorDto,
  })
  updateBlacklistSettings(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: UpdateBlacklistSettingsDto,
  ): Promise<BlacklistSettingsDto> {
    return this.risk.updateSettings(access.storeId, dto);
  }

  @Get('blacklist')
  @RequirePermission(PERMISSIONS.CUSTOMERS_BLACKLIST)
  @ApiOperation({
    summary:
      'Blacklist screen — total, At Risk Customers, Blacklisted Customers',
    description:
      'page/limit paginate blacklistedCustomers only. atRiskCustomers is a bounded watchlist (not offset-paginated — "is this customer near a limit" is computed against BlacklistSettings, not a database filter).',
  })
  @ApiOkResponse({ type: BlacklistScreenResponseDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.blacklist permission.',
    type: ApiErrorDto,
  })
  getBlacklistScreen(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: CustomerListQueryDto,
  ): Promise<BlacklistScreenResponseDto> {
    return this.customers.getBlacklistScreen(access.storeId, query);
  }

  @Get(':customerId')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  @ApiOperation({
    summary: 'Customer Details — risk score breakdown + order history',
  })
  @ApiParam({ name: 'customerId', format: 'uuid' })
  @ApiOkResponse({ type: CustomerDetailResponseDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.view permission.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Customer not found.',
    type: ApiErrorDto,
  })
  getById(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CustomerDetailResponseDto> {
    return this.customers.getById(access.storeId, customerId);
  }

  @Post(':customerId/blacklist')
  @RequirePermission(PERMISSIONS.CUSTOMERS_BLACKLIST)
  @ApiOperation({
    summary: 'Add to Blacklist',
    description:
      'Reason is auto-filled from the risk score breakdown when not supplied.',
  })
  @ApiParam({ name: 'customerId', format: 'uuid' })
  @ApiOkResponse({ type: CustomerDetailResponseDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.blacklist permission.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Customer not found.',
    type: ApiErrorDto,
  })
  async addToBlacklist(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AddToBlacklistDto,
  ): Promise<CustomerDetailResponseDto> {
    await this.risk.addToBlacklist(access.storeId, customerId, dto.reason);
    return this.customers.getById(access.storeId, customerId);
  }

  @Delete(':customerId/blacklist')
  @RequirePermission(PERMISSIONS.CUSTOMERS_BLACKLIST)
  @ApiOperation({
    summary: 'Remove from Blacklist',
    description:
      'Resets all four risk counters to zero — monitored again from zero.',
  })
  @ApiParam({ name: 'customerId', format: 'uuid' })
  @ApiOkResponse({ type: CustomerDetailResponseDto })
  @ApiForbiddenResponse({
    description: 'Missing customers.blacklist permission.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Customer not found.',
    type: ApiErrorDto,
  })
  async removeFromBlacklist(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CustomerDetailResponseDto> {
    await this.risk.removeFromBlacklist(access.storeId, customerId);
    return this.customers.getById(access.storeId, customerId);
  }
}
