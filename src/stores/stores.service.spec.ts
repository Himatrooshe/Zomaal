import { ConflictException } from '@nestjs/common';
import { StoresService } from './stores.service';

const row = {
  id: 'store',
  ownerName: 'QA',
  ownerPhotoUrl: null,
  businessName: 'QA',
  address: 'QA',
  city: 'QA',
  country: 'Morocco',
  logoUrl: null,
  isActive: true,
  baseCurrency: 'MAD',
  userId: 'owner',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};
function build() {
  const prisma = {
    store: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
    },
  };
  const access = {
    requireOwner: jest.fn().mockResolvedValue({ storeId: 'store' }),
  };
  return {
    prisma,
    service: new StoresService(prisma as never, access as never, {} as never),
  };
}
describe('Store accounting currency', () => {
  it('rejects changing currency before any other settings can persist', async () => {
    const { prisma, service } = build();
    await expect(
      service.update('owner', { baseCurrency: 'USD', businessName: 'Changed' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });
  it('accepts replaying the existing currency without writing the currency field', async () => {
    const { prisma, service } = build();
    await expect(
      service.update('owner', { baseCurrency: 'mad', businessName: 'QA' }),
    ).resolves.toMatchObject({ baseCurrency: 'MAD' });
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'store' },
      data: { businessName: 'QA' },
    });
  });
  it('keeps ordinary settings edits independent of currency checks', async () => {
    const { prisma, service } = build();
    await service.update('owner', { city: 'QA' });
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'store' },
      data: { city: 'QA' },
    });
  });
});
