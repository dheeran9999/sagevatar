import type { Role } from './api';

/** Mirrors server/src/lib/security.ts PasswordSchema. The server is the authority. */
export const PASSWORD_RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: 'length', label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { id: 'lower', label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { id: 'upper', label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'number', label: 'A number', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: 'A symbol (e.g. ! @ # -)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const passwordProblems = (p: string) => PASSWORD_RULES.filter((r) => !r.test(p));

/** 0–4 for the strength meter. Only "Strong" (all rules) is accepted. */
export function passwordScore(p: string): number {
  if (!p) return 0;
  const met = PASSWORD_RULES.length - passwordProblems(p).length;
  const bonus = p.length >= 14 ? 1 : 0;
  return Math.min(4, Math.max(1, Math.round((met / PASSWORD_RULES.length) * 3) + bonus));
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where each role lands after signing in. */
export const homeFor = (role: Role) => (role === 'CREATOR' ? '/creator' : '/');
