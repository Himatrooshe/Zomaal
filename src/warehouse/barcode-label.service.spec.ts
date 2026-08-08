import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryBarcodeType } from '@prisma/client';
import { BarcodeLabelService } from './barcode-label.service';
import { BarcodeLabelTemplate } from './dto/barcode.dto';

describe('BarcodeLabelService', () => {
  const findMany = jest.fn();
  const requireStore = jest.fn().mockResolvedValue({ id: 'store-1' });
  const service = new BarcodeLabelService(
    { inventoryBarcode: { findMany } } as never,
    { requireStore } as never,
  );
  const barcodeId = '9e124ffc-b2eb-4f82-b835-a22bc36fe5c8';

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([
      {
        id: barcodeId,
        value: 'ZML-A1B2C3D4E5F6',
        type: InventoryBarcodeType.INTERNAL_CODE_128,
        inventoryItem: {
          variant: {
            title: 'Black / XL',
            sku: 'HEADPHONE-BLACK-XL',
            product: { name: 'Wireless Headphones' },
          },
          packagingMaterial: null,
        },
      },
    ]);
  });

  it('renders an exact-size SVG preview without storing a generated image', async () => {
    const result = await service.renderSvgForUser(
      'user-1',
      barcodeId,
      BarcodeLabelTemplate.THERMAL_60X40,
    );

    expect(result.body).toContain('width="60mm" height="40mm"');
    expect(result.body).toContain('Wireless Headphones');
    expect(result.body).toContain('<path');
    expect(result.filename).toBe(`barcode-label-${barcodeId}.svg`);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [barcodeId] }, storeId: 'store-1' },
      }),
    );
  });

  it('renders a printer-neutral PDF', async () => {
    const result = await service.renderPdfForUser('user-1', barcodeId);

    expect(result.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.body.length).toBeGreaterThan(1_000);
  });

  it('rejects a generated Code 128 value on a label too narrow for reliable printing', async () => {
    await expect(
      service.renderPdfForUser(
        'user-1',
        barcodeId,
        BarcodeLabelTemplate.THERMAL_50X30,
      ),
    ).rejects.toThrow('THERMAL_60X40');
  });

  it('renders requested batch copies while loading each barcode once', async () => {
    const result = await service.renderBatchPdfForUser('user-1', [
      { barcodeId, quantity: 2 },
      { barcodeId, quantity: 1 },
    ]);

    expect(result.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [barcodeId] }, storeId: 'store-1' },
      }),
    );
  });

  it('rejects oversized batches before querying the database', async () => {
    await expect(
      service.renderBatchPdfForUser('user-1', [
        { barcodeId, quantity: 100 },
        {
          barcodeId: '38baa634-e5b4-43fe-aef9-cd7c4c847fee',
          quantity: 100,
        },
        {
          barcodeId: '5e7f8e94-324d-47f0-98e6-6fdcf6c905df',
          quantity: 1,
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requireStore).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns not found instead of leaking another store barcode', async () => {
    findMany.mockResolvedValue([]);
    await expect(
      service.renderPdfForUser('user-1', barcodeId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
