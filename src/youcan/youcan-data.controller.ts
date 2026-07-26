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
import { YouCanDataService } from './youcan-data.service';
import {
  YouCanIdParamDto,
  YouCanDataPageQueryDto,
} from './dto/youcan-data-query.dto';
import {
  YouCanPaginatedResponseDto,
  YouCanDataResponseDto,
  YouCanProductDto,
  YouCanOrderDto,
  YouCanCustomerDto,
} from './dto/youcan-data-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';

function ApiYouCanPageQuery(searchExample: string) {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      description: 'Page number for pagination. Defaults to 1.',
      example: 1,
      schema: { type: 'integer', minimum: 1, default: 1 },
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Maximum number of records to return. Defaults to 20.',
      example: 20,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    }),
    ApiQuery({
      name: 'q',
      required: false,
      type: String,
      description: 'YouCan search query string.',
      example: searchExample,
      schema: { type: 'string', minLength: 1, maxLength: 500 },
    }),
  );
}

function ApiYouCanReadErrors(
  notFoundDescription = 'The current user has not created a Zomaal store, or the requested resource does not exist.',
) {
  return applyDecorators(
    ApiUnauthorizedResponse({
      description: 'Missing/invalid access token.',
      type: ApiErrorDto,
    }),
    ApiForbiddenResponse({
      description: 'The YouCan installation lacks a required scope.',
      type: ApiErrorDto,
    }),
    ApiNotFoundResponse({
      description: notFoundDescription,
      type: ApiErrorDto,
    }),
    ApiConflictResponse({
      description: 'The Zomaal store has no active YouCan connection.',
      type: ApiErrorDto,
    }),
    ApiBadGatewayResponse({
      description: 'YouCan returned an empty or malformed response.',
      type: ApiErrorDto,
    }),
    ApiServiceUnavailableResponse({
      description: 'YouCan timed out or is temporarily unavailable.',
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

@ApiTags('YouCan Store Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('youcan/data')
export class YouCanDataController {
  constructor(private readonly dataService: YouCanDataService) {}

  @Get('products')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List products from the connected YouCan store' })
  @ApiYouCanPageQuery('shirt')
  @ApiOkResponse({
    description: 'Paginated product summaries.',
    type: YouCanPaginatedResponseDto<YouCanProductDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiYouCanReadErrors()
  getProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: YouCanDataPageQueryDto,
  ) {
    return this.dataService.listProducts(user.userId, query);
  }

  @Get('products/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get complete details for one YouCan product' })
  @ApiOkResponse({
    description: 'Complete YouCan product details.',
    type: YouCanDataResponseDto<YouCanProductDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid YouCan product ID.',
    type: ApiErrorDto,
  })
  @ApiYouCanReadErrors('The YouCan product does not exist.')
  getProduct(
    @CurrentUser() user: JwtPayload,
    @Param() params: YouCanIdParamDto,
  ) {
    return this.dataService.getProductDetails(user.userId, params.id);
  }

  @Get('orders')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List orders from the connected YouCan store' })
  @ApiYouCanPageQuery('paid')
  @ApiOkResponse({
    description: 'Paginated order summaries.',
    type: YouCanPaginatedResponseDto<YouCanOrderDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiYouCanReadErrors()
  getOrders(
    @CurrentUser() user: JwtPayload,
    @Query() query: YouCanDataPageQueryDto,
  ) {
    return this.dataService.listOrders(user.userId, query);
  }

  @Get('orders/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get complete details for one YouCan order' })
  @ApiOkResponse({
    description: 'Complete YouCan order details.',
    type: YouCanDataResponseDto<YouCanOrderDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid YouCan order ID.',
    type: ApiErrorDto,
  })
  @ApiYouCanReadErrors('The YouCan order does not exist.')
  getOrder(@CurrentUser() user: JwtPayload, @Param() params: YouCanIdParamDto) {
    return this.dataService.getOrderDetails(user.userId, params.id);
  }

  @Get('customers')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List customers from the connected YouCan store' })
  @ApiYouCanPageQuery('John')
  @ApiOkResponse({
    description: 'Paginated customer summaries.',
    type: YouCanPaginatedResponseDto<YouCanCustomerDto>,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiYouCanReadErrors()
  getCustomers(
    @CurrentUser() user: JwtPayload,
    @Query() query: YouCanDataPageQueryDto,
  ) {
    return this.dataService.listCustomers(user.userId, query);
  }
}
