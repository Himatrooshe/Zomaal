import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Delete,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { MessageResponseDto } from '../auth/dto/auth-response.dto';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { SelectStoreDto } from './dto/select-store.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  StoreListResponseDto,
  StoreResponseDto,
} from './dto/store-response.dto';
import { ProfileMediaService } from '../profile-media/profile-media.service';
import type { WarehouseMediaUploadFile } from '../warehouse/media.service';

@ApiTags('Stores')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly profileMedia: ProfileMediaService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a store for the current user',
    description:
      'Creates a store owned by the authenticated user and selects it as the active store. First store also marks onboarding complete. Matches Figma “Add New Store”.',
  })
  @ApiBody({
    type: CreateStoreDto,
    examples: {
      moroccoStore: {
        summary: 'Moroccan online store',
        value: {
          ownerName: 'Ahmed Alaoui',
          businessName: 'Atlas Market',
          address: '123 Rue Hassan II',
          city: 'Casablanca',
          country: 'Morocco',
          logoUrl: 'https://example.com/logo.png',
          baseCurrency: 'MAD',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Store created.', type: StoreResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid, missing, or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Staff members cannot create stores.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() createStoreDto: CreateStoreDto,
  ) {
    return this.storesService.create(user.userId, createStoreDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all stores owned by the current user',
    description:
      'Figma “Your Stores” popup. Each row includes `isCurrent` for the active store badge.',
  })
  @ApiOkResponse({
    description: 'Owned stores, oldest first.',
    type: StoreListResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Caller is not a store owner (e.g. staff-only account).',
    type: ApiErrorDto,
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.storesService.list(user.userId);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get the current (active) store',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns the store selected via POST /stores/select (or the only/oldest owned store).',
  })
  @ApiOkResponse({
    description: 'Current user’s active store.',
    type: StoreResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has not created a store.',
    type: ApiErrorDto,
  })
  findCurrent(@CurrentUser() user: JwtPayload) {
    return this.storesService.findCurrent(user.userId);
  }

  @Put('me')
  @ApiOperation({
    summary: 'Update the current (active) store',
    description:
      'All request fields are optional; only supplied fields are changed. Includes logo, country, and baseCurrency.',
  })
  @ApiBody({
    type: UpdateStoreDto,
    examples: {
      renameStore: {
        summary: 'Update business name, logo, and currency',
        value: {
          businessName: 'Atlas Market Pro',
          logoUrl: 'https://example.com/new-logo.png',
          baseCurrency: 'MAD',
        },
      },
      updateAddress: {
        summary: 'Update pickup address',
        value: {
          address: '45 Boulevard Zerktouni',
          city: 'Casablanca',
          country: 'Morocco',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Updated store.', type: StoreResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has not created a store.',
    type: ApiErrorDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(user.userId, updateStoreDto);
  }

  @Post('me/logo')
  @UseInterceptors(
    FileInterceptor('logo', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['logo'],
      properties: {
        logo: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG, or WebP store logo, max 5 MiB. Figma “Add Store Logo”.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload store logo',
    description:
      'Stores the image and sets `logoUrl` on the active store to a public `/profile-media/stores/…` path. Replaces any previous uploaded logo. External HTTPS URLs via PUT /stores/me still work.',
  })
  @ApiCreatedResponse({
    description: 'Updated active store with new logoUrl.',
    type: StoreResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing file or unsupported/corrupt image.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Image storage is unavailable.',
    type: ApiErrorDto,
  })
  async uploadLogo(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: WarehouseMediaUploadFile,
  ) {
    await this.profileMedia.uploadStoreLogo(user.userId, file);
    return this.storesService.findCurrent(user.userId);
  }

  @Post('select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Switch the active store',
    description:
      'Sets which owned store Settings and the rest of the app act on (Figma store switcher).',
  })
  @ApiBody({ type: SelectStoreDto })
  @ApiOkResponse({
    description: 'Newly selected store.',
    type: StoreResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Store not found or not owned by the caller.',
    type: ApiErrorDto,
  })
  select(@CurrentUser() user: JwtPayload, @Body() dto: SelectStoreDto) {
    return this.storesService.select(user.userId, dto.storeId);
  }

  @Delete(':storeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an owned store',
    description:
      'Permanently deletes one store and its cascaded data. Cannot delete the last remaining store — use DELETE /users/me instead.',
  })
  @ApiOkResponse({
    description: 'Store deleted.',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Attempted to delete the only remaining store.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store not found or not owned by the caller.',
    type: ApiErrorDto,
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return this.storesService.remove(user.userId, storeId);
  }
}
