import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ReturnRequestService } from './return-request.service';
import {
  DetectReturnDto,
  DetectedReturnResponseDto,
  ReturnListQueryDto,
  ReturnListResponseDto,
  VerifyReturnDto,
  VerifiedReturnResponseDto,
} from './dto/return-request.dto';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description: 'Return data is private to the authenticated store and must not be cached.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

@ApiTags('E-commerce Returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('ecommerce/returns')
export class ReturnRequestController {
  constructor(private readonly returns: ReturnRequestService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List return requests (Returns screen)',
    description:
      'Backs the summary cards (Total Returns / Pending Verification / Total Order Confirm) ' +
      'and the tabbed, searchable list. DELAYED is a NEED_VERIFICATION request older than 2 ' +
      'days — computed on read, not a stored status.',
  })
  @ApiOkResponse({ type: ReturnListResponseDto, headers: PRIVATE_NO_STORE_HEADERS })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReturnListQueryDto,
  ): Promise<ReturnListResponseDto> {
    return this.returns.list(user.userId, query);
  }

  @Get('search')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Search orders for Manual Verification',
    description:
      'Order ID/name matches every platform. Phone/customer-name matches ONLY manually ' +
      'created orders — Shopify/YouCan/Lightfunnels orders intentionally omit customer PII ' +
      'at rest (see EcommerceOrder in schema.prisma), so there is nothing to search there ' +
      'without a live per-candidate platform call, which this endpoint does not do.',
  })
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiOkResponse({ description: 'Up to 20 matching orders.' })
  search(@CurrentUser() user: JwtPayload, @Query('q') q: string) {
    return this.returns.search(user.userId, q);
  }

  @Post('detect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a scan/manual code to a return (Scan + Return Detected screens)',
    description:
      'Resolves value the same way GET /ecommerce/scan does (Zomaal QR, courier tracking ' +
      'number — covers both our own couriers and 3rd-party carriers — or a typed order ' +
      'ID/name), then finds or creates the open ReturnRequest for that order, covering ' +
      'every line on it. lossSummary is a live preview based on whatever condition is ' +
      'already recorded — recompute by calling this again after partial verification.',
  })
  @ApiOkResponse({ type: DetectedReturnResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid payload.', type: ApiErrorDto })
  @ApiNotFoundResponse({ description: 'No order matches this code.', type: ApiErrorDto })
  detect(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DetectReturnDto,
  ): Promise<DetectedReturnResponseDto> {
    return this.returns.detect(user.userId, dto);
  }

  @Post(':returnRequestId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record conditions and confirm a return (Return Detected screen "Confirm")',
    description:
      'Records each line\'s condition via the same engine as POST /orders/:orderId/' +
      'condition — the matching inventory movement and, for DAMAGED, financial event ' +
      'apply in the same call. Once every line on the request has a recorded condition, ' +
      'status advances to PROCESSED automatically.',
  })
  @ApiParam({ name: 'returnRequestId', format: 'uuid' })
  @ApiOkResponse({ type: VerifiedReturnResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid payload, or a line does not belong to this return request.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({ description: 'Return request not found.', type: ApiErrorDto })
  verify(
    @CurrentUser() user: JwtPayload,
    @Param('returnRequestId', new ParseUUIDPipe()) returnRequestId: string,
    @Body() dto: VerifyReturnDto,
  ): Promise<VerifiedReturnResponseDto> {
    return this.returns.verify(user.userId, returnRequestId, dto);
  }
}
