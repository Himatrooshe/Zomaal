import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Validates a numeric-string money field (paired with @IsNumberString) is
 * strictly greater than zero. class-validator's @IsNumberString only checks
 * the value is parseable — it happily accepts "0", "0.00", or "-50.00",
 * which is wrong for a salary, payment, or expense amount.
 */
export function IsPositiveAmount(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPositiveAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 0;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a positive amount greater than zero`;
        },
      },
    });
  };
}
