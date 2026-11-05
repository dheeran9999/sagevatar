import type { ReactNode } from 'react';
import type { LibraryAvatar } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { Button, Pill } from '../../../components/ui';
import { Checkerboard } from './shared';
import { formatBytes, SOURCE_LABEL, STYLE_LABEL, TYPE_LABEL } from './labels';

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-glass-border py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function Link({ href }: { href: string | null }) {
  if (!href) return <>—</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all text-brand-2 underline-offset-4 hover:underline"
    >
      {href.replace(/^https?:\/\//, '')}
    </a>
  );
}

/** Large asset preview with technical, usage and licensing details. */
export function AvatarDetailDialog({
  avatar,
  onClose,
  onEdit,
}: {
  avatar: LibraryAvatar | null;
  onClose: () => void;
  onEdit: (a: LibraryAvatar) => void;
}) {
  const a = avatar;
  return (
    <Modal
      open={!!a}
      onClose={onClose}
      title={a?.name ?? ''}
      description={
        a ? `${a.category.name} · ${TYPE_LABEL[a.typeCode]} · ${STYLE_LABEL[a.style]}` : undefined
      }
      size="lg"
      footer={
        a && (
          <Button variant="ghost" onClick={() => onEdit(a)}>
            Edit details
          </Button>
        )
      }
    >
      {a && (
        <div className="grid max-h-[65vh] gap-5 overflow-y-auto md:grid-cols-[1fr_1fr]">
          <Checkerboard className="grid min-h-64 place-items-center">
            <img
              src={a.fileUrl}
              alt={a.name}
              className="max-h-[50vh] max-w-full object-contain p-3"
            />
          </Checkerboard>
          <div className="flex flex-col gap-4">
            {a.description && <p className="text-sm text-text-muted">{a.description}</p>}
            {a.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.tags.map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
              </div>
            )}
            <dl>
              <Row label="Status">
                <Pill tone={a.isActive ? 'ok' : 'warn'}>{a.isActive ? 'Active' : 'Hidden'}</Pill>
              </Row>
              <Row label="Used in creations">{a.usageCount}</Row>
              <Row label="Format">
                {a.mimeType.replace('image/', '').replace('+xml', '').toUpperCase()}
                {a.isAnimated ? ' · animated' : ''}
              </Row>
              <Row label="Size">
                {a.width}×{a.height} · {formatBytes(a.sizeBytes)}
              </Row>
              <Row label="Added">
                {date(a.createdAt)} by {a.createdBy.name}
              </Row>
            </dl>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Source & licence</h3>
              <dl>
                <Row label="Source">
                  <Pill tone={a.sourceType === 'LICENSED' ? 'brand' : 'neutral'}>
                    {SOURCE_LABEL[a.sourceType]}
                  </Pill>
                </Row>
                <Row label="Author / vendor">{a.sourceName || '—'}</Row>
                <Row label="Licence">{a.licenseName || '—'}</Row>
                <Row label="Licence URL">
                  <Link href={a.licenseUrl} />
                </Row>
                <Row label="Source URL">
                  <Link href={a.sourceUrl} />
                </Row>
                <Row label="Expires">
                  {a.licenseExpiresAt ? (
                    <span className={a.licenseExpired ? 'text-accent' : ''}>
                      {date(a.licenseExpiresAt)}
                      {a.licenseExpired ? ' (expired)' : ''}
                    </span>
                  ) : (
                    'No expiry'
                  )}
                </Row>
                <Row label="Attribution">{a.attribution || '—'}</Row>
                <Row label="Rights confirmed">
                  {a.rightsConfirmedAt
                    ? `${date(a.rightsConfirmedAt)} by ${a.rightsConfirmedBy?.name ?? 'unknown'}`
                    : 'Not yet'}
                </Row>
              </dl>
              {a.licenseNotes && (
                <p className="mt-2 whitespace-pre-line text-xs text-text-muted">{a.licenseNotes}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
