import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Modal } from '../../components/Modal';
import { Chips } from '../../components/Chips';
import { Button, ErrorText, Field, Spinner } from '../../components/ui';
import { IconCheck, IconDownload, IconMail, IconAlert } from '../../components/icons';
import type { EmailResult, PhotoFormat } from '../../lib/api';
import { EMAIL_RE } from '../../lib/password';

/** JPG / PNG choice used wherever a photo can be downloaded. */
export function FormatPicker({
  value,
  onChange,
  id = 'fmt',
}: {
  value: PhotoFormat;
  onChange: (f: PhotoFormat) => void;
  id?: string;
}) {
  return (
    <Chips
      label="Download format"
      role="radiogroup"
      layoutId={`${id}-format`}
      value={value}
      onChange={(v) => onChange(v as PhotoFormat)}
      options={[
        { value: 'jpg', label: 'JPG' },
        { value: 'png', label: 'PNG' },
      ]}
    />
  );
}

/**
 * Preview: the original and the final photo side by side (exactly what gets downloaded or
 * emailed), with shortcuts back into the editor.
 */
export function PreviewDialog({
  open,
  originalUrl,
  finalUrl,
  eventName,
  avatarName,
  size,
  onClose,
  onChangeAvatar,
  onChangePlacement,
  onDownload,
  onEmail,
  downloading,
  format,
  onFormat,
}: {
  open: boolean;
  originalUrl: string | null;
  finalUrl: string | null;
  eventName?: string;
  avatarName?: string;
  size?: { width: number; height: number };
  onClose: () => void;
  onChangeAvatar: () => void;
  onChangePlacement: () => void;
  onDownload: () => void;
  onEmail: () => void;
  downloading: boolean;
  format: PhotoFormat;
  onFormat: (f: PhotoFormat) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={eventName ? `Preview · ${eventName}` : 'Preview'}
      description={`The final photo is exactly what will be downloaded or emailed${
        size ? ` (${size.width}×${size.height} px)` : ''
      }.`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Back to editor
          </Button>
          <Button variant="subtle" onClick={onChangeAvatar}>
            Change avatar
          </Button>
          <Button variant="subtle" onClick={onChangePlacement}>
            Change placement
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FormatPicker value={format} onChange={onFormat} id="preview" />
            <Button variant="ghost" icon={<IconMail size={16} />} onClick={onEmail}>
              Email
            </Button>
            <Button
              icon={<IconDownload size={16} />}
              loading={downloading}
              onClick={onDownload}
              data-autofocus
            >
              Download {format.toUpperCase()}
            </Button>
          </div>
        </div>
      }
    >
      {eventName && (
        <p className="mb-3 inline-flex rounded-full border border-brand-2/30 bg-brand-2/10 px-3 py-1 text-xs">
          Saving to event: <strong className="ml-1">{eventName}</strong>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2" aria-label="Before and after">
        {[
          { label: 'Original', url: originalUrl, alt: 'Original photo' },
          {
            label: avatarName ? `Final · with ${avatarName}` : 'Final',
            url: finalUrl,
            alt: 'Final photo preview',
          },
        ].map((x) => (
          <figure key={x.label} className="flex flex-col gap-1.5">
            <figcaption className="text-xs font-medium text-text-muted">{x.label}</figcaption>
            <div className="overflow-hidden rounded-2xl border border-glass-border bg-ink">
              {x.url ? (
                <img src={x.url} alt={x.alt} className="mx-auto max-h-[55vh] w-auto" />
              ) : (
                <div className="grid h-48 place-items-center">
                  <Spinner />
                </div>
              )}
            </div>
          </figure>
        ))}
      </div>
    </Modal>
  );
}

export type SendStage = 'render' | 'save' | 'send';
const STAGES: { id: SendStage; label: string }[] = [
  { id: 'render', label: 'Preparing the final photo' },
  { id: 'save', label: 'Saving it securely' },
  { id: 'send', label: 'Handing it to the mail server' },
];

/**
 * Email the final photo. Recipient and subject are required; the photo is attached on the
 * server. Success is shown only after the mail server has accepted the message.
 */
export function EmailDialog({
  open,
  onClose,
  onSend,
  defaultTo,
  defaultSubject = 'My SageVatar photo',
  attachment,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (
    to: string,
    subject: string,
    message: string,
    progress: (stage: SendStage) => void,
  ) => Promise<EmailResult>;
  defaultTo: string;
  defaultSubject?: string;
  /** Thumbnail + name of what will be attached. */
  attachment?: { url: string | null; name: string };
}) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<SendStage | null>(null);
  const [result, setResult] = useState<EmailResult | null>(null);

  const toError = touched
    ? !to.trim()
      ? 'Enter the recipient’s email'
      : !EMAIL_RE.test(to.trim())
        ? 'Enter a valid email address'
        : ''
    : '';
  const subjectError = touched && !subject.trim() ? 'Enter a subject' : '';
  const busy = stage !== null && !result;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!to.trim() || !EMAIL_RE.test(to.trim()) || !subject.trim()) return;
    setError('');
    setStage('render');
    try {
      const r = await onSend(to.trim(), subject.trim(), message.trim(), setStage);
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
      setStage(null);
    }
  };

  const currentIndex = stage ? STAGES.findIndex((s) => s.id === stage) : -1;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Email this photo"
      description="The final photo is attached and sent from SageVatar’s mail server."
    >
      {result ? (
        <div className="flex flex-col gap-4" role="status">
          {result.delivery === 'smtp' ? (
            <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
              <IconCheck size={18} className="mt-0.5 shrink-0 text-success" />
              <div>
                <div className="font-medium">Email accepted for delivery</div>
                <div className="text-text-muted">
                  The mail server accepted it for {result.acceptedBy.join(', ')}. It should arrive
                  shortly.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
              <IconAlert size={18} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <div className="font-medium">Not delivered — email isn’t configured</div>
                <div className="text-text-muted">
                  This server has no mail service yet, so the message was saved to the server outbox
                  instead of being sent. Download the photo to share it for now.
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Email photo">
          <Field
            label="Recipient email *"
            type="email"
            required
            value={to}
            error={toError}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
            data-autofocus
          />
          <Field
            label="Subject *"
            required
            value={subject}
            error={subjectError}
            maxLength={120}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">Message</span>
            <textarea
              value={message}
              maxLength={1000}
              rows={3}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-2xl border border-glass-border bg-ink/50 px-4 py-3 text-[15px] text-text outline-none transition hover:border-glass-edge focus:border-brand-2/70"
            />
          </label>
          {attachment && (
            <div className="flex items-center gap-3 rounded-2xl border border-glass-border bg-ink/30 p-2.5">
              {attachment.url ? (
                <img src={attachment.url} alt="" className="h-12 w-16 rounded-lg object-cover" />
              ) : (
                <div className="h-12 w-16 rounded-lg bg-fg/10" />
              )}
              <div className="min-w-0 text-xs">
                <div className="font-medium text-text">Attachment</div>
                <div className="truncate text-text-muted">{attachment.name}</div>
              </div>
            </div>
          )}
          {busy && (
            <div role="status" aria-label="Sending progress" className="flex flex-col gap-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
                <motion.div
                  className="bg-gradient-brand h-full rounded-full"
                  initial={false}
                  animate={{ width: `${((currentIndex + 0.5) / STAGES.length) * 100}%` }}
                />
              </div>
              <ol className="flex flex-col gap-1 text-xs">
                {STAGES.map((s, i) => (
                  <li
                    key={s.id}
                    className={`flex items-center gap-2 ${i < currentIndex ? 'text-success' : i === currentIndex ? 'text-text' : 'text-text-dim'}`}
                  >
                    {i < currentIndex ? (
                      <IconCheck size={12} />
                    ) : i === currentIndex ? (
                      <Spinner size={12} />
                    ) : (
                      <span className="h-3 w-3 rounded-full border border-fg/20" />
                    )}
                    {s.label}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} icon={<IconMail size={16} />}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
