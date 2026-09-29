import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateSalaryPaymentDto,
  SalaryPaymentListQueryDto,
} from './staff-salary.dto';
import { UpdateStaffDto } from './staff.dto';

describe('Staff API validation', () => {
  const batch = {
    idempotencyKey: '14a3a49b-2d65-45cd-b467-8ae3e6f59142',
    staffMemberIds: ['14a3a49b-2d65-45cd-b467-8ae3e6f59143'],
    paymentDate: '2026-09-29',
    paymentMethod: 'CASH',
  };
  it('requires a retry key and rejects invalid precision or unsafe receipt URLs', async () => {
    for (const patch of [
      { idempotencyKey: undefined },
      { amount: '0' },
      { amount: '1.001' },
      { receiptUrl: 'javascript:alert(1)' },
      { staffMemberIds: [] },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(CreateSalaryPaymentDto, { ...batch, ...patch }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(CreateSalaryPaymentDto, { ...batch, amount: '100.25' }),
      ),
    ).toEqual([]);
  });
  it('rejects zero pages and fractional limits', async () => {
    expect(
      (
        await validate(
          plainToInstance(SalaryPaymentListQueryDto, {
            page: '0',
            limit: '1.5',
          }),
        )
      ).length,
    ).toBe(2);
  });
  it('blank password preserves the existing password and nested salary is validated', async () => {
    const dto = plainToInstance(UpdateStaffDto, { password: '' });
    expect(dto.password).toBeUndefined();
    expect(await validate(dto)).toEqual([]);
    expect(
      (
        await validate(
          plainToInstance(UpdateStaffDto, { salary: { baseSalary: '-1' } }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
