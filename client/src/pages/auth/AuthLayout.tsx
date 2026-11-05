import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AuthBackdrop } from '../../components/AuthBackdrop';
import { Brand } from '../../components/Brand';
import { softSpring } from '../../lib/motion';

/**
 * Shared frame for the signed-out pages (Sign Up, verify email, forgot / reset password):
 * city backdrop + one glass card. Never shows the post-login flyover.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="surface-dark relative flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <AuthBackdrop />
      <motion.section
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={softSpring}
        className="glass glass-strong relative flex w-full max-w-md flex-col gap-5 p-7 sm:p-9"
      >
        <div className="gradient-hairline absolute inset-x-10 top-0" aria-hidden />
        <Brand size="lg" />
        <div>
          <h1 className="text-[24px] font-semibold leading-tight sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="text-center text-sm text-text-muted">{footer}</div>}
      </motion.section>
    </main>
  );
}

/** Success / info panel used after submitting a form. */
export function Notice({
  tone = 'success',
  title,
  children,
}: {
  tone?: 'success' | 'info';
  title: string;
  children?: ReactNode;
}) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border px-4 py-3.5 text-sm ${
        tone === 'success'
          ? 'border-success/30 bg-success/10 text-text'
          : 'border-brand-2/30 bg-brand-2/10 text-text'
      }`}
    >
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-text-muted">{children}</div>}
    </motion.div>
  );
}

/** Shown when the server has no SMTP: the email was saved on the server, not delivered. */
export function DevOutboxNote() {
  return (
    <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      Development server: email delivery isn't configured, so the message was saved to the server
      outbox (<code>server/storage/outbox</code>) and its link printed in the API console. It was
      not sent.
    </p>
  );
}
