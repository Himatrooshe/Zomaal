import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CategoryService } from './category.service';
import { ProductCategoryResponseDto } from './dto/category-response.dto';
import {
  CreateProductCategoryDto,
  UpdateProductCategoryDto,
} from './dto/category.dto';

@ApiTags('Warehouse Categories')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard)
@Controller('warehouse/categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a store-owned product category',
    description:
      'Creates a selectable Add Product category. Slugs are generated from names and made unique within the merchant store. parentId is optional and must belong to the same store.',
  })
  @ApiCreatedResponse({ type: ProductCategoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Request validation failed.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or requested parent category was not found.',
    type: ApiErrorDto,
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductCategoryDto,
  ) {
    return this.categories.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List product categories',
    description:
      'Populates the Add Product category selector. Results are ordered by position then name and include a product count. Inactive categories are hidden by default.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    example: false,
  })
  @ApiOkResponse({ type: [ProductCategoryResponseDto] })
  @ApiBadRequestResponse({
    description: 'includeInactive is not a boolean.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.categories.list(user.userId, includeInactive);
  }

  @Patch(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned category ID.',
  })
  @ApiOperation({
    summary: 'Update a product category',
    description:
      'Partially updates category metadata, ordering, parent, or active state. Renaming regenerates a store-unique slug. Hierarchy cycles are rejected.',
  })
  @ApiOkResponse({ type: ProductCategoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or request body.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store, category, or parent category was not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The requested hierarchy would create a cycle.',
    type: ApiErrorDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.categories.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned category ID.',
  })
  @ApiOperation({
    summary: 'Archive a product category',
    description:
      'Soft-disables the category. Existing product assignments remain, but new products cannot use it and products assigned to it cannot be activated until it is restored with PATCH isActive=true.',
  })
  @ApiOkResponse({ type: ProductCategoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Category ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned category was not found.',
    type: ApiErrorDto,
  })
  archive(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.categories.archive(user.userId, id);
  }
}
