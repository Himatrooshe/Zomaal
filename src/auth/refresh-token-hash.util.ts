import { createHash, timingSafeEqual } from 'crypto';

// Refresh tokens are long random-looking JWTs, so a fast hash is enough to
// keep them unusable if the database leaks. bcrypt must not be used here: it
// only reads the first 72 bytes, and every JWT for the same user shares that
// prefix (header + start of the payload), so any old token would match.
export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

export function refreshTokenMatches(
  refreshToken: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashRefreshToken(refreshToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}
