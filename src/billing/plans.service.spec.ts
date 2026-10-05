import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlansService } from './plans.service';

const NOW = new Date('2026-10-05T12:00:00.000Z');

const PLAN = {
  id: 'plan-1',
  code: 'PRO',
  name: 'Pro',
  description: null,
  monthlyPrice: new Prisma.Decimal('20'),
  yearlyPrice: null,
  currency: 'MAD',
  taxIncluded: true,
  maxStores: null,
  features: ['ads', 'shop'],
  featureList: [],
  isActive: true,
  sortOrder: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function build() {
  const prisma = {
    plan: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  return { service: new PlansService(prisma as never), prisma };
}

describe('PlansService', () => {
  it('requires at least one price', async () => {
    const { service } = build();
    await expect(
      service.create({
        code: 'PRO',
        name: 'Pro',
        features: [],
        featureList: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores prices as Decimal and returns them with 2 decimals', async () => {
    const { service, prisma } = build();
    prisma.plan.create.mockImplementation(({ data }: { data: object }) => ({
      ...PLAN,
      ...data,
    }));
    const res = await service.create({
      code: 'PRO',
      name: ' Pro ',
      monthlyPrice: '20',
      currency: 'mad',
    });
    const data = (
      prisma.plan.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.monthlyPrice).toBeInstanceOf(Prisma.Decimal);
    expect(data.name).toBe('Pro');
    expect(data.currency).toBe('MAD');
    expect(res.monthlyPrice).toBe('20.00');
  });

  it('409 on duplicate code', async () => {
    const { service, prisma } = build();
    prisma.plan.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.create({ code: 'PRO', name: 'Pro', monthlyPrice: '20' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to clear the only price', async () => {
    const { service, prisma } = build();
    prisma.plan.findUnique.mockResolvedValue(PLAN);
    await expect(
      service.update('plan-1', { monthlyPrice: null } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 for an unknown plan', async () => {
    const { service, prisma } = build();
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(service.update('x', { name: 'A' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
