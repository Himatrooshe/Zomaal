import { Controller, Get, Post, Body, Put, UseGuards } from '@nestjs/common';
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StoreResponseDto } from './dto/store-response.dto';

@ApiTags('Stores')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Post()
  @ApiOperation({
    summary: 'Create the current user’s store',
    description:
      'Creates one store for the authenticated user and marks onboarding as complete.',
  })
  @ApiBody({
    type: CreateStoreDto,
    description: 'Store profile and pickup address for the current user.',
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
    description: 'The authenticated user already has a store.',
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

  @Get('me')
  @ApiOperation({
    summary: 'Get the current user’s store',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Returns the single store owned by the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Current user’s store.',
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
  findOne(@CurrentUser() user: JwtPayload) {
    return this.storesService.findOne(user.userId);
  }

  @Put('me')
  @ApiOperation({
    summary: 'Update the current user’s store',
    description:
      'All request fields are optional; only supplied fields are changed.',
  })
  @ApiBody({
    type: UpdateStoreDto,
    description:
      'Partial update. Include at least one field; omitted fields remain unchanged.',
    examples: {
      renameStore: {
        summary: 'Update business name and logo',
        value: {
          businessName: 'Atlas Market Pro',
          logoUrl: 'https://example.com/new-logo.png',
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
}
