/**
 * Demo-grade account handling: scrypt-hashed passwords and opaque session
 * tokens stored as SHA-256 digests. Enough to keep one rider's trips, spend
 * and impact separate from another's without pulling in an identity provider.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { now } from '../lib/clock.js';
import type { Db } from '../store/db.js';

const SCRYPT_KEYLEN = 64;

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  role: string;
  business_name: string | null;
  created_at: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  businessName: string | null;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    businessName: row.business_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

function verifyPassword(password: string, row: UserRow): boolean {
  const attempt = Buffer.from(hashPassword(password, row.password_salt), 'hex');
  const stored = Buffer.from(row.password_hash, 'hex');
  if (attempt.length !== stored.length) return false;
  return timingSafeEqual(attempt, stored);
}

/** Tokens are random; only their digest is persisted. */
function tokenDigest(token: string): string {
  return createHash('sha256').update(`${token}:${config.authSecret}`).digest('hex');
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  expiresAt: string;
}

export class AuthService {
  constructor(private readonly db: Db) {}

  findByEmail(email: string): UserRow | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined;
  }

  findById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  register(input: {
    email: string;
    password: string;
    displayName?: string;
    businessName?: string;
  }): AuthResult {
    const email = input.email.trim().toLowerCase();
    if (this.findByEmail(email)) {
      throw ApiError.conflict('An account with that email already exists');
    }
    const salt = randomBytes(16).toString('hex');
    const row: UserRow = {
      id: newId('user'),
      email,
      display_name: input.displayName?.trim() || email.split('@')[0]!,
      password_hash: hashPassword(input.password, salt),
      password_salt: salt,
      role: 'user',
      business_name: input.businessName?.trim() || null,
      created_at: now(),
    };
    this.db
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, business_name, created_at)
         VALUES (@id, @email, @display_name, @password_hash, @password_salt, @role, @business_name, @created_at)`,
      )
      .run(row);
    return this.issueSession(row);
  }

  login(email: string, password: string): AuthResult {
    const row = this.findByEmail(email);
    // Same error for unknown email and bad password: do not confirm which
    // addresses have accounts.
    if (!row || !verifyPassword(password, row)) {
      throw ApiError.unauthorized('Incorrect email or password');
    }
    return this.issueSession(row);
  }

  /**
   * Sign in without a password, creating the account on first use. Lets the
   * demo open straight into a working rider session; disabled in production.
   */
  guest(email?: string): AuthResult {
    if (config.isProduction) {
      throw ApiError.forbidden('Guest sign-in is disabled in production');
    }
    const address = (email ?? `guest-${newId('x', 6).slice(2).toLowerCase()}@flowatl.demo`)
      .trim()
      .toLowerCase();
    const existing = this.findByEmail(address);
    if (existing) return this.issueSession(existing);
    return this.register({
      email: address,
      password: randomBytes(24).toString('hex'),
      displayName: 'Demo Rider',
    });
  }

  issueSession(row: UserRow): AuthResult {
    const token = randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = createdAt + config.sessionTtlMs;
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(tokenDigest(token), row.id, createdAt, expiresAt);
    return {
      user: toPublicUser(row),
      token,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** Resolve a bearer token to a user, pruning it if it has expired. */
  authenticate(token: string): UserRow | null {
    const digest = tokenDigest(token);
    const session = this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(digest) as { user_id: string; expires_at: number } | undefined;
    if (!session) return null;
    if (session.expires_at <= now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest);
      return null;
    }
    return this.findById(session.user_id) ?? null;
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenDigest(token));
  }

  /** Housekeeping: drop sessions that are past their expiry. */
  pruneExpiredSessions(): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    return result.changes;
  }
}
