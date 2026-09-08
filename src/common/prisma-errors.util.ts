import { Prisma } from '@prisma/client';

/**
 * True when `err` is a Prisma unique-constraint violation (P2002).
 *
 * The pre-check-then-create pattern used throughout (check a name/phone is
 * free, then create) is not atomic — two concurrent requests can both pass
 * the check and race to the DB, where only one INSERT wins. Without this,
 * the loser's unhandled PrismaClientKnownRequestError becomes a raw 500
 * instead of the same 409 the pre-check already gives the common case.
 * Callers should still keep the pre-check (fast, clean message on the
 * common path) and wrap the write in try/catch using this as the fallback.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
