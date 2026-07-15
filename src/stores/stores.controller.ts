import { Controller, Get, Post, Body, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
  @ApiOperation({ summary: 'Get the current user’s store' })
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
