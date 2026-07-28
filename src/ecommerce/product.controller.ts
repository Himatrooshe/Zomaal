import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductService } from './product.service';
import {
  CreateProductDto,
  ProductResponseDto,
  PublishProductDto,
  UploadProductImagesDto,
  UploadProductImagesResponseDto,
} from './dto/product.dto';
import {
  ProductImageUploadService,
  type ProductImageUploadFile,
} from './product-image-upload.service';

@ApiTags('Products (Cross-Listing)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ecommerce/products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly productImageUploadService: ProductImageUploadService,
  ) {}

  @Post('images/upload')
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 5,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload phone images to the selected e-commerce provider',
    description:
      'Uploads JPEG, PNG, or WebP bytes directly into the connected Shopify or YouCan account. Submit at most 5 images per request, each no larger than 5 MB. Use the returned images array in POST /ecommerce/products/publish. Shopify staged URLs must be published promptly. Lightfunnels binary upload is not available because its public API does not document that contract.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['platform', 'images'],
      properties: {
        platform: {
          type: 'string',
          enum: ['SHOPIFY', 'YOUCAN', 'LIGHTFUNNELS'],
        },
        images: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @ApiCreatedResponse({ type: UploadProductImagesResponseDto })
  uploadProductImages(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadProductImagesDto,
    @UploadedFiles() files: ProductImageUploadFile[],
  ): Promise<UploadProductImagesResponseDto> {
    return this.productImageUploadService.upload(
      user.userId,
      dto.platform,
      files,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a central product' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  createProduct(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productService.createProduct(user.userId, dto);
  }

  @Post('publish')
  @ApiOperation({
    summary: 'Create and publish a product to the selected e-commerce platform',
    description:
      'Select SHOPIFY, YOUCAN, or LIGHTFUNNELS. The current user must have an active connection to that platform. Reuse the same idempotencyKey when retrying.',
  })
  @ApiCreatedResponse({ type: ProductResponseDto })
  createAndPublishProduct(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishProductDto,
  ): Promise<ProductResponseDto> {
    return this.productService.createAndPublishProduct(user.userId, dto);
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
  @ApiCreatedResponse({ type: ProductResponseDto })
  publishProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
  ): Promise<ProductResponseDto> {
    return this.productService.publishProduct(user.userId, id, connectionId);
  }
}
