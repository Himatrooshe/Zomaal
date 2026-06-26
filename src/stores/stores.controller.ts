import { Controller, Get, Post, Body, Put, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new store' })
  @ApiResponse({ status: 201, description: 'Store created successfully' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() createStoreDto: CreateStoreDto,
  ) {
    return this.storesService.create(user.userId, createStoreDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user store' })
  @ApiResponse({ status: 200, description: 'Returns the store' })
  findOne(@CurrentUser() user: JwtPayload) {
    return this.storesService.findOne(user.userId);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update current user store' })
  @ApiResponse({ status: 200, description: 'Store updated successfully' })
  update(
    @CurrentUser() user: JwtPayload,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(user.userId, updateStoreDto);
  }
}
