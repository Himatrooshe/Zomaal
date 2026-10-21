import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PermissionGuard } from '../access/permission.guard';
import { PERMISSIONS } from '../access/permissions';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ItemValueListDto, ItemValueQueryDto } from './dto/item-value.dto';
import { ItemValueService } from './item-value.service';

@ApiTags('Item Value')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({
  description: 'The caller has no store.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('warehouse/item-value')
export class ItemValueController {
  constructor(private readonly itemValue: ItemValueService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'Get current warehouse inventory value',
    description:
      'Store-scoped, read-only current valuation. Physical product variants and packaging with stock are included; bundle components are counted only as their physical variants. Unknown costs and legacy zero-cost products are reported as unvalued. Confirmed free packaging purchases have zero value. Incoming stock is excluded. The response is a current snapshot, not a historical valuation. Summary covers all matching items, independently of pagination.',
  })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiOkResponse({ type: ItemValueListDto })
  get(@CurrentUser() user: JwtPayload, @Query() query: ItemValueQueryDto) {
    return this.itemValue.get(user.userId, query);
  }
}
