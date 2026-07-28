import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto,
  ProductResponseDto,
  PublishProductDto,
} from './dto/product.dto';
import type { ProductData } from './interfaces/ecommerce-product-adapter.interface';
import { LightfunnelsProductAdapter } from './lightfunnels-product.adapter';
import { ShopifyProductAdapter } from './shopify-product.adapter';
import { YouCanProductAdapter } from './youcan-product.adapter';

const PRODUCT_INCLUDE = {
  variants: true,
  images: { orderBy: { position: 'asc' as const } },
  listings: {
    include: {
      connection: {
        select: { platform: true },
      },
    },
  },
} as const;

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyProductAdapter: ShopifyProductAdapter,
    private readonly youcanProductAdapter: YouCanProductAdapter,
    private readonly lightfunnelsProductAdapter: LightfunnelsProductAdapter,
  ) {}

  private async requireStore(userId: string) {
    const store = await this.prisma.store.findUnique({
      where: { userId },
    });
    if (!store) {
      throw new BadRequestException('User does not have a store configured');
    }
    return store;
  }

  async createProduct(
    userId: string,
    data: CreateProductDto,
  ): Promise<ProductResponseDto> {
    const store = await this.requireStore(userId);
    const product = await this.prisma.product.create({
      data: this.productCreateData(store.id, data),
      include: PRODUCT_INCLUDE,
    });
    return this.toResponse(product);
  }

  async createAndPublishProduct(
    userId: string,
    request: PublishProductDto,
  ): Promise<ProductResponseDto> {
    const store = await this.requireStore(userId);
    const existing = await this.prisma.product.findUnique({
      where: {
        storeId_idempotencyKey: {
          storeId: store.id,
          idempotencyKey: request.idempotencyKey,
        },
      },
      include: PRODUCT_INCLUDE,
    });

    if (existing) {
      return this.resumeIdempotentPublication(
        userId,
        existing,
        request.platform,
      );
    }

    const connection = await this.requireActiveConnection(
      store.id,
      request.platform,
    );

    let product: ProductWithRelations;
    try {
      product = await this.prisma.product.create({
        data: {
          ...this.productCreateData(store.id, request.product),
          idempotencyKey: request.idempotencyKey,
          listings: {
            create: {
              connectionId: connection.id,
              status: 'PENDING',
            },
          },
        },
        include: PRODUCT_INCLUDE,
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      const concurrentProduct = await this.prisma.product.findUnique({
        where: {
          storeId_idempotencyKey: {
            storeId: store.id,
            idempotencyKey: request.idempotencyKey,
          },
        },
        include: PRODUCT_INCLUDE,
      });
      if (!concurrentProduct) {
        throw error;
      }
      return this.resumeIdempotentPublication(
        userId,
        concurrentProduct,
        request.platform,
      );
    }

    const listing = product.listings[0];
    if (!listing) {
      throw new ConflictException('Product listing was not initialized');
    }
    return this.executePublication(
      userId,
      product,
      listing.id,
      request.platform,
    );
  }

  async listProducts(userId: string): Promise<ProductResponseDto[]> {
    const store = await this.requireStore(userId);
    const products = await this.prisma.product.findMany({
      where: { storeId: store.id },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return products.map((product) => this.toResponse(product));
  }

  async getProduct(
    userId: string,
    productId: string,
  ): Promise<ProductResponseDto> {
    const store = await this.requireStore(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId: store.id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.toResponse(product);
  }

  async publishProduct(
    userId: string,
    productId: string,
    connectionId: string,
  ): Promise<ProductResponseDto> {
    const store = await this.requireStore(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId: store.id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: {
        id: connectionId,
        storeId: store.id,
        status: EcommerceConnectionStatus.ACTIVE,
      },
    });
    if (!connection) {
      throw new NotFoundException('Active e-commerce connection not found');
    }

    const current = product.listings.find(
      (listing) => listing.connectionId === connection.id,
    );
    if (current?.status === 'PUBLISHED') {
      return this.toResponse(product);
    }

    const listing = await this.prisma.productListing.upsert({
      where: {
        productId_connectionId: {
          productId,
          connectionId,
        },
      },
      create: {
        productId,
        connectionId,
        status: 'PENDING',
      },
      update: {
        status: 'PENDING',
        errorMessage: null,
      },
    });

    return this.executePublication(
      userId,
      product,
      listing.id,
      connection.platform,
    );
  }

  private async resumeIdempotentPublication(
    userId: string,
    product: ProductWithRelations,
    platform: EcommercePlatform,
  ): Promise<ProductResponseDto> {
    const listing = product.listings[0];
    if (!listing || listing.connection.platform !== platform) {
      throw new ConflictException(
        'This idempotency key was already used for a different platform',
      );
    }
    if (listing.status === 'PUBLISHED') {
      return this.toResponse(product);
    }
    return this.executePublication(userId, product, listing.id, platform);
  }

  private async executePublication(
    userId: string,
    product: ProductWithRelations,
    listingId: string,
    platform: EcommercePlatform,
  ): Promise<ProductResponseDto> {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const claim = await this.prisma.productListing.updateMany({
      where: {
        id: listingId,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PUBLISHING', updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: 'PUBLISHING',
        errorMessage: null,
      },
    });

    if (claim.count === 0) {
      const current = await this.prisma.productListing.findUnique({
        where: { id: listingId },
      });
      if (current?.status === 'PUBLISHED') {
        return this.loadProductResponse(product.storeId, product.id);
      }
      throw new ConflictException(
        'This product is already being published; retry shortly with the same idempotency key',
      );
    }

    try {
      const result = await this.adapterFor(platform).publishProduct(
        userId,
        this.toProductData(product),
      );
      await this.prisma.productListing.update({
        where: { id: listingId },
        data: {
          externalProductId: result.externalProductId,
          status: 'PUBLISHED',
          errorMessage: null,
        },
      });
      return this.loadProductResponse(product.storeId, product.id);
    } catch (error) {
      const providerMessage = this.safeErrorMessage(error);
      await this.prisma.productListing.update({
        where: { id: listingId },
        data: {
          status: 'FAILED',
          errorMessage: providerMessage,
        },
      });
      throw new BadGatewayException({
        message: `Failed to publish product to ${platform}`,
        productId: product.id,
        platform,
        listingStatus: 'FAILED',
        providerMessage,
      });
    }
  }

  private async requireActiveConnection(
    storeId: string,
    platform: EcommercePlatform,
  ) {
    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: {
        storeId,
        platform,
        status: EcommerceConnectionStatus.ACTIVE,
      },
    });
    if (!connection) {
      throw new ConflictException(
        `Connect or reconnect ${platform} before publishing products`,
      );
    }
    return connection;
  }

  private adapterFor(platform: EcommercePlatform) {
    switch (platform) {
      case EcommercePlatform.SHOPIFY:
        return this.shopifyProductAdapter;
      case EcommercePlatform.YOUCAN:
        return this.youcanProductAdapter;
      case EcommercePlatform.LIGHTFUNNELS:
        return this.lightfunnelsProductAdapter;
    }
  }

  private productCreateData(storeId: string, data: CreateProductDto) {
    return {
      storeId,
      title: data.title,
      description: data.description,
      vendor: data.vendor,
      status: data.status,
      variants: {
        create: data.variants.map((variant) => ({
          title: variant.title,
          sku: variant.sku,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          inventoryQty: variant.inventoryQty,
        })),
      },
      images: {
        create: (data.images ?? []).map((image) => ({
          url: image.url,
          position: image.position,
        })),
      },
    };
  }

  private toProductData(product: ProductWithRelations): ProductData {
    return {
      idempotencyKey: product.idempotencyKey ?? product.id,
      title: product.title,
      description: product.description ?? undefined,
      vendor: product.vendor ?? undefined,
      status: product.status,
      variants: product.variants.map((variant) => ({
        title: variant.title ?? undefined,
        sku: variant.sku ?? undefined,
        price: Number(variant.price),
        compareAtPrice:
          variant.compareAtPrice === null
            ? undefined
            : Number(variant.compareAtPrice),
        inventoryQty: variant.inventoryQty,
      })),
      images: product.images.map((image) => ({
        url: image.url,
        position: image.position,
      })),
    };
  }

  private async loadProductResponse(
    storeId: string,
    productId: string,
  ): Promise<ProductResponseDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.toResponse(product);
  }

  private toResponse(product: ProductWithRelations): ProductResponseDto {
    return {
      ...product,
      description: product.description ?? undefined,
      vendor: product.vendor ?? undefined,
      variants: product.variants.map((variant) => ({
        ...variant,
        title: variant.title ?? undefined,
        sku: variant.sku ?? undefined,
        price: Number(variant.price),
        compareAtPrice:
          variant.compareAtPrice === null
            ? undefined
            : Number(variant.compareAtPrice),
      })),
      listings: product.listings.map(({ connection, ...listing }) => ({
        ...listing,
        platform: connection.platform,
      })),
    };
  }

  private safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Provider error';
    return message.replace(/\s+/g, ' ').trim().slice(0, 1000);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
