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
): SalaryPaymentDisplayStatus {
  if (status === SalaryPaymentStatus.PAID) {
    return 'PAID';
  }
  // Salary dates are UTC calendar days: a payment due today is pending
  // throughout today, not overdue immediately after midnight.
  if (paymentDate.getTime() < salaryDay(now).getTime()) {
    return 'OVERDUE';
  }
  return 'PENDING';
}

export function salaryDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
