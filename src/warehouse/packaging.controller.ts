import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { PERMISSIONS } from '../access/permissions';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { Response } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  CreatePackagingDto,
  PackagingListQueryDto,
  UpdatePackagingDto,
} from './dto/packaging.dto';
import {
  ArchivePackagingResponseDto,
  OwnedPackagingMaterialResponseDto,
  PackagingMaterialDetailResponseDto,
} from './dto/packaging-response.dto';
import { MediaService } from './media.service';
import { PackagingService } from './packaging.service';

@ApiTags('Warehouse Packaging')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('warehouse/packaging')
export class PackagingController {
  constructor(
    private readonly packaging: PackagingService,
    private readonly media: MediaService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  @ApiProduces('application/json')
  @ApiOperation({
    summary: 'List packaging owned by the current merchant',
    description:
      'Packaging list screen and the Add Product packaging selector. Returns active materials, both bought from Zomaal Shop (source SHOP) and added by the merchant (source MANUAL), sorted by name. available is on-hand minus reserved and damaged.',
  })
  @ApiOkResponse({ type: [OwnedPackagingMaterialResponseDto] })
  @ApiBadRequestResponse({
    description: 'Invalid filter value.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  list(@CurrentUser() user: JwtPayload, @Query() query: PackagingListQueryDto) {
    return this.packaging.listOwned(user.userId, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PRODUCTS_ADD)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a packaging item',
    description:
      'For packaging bought outside Zomaal Shop. openingStock is recorded as an OPENING_BALANCE movement. Upload the photo first with POST /warehouse/media (purpose PACKAGING) and pass its id as imageUploadId.',
  })
  @ApiCreatedResponse({ type: PackagingMaterialDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid body, or the image upload is missing, expired or not purpose PACKAGING.',
    type: ApiErrorDto,
  })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePackagingDto) {
    return this.packaging.create(user.userId, dto);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Packaging material ID.',
  })
  @ApiOperation({
    summary: 'Packaging details',
    description:
      'Stock, minimum level and the products that use it. For stock history call GET /warehouse/inventory/items/{inventoryItemId}/movements; for Update stock call PUT /warehouse/inventory/items/{inventoryItemId}/stock.',
  })
  @ApiOkResponse({ type: PackagingMaterialDetailResponseDto })
  @ApiBadRequestResponse({
    description: 'ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Packaging not found.',
    type: ApiErrorDto,
  })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.packaging.get(user.userId, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Packaging material ID.',
  })
  @ApiOperation({
    summary: 'Edit a packaging item',
    description:
      'Send only the fields to change. unit, minimumLevel and lowStockAlert can be changed on any packaging; name, sku and the photo only on merchant-added packaging (source MANUAL). Stock is changed through the inventory endpoints.',
  })
  @ApiOkResponse({ type: PackagingMaterialDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid body, image upload unusable, or a catalog field sent for Zomaal Shop packaging.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Packaging not found.',
    type: ApiErrorDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePackagingDto,
  ) {
    return this.packaging.update(user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PRODUCTS_DELETE)
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Packaging material ID.',
  })
  @ApiOperation({
    summary: 'Archive a packaging item',
    description:
      'Hides it from the list and the product selector. Stock history is kept. Not allowed while a product still uses it.',
  })
  @ApiOkResponse({ type: ArchivePackagingResponseDto })
  @ApiBadRequestResponse({
    description: 'ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Packaging not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Still used by one or more products.',
    type: ApiErrorDto,
  })
  archive(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.packaging.archive(user.userId, id);
  }

  @Get(':id/image')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Owned packaging material ID.',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'Read an owned packaging material image',
    description:
      'Authenticated relative URL returned by packaging responses. The material must be active, owned by the current merchant, and have a catalog image.',
  })
  @ApiOkResponse({
    description: 'Raw packaging image bytes.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description: 'Packaging material ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store-owned active packaging image was not found.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The private Cloud Storage object could not be read.',
    type: ApiErrorDto,
  })
  async image(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ) {
    const objectName = await this.packaging.requireImageObject(user.userId, id);
    return this.media.streamPrivateObject(objectName, response);
  }
}
