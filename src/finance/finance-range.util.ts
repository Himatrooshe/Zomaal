import { BadRequestException } from '@nestjs/common';
import type { RevenueRangeQueryDto } from '../ecommerce/dto/revenue-query.dto';

export interface ResolvedRange {
  from: string | null;
  to: string | null;
  timezone: string;
  /** Inclusive lower bound as a UTC Date, or null for no lower bound. */
  fromDate: Date | null;
  /** Exclusive upper bound as a UTC Date, or null for no upper bound. */
  toDateExclusive: Date | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Same defaulting behavior as ecommerce.service.ts's defaultHomeRange +
 * validateRange (current calendar month when no from/to is given), kept
 * local to the finance module to avoid reaching into ecommerce internals.
 */
export function resolveRange(query: RevenueRangeQueryDto): ResolvedRange {
  const timezone = query.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone');
  }

  let from = query.from ?? null;
  let to = query.to ?? null;

  for (const [field, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value) {
      assertCalendarDate(value, field);
    }
  }

  if (!from && !to) {
    const now = new Date();
    to = dateInTimezone(now, timezone);
    from = `${to.slice(0, 7)}-01`;
  }

  if (from && to && from > to) {
    throw new BadRequestException('from must be on or before to');
  }

  return {
    from,
    to,
    timezone,
    fromDate: from ? new Date(`${from}T00:00:00Z`) : null,
    toDateExclusive: to
      ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000)
      : null,
  };
}

function assertCalendarDate(value: string, field: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} must be a valid calendar date`);
  }
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
