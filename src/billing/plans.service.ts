import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueConstraintError } from '../common/prisma-errors.util';
import { toPlanResponse } from './subscription.service';
import type {
  CreatePlanDto,
  PlanResponseDto,
  UpdatePlanDto,
} from './dto/billing.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin list includes inactive plans. */
  async listAll(): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map(toPlanResponse);
  }

  async create(dto: CreatePlanDto): Promise<PlanResponseDto> {
    assertSellable(dto.monthlyPrice, dto.yearlyPrice);
    try {
      const plan = await this.prisma.plan.create({
        data: {
          features: [],
          featureList: [],
          ...toData(dto),
        } as Prisma.PlanCreateInput,
      });
      return toPlanResponse(plan);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          `A plan with code ${dto.code} already exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Price changes apply to future payments only — existing subscriptions keep
   * the period they paid for, and invoices keep their own amount.
   */
  async update(id: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan not found');

    const monthly =
      dto.monthlyPrice !== undefined
        ? dto.monthlyPrice
        : existing.monthlyPrice?.toFixed(2);
    const yearly =
      dto.yearlyPrice !== undefined
        ? dto.yearlyPrice
        : existing.yearlyPrice?.toFixed(2);
    assertSellable(monthly, yearly);

    try {
      const plan = await this.prisma.plan.update({
        where: { id },
        data: toData(dto),
      });
      return toPlanResponse(plan);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          `A plan with code ${dto.code} already exists`,
        );
      }
      throw err;
    }
  }
}

function assertSellable(monthly?: string | null, yearly?: string | null): void {
  if (!monthly && !yearly) {
    throw new ConflictException(
      'A plan needs a monthly price, a yearly price, or both',
    );
  }
}

function toData(dto: UpdatePlanDto): Prisma.PlanUpdateInput {
  return {
    ...(dto.code !== undefined && { code: dto.code }),
    ...(dto.name !== undefined && { name: dto.name.trim() }),
    ...(dto.description !== undefined && {
      description: dto.description?.trim() || null,
    }),
    ...(dto.monthlyPrice !== undefined && {
      monthlyPrice:
        dto.monthlyPrice === null ? null : new Prisma.Decimal(dto.monthlyPrice),
    }),
    ...(dto.yearlyPrice !== undefined && {
      yearlyPrice:
        dto.yearlyPrice === null ? null : new Prisma.Decimal(dto.yearlyPrice),
    }),
    ...(dto.currency !== undefined && { currency: dto.currency.toUpperCase() }),
    ...(dto.taxIncluded !== undefined && { taxIncluded: dto.taxIncluded }),
    ...(dto.maxStores !== undefined && { maxStores: dto.maxStores }),
    ...(dto.features !== undefined && { features: dto.features }),
    ...(dto.featureList !== undefined && {
      featureList: dto.featureList.map((f) => f.trim()).filter(Boolean),
    }),
    ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
  };
}
