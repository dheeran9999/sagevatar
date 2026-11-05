import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { EventPhoto, PhotoFormat } from '../../lib/api';
import { FormatPicker } from '../studio/Dialogs';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { IconDownload, IconImage, IconMail, IconTrash } from '../../components/icons';

/**
 * One event's gallery. What each person may do is decided by the server; this only offers
 * the matching buttons (download / email what you can see, delete your own, Creators manage).
 */
export function EventGallery({
  photos,
  albums,
  manage = false,
  onDelete,
  onEmail,
  onMove,
  exportHref,
}: {
  photos: EventPhoto[] | null;
  albums?: { id: string; name: string }[];
  /** Creator view: can remove any photo and sort into albums. */
  manage?: boolean;
  onDelete: (p: EventPhoto) => Promise<void>;
  onEmail?: (p: EventPhoto) => void;
  onMove?: (p: EventPhoto, albumId: string | null) => Promise<void>;
  /** Creator: ZIP export link for the current album filter ('all' | 'none' | album id). */
  exportHref?: (album: string) => string;
}) {
  const [open, setOpen] = useState<EventPhoto | null>(null);
  const [confirm, setConfirm] = useState<EventPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [album, setAlbum] = useState<string>('all');
  const [format, setFormat] = useState<PhotoFormat>('jpg');

  if (photos === null) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square !rounded-2xl" />
        ))}
      </div>
    );
  }

  const shown =
    album === 'all'
      ? photos
      : photos.filter((p) => (album === 'none' ? !p.album : p.album?.id === album));

  return (
    <div className="flex flex-col gap-3">
      {(!!albums?.length || exportHref) && (
        <div className="flex flex-wrap items-end gap-3">
          {!!albums?.length && (
            <div className="w-64 max-w-full">
              <Select
                label="Album"
                value={album}
                onChange={setAlbum}
                options={[
                  { value: 'all', label: 'All photos' },
                  { value: 'none', label: 'Unsorted' },
                  ...albums.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>
          )}
          {exportHref && shown.length > 0 && (
            <a
              href={exportHref(album)}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-glass-border bg-glass px-4 text-sm font-medium transition hover:border-glass-edge hover:bg-glass-strong"
            >
              <IconDownload size={16} /> Export {album === 'all' ? 'all photos' : 'album'} (ZIP)
            </a>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState icon={<IconImage size={22} />} title="No photos yet">
          Photos saved to this event appear here.
        </EmptyState>
      ) : (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Event photos"
        >
          <AnimatePresence initial={false}>
            {shown.map((p, i) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: Math.min(i, 12) * 0.02 } }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="glass group overflow-hidden !rounded-2xl"
              >
                <button
                  type="button"
                  onClick={() => setOpen(p)}
                  className="block aspect-square w-full overflow-hidden bg-ink/40"
                  aria-label={`Open photo by ${p.mine ? 'you' : p.owner.name}`}
                >
                  <img
                    src={p.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </button>
                <div className="flex flex-col gap-0.5 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-text">
                      {p.mine ? 'You' : p.owner.name}
                    </span>
                    <time className="shrink-0 text-text-dim" dateTime={p.capturedAt}>
                      {new Date(p.capturedAt).toLocaleString([], {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  <span className="truncate text-text-dim">
                    {p.avatarUsed ? p.avatarUsed.name : 'No avatar'}
                    {p.album ? ` · ${p.album.name}` : ''}
                  </span>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `Photo by ${open.mine ? 'you' : open.owner.name}` : ''}
        description={
          open
            ? `${open.eventName ? `${open.eventName} · ` : ''}${open.eventCode} · captured ${new Date(open.capturedAt).toLocaleString()}`
            : undefined
        }
        size="lg"
        footer={
          open && (
            <div className="flex w-full flex-wrap justify-end gap-2">
              {(open.mine || manage) && (
                <Button
                  variant="danger"
                  icon={<IconTrash size={16} />}
                  onClick={() => setConfirm(open)}
                >
                  {manage && !open.mine ? 'Remove' : 'Delete'}
                </Button>
              )}
              {onEmail && (
                <Button variant="ghost" icon={<IconMail size={16} />} onClick={() => onEmail(open)}>
                  Email
                </Button>
              )}
              <FormatPicker value={format} onChange={setFormat} id="gallery" />
              <a
                href={
                  format === 'png' && open.downloadPngUrl ? open.downloadPngUrl : open.downloadUrl
                }
                className="bg-gradient-brand btn-shine inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-white shadow-[var(--shadow-glow)]"
              >
                <IconDownload size={16} /> Download {format.toUpperCase()}
              </a>
            </div>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-3">
            <img
              src={open.finalUrl}
              alt={`Event photo by ${open.owner.name}`}
              className="max-h-[60vh] w-full rounded-2xl bg-ink object-contain"
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-text-dim">Employee</dt>
                <dd>{open.owner.name}</dd>
              </div>
              <div>
                <dt className="text-text-dim">Captured</dt>
                <dd>{new Date(open.capturedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-text-dim">Avatar</dt>
                <dd>
                  {open.avatarUsed
                    ? `${open.avatarUsed.name}${open.avatarUsed.kind === 'generated' ? ' (AI)' : ''}`
                    : 'None'}
                </dd>
              </div>
              <div>
                <dt className="text-text-dim">Source</dt>
                <dd>{open.source === 'CAMERA' ? 'Camera' : 'Upload'}</dd>
              </div>
            </dl>
            {manage && onMove && albums && (
              <div className="max-w-xs">
                <Select
                  label="Album"
                  value={open.album?.id ?? 'none'}
                  onChange={async (v) => {
                    const albumId = v === 'none' ? null : v;
                    await onMove(open, albumId);
                    setOpen({ ...open, album: albums.find((a) => a.id === albumId) ?? null });
                  }}
                  options={[
                    { value: 'none', label: 'Unsorted' },
                    ...albums.map((a) => ({ value: a.id, label: a.name })),
                  ]}
                />
              </div>
            )}
            {open.originalUrl && (
              <a href={open.originalUrl} className="text-xs text-brand-2 hover:underline">
                View original (unedited) photo
              </a>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.mine ? 'Delete this photo?' : 'Remove this photo from the event?'}
        description="The photo and its files are deleted permanently."
        confirmLabel={confirm?.mine ? 'Delete' : 'Remove'}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try {
            await onDelete(confirm);
            setConfirm(null);
            setOpen(null);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
