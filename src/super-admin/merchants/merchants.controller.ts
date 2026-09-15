import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { MerchantsService } from './merchants.service';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { ListMerchantsQueryDto } from './dto/list-merchants-query.dto';
import {
  MerchantResponseDto,
  MessageResponseDto,
} from './dto/merchant-response.dto';

@ApiTags('Admin Merchants')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin/merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get()
  @ApiOperation({ summary: 'List Zomaal merchants (store-owning users)' })
  @ApiOkResponse({ type: [MerchantResponseDto] })
  list(@Query() query: ListMerchantsQueryDto) {
    return this.merchantsService.list(query);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get one merchant' })
  @ApiOkResponse({ type: MerchantResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  getOne(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.merchantsService.getOne(userId);
  }

  @Get(':userId/overview')
  @ApiOperation({
    summary:
      'Merchant detail: connections, staff, order stats, recent orders, customers',
    description:
      'Read-only. Revenue is grouped per currency (orders keep their platform currency) and excludes cancelled orders.',
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  overview(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.merchantsService.overview(userId);
  }

  @Patch(':userId')
  @ApiOperation({
    summary: "Edit a merchant's store details, or activate/suspend them",
  })
  @ApiOkResponse({ type: MerchantResponseDto })
  update(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMerchantDto,
  ) {
    return this.merchantsService.update(admin, userId, dto);
  }

  @Delete(':userId')
  @ApiOperation({
    summary: 'Permanently delete a merchant account',
    description:
      'Cascades to everything the merchant owns (store, products, customers, orders, connections). There is no undo. Recorded in the activity log.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  remove(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.merchantsService.remove(admin, userId);
  }
}
