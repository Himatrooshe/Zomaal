import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, ProductResponseDto } from './dto/product.dto';
import { ShopifyProductAdapter } from './shopify-product.adapter';
import { YouCanProductAdapter } from './youcan-product.adapter';
import { LightfunnelsProductAdapter } from './lightfunnels-product.adapter';
import { EcommercePlatform } from '@prisma/client';

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
      data: {
        storeId: store.id,
        title: data.title,
        description: data.description,
        vendor: data.vendor,
        status: data.status,
        variants: {
          create: data.variants.map((v) => ({
            title: v.title,
            sku: v.sku,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            inventoryQty: v.inventoryQty,
          })),
        },
        images: {
          create:
            data.images?.map((img) => ({
              url: img.url,
              position: img.position,
            })) || [],
        },
      },
      include: {
        variants: true,
        images: true,
        listings: true,
      },
    });

    return product as unknown as ProductResponseDto;
  }

  async listProducts(userId: string): Promise<ProductResponseDto[]> {
    const store = await this.requireStore(userId);
    const products = await this.prisma.product.findMany({
      where: { storeId: store.id },
      include: { variants: true, images: true, listings: true },
      orderBy: { createdAt: 'desc' },
    });
    return products as unknown as ProductResponseDto[];
  }

  async getProduct(
    userId: string,
    productId: string,
  ): Promise<ProductResponseDto> {
    const store = await this.requireStore(userId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId, storeId: store.id },
      include: { variants: true, images: true, listings: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product as unknown as ProductResponseDto;
  }

  async publishProduct(
    userId: string,
    productId: string,
    connectionId: string,
  ): Promise<void> {
    const store = await this.requireStore(userId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId, storeId: store.id },
      include: { variants: true, images: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    const connection = await this.prisma.ecommerceConnection.findUnique({
      where: { id: connectionId, storeId: store.id },
    });

    if (!connection)
      throw new NotFoundException('Ecommerce connection not found');

    const productData = {
      title: product.title,
      description: product.description || undefined,
      vendor: product.vendor || undefined,
      status: product.status,
      variants: product.variants.map((v) => ({
        title: v.title || undefined,
        sku: v.sku || undefined,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
        inventoryQty: v.inventoryQty,
      })),
      images: product.images.map((img) => ({
        url: img.url,
        position: img.position,
      })),
    };

    let externalProductId = '';

    switch (connection.platform) {
      case EcommercePlatform.SHOPIFY: {
        const shopifyResult = await this.shopifyProductAdapter.publishProduct(
          userId,
          productData,
        );
        externalProductId = shopifyResult.externalProductId;
        break;
      }
      case EcommercePlatform.YOUCAN: {
        const youcanResult = await this.youcanProductAdapter.publishProduct(
          userId,
          productData,
        );
        externalProductId = youcanResult.externalProductId;
        break;
      }
      case EcommercePlatform.LIGHTFUNNELS: {
        const lightfunnelsResult =
          await this.lightfunnelsProductAdapter.publishProduct(
            userId,
            productData,
          );
        externalProductId = lightfunnelsResult.externalProductId;
        break;
      }
      default:
        throw new BadRequestException('Platform not supported for publishing');
    }

    await this.prisma.productListing.upsert({
      where: {
        productId_connectionId: {
          productId,
          connectionId,
        },
      },
      create: {
        productId,
        connectionId,
        externalProductId,
        status: 'PUBLISHED',
      },
      update: {
        externalProductId,
        status: 'PUBLISHED',
      },
    });
  }
}
