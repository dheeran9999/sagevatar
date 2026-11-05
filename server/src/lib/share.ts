import path from 'node:path';
import sharp from 'sharp';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from './http.js';
import type { MailMode, Mailer } from './mailer.js';
import { escapeHtml } from './events.js';

// ---- Downloads ----------------------------------------------------------------

export const DownloadQuery = z.object({
  download: z.literal('1').optional(),
  format: z.enum(['jpg', 'png']).optional(),
});

/**
 * The stored final photo in the requested format at its full stored resolution.
 * JPG is re-encoded only if the stored file isn't already a JPEG (quality 95);
 * PNG is a lossless encode of the stored pixels.
 */
export async function photoInFormat(buf: Buffer, format: 'jpg' | 'png') {
  const meta = await sharp(buf).metadata();
  if (format === 'jpg') {
    if (meta.format === 'jpeg') return { buf, contentType: 'image/jpeg', ext: 'jpg' };
    const out = await sharp(buf)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();
    return { buf: out, contentType: 'image/jpeg', ext: 'jpg' };
  }
  if (meta.format === 'png') return { buf, contentType: 'image/png', ext: 'png' };
  return {
    buf: await sharp(buf).png({ compressionLevel: 8 }).toBuffer(),
    contentType: 'image/png',
    ext: 'png',
  };
}

/** A safe, meaningful file name: SageVatar_<context>_<avatar>_<YYYY-MM-DD_HH-mm>_<id6>.ext */
export function photoFilename(parts: {
  context: string;
  avatar?: string | null;
  person?: string | null;
  at: Date;
  id: string;
  ext: string;
}) {
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40);
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = parts.at;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return [
    'SageVatar',
    clean(parts.context),
    parts.person ? clean(parts.person) : null,
    parts.avatar ? clean(parts.avatar) : null,
    stamp,
    parts.id.slice(-6),
  ]
    .filter(Boolean)
    .join('_')
    .concat(`.${parts.ext}`);
}

// ---- Email ----------------------------------------------------------------------

export const ShareEmailBody = z
  .object({
    to: z.string().trim().toLowerCase().max(254).email('Enter a valid recipient email address'),
    subject: z.string().trim().min(1, 'Enter a subject').max(120),
    message: z.string().trim().max(1000).default(''),
  })
  .strict();
export type ShareEmail = z.infer<typeof ShareEmailBody>;

type SmtpError = Error & {
  code?: string;
  responseCode?: number;
  response?: string;
  rejected?: unknown[];
};

/** Turns SMTP failures into messages people can act on (no server details or credentials). */
function deliveryError(e: unknown, to: string): HttpError {
  if (e instanceof HttpError) return e;
  const err = e as SmtpError;
  const response = (err.response ?? '').slice(0, 160);
  if (
    err.code === 'EENVELOPE' ||
    (err.responseCode && err.responseCode >= 500 && err.responseCode < 600)
  ) {
    return new HttpError(
      422,
      `The mail server refused to deliver to ${to}${response ? ` (${response})` : ''}.`,
    );
  }
  if (err.code === 'EAUTH') {
    return new HttpError(
      502,
      'The mail server rejected SageVatar’s sign-in. Ask a Creator to check the SMTP settings.',
    );
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(err.code ?? '')) {
    return new HttpError(502, 'Couldn’t reach the mail server. Please try again later.');
  }
  if (err.responseCode && err.responseCode >= 400) {
    return new HttpError(
      503,
      `The mail server is temporarily unavailable${response ? ` (${response})` : ''}. Try again later.`,
    );
  }
  return new HttpError(502, 'The email could not be sent. Please try again later.');
}

/**
 * Emails one photo as an attachment and records the attempt in EmailActivity.
 * Success means the mail server ACCEPTED the message for the recipient (SMTP 250), or — in
 * development without SMTP — that it was saved to the outbox (reported as such, not "sent").
 */
export async function emailPhoto(
  prisma: PrismaClient,
  mailer: Mailer,
  opts: {
    userId: string;
    sender: string;
    body: ShareEmail;
    context: string;
    file: { buf: Buffer; filename: string; contentType: string };
    link: { creationId: string } | { eventPhotoId: string } | { groupPosterId: string };
  },
): Promise<{ status: 'SENT'; delivery: MailMode; messageId: string | null; acceptedBy: string[] }> {
  const { body } = opts;
  const activity = await prisma.emailActivity.create({
    data: { userId: opts.userId, recipient: body.to, subject: body.subject, ...opts.link },
  });
  try {
    const result = await mailer.send({
      to: body.to,
      subject: body.subject,
      text: `${body.message ? `${body.message}\n\n` : ''}${opts.context}\n\nShared by ${opts.sender} with SageVatar. The photo is attached (${opts.file.filename}).`,
      html: `${body.message ? `<p>${escapeHtml(body.message).replace(/\n/g, '<br>')}</p>` : ''}<p>${escapeHtml(opts.context)}</p><p style="color:#6b7280;font-size:12px">Shared by ${escapeHtml(opts.sender)} with SageVatar. The photo is attached.</p>`,
      attachments: [
        {
          filename: opts.file.filename,
          content: opts.file.buf,
          contentType: opts.file.contentType,
        },
      ],
    });
    const accepted = result?.accepted ?? [body.to];
    if (!accepted.map((a) => a.toLowerCase()).includes(body.to)) {
      throw Object.assign(new Error('rejected'), { code: 'EENVELOPE', response: result?.response });
    }
    await prisma.emailActivity.update({
      where: { id: activity.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        delivery: mailer.mode,
        providerMessageId: result?.messageId ?? null,
      },
    });
    return {
      status: 'SENT',
      delivery: mailer.mode,
      messageId: result?.messageId ?? null,
      acceptedBy: accepted,
    };
  } catch (e) {
    const mapped = deliveryError(e, body.to);
    await prisma.emailActivity.update({
      where: { id: activity.id },
      data: { status: 'FAILED', error: mapped.message.slice(0, 300), delivery: mailer.mode },
    });
    throw mapped;
  }
}

export const extOf = (key: string) => path.extname(key).slice(1).toLowerCase();
