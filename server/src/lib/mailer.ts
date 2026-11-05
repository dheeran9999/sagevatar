import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import { HttpError } from './http.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * How mail leaves the server:
 *  - smtp        SMTP_HOST is set → real delivery through that server.
 *  - dev-outbox  development/test without SMTP → each message is saved as JSON under
 *                <STORAGE_DIR>/outbox and its links are printed to the console. NOT delivered.
 *  - disabled    production without SMTP → sending fails with 503.
 */
export type MailMode = 'smtp' | 'dev-outbox' | 'disabled';

/** What the mail server said. 'accepted' means the SMTP server took responsibility for it. */
export interface MailResult {
  messageId?: string;
  accepted: string[];
  rejected: string[];
  response?: string;
}

export interface Mailer {
  mode: MailMode;
  send(mail: Mail): Promise<MailResult | void>;
}

export function createMailer(config: AppConfig): Mailer {
  if (config.emailConfigured) {
    const transport: Transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
    });
    return {
      mode: 'smtp',
      async send(mail) {
        const info = await transport.sendMail({ from: config.MAIL_FROM, ...mail });
        const list = (xs: unknown[] | undefined) =>
          (xs ?? []).map((x) =>
            typeof x === 'string' ? x : ((x as { address?: string }).address ?? ''),
          );
        return {
          messageId: info.messageId,
          accepted: list(info.accepted),
          rejected: list(info.rejected),
          response: info.response,
        };
      },
    };
  }

  if (!config.isProduction) {
    const dir = path.join(config.storageRoot, 'outbox');
    return {
      mode: 'dev-outbox',
      async send(mail) {
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${Date.now()}-${mail.to.replace(/[^a-z0-9]+/gi, '_')}.json`);
        const { attachments, ...rest } = mail;
        const record = {
          from: config.MAIL_FROM,
          ...rest,
          // Attachment bytes are not written to the outbox, only what would be attached.
          attachments: attachments?.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            bytes: a.content.length,
          })),
        };
        writeFileSync(file, JSON.stringify(record, null, 2));
        const outboxResult: MailResult = {
          messageId: `dev-outbox:${path.basename(file)}`,
          accepted: [mail.to],
          rejected: [],
        };
        if (config.NODE_ENV !== 'test') {
          const links = mail.text.match(/https?:\/\/\S+/g) ?? [];
          console.info(
            `[dev-outbox] NOT delivered (SMTP not configured) → ${mail.to}: ${mail.subject}\n` +
              links.map((l) => `  ${l}`).join('\n'),
          );
        }
        return outboxResult;
      },
    };
  }

  return {
    mode: 'disabled',
    async send() {
      throw new HttpError(503, 'Email is not configured on this server. Contact your Creator.');
    },
  };
}
