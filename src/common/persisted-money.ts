import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Decimal(20,4) has 16 integer digits. Leave a representable JSON-number
// boundary below 10^16; Decimal checks also protect computed allocation totals.
export const MAX_MONEY_INPUT = 9_999_999_999_999_998;
const MONEY_LIMIT = new Prisma.Decimal('10000000000000000');
export function assertPersistedMoney(
  value: Prisma.Decimal,
  field: string,
): void {
  if (!value.isFinite() || value.lt(0) || value.gte(MONEY_LIMIT)) {
    throw new BadRequestException(
      `${field} exceeds the supported monetary range`,
    );
  }
}
