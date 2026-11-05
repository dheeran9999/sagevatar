import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { TEST_ENV } from '../vitest.config.js';

/**
 * Builds a fresh test database before every run.
 * Only ever touches the hard-coded test files below — never DATABASE_URL from .env —
 * and uses the non-destructive `migrate deploy` rather than `migrate reset`.
 */
const TEST_DB_FILES = ['./prisma/test.db', './prisma/test.db-journal'];

export default function setup() {
  if (TEST_ENV.DATABASE_URL !== 'file:./test.db') {
    throw new Error('Refusing to prepare a database that is not the test database');
  }
  for (const f of TEST_DB_FILES) rmSync(f, { force: true });
  rmSync('./storage-test', { recursive: true, force: true });

  const env = { ...process.env, ...TEST_ENV };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });
}
