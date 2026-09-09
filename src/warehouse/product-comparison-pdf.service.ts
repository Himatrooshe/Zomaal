import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ProductComparisonResponseDto } from './dto/product-response.dto';

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const INK = '#111111';
const MUTED = '#555555';
const ACCENT = '#2F6FED';
const BORDER = '#E2E2E2';

const METRIC_ROWS: Array<{
  key: keyof ProductComparisonResponseDto['productA']['metrics'];
  label: string;
  format: 'number' | 'percent' | 'money';
}> = [
  { key: 'totalOrders', label: 'Total orders', format: 'number' },
  { key: 'deliveryRate', label: 'Delivery rate', format: 'percent' },
  { key: 'returnRate', label: 'Return rate', format: 'percent' },
  { key: 'cancellationRate', label: 'Cancellation rate', format: 'percent' },
  { key: 'revenue', label: 'Revenue', format: 'money' },
  { key: 'profit', label: 'Profit', format: 'money' },
  { key: 'avgOrderValue', label: 'Avg. order value', format: 'money' },
  { key: 'cpo', label: 'Cost per order', format: 'money' },
];

/**
 * Renders the "Export Comparison" PDF for the Compare Products screen.
 * Deliberately its own small service (not folded into ProductService)
 * so the comparison math and the PDF rendering stay independently
 * testable, mirroring how BarcodeLabelService is kept separate from
 * ProductService even though both live under the warehouse module.
 */
@Injectable()
export class ProductComparisonPdfService {
  render(comparison: ProductComparisonResponseDto): Promise<Buffer> {
    const document = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      compress: true,
      info: { Title: 'Zomaal product comparison', Creator: 'Zomaal' },
    });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));

      this.drawHeader(document, comparison);
      this.drawTable(document, comparison);
      this.drawInsight(document, comparison);
      this.drawFooter(document, comparison);

      document.end();
    });
  }

  private drawHeader(
    document: PDFKit.PDFDocument,
    comparison: ProductComparisonResponseDto,
  ) {
    document
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(INK)
      .text('Product Comparison', MARGIN, MARGIN);
    document
      .font('Helvetica')
      .fontSize(10)
      .fillColor(MUTED)
      .text(
        `${formatDate(comparison.period.from)} – ${formatDate(comparison.period.to)}  ·  ${comparison.currency}`,
        MARGIN,
        MARGIN + 24,
      );

    const columnWidth = (PAGE_WIDTH - MARGIN * 2 - 20) / 2;
    const namesTop = MARGIN + 48;
    document
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(INK)
      .text(truncate(comparison.productA.name, 40), MARGIN, namesTop, {
        width: columnWidth,
      })
      .text(
        truncate(comparison.productB.name, 40),
        MARGIN + columnWidth + 20,
        namesTop,
        { width: columnWidth },
      );

    document
      .moveTo(MARGIN, namesTop + 26)
      .lineTo(PAGE_WIDTH - MARGIN, namesTop + 26)
      .strokeColor(BORDER)
      .lineWidth(1)
      .stroke();
  }

  private drawTable(
    document: PDFKit.PDFDocument,
    comparison: ProductComparisonResponseDto,
  ) {
    const labelWidth = 160;
    const columnWidth = (PAGE_WIDTH - MARGIN * 2 - labelWidth) / 2;
    const colA = MARGIN + labelWidth;
    const colB = colA + columnWidth;
    let y = MARGIN + 90;
    const rowHeight = 24;

    for (const [index, row] of METRIC_ROWS.entries()) {
      if (index % 2 === 0) {
        document
          .rect(MARGIN, y - 4, PAGE_WIDTH - MARGIN * 2, rowHeight)
          .fillColor('#F7F8FA')
          .fill();
      }
      const valueA = formatMetric(
        comparison.productA.metrics[row.key],
        row.format,
      );
      const valueB = formatMetric(
        comparison.productB.metrics[row.key],
        row.format,
      );
      const winnerMetric = comparison.insight?.metric === row.key;

      document
        .font('Helvetica')
        .fontSize(10)
        .fillColor(MUTED)
        .text(row.label, MARGIN, y, { width: labelWidth - 8 });
      document
        .font(
          winnerMetric && comparison.insight?.winner === 'A'
            ? 'Helvetica-Bold'
            : 'Helvetica',
        )
        .fillColor(
          winnerMetric && comparison.insight?.winner === 'A' ? ACCENT : INK,
        )
        .text(valueA, colA, y, { width: columnWidth - 12 });
      document
        .font(
          winnerMetric && comparison.insight?.winner === 'B'
            ? 'Helvetica-Bold'
            : 'Helvetica',
        )
        .fillColor(
          winnerMetric && comparison.insight?.winner === 'B' ? ACCENT : INK,
        )
        .text(valueB, colB, y, { width: columnWidth - 12 });

      y += rowHeight;
    }

    document
      .moveTo(MARGIN, y + 4)
      .lineTo(PAGE_WIDTH - MARGIN, y + 4)
      .strokeColor(BORDER)
      .lineWidth(1)
      .stroke();
  }

  private drawInsight(
    document: PDFKit.PDFDocument,
    comparison: ProductComparisonResponseDto,
  ) {
    if (!comparison.insight) return;
    const top = MARGIN + 90 + METRIC_ROWS.length * 24 + 24;
    const boxHeight = 46;

    document
      .roundedRect(MARGIN, top, PAGE_WIDTH - MARGIN * 2, boxHeight, 6)
      .fillColor('#EAF1FF')
      .fill();
    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(ACCENT)
      .text('INSIGHT', MARGIN + 14, top + 10);
    document
      .font('Helvetica')
      .fontSize(10)
      .fillColor(INK)
      .text(comparison.insight.message, MARGIN + 14, top + 24, {
        width: PAGE_WIDTH - MARGIN * 2 - 28,
      });
  }

  private drawFooter(
    document: PDFKit.PDFDocument,
    comparison: ProductComparisonResponseDto,
  ) {
    const text = comparison.dataUpdatedAt
      ? `Data as of ${formatDateTime(comparison.dataUpdatedAt)}`
      : 'No orders in this period yet';
    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(text, MARGIN, PAGE_HEIGHT - MARGIN - 12, {
        width: PAGE_WIDTH - MARGIN * 2,
      });
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMetric(
  value: number | string,
  format: 'number' | 'percent' | 'money',
): string {
  if (format === 'number') return String(value);
  if (format === 'percent') return `${value}%`;
  return Number(value).toFixed(2);
}
