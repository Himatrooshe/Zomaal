import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { BarcodeLabelService } from './barcode-label.service';
import { BarcodeService } from './barcode.service';
import {
  BarcodeLabelFormat,
  BarcodeLabelQueryDto,
  BarcodeLabelTemplate,
  BarcodeValidationResponseDto,
  BatchBarcodeLabelsDto,
  GeneratedBarcodeResponseDto,
  ResolveBarcodeQueryDto,
  ResolvedBarcodeResponseDto,
  ValidateBarcodeDto,
} from './dto/barcode.dto';

@ApiTags('Warehouse Barcodes')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard)
@Controller('warehouse/barcodes')
export class BarcodeController {
  constructor(
    private readonly barcodes: BarcodeService,
    private readonly labels: BarcodeLabelService,
  ) {}

  @Post('generate')
  @ApiOperation({
    summary: 'Generate an available internal Code 128 value',
    description:
      'Supports the design Generate Barcode button. Returns a store-available ZML-XXXXXXXXXXXX value. Product creation also generates one automatically for every variant whose barcode is omitted. This is a product/variant identifier, not a shipment tracking number.',
  })
  @ApiCreatedResponse({ type: GeneratedBarcodeResponseDto })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  @ApiBadRequestResponse({
    description:
      'A unique generated value could not be produced after retries.',
    type: ApiErrorDto,
  })
  generate(@CurrentUser() user: JwtPayload) {
    return this.barcodes.generate(user.userId);
  }

  @Post('validate')
  @ApiOperation({
    summary: 'Validate barcode syntax and store availability',
    description:
      'Use when a merchant enters or scans an existing manufacturer/supplier barcode. Validates EAN-13, UPC-A, and GTIN check digits, normalizes Zomaal internal values, infers type when omitted, and reports whether the current store already uses the value.',
  })
  @ApiCreatedResponse({ type: BarcodeValidationResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid characters, length, check digit, or internal ZML format.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  validate(@CurrentUser() user: JwtPayload, @Body() dto: ValidateBarcodeDto) {
    return this.barcodes.validateForUser(user.userId, dto.value, dto.type);
  }

  @Get('resolve')
  @ApiOperation({
    summary: 'Resolve a physical scanner value to store inventory',
    description:
      'A USB/Bluetooth scanner normally types the decoded value into the app. Send that exact value here to retrieve the authenticated store product variant or packaging material and aggregated inventory. Values from another merchant store intentionally return 404.',
  })
  @ApiOkResponse({ type: ResolvedBarcodeResponseDto })
  @ApiBadRequestResponse({
    description: 'The scanned value contains unsupported characters or length.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description:
      'The user has no store, or this store has no inventory barcode with that value.',
    type: ApiErrorDto,
  })
  resolve(
    @CurrentUser() user: JwtPayload,
    @Query() query: ResolveBarcodeQueryDto,
  ) {
    return this.barcodes.resolveForUser(user.userId, query.value);
  }

  @Get(':barcodeId/label')
  @ApiOperation({
    summary: 'Render one printable barcode sticker',
    description:
      'Renders the stored barcode on demand; images are not stored in the database. PDF pages use the exact selected physical dimensions and work with normal printer drivers. SVG is useful for preview. Print at 100% / Actual Size with browser scaling disabled.',
  })
  @ApiParam({ name: 'barcodeId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Binary PDF or UTF-8 SVG label, selected by the format query.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
      'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid query, unsupported stored value, or barcode too dense for reliable printing on the selected template.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Barcode does not belong to the authenticated store.',
    type: ApiErrorDto,
  })
  @ApiProduces('application/pdf', 'image/svg+xml')
  async label(
    @CurrentUser() user: JwtPayload,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
    @Query() query: BarcodeLabelQueryDto,
    @Res() response: Response,
  ) {
    const format = query.format ?? BarcodeLabelFormat.PDF;
    const template = query.template ?? BarcodeLabelTemplate.THERMAL_60X40;
    const rendered =
      format === BarcodeLabelFormat.SVG
        ? await this.labels.renderSvgForUser(user.userId, barcodeId, template)
        : await this.labels.renderPdfForUser(user.userId, barcodeId, template);
    sendLabel(
      response,
      rendered.body,
      rendered.filename,
      format === BarcodeLabelFormat.SVG
        ? 'image/svg+xml; charset=utf-8'
        : 'application/pdf',
      'inline',
    );
  }

  @Post('labels/batch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Render a multi-page barcode label PDF',
    description:
      'Creates one exact-size PDF page per sticker. Items retain request order and quantity repeats a label. Limited to 100 request rows, 100 copies per row, and 200 total pages to protect server memory and CPU.',
  })
  @ApiBody({ type: BatchBarcodeLabelsDto })
  @ApiOkResponse({
    description: 'Multi-page PDF ready for an operating-system printer driver.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, total label limit exceeded, or a barcode is too dense for the template.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description:
      'At least one barcode does not belong to the authenticated store.',
    type: ApiErrorDto,
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/pdf')
  async batchLabels(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BatchBarcodeLabelsDto,
    @Res() response: Response,
  ) {
    const rendered = await this.labels.renderBatchPdfForUser(
      user.userId,
      dto.items,
      dto.template ?? BarcodeLabelTemplate.THERMAL_60X40,
    );
    sendLabel(
      response,
      rendered.body,
      rendered.filename,
      'application/pdf',
      'attachment',
    );
  }
}

function sendLabel(
  response: Response,
  body: Buffer | string,
  filename: string,
  contentType: string,
  disposition: 'inline' | 'attachment',
) {
  response.set({
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.send(body);
}
