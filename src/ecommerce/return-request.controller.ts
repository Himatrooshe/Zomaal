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
  ApiConflictResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentStoreAccess } from '../access/current-store-access.decorator';
import type { StoreAccess } from '../access/store-access.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { PERMISSIONS } from '../access/permissions';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ReturnRequestService } from './return-request.service';
import {
  DetectReturnDto,
  DetectedReturnResponseDto,
  ReturnListQueryDto,
  ReturnListResponseDto,
  ReturnSearchQueryDto,
  VerifyReturnDto,
  VerifiedReturnResponseDto,
} from './dto/return-request.dto';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description:
      'Return data is private to the authenticated store and must not be cached.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

@ApiTags('E-commerce Returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({
  description: "You don't have permission to access Returns.",
  type: ApiErrorDto,
})
@Controller('ecommerce/returns')
export class ReturnRequestController {
  constructor(private readonly returns: ReturnRequestService) {}

  @Get()
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List return requests (Returns screen)',
    description:
      'Backs the summary cards (Total Returns / Pending Verification / Total Order Confirm) ' +
      'and the tabbed, searchable list. DELAYED is a NEED_VERIFICATION request older than 2 ' +
      'days — computed on read, not a stored status.',
  })
  @ApiOkResponse({
    type: ReturnListResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReturnListQueryDto,
    @CurrentStoreAccess() access: StoreAccess,
  ): Promise<ReturnListResponseDto> {
    return this.returns.list(user.userId, query, access);
  }

  @Get('search')
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Search orders for Manual Verification',
    description:
      'Matches order identifiers and names, manual customer fields, and linked customer ' +
      'names/phones captured during platform sync. Results are scoped to the active store. ' +
      'Legacy orders without saved customer details match only order identifiers/names.',
  })
  @ApiOkResponse({ description: 'Up to 20 matching orders.' })
  @ApiBadRequestResponse({
    description: 'Search term is missing, blank, or not a string.',
    type: ApiErrorDto,
  })
  search(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReturnSearchQueryDto,
    @CurrentStoreAccess() access: StoreAccess,
  ) {
    return this.returns.search(user.userId, query.q, access);
  }

  @Post('detect')
  @RequirePermission(PERMISSIONS.RETURNS_SCAN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resolve a scan/manual code to a return (Scan + Return Detected screens)',
    description:
      'Resolves value the same way GET /ecommerce/scan does (Zomaal QR, courier tracking ' +
      'number — covers both our own couriers and 3rd-party carriers — or a typed order ' +
      'ID/name), then finds or creates the open ReturnRequest for that order, covering ' +
      'every line on it. lossSummary is a live preview based on whatever condition is ' +
      'already recorded — read saved allocations via GET /ecommerce/returns/:returnRequestId after verification.',
  })
  @ApiConflictResponse({
    description:
      'Tracking/reference matches multiple orders; select an order explicitly',
    type: ApiErrorDto,
  })
  @ApiOkResponse({ type: DetectedReturnResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid payload.', type: ApiErrorDto })
  @ApiNotFoundResponse({
    description: 'No order matches this code.',
    type: ApiErrorDto,
  })
  detect(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DetectReturnDto,
    @CurrentStoreAccess() access: StoreAccess,
  ): Promise<DetectedReturnResponseDto> {
    return this.returns.detect(user.userId, dto, access);
  }

  @Post(':returnRequestId/verify')
  @RequirePermission(PERMISSIONS.RETURNS_PROCESS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record conditions and confirm a return (Return Detected screen "Confirm")',
    description:
      "Records each line's condition via the same engine as POST /orders/:orderId/" +
      'condition — the matching inventory movements and condition-loss ledger changes ' +
      'apply in the same call. Once every line on the request has a recorded condition, ' +
      'status advances to PROCESSED automatically. Quantity/component rows replace all saved allocations for each included line; omit quantity for a whole-line condition.',
  })
  @ApiParam({ name: 'returnRequestId', format: 'uuid' })
  @ApiOkResponse({ type: VerifiedReturnResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or a line does not belong to this return request.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Return request not found.',
    type: ApiErrorDto,
  })
  verify(
    @CurrentUser() user: JwtPayload,
    @Param('returnRequestId', new ParseUUIDPipe()) returnRequestId: string,
    @Body() dto: VerifyReturnDto,
    @CurrentStoreAccess() access: StoreAccess,
  ): Promise<VerifiedReturnResponseDto> {
    return this.returns.verify(user.userId, returnRequestId, dto, access);
  }
  @Get(':returnRequestId')
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read a saved return with its component/quantity conditions',
    description:
      'Reads open or processed returns without creating another return request.',
  })
  @ApiParam({ name: 'returnRequestId', format: 'uuid' })
  @ApiOkResponse({ type: DetectedReturnResponseDto })
  @ApiNotFoundResponse({
    description: 'Store-owned return not found',
    type: ApiErrorDto,
  })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('returnRequestId', new ParseUUIDPipe()) id: string,
    @CurrentStoreAccess() access: StoreAccess,
  ) {
    return this.returns.get(user.userId, id, access);
  }
}
