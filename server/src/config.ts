import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Public origin of the web client — used for CORS and to build invite links. */
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  SESSION_MAX_AGE_HOURS: z.coerce.number().positive().default(8),
  INVITE_TTL_HOURS: z.coerce.number().positive().default(72),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().positive().default(15),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('SageVatar <no-reply@sageitinc.com>'),
  /** Comma-separated company domains allowed to self-register (Sign Up). */
  SIGNUP_EMAIL_DOMAINS: z
    .string()
    .default('sageitinc.com')
    .transform((v) =>
      v
        .split(',')
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
    ),
  VERIFY_TTL_HOURS: z.coerce.number().positive().default(24),
  RESET_TTL_MINUTES: z.coerce.number().positive().default(30),
  /** AI avatar generation + semantic search. Empty key = both off; keyword search still works. */
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  OPENAI_IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'auto']).default('medium'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  /** Let Employees generate personal avatars (Creators always can when AI is configured). */
  AI_EMPLOYEE_GENERATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Images per user per day (counts every image requested). */
  AI_DAILY_IMAGE_LIMIT: z.coerce.number().int().min(0).default(24),
  /** "Remember me" keeps the session for this many days; otherwise it ends with the browser. */
  /** Session cookie 'Secure' flag. Defaults to on in production; set false only for plain-HTTP LAN/test deployments. */
  COOKIE_SECURE: z.enum(['true', 'false', '']).optional().default(''),
  REMEMBER_ME_DAYS: z.coerce.number().positive().default(30),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  storageRoot: string;
  /** Served at /media — avatar and template assets only. */
  publicStorage: string;
  /** Never served statically — personal photos, streamed after an ownership check. */
  privateStorage: string;
  emailConfigured: boolean;
  aiConfigured: boolean;
  isProduction: boolean;
  /** Session cookie Secure flag (COOKIE_SECURE, else on in production). */
  cookieSecure: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const c = parsed.data;
  const storageRoot = path.resolve(process.cwd(), c.STORAGE_DIR);
  return {
    ...c,
    storageRoot,
    publicStorage: path.join(storageRoot, 'public'),
    privateStorage: path.join(storageRoot, 'private'),
    // Auth is optional (e.g. an internal relay), so the host alone enables sending.
    emailConfigured: Boolean(c.SMTP_HOST),
    aiConfigured: Boolean(c.OPENAI_API_KEY),
    isProduction: c.NODE_ENV === 'production',
    cookieSecure: c.COOKIE_SECURE === '' ? c.NODE_ENV === 'production' : c.COOKIE_SECURE === 'true',
  };
}
