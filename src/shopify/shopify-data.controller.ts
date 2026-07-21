import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ShopifyDataPageQueryDto } from './dto/shopify-data-query.dto';
import {
  ShopifyCustomerListResponseDto,
  ShopifyOrderListResponseDto,
  ShopifyProductListResponseDto,
  ShopifyShopOverviewDto,
} from './dto/shopify-data-response.dto';
import { ShopifyDataService } from './shopify-data.service';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description:
      'Store data can contain protected customer information and must not be stored by shared caches.',
    schema: {
      type: 'string',
      example: 'private, no-store',
    },
  },
};

@ApiTags('Shopify Data')
@ApiProduces('application/json')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shopify')
export class ShopifyDataController {
  constructor(private readonly dataService: ShopifyDataService) {}

  @Get('store')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get the connected Shopify store overview',
    description:
      'Reads current store identity, domain, plan, currency, timezone, and address data directly from Shopify. Zomaal never returns the Shopify access token.',
  })
  @ApiOkResponse({
    description: 'Current Shopify store overview.',
    type: ShopifyShopOverviewDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiShopifyReadErrors()
  getStore(@CurrentUser() user: JwtPayload): Promise<ShopifyShopOverviewDto> {
    return this.dataService.getOverview(user.userId);
  }

  @Get('products')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List products from the connected Shopify store',
    description:
      'Returns lightweight product summaries ordered by most recently updated. Requires Shopify `read_products` (or the corresponding write scope). Use `pageInfo.endCursor` as `after` to fetch the next page.',
  })
  @ApiShopifyPageQuery('status:active')
  @ApiOkResponse({
    description:
      'Cursor-paginated products. An empty store returns `data: []` with HTTP 200.',
    type: ShopifyProductListResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid `first`, `after`, `query`, or an unexpected query parameter.',
    type: ApiErrorDto,
  })
  @ApiShopifyReadErrors()
  getProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: ShopifyDataPageQueryDto,
  ): Promise<ShopifyProductListResponseDto> {
    return this.dataService.listProducts(user.userId, query);
  }

  @Get('orders')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List orders from the connected Shopify store',
    description:
      'Returns order summaries ordered by most recently processed. Requires Shopify `read_orders` and protected customer data access. Shopify exposes only the latest 60 days by default; older orders require approved `read_all_orders` access. Use `pageInfo.endCursor` as `after` for the next page.',
  })
  @ApiShopifyPageQuery('financial_status:paid')
  @ApiOkResponse({
    description:
      'Cursor-paginated order summaries. Customer contact details, addresses, and line items are intentionally excluded from this list.',
    type: ShopifyOrderListResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid `first`, `after`, `query`, or an unexpected query parameter.',
    type: ApiErrorDto,
  })
  @ApiShopifyReadErrors()
  getOrders(
    @CurrentUser() user: JwtPayload,
    @Query() query: ShopifyDataPageQueryDto,
  ): Promise<ShopifyOrderListResponseDto> {
    return this.dataService.listOrders(user.userId, query);
  }

  @Get('customers')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List customers from the connected Shopify store',
    description:
      'Returns customer summaries ordered by most recently updated. Requires Shopify `read_customers`. Names, email addresses, and phone numbers are protected customer data and require the relevant Shopify production approval. Use `pageInfo.endCursor` as `after` for the next page.',
  })
  @ApiShopifyPageQuery("updated_at:>='2026-07-01T00:00:00Z'")
  @ApiOkResponse({
    description:
      'Cursor-paginated customer summaries. Decimal money and 64-bit order counts are returned as strings.',
    type: ShopifyCustomerListResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid `first`, `after`, `query`, or an unexpected query parameter.',
    type: ApiErrorDto,
  })
  @ApiShopifyReadErrors()
  getCustomers(
    @CurrentUser() user: JwtPayload,
    @Query() query: ShopifyDataPageQueryDto,
  ): Promise<ShopifyCustomerListResponseDto> {
    return this.dataService.listCustomers(user.userId, query);
  }
}

function ApiShopifyPageQuery(searchExample: string) {
  return applyDecorators(
    ApiQuery({
      name: 'first',
      required: false,
      type: Number,
      description:
        'Page size. Defaults to 20 and is capped at 100 to control Shopify query cost and mobile payload size.',
      example: 20,
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20,
      },
    }),
    ApiQuery({
      name: 'after',
      required: false,
      type: String,
      description:
        'Opaque `pageInfo.endCursor` from the previous response. Omit for the first page; an empty value is treated as omitted.',
      example:
        'eyJsYXN0X2lkIjo2MzIxMzk1MjIwLCJsYXN0X3ZhbHVlIjoiNjMyMTM5NTIyMCJ9',
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
      },
    }),
    ApiQuery({
      name: 'query',
      required: false,
      type: String,
      description:
        'Shopify search-syntax filter for this resource. The value is sent through a GraphQL variable; an empty value is treated as omitted.',
      example: searchExample,
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
      },
    }),
  );
}

function ApiShopifyReadErrors() {
  return applyDecorators(
    ApiUnauthorizedResponse({
      description:
        'Missing/invalid Zomaal access token, or Shopify authorization has expired and the store must be reconnected.',
      type: ApiErrorDto,
    }),
    ApiForbiddenResponse({
      description:
        'The Shopify installation lacks a required scope or protected customer data approval.',
      type: ApiErrorDto,
    }),
    ApiNotFoundResponse({
      description: 'The current user has not created a Zomaal store.',
      type: ApiErrorDto,
    }),
    ApiConflictResponse({
      description:
        'The Zomaal store has no active Shopify connection. Complete Shopify OAuth first.',
      type: ApiErrorDto,
    }),
    ApiBadGatewayResponse({
      description:
        'Shopify returned an empty, malformed, or schema-invalid GraphQL response.',
      type: ApiErrorDto,
    }),
    ApiServiceUnavailableResponse({
      description:
        'Shopify timed out, throttled the request after retries, or is temporarily unavailable.',
      type: ApiErrorDto,
    }),
  );
}
