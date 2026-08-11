import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { LightfunnelsDataService } from './lightfunnels-data.service';
import {
  LightfunnelsIdParamDto,
  LightfunnelsDataPageQueryDto,
} from './dto/lightfunnels-data-query.dto';
import {
  LightfunnelsPaginatedResponseDto,
  LightfunnelsDataResponseDto,
  LightfunnelsProductDto,
  LightfunnelsOrderDto,
  LightfunnelsCustomerDto,
} from './dto/lightfunnels-data-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';

function ApiLightfunnelsPageQuery(searchExample: string) {
  return applyDecorators(
    ApiQuery({
      name: 'first',
      required: false,
      type: Number,
      description: 'Page size. Defaults to 20 and is capped at 100.',
      example: 20,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    }),
    ApiQuery({
      name: 'after',
      required: false,
      type: String,
      description:
        'Opaque cursor from the previous response. Omit for the first page.',
      example: 'eyJsYXN0X2lkIjo2MzIxMzk1MjE5fQ==',
      schema: { type: 'string', minLength: 1, maxLength: 2048 },
    }),
    ApiQuery({
      name: 'query',
      required: false,
      type: String,
      description: 'Lightfunnels search-syntax filter.',
      example: searchExample,
      schema: { type: 'string', minLength: 1, maxLength: 500 },
    }),
  );
}

function ApiLightfunnelsReadErrors(
  notFoundDescription = 'The current user has not created a Zomaal store, or the requested resource does not exist.',
) {
  return applyDecorators(
    ApiUnauthorizedResponse({
      description: 'Missing/invalid access token.',
      type: ApiErrorDto,
    }),
    ApiForbiddenResponse({
      description: 'The Lightfunnels installation lacks a required scope.',
      type: ApiErrorDto,
    }),
    ApiNotFoundResponse({
      description: notFoundDescription,
      type: ApiErrorDto,
    }),
    ApiConflictResponse({
      description: 'The Zomaal store has no active Lightfunnels connection.',
      type: ApiErrorDto,
    }),
    ApiBadGatewayResponse({
      description: 'Lightfunnels returned an empty or malformed response.',
      type: ApiErrorDto,
    }),
    ApiServiceUnavailableResponse({
      description: 'Lightfunnels timed out or is temporarily unavailable.',
      type: ApiErrorDto,
    }),
  );
}

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description: 'Response is not cacheable and contains private data.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

@ApiTags('Lightfunnels Store Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lightfunnels/data')
export class LightfunnelsDataController {
  constructor(private readonly dataService: LightfunnelsDataService) {}

  @Get('products')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List products from the connected Lightfunnels store',
  })
  @ApiLightfunnelsPageQuery('status:active')
  @ApiOkResponse({
    description: 'Cursor-paginated product summaries.',
    type: LightfunnelsPaginatedResponseDto<LightfunnelsProductDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiLightfunnelsReadErrors()
  getProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: LightfunnelsDataPageQueryDto,
  ) {
    return this.dataService.listProducts(user.userId, query);
  }

  @Get('products/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get complete details for one Lightfunnels product',
  })
  @ApiOkResponse({
    description: 'Complete Lightfunnels product details.',
    type: LightfunnelsDataResponseDto<LightfunnelsProductDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid numeric product ID.',
    type: ApiErrorDto,
  })
  @ApiLightfunnelsReadErrors('The Lightfunnels product does not exist.')
  getProduct(
    @CurrentUser() user: JwtPayload,
    @Param() params: LightfunnelsIdParamDto,
  ) {
    return this.dataService.getProductDetails(user.userId, params.id);
  }

  @Get('orders')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List orders from the connected Lightfunnels store',
  })
  @ApiLightfunnelsPageQuery('financial_status:paid')
  @ApiOkResponse({
    description: 'Cursor-paginated order summaries.',
    type: LightfunnelsPaginatedResponseDto<LightfunnelsOrderDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiLightfunnelsReadErrors()
  getOrders(
    @CurrentUser() user: JwtPayload,
    @Query() query: LightfunnelsDataPageQueryDto,
  ) {
    return this.dataService.listOrders(user.userId, query);
  }

  @Get('orders/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get complete details for one Lightfunnels order' })
  @ApiOkResponse({
    description: 'Complete Lightfunnels order details.',
    type: LightfunnelsDataResponseDto<LightfunnelsOrderDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid numeric order ID.',
    type: ApiErrorDto,
  })
  @ApiLightfunnelsReadErrors('The Lightfunnels order does not exist.')
  getOrder(
    @CurrentUser() user: JwtPayload,
    @Param() params: LightfunnelsIdParamDto,
  ) {
    return this.dataService.getOrderDetails(user.userId, params.id);
  }

  @Get('customers')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List customers from the connected Lightfunnels store',
  })
  @ApiLightfunnelsPageQuery('created_at:>2026-07-01')
  @ApiOkResponse({
    description: 'Cursor-paginated customer summaries.',
    type: LightfunnelsPaginatedResponseDto<LightfunnelsCustomerDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiLightfunnelsReadErrors()
  getCustomers(
    @CurrentUser() user: JwtPayload,
    @Query() query: LightfunnelsDataPageQueryDto,
  ) {
    return this.dataService.listCustomers(user.userId, query);
  }
}
