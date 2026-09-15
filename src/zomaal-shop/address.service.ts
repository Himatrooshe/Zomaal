import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AddressInput {
  label: string;
  fullName: string;
  phone: string;
  country: string;
  city: string;
  district?: string | null;
  address: string;
  isDefault?: boolean;
}

type AddressRow = Awaited<
  ReturnType<PrismaService['shopAddress']['findFirstOrThrow']>
>;

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string) {
    const rows = await this.prisma.shopAddress.findMany({
      where: { storeId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async require(storeId: string, id: string) {
    const row = await this.prisma.shopAddress.findFirst({
      where: { id, storeId },
    });
    if (!row) throw new NotFoundException('Address not found');
    return row;
  }

  async defaultFor(storeId: string) {
    return this.prisma.shopAddress.findFirst({
      where: { storeId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  // The first address is always the default; marking another as default
  // un-marks the rest, so there is exactly one default whenever any exist.
  async create(storeId: string, input: AddressInput) {
    const count = await this.prisma.shopAddress.count({ where: { storeId } });
    const makeDefault = count === 0 || input.isDefault === true;
    const row = await this.prisma.$transaction(async (tx) => {
      if (makeDefault)
        await tx.shopAddress.updateMany({
          where: { storeId },
          data: { isDefault: false },
        });
      return tx.shopAddress.create({
        data: {
          storeId,
          label: input.label.trim(),
          fullName: input.fullName.trim(),
          phone: input.phone.trim(),
          country: input.country.trim(),
          city: input.city.trim(),
          district: input.district?.trim() || null,
          address: input.address.trim(),
          isDefault: makeDefault,
        },
      });
    });
    return this.toResponse(row);
  }

  async update(storeId: string, id: string, input: Partial<AddressInput>) {
    await this.require(storeId, id);
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.shopAddress.updateMany({
          where: { storeId, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.shopAddress.update({
        where: { id },
        data: {
          ...this.clean(input),
          // Un-defaulting the only default isn't allowed; ignore isDefault:false.
          ...(input.isDefault === true ? { isDefault: true } : {}),
        },
      });
    });
    return this.toResponse(row);
  }

  async remove(storeId: string, id: string) {
    const row = await this.require(storeId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.shopAddress.delete({ where: { id } });
      if (row.isDefault) {
        const next = await tx.shopAddress.findFirst({
          where: { storeId },
          orderBy: { updatedAt: 'desc' },
        });
        if (next)
          await tx.shopAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
      }
    });
    return { message: 'Address deleted' };
  }

  toResponse(r: AddressRow) {
    return {
      id: r.id,
      label: r.label,
      fullName: r.fullName,
      phone: r.phone,
      country: r.country,
      city: r.city,
      district: r.district,
      address: r.address,
      isDefault: r.isDefault,
      formatted: [r.address, r.district, r.city, r.country]
        .filter(Boolean)
        .join(', '),
    };
  }

  private clean(input: Partial<AddressInput>) {
    const t = (v: string | null | undefined) =>
      typeof v === 'string' ? v.trim() : v;
    const out: Record<string, unknown> = {};
    for (const key of [
      'label',
      'fullName',
      'phone',
      'country',
      'city',
      'address',
    ] as const) {
      if (input[key] !== undefined) out[key] = t(input[key]);
    }
    if (input.district !== undefined) out.district = t(input.district) || null;
    return out;
  }
}
