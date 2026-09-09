import { ProductComparisonPdfService } from './product-comparison-pdf.service';
import type { ProductComparisonResponseDto } from './dto/product-response.dto';

function baseComparison(): ProductComparisonResponseDto {
  return {
    period: {
      period: 'CUSTOM',
      from: '2026-08-10T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
    },
    currency: 'MAD',
    productA: {
      productId: 'product-a',
      name: 'Wireless Headphones',
      imageUrl: null,
      metrics: {
        totalOrders: 2,
        deliveryRate: 100,
        returnRate: 0,
        cancellationRate: 0,
        revenue: '749.9700',
        profit: '389.9700',
        avgOrderValue: '374.9850',
        cpo: '180.0000',
      },
    },
    productB: {
      productId: 'product-b',
      name: 'Bluetooth Speaker',
      imageUrl: null,
      metrics: {
        totalOrders: 1,
        deliveryRate: 0,
        returnRate: 0,
        cancellationRate: 0,
        revenue: '249.9900',
        profit: '129.9900',
        avgOrderValue: '249.9900',
        cpo: '120.0000',
      },
    },
    insight: {
      metric: 'revenue',
      winner: 'A',
      message:
        'Wireless Headphones has 200% better revenue than Bluetooth Speaker',
    },
    dataUpdatedAt: '2026-08-11T12:00:00.000Z',
  };
}

describe('ProductComparisonPdfService', () => {
  const service = new ProductComparisonPdfService();

  it('renders a valid single-page PDF document', async () => {
    const body = await service.render(baseComparison());

    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(500);
    expect(body.subarray(-6).toString()).toContain('%%EOF');
  });

  it('renders without throwing when there is no insight (nothing comparable)', async () => {
    const comparison = baseComparison();
    comparison.insight = null;

    const body = await service.render(comparison);

    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders without throwing when there are no orders yet (dataUpdatedAt null)', async () => {
    const comparison = baseComparison();
    comparison.dataUpdatedAt = null;
    comparison.productA.metrics.totalOrders = 0;
    comparison.productB.metrics.totalOrders = 0;
    comparison.insight = null;

    const body = await service.render(comparison);

    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders long product names without throwing', async () => {
    const comparison = baseComparison();
    comparison.productA.name =
      'An Extremely Long Product Name That Should Be Truncated Safely In The PDF Header';

    const body = await service.render(comparison);

    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
