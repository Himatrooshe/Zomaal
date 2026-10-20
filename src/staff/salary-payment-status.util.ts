import { calendarDay } from '../common/calendar-date.util';
import { SalaryPaymentStatus } from '@prisma/client';

/** UI filter / display values — OVERDUE is never stored. */
export const SALARY_PAYMENT_DISPLAY_STATUSES = [
  'PAID',
  'PENDING',
  'OVERDUE',
] as const;

export type SalaryPaymentDisplayStatus =
  (typeof SALARY_PAYMENT_DISPLAY_STATUSES)[number];

/**
 * OVERDUE = PENDING with paymentDate in the past (same pattern as ReturnRequest DELAYED).
 */
export function deriveSalaryDisplayStatus(
  status: SalaryPaymentStatus,
  paymentDate: Date,
  now: Date = new Date(),
  timezone = 'UTC',
): SalaryPaymentDisplayStatus {
  if (status === SalaryPaymentStatus.PAID) {
    return 'PAID';
  }
  // Due dates are calendar labels encoded at UTC midnight. Compare with
  // the phone-local calendar label, rather than a guessed UTC offset.
  if (paymentDate.getTime() < calendarDay(now, timezone).getTime()) {
    return 'OVERDUE';
  }
  return 'PENDING';
}

export function salaryDay(date: Date): Date {
  return calendarDay(date);
}
