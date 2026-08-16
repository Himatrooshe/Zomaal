import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AdjustInventoryDto, SetInventoryOnHandDto } from './dto/inventory.dto';
import {
  InventoryItemResponseDto,
  InventoryMovementResponseDto,
} from './dto/inventory-response.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Warehouse Inventory')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard)
@Controller('warehouse/inventory/items')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description:
      'Inventory item ID returned by a product variant or owned packaging material.',
  })
  @ApiOperation({
    summary: 'Get balances for an inventory item',
    description:
      'Use inventoryItemId returned on each product variant. Returns scanner identifiers and per-location quantities. available is always onHand - reserved - damaged.',
  })
  @ApiOkResponse({ type: InventoryItemResponseDto })
  @ApiBadRequestResponse({
    description: 'Inventory item ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned inventory item was not found.',
    type: ApiErrorDto,
  })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.inventory.getItem(user.userId, id);
  }

  @Get(':id/movements')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Inventory item ID.' })
  @ApiOperation({
    summary: 'Get auditable inventory movement history',
    description:
      'Newest-first immutable audit trail. Product creation writes OPENING_BALANCE; manual adjustments write MANUAL_ADJUSTMENT. The limit is clamped to 1-500 and defaults to 100.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  @ApiOkResponse({ type: [InventoryMovementResponseDto] })
  @ApiBadRequestResponse({
    description: 'Inventory item ID or limit is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned inventory item was not found.',
    type: ApiErrorDto,
  })
  movements(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.inventory.movements(user.userId, id, limit);
  }

  @Post(':id/adjustments')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Inventory item ID.' })
  @ApiOperation({
    summary: 'Apply an idempotent manual stock adjustment',
    description:
      'Atomically changes one quantity bucket at the default warehouse and appends an audit movement. Quantities cannot become negative, and reserved + damaged cannot exceed onHand. Repeat the identical idempotencyKey to safely retry.',
  })
  @ApiCreatedResponse({ type: InventoryMovementResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid body/UUID, negative resulting bucket, or reserved + damaged would exceed on-hand stock.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned inventory item was not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Inventory changed concurrently after three retries.',
    type: ApiErrorDto,
  })
  adjust(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdjustInventoryDto,
  ) {
    return this.inventory.adjust(user.userId, id, dto);
  }

  @Put(':id/stock')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Inventory item ID.' })
  @ApiOperation({
    summary: 'Set the final on-hand stock quantity',
    description:
      'UI-friendly Update Stock endpoint. Send the final quantity shown in the popup; the backend calculates and audits the delta atomically.',
  })
  @ApiOkResponse({ type: InventoryMovementResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid quantity or the new on-hand quantity is below reserved plus damaged stock.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned inventory item was not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Inventory changed concurrently after three retries.',
    type: ApiErrorDto,
  })
  setStock(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetInventoryOnHandDto,
  ) {
    return this.inventory.setOnHand(user.userId, id, dto);
  }
}
