import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const BCRYPT_ROUNDS = 12;

export const PasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lower-case letter')
  .regex(/[A-Z]/, 'Password must contain an upper-case letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Compared against when the account does not exist, so response time doesn't reveal it. */
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS);
export const burnPasswordCheck = (plain: string) => bcrypt.compare(plain, DUMMY_HASH);

// ---- Sessions ---------------------------------------------------------------

export const SESSION_COOKIE = 'sa_session';

export interface SessionClaims {
  sub: string;
  /** Must match User.tokenVersion — bumping it revokes every outstanding session. */
  tv: number;
}

export function signSession(claims: SessionClaims, secret: string, expiresIn: string): string {
  return jwt.sign(claims, secret, {
    algorithm: 'HS256',
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    issuer: 'sageavatar',
  });
}

export function verifySession(token: string, secret: string): SessionClaims | null {
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'sageavatar' });
    if (typeof p === 'object' && typeof p.sub === 'string' && typeof p.tv === 'number') {
      return { sub: p.sub, tv: p.tv };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- One-time tokens (invites, email verification, password reset) ----------------------------------------------

export function createOneTimeToken() {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
