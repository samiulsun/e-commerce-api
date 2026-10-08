import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Refresh tokens are stored as SHA-256 digests. A keyed hash is unnecessary —
 * the token itself is a high-entropy JWT — and bcrypt would truncate the JWT
 * at 72 bytes, which could let a rotated token still match a newer digest.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenMatches(
  token: string,
  storedDigest: string,
): boolean {
  const digest = Buffer.from(hashRefreshToken(token), 'hex');
  const stored = Buffer.from(storedDigest, 'hex');
  return digest.length === stored.length && timingSafeEqual(digest, stored);
}
