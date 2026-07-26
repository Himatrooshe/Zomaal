import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductService } from './product.service';
import { CreateProductDto, ProductResponseDto } from './dto/product.dto';

@ApiTags('Products (Cross-Listing)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ecommerce/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @ApiOperation({ summary: 'Create a central product' })
  @ApiOkResponse({ type: ProductResponseDto })
  createProduct(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productService.createProduct(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List central products' })
  @ApiOkResponse({ type: [ProductResponseDto] })
  listProducts(@CurrentUser() user: JwtPayload): Promise<ProductResponseDto[]> {
    return this.productService.listProducts(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get central product details' })
  @ApiOkResponse({ type: ProductResponseDto })
  getProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProductResponseDto> {
    return this.productService.getProduct(user.userId, id);
  }

  @Post(':id/publish/:connectionId')
  @ApiOperation({ summary: 'Publish product to an external store connection' })
  publishProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
  ): Promise<void> {
    return this.productService.publishProduct(user.userId, id, connectionId);
  }
}
