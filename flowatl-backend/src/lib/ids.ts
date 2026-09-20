import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U.

/** Short, URL-safe, case-insensitive-ish id with a domain prefix (e.g. "ride_7K3QZ1..."). */
export function newId(prefix: string, length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

/** Boarding pass payload encoded into the rider's QR code. */
export function newBoardingToken(): string {
  return randomBytes(18).toString('base64url');
}
