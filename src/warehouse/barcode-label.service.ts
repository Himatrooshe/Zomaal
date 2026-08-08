import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryBarcodeType } from '@prisma/client';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import {
  BarcodeLabelTemplate,
  BatchBarcodeLabelItemDto,
} from './dto/barcode.dto';
import { WarehouseStoreService } from './warehouse-store.service';

const MAX_BATCH_LABELS = 200;
const MILLIMETRES_TO_POINTS = 72 / 25.4;
const BASE_RENDER_SCALE = 3;
const REFERENCE_PRINTER_DPI = 203;
const MINIMUM_MODULE_DOTS = 2;

const LABEL_TEMPLATES: Record<
  BarcodeLabelTemplate,
  { widthMm: number; heightMm: number; titleFontSize: number }
> = {
  [BarcodeLabelTemplate.THERMAL_50X30]: {
    widthMm: 50,
    heightMm: 30,
    titleFontSize: 7,
  },
  [BarcodeLabelTemplate.THERMAL_60X40]: {
    widthMm: 60,
    heightMm: 40,
    titleFontSize: 8,
  },
  [BarcodeLabelTemplate.THERMAL_100X50]: {
    widthMm: 100,
    heightMm: 50,
    titleFontSize: 10,
  },
};

interface BarcodeLabelData {
  id: string;
  value: string;
  type: InventoryBarcodeType;
  title: string;
  subtitle: string | null;
}

interface RenderedLabel {
  data: BarcodeLabelData;
  barcodePng: Buffer;
}

@Injectable()
export class BarcodeLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
  ) {}

  async renderPdfForUser(
    userId: string,
    barcodeId: string,
    templateName = BarcodeLabelTemplate.THERMAL_60X40,
  ) {
    const [label] = await this.loadLabelsForUser(userId, [barcodeId]);
    const rendered = await this.prepareLabel(label, templateName);
    const pdf = await this.createPdf([rendered], templateName);
    return { body: pdf, filename: `barcode-label-${barcodeId}.pdf` };
  }

  async renderSvgForUser(
    userId: string,
    barcodeId: string,
    templateName = BarcodeLabelTemplate.THERMAL_60X40,
  ) {
    const [label] = await this.loadLabelsForUser(userId, [barcodeId]);
    await this.prepareLabel(label, templateName);
    const body = this.createSvg(label, templateName);
    return { body, filename: `barcode-label-${barcodeId}.svg` };
  }

  async renderBatchPdfForUser(
    userId: string,
    items: BatchBarcodeLabelItemDto[],
    templateName = BarcodeLabelTemplate.THERMAL_60X40,
  ) {
    if (
      items.length < 1 ||
      items.length > 100 ||
      items.some(
        (item) =>
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 100,
      )
    ) {
      throw new BadRequestException(
        'A batch requires 1 to 100 rows and each quantity must be from 1 to 100',
      );
    }
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    if (total > MAX_BATCH_LABELS) {
      throw new BadRequestException(
        `A batch may contain at most ${MAX_BATCH_LABELS} labels`,
      );
    }

    const ids = [...new Set(items.map((item) => item.barcodeId))];
    const labels = await this.loadLabelsForUser(userId, ids);
    const renderedById = new Map<string, RenderedLabel>();
    for (const label of labels) {
      renderedById.set(label.id, await this.prepareLabel(label, templateName));
    }

    const pages = items.flatMap((item) => {
      const rendered = renderedById.get(item.barcodeId);
      if (!rendered) {
        throw new NotFoundException(
          `Barcode ${item.barcodeId} was not found in this store`,
        );
      }
      return Array.from({ length: item.quantity }, () => rendered);
    });
    const body = await this.createPdf(pages, templateName);
    return { body, filename: `barcode-labels-${Date.now()}.pdf` };
  }

  private async loadLabelsForUser(userId: string, barcodeIds: string[]) {
    const store = await this.stores.requireStore(userId);
    const barcodes = await this.prisma.inventoryBarcode.findMany({
      where: { id: { in: barcodeIds }, storeId: store.id },
      select: {
        id: true,
        value: true,
        type: true,
        inventoryItem: {
          select: {
            variant: {
              select: {
                title: true,
                sku: true,
                product: { select: { name: true } },
              },
            },
            packagingMaterial: {
              select: { name: true, sku: true },
            },
          },
        },
      },
    });
    if (barcodes.length !== barcodeIds.length) {
      const found = new Set(barcodes.map((barcode) => barcode.id));
      const missingId = barcodeIds.find((id) => !found.has(id));
      throw new NotFoundException(
        `Barcode ${missingId ?? ''} was not found in this store`.trim(),
      );
    }

    const byId = new Map(
      barcodes.map((barcode) => {
        const variant = barcode.inventoryItem.variant;
        const packaging = barcode.inventoryItem.packagingMaterial;
        return [
          barcode.id,
          {
            id: barcode.id,
            value: barcode.value,
            type: barcode.type,
            title:
              variant?.product.name ?? packaging?.name ?? 'Zomaal Inventory',
            subtitle: variant?.sku ?? variant?.title ?? packaging?.sku ?? null,
          } satisfies BarcodeLabelData,
        ];
      }),
    );
    return barcodeIds.map((id) => byId.get(id)!);
  }

  private async prepareLabel(
    data: BarcodeLabelData,
    templateName: BarcodeLabelTemplate,
  ): Promise<RenderedLabel> {
    const template = requireTemplate(templateName);
    const options = barcodeRenderOptions(data, template.heightMm);
    let barcodePng: Buffer;
    try {
      barcodePng = await bwipjs.toBuffer(options);
    } catch {
      throw new BadRequestException(
        'This barcode value cannot be rendered as its configured barcode type',
      );
    }
    ensureBarcodeDensity(barcodePng, template.widthMm, templateName);
    return { data, barcodePng };
  }

  private createSvg(
    data: BarcodeLabelData,
    templateName: BarcodeLabelTemplate,
  ): string {
    const template = requireTemplate(templateName);
    let barcodeSvg: string;
    try {
      barcodeSvg = bwipjs.toSVG(barcodeRenderOptions(data, template.heightMm));
    } catch {
      throw new BadRequestException(
        'This barcode value cannot be rendered as its configured barcode type',
      );
    }
    const topMm = template.heightMm <= 30 ? 6 : 9;
    const bottomMm = 2;
    const nested = barcodeSvg.replace(
      '<svg ',
      `<svg x="2" y="${topMm}" width="${template.widthMm - 4}" height="${template.heightMm - topMm - bottomMm}" preserveAspectRatio="xMidYMid meet" `,
    );
    const title = escapeXml(
      truncate(data.title, template.widthMm <= 50 ? 34 : 70),
    );
    const subtitle = data.subtitle
      ? escapeXml(truncate(data.subtitle, template.widthMm <= 50 ? 38 : 80))
      : '';
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${template.widthMm}mm" height="${template.heightMm}mm" viewBox="0 0 ${template.widthMm} ${template.heightMm}">`,
      '<rect width="100%" height="100%" fill="#fff"/>',
      `<text x="2" y="3.5" font-family="Arial, sans-serif" font-size="2.8" font-weight="600">${title}</text>`,
      subtitle
        ? `<text x="2" y="5.7" font-family="Arial, sans-serif" font-size="1.8" fill="#333">${subtitle}</text>`
        : '',
      nested,
      '</svg>',
    ].join('');
  }

  private createPdf(
    labels: RenderedLabel[],
    templateName: BarcodeLabelTemplate,
  ): Promise<Buffer> {
    const template = requireTemplate(templateName);
    const width = toPoints(template.widthMm);
    const height = toPoints(template.heightMm);
    const margin = toPoints(2);
    const barcodeTop = toPoints(template.heightMm <= 30 ? 6 : 9);
    const document = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      compress: true,
      info: { Title: 'Zomaal barcode labels', Creator: 'Zomaal' },
    });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));
      for (const label of labels) {
        document.addPage({ size: [width, height], margin: 0 });
        document
          .font('Helvetica-Bold')
          .fontSize(template.titleFontSize)
          .fillColor('#111111')
          .text(toPdfSafeText(label.data.title), margin, toPoints(1.5), {
            width: width - margin * 2,
            height: toPoints(3.5),
            ellipsis: true,
            lineBreak: false,
          });
        if (label.data.subtitle) {
          document
            .font('Helvetica')
            .fontSize(Math.max(6, template.titleFontSize - 2))
            .fillColor('#333333')
            .text(toPdfSafeText(label.data.subtitle), margin, toPoints(4), {
              width: width - margin * 2,
              height: toPoints(3),
              ellipsis: true,
              lineBreak: false,
            });
        }
        document.image(label.barcodePng, margin, barcodeTop, {
          fit: [width - margin * 2, height - barcodeTop - toPoints(1.5)],
          align: 'center',
          valign: 'center',
        });
      }
      document.end();
    });
  }
}

function requireTemplate(templateName: BarcodeLabelTemplate) {
  const template = LABEL_TEMPLATES[templateName];
  if (!template) {
    throw new BadRequestException('Unsupported barcode label template');
  }
  return template;
}

function barcodeRenderOptions(data: BarcodeLabelData, labelHeightMm: number) {
  return {
    bcid: barcodeEncoder(data.type, data.value),
    text: data.value,
    scale: BASE_RENDER_SCALE,
    height: labelHeightMm <= 30 ? 12 : 22,
    includetext: true,
    textxalign: 'center' as const,
    textsize: labelHeightMm <= 30 ? 8 : 10,
    paddingwidth: 3,
    paddingheight: 2,
    backgroundcolor: 'FFFFFF',
  };
}

function barcodeEncoder(type: InventoryBarcodeType, value: string): string {
  switch (type) {
    case InventoryBarcodeType.EAN_13:
      return 'ean13';
    case InventoryBarcodeType.UPC_A:
      return 'upca';
    case InventoryBarcodeType.GTIN:
      if (value.length === 8) return 'ean8';
      if (value.length === 12) return 'upca';
      if (value.length === 13) return 'ean13';
      if (value.length === 14) return 'itf14';
      throw new BadRequestException('Stored GTIN has an unsupported length');
    case InventoryBarcodeType.INTERNAL_CODE_128:
    case InventoryBarcodeType.OTHER:
      return 'code128';
  }
}

function ensureBarcodeDensity(
  png: Buffer,
  labelWidthMm: number,
  templateName: BarcodeLabelTemplate,
) {
  if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') {
    throw new BadRequestException('Barcode renderer returned an invalid image');
  }
  const imageWidthPixels = png.readUInt32BE(16);
  const usablePrinterDots = ((labelWidthMm - 4) * REFERENCE_PRINTER_DPI) / 25.4;
  const estimatedModuleDots =
    (usablePrinterDots * BASE_RENDER_SCALE) / imageWidthPixels;
  if (estimatedModuleDots < MINIMUM_MODULE_DOTS) {
    const suggestion =
      templateName === BarcodeLabelTemplate.THERMAL_50X30
        ? ' Use THERMAL_60X40 or THERMAL_100X50 for this value.'
        : '';
    throw new BadRequestException(
      `Barcode is too dense for reliable 203 DPI printing on this template.${suggestion}`,
    );
  }
}

function toPoints(millimetres: number): number {
  return millimetres * MILLIMETRES_TO_POINTS;
}

function toPdfSafeText(value: string): string {
  const ascii = value.replace(/[^\x20-\x7E]/g, '').trim();
  return ascii || 'Zomaal Inventory';
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
}
