import { Injectable } from '@nestjs/common';
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
    const response = await this.connectionService.getJsonForUser<{
      product: YouCanProductDto;
    }>(userId, `/products/${productId}`);
    return { data: response.product };
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
