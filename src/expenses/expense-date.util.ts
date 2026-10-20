import { BadRequestException } from '@nestjs/common';
import { dateInZone } from '../common/calendar-date.util';
export {
  IsCalendarDate as IsExpenseDate,
  strictInteger,
  trimText as trimExpenseText,
  monthInZone,
  dateInZone,
} from '../common/calendar-date.util';

export function expenseInstant(value: string, timezone = 'UTC'): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dateInZone(value, timezone)
    : new Date(value);
}

export interface ExpenseRangeQuery {
  dateFrom?: string;
  dateTo?: string;
  timezone?: string;
}
export function expenseRange(query: ExpenseRangeQuery) {
  const timezone = query.timezone ?? 'UTC';
  const dayOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = query.dateFrom
    ? dayOnly(query.dateFrom)
      ? dateInZone(query.dateFrom, timezone)
      : new Date(query.dateFrom)
    : undefined;
  let to: Date | undefined;
  const inclusiveTo = !!query.dateTo && !dayOnly(query.dateTo);
  if (query.dateTo) {
    if (inclusiveTo) to = new Date(query.dateTo);
    else {
      const next = new Date(`${query.dateTo}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      to = dateInZone(next.toISOString().split('T')[0], timezone);
    }
  }
  if (from && to && (inclusiveTo ? from > to : from >= to))
    throw new BadRequestException('dateFrom must be before or equal to dateTo');
  return { from, to, inclusiveTo };
}
export function expenseDateWhere(query: ExpenseRangeQuery) {
  const { from, to, inclusiveTo } = expenseRange(query);
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? (inclusiveTo ? { lte: to } : { lt: to }) : {}),
  };
}
