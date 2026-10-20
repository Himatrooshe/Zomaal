import { BadRequestException } from '@nestjs/common';
import {
  isISO8601,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

export function IsCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isExpenseDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
            Number(value.slice(0, 4)) > 0 &&
            isISO8601(value, { strict: true, strictSeparator: true }) &&
            (!value.includes('T') || /(?:Z|[+-]\d{2}:\d{2})$/.test(value)) &&
            Number.isFinite(new Date(value).getTime())
          );
        },
        defaultMessage: () =>
          `${propertyName} must be a real ISO calendar date or a timestamp with an explicit timezone`,
      },
    });
}

export const strictInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
export const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export function monthInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

/** Resolve local midnight without guessing the phone's offset or ignoring DST. */
export function dateInZone(day: string, timezone: string): Date {
  const local = new Date(`${day}T00:00:00.000Z`).getTime();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  });
  const localDay = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)!.value;
    const year =
      part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
    const result = new Date(0);
    result.setUTCFullYear(year, Number(part('month')) - 1, Number(part('day')));
    result.setUTCHours(0, 0, 0, 0);
    return result.getTime();
  };
  // Find the first instant in this calendar day. This also handles midnight
  // DST gaps/folds, where assuming that local 00:00 exists loses an hour.
  let low = local - 48 * 60 * 60 * 1000;
  let high = local + 48 * 60 * 60 * 1000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDay(mid) < local) low = mid + 1;
    else high = mid;
  }
  if (localDay(low) !== local)
    throw new BadRequestException(
      'Calendar date does not exist in the requested timezone',
    );
  return new Date(low);
}

/** Calendar label encoded at UTC midnight; it is not a payout instant. */
export function calendarDay(instant: Date, timezone = 'UTC'): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  const result = new Date(0);
  result.setUTCFullYear(
    Number(part('year')),
    Number(part('month')) - 1,
    Number(part('day')),
  );
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
export function salaryCalendarInput(value: string, timezone = 'UTC'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    dateInZone(value, timezone); // Reject calendar days skipped by a timezone change.
    return new Date(`${value}T00:00:00.000Z`);
  }
  return calendarDay(new Date(value), timezone);
}
