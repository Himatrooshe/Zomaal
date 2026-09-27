import { SalaryPaymentStatus } from '@prisma/client';
import { deriveSalaryDisplayStatus } from './salary-payment-status.util';

describe('deriveSalaryDisplayStatus', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');

  it('returns PAID regardless of date', () => {
    expect(
      deriveSalaryDisplayStatus(
        SalaryPaymentStatus.PAID,
        new Date('2026-01-01T00:00:00.000Z'),
        now,
      ),
    ).toBe('PAID');
  });

  it('returns PENDING when unpaid and paymentDate is in the future', () => {
    expect(
      deriveSalaryDisplayStatus(
        SalaryPaymentStatus.PENDING,
        new Date('2026-06-01T00:00:00.000Z'),
        now,
      ),
    ).toBe('PENDING');
  });

  it('returns OVERDUE when unpaid and paymentDate is in the past', () => {
    expect(
      deriveSalaryDisplayStatus(
        SalaryPaymentStatus.PENDING,
        new Date('2026-04-01T00:00:00.000Z'),
        now,
      ),
    ).toBe('OVERDUE');
  });
});
