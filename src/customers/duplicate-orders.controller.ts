import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentStoreAccess } from '../access/current-store-access.decorator';
import { PermissionGuard } from '../access/permission.guard';
import { PERMISSIONS } from '../access/permissions';
import { RequirePermission } from '../access/require-permission.decorator';
import type { StoreAccess } from '../access/store-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  CancelDuplicateOrdersDto,
  CancelDuplicateOrdersResponseDto,
  DuplicateOrdersQueryDto,
  DuplicateOrdersResponseDto,
  KeepDuplicateGroupResponseDto,
} from './dto/duplicate-orders.dto';
import { DuplicateOrdersService } from './duplicate-orders.service';
import { DUPLICATE_WINDOW_HOURS } from './duplicate-orders.util';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({
  description: 'Missing the permission named on the route.',
  type: ApiErrorDto,
})
@Controller('customers/duplicate-orders')
export class DuplicateOrdersController {
  constructor(private readonly duplicates: DuplicateOrdersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  @ApiOperation({
    summary: 'Duplicate Orders screen — groups by same phone',
    description: `Orders from the same customer phone that share a product within ${DUPLICATE_WINDOW_HOURS} hours of the group's main (oldest) order. Cancelled and already-reviewed orders are left out.`,
  })
  @ApiOkResponse({ type: DuplicateOrdersResponseDto })
  list(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: DuplicateOrdersQueryDto,
  ): Promise<DuplicateOrdersResponseDto> {
    return this.duplicates.list(access.storeId, {
      days: query.days ?? 30,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.ORDERS_CANCEL)
  @ApiOperation({
    summary: 'Cancel selected duplicates',
    description:
      'Manual orders are cancelled. Shopify / YouCan / Lightfunnels orders are cancelled in Zomaal only (courier dispatch is blocked) — platformCancelRequired tells the app to ask the merchant to cancel them on the platform too. Cancelled duplicates never count as customer cancellations.',
  })
  @ApiOkResponse({ type: CancelDuplicateOrdersResponseDto })
  @ApiBadRequestResponse({
    description:
      'An order is not in a duplicate group, or every order of a group was selected.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({ description: 'Order not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description:
      'An order was already sent to a courier, or was reviewed meanwhile.',
    type: ApiErrorDto,
  })
  cancel(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: CancelDuplicateOrdersDto,
  ): Promise<CancelDuplicateOrdersResponseDto> {
    return this.duplicates.cancel(access.storeId, access.userId, dto.orderIds);
  }

  @Post(':groupId/keep')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.ORDERS_EDIT)
  @ApiOperation({
    summary: 'Not duplicates — keep every order in the group',
    description:
      'Marks the group’s duplicates as real separate orders so they are not flagged again.',
  })
  @ApiParam({ name: 'groupId', format: 'uuid', description: 'Main order id.' })
  @ApiOkResponse({ type: KeepDuplicateGroupResponseDto })
  @ApiNotFoundResponse({
    description: 'No current duplicate group with this main order.',
    type: ApiErrorDto,
  })
  keep(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<KeepDuplicateGroupResponseDto> {
    return this.duplicates.keepGroup(access.storeId, access.userId, groupId);
  }
}
