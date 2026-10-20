import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockShopStore } from './shop-lock.util';
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

  async require(
    storeId: string,
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.shopAddress.findFirst({
      where: { id, storeId },
    });
    if (!row) throw new NotFoundException('Address not found');
    return row;
  }

  async defaultFor(
    storeId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    return db.shopAddress.findFirst({
      where: { storeId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  // The first address is always the default; marking another as default
  // un-marks the rest, so there is exactly one default whenever any exist.
  async create(storeId: string, input: AddressInput) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockShopStore(tx, storeId);
      const count = await tx.shopAddress.count({ where: { storeId } });
      const makeDefault = count === 0 || input.isDefault === true;
      const created = await tx.shopAddress.create({
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
      await this.normalizeDefault(
        tx,
        storeId,
        makeDefault ? created.id : undefined,
      );
      return tx.shopAddress.findUniqueOrThrow({ where: { id: created.id } });
    });
    return this.toResponse(row);
  }

  async update(storeId: string, id: string, input: Partial<AddressInput>) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockShopStore(tx, storeId);
      await this.require(storeId, id, tx);
      if (input.isDefault === true) {
        await tx.shopAddress.updateMany({
          where: { storeId, id: { not: id } },
          data: { isDefault: false },
        });
      }
      await tx.shopAddress.update({
        where: { id },
        data: {
          ...this.clean(input),
          // Un-defaulting the only default isn't allowed; ignore isDefault:false.
          ...(input.isDefault === true ? { isDefault: true } : {}),
        },
      });
      await this.normalizeDefault(
        tx,
        storeId,
        input.isDefault === true ? id : undefined,
      );
      return tx.shopAddress.findUniqueOrThrow({ where: { id } });
    });
    return this.toResponse(row);
  }

  async remove(storeId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockShopStore(tx, storeId);
      await this.require(storeId, id, tx);
      await tx.shopAddress.delete({ where: { id } });
      await this.normalizeDefault(tx, storeId);
    });
    return { message: 'Address deleted' };
  }

  private async normalizeDefault(
    tx: Prisma.TransactionClient,
    storeId: string,
    preferred?: string,
  ) {
    const next = preferred
      ? { id: preferred }
      : await tx.shopAddress.findFirst({
          where: { storeId },
          orderBy: [
            { isDefault: 'desc' },
            { updatedAt: 'desc' },
            { id: 'asc' },
          ],
        });
    if (!next) return;
    await tx.shopAddress.updateMany({
      where: { storeId, id: { not: next.id } },
      data: { isDefault: false },
    });
    await tx.shopAddress.update({
      where: { id: next.id },
      data: { isDefault: true },
    });
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
