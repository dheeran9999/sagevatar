import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

/** Tests run against their own database and storage folder, never the dev ones. */
export const TEST_ENV = {
  ...loadEnv('', process.cwd(), ''),
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test.db',
  STORAGE_DIR: './storage-test',
  LOGIN_RATE_LIMIT_MAX: '1000',
};

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: TEST_ENV,
    globalSetup: ['tests/global-setup.ts'],
    // One shared SQLite file — run test files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
