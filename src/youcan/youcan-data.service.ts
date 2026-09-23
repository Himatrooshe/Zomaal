import { Injectable, NotFoundException } from '@nestjs/common';
import { YouCanConnectionService } from './youcan-connection.service';
import { YouCanDataPageQueryDto } from './dto/youcan-data-query.dto';
import {
  YouCanPaginatedResponseDto,
  YouCanDataResponseDto,
  YouCanProductDto,
  YouCanOrderDto,
  YouCanCustomerDto,
} from './dto/youcan-data-response.dto';

@Injectable()
export class YouCanDataService {
  constructor(private readonly connectionService: YouCanConnectionService) {}

  async listProducts(
    userId: string,
    query: YouCanDataPageQueryDto,
  ): Promise<YouCanPaginatedResponseDto<YouCanProductDto>> {
    return this.connectionService.getJsonForUser(userId, '/products', {
      page: query.page,
      limit: query.limit,
      q: query.q,
    });
  }

  async getProductDetails(
    userId: string,
    productId: string,
  ): Promise<YouCanDataResponseDto<YouCanProductDto>> {
    const response = await this.connectionService.getJsonForUser<unknown>(
      userId,
      `/products/${productId}`,
    );
    const product = unwrapYouCanProduct(response);
    if (!product) {
      throw new NotFoundException(`YouCan product ${productId} not found`);
    }
    return { data: product };
  }

  async listOrders(
    userId: string,
    query: YouCanDataPageQueryDto,
  ): Promise<YouCanPaginatedResponseDto<YouCanOrderDto>> {
    return this.connectionService.getJsonForUser(userId, '/orders', {
      page: query.page,
      limit: query.limit,
      q: query.q,
      include: 'payment,shipping,discount,refunds,variants',
    });
  }

  async getOrderDetails(
    userId: string,
    orderId: string,
  ): Promise<YouCanDataResponseDto<YouCanOrderDto>> {
    const response = await this.connectionService.getJsonForUser<{
      order: YouCanOrderDto;
    }>(userId, `/orders/${orderId}`, {
      include: 'payment,shipping,discount,refunds,variants',
    });
    return { data: response.order };
  }

  async listCustomers(
    userId: string,
    query: YouCanDataPageQueryDto,
  ): Promise<YouCanPaginatedResponseDto<YouCanCustomerDto>> {
    return this.connectionService.getJsonForUser(userId, '/customers', {
      page: query.page,
      limit: query.limit,
      q: query.q,
    });
  }
}

function unwrapYouCanProduct(response: unknown): YouCanProductDto | null {
  if (!response || typeof response !== 'object') return null;
  const record = response as Record<string, unknown>;
  if (isYouCanProduct(record.product)) return record.product;
  if (isYouCanProduct(record.data)) return record.data;
  if (isYouCanProduct(record)) return record;
  return null;
}

function isYouCanProduct(value: unknown): value is YouCanProductDto {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}
