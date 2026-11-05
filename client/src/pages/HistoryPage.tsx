import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api, type Creation, type CreationFilters, type PhotoFormat } from '../lib/api';
import { ConfirmDialog } from '../components/Modal';
import { Select } from '../components/Select';
import { useToast } from '../components/toast-context';
import { EmptyState, ErrorText, IconButton, Panel, Skeleton, inputClass } from '../components/ui';
import { IconDownload, IconImage, IconSearch, IconTrash } from '../components/icons';
import { FormatPicker } from './studio/Dialogs';

type DateRange = 'all' | '7' | '30' | '365';
const TYPE_LABEL: Record<string, string> = {
  FACE: 'Face',
  HALF_BODY: 'Half Body',
  FULL_BODY: 'Full Body',
  BACKGROUND: 'Background',
};

/**
 * The signed-in user's own (personal) photos — never event photos, never anyone else's.
 * Search and filters run on the server.
 */
export default function HistoryPage() {
  const toast = useToast();
  const [items, setItems] = useState<Creation[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Creation | null>(null);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<PhotoFormat>('jpg');

  const [q, setQ] = useState('');
  const [source, setSource] = useState<'all' | 'CAMERA' | 'UPLOAD'>('all');
  const [kind, setKind] = useState<'all' | 'library' | 'generated' | 'none'>('all');
  const [type, setType] = useState<'all' | NonNullable<CreationFilters['avatarType']>>('all');
  const [range, setRange] = useState<DateRange>('all');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const filtered =
    !!q.trim() || source !== 'all' || kind !== 'all' || type !== 'all' || range !== 'all';

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      const filters: CreationFilters = {
        q: q.trim() || undefined,
        source: source === 'all' ? undefined : source,
        avatarKind: kind === 'all' ? undefined : kind,
        avatarType: type === 'all' ? undefined : type,
        from:
          range === 'all'
            ? undefined
            : new Date(Date.now() - Number(range) * 86400_000).toISOString(),
        sort,
      };
      api.creations
        .list(filters)
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setTotal(r.total);
          setError('');
        })
        .catch((e: Error) => alive && setError(e.message));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, source, kind, type, range, sort]);

  const remove = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.creations.remove(pending.id);
      setItems((xs) => xs?.filter((x) => x.id !== pending.id) ?? null);
      setTotal((t) => t - 1);
      toast.success('Photo deleted', `“${pending.title}” was removed from your history.`);
      setPending(null);
    } catch (e) {
      toast.error('Could not delete photo', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="My creations"
      subtitle="Your personal photos — private to you. Event photos live in each event’s gallery."
    >
      <div className="mb-4 flex flex-col gap-3">
        <div role="search" className="group relative">
          <IconSearch
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            type="search"
            aria-label="Search my creations"
            placeholder="Search by title or avatar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${inputClass} !rounded-full !py-2.5 pl-11 pr-4 text-sm`}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Select
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: 'all', label: 'Camera & upload' },
              { value: 'CAMERA', label: 'Camera' },
              { value: 'UPLOAD', label: 'Upload' },
            ]}
          />
          <Select
            label="Avatar"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'Any avatar' },
              { value: 'library', label: 'Library avatar' },
              { value: 'generated', label: 'AI-generated' },
              { value: 'none', label: 'No avatar' },
            ]}
          />
          <Select
            label="Avatar type"
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'FACE', label: 'Face' },
              { value: 'HALF_BODY', label: 'Half Body' },
              { value: 'FULL_BODY', label: 'Full Body' },
              { value: 'BACKGROUND', label: 'Background' },
            ]}
          />
          <Select
            label="Date"
            value={range}
            onChange={setRange}
            options={[
              { value: 'all', label: 'Any time' },
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '365', label: 'Last year' },
            ]}
          />
          <Select
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-dim">
          <span role="status">
            {items ? `${total} photo${total === 1 ? '' : 's'}${filtered ? ' match' : ''}` : ''}
          </span>
          <span className="inline-flex items-center gap-2">
            Download as <FormatPicker value={format} onChange={setFormat} id="history" />
          </span>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {items === null && !error && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] !rounded-2xl" />
          ))}
        </div>
      )}

      {items?.length === 0 && (
        <EmptyState
          icon={<IconImage size={24} />}
          title={filtered ? 'Nothing matches' : 'No creations yet'}
        >
          {filtered ? (
            'Try a different search or clear the filters.'
          ) : (
            <>
              Photos you create in the{' '}
              <Link to="/" className="text-brand-2 underline-offset-4 hover:underline">
                Studio
              </Link>{' '}
              will appear here.
            </>
          )}
        </EmptyState>
      )}

      <motion.ul
        layout
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        aria-label="My creations"
      >
        <AnimatePresence>
          {items?.map((c, i) => (
            <motion.li
              key={c.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03 } }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="glass glass-interactive group overflow-hidden !rounded-2xl hover:-translate-y-1"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-ink/40">
                <img
                  src={api.creations.imageUrl(c.id)}
                  alt={c.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <a
                    href={api.creations.imageUrl(c.id, 'result', true, format)}
                    aria-label={`Download ${c.title} as ${format.toUpperCase()}`}
                    className="grid h-8 w-8 place-items-center rounded-full border border-glass-border bg-ink/70 text-text backdrop-blur transition hover:bg-ink"
                  >
                    <IconDownload size={15} />
                  </a>
                  <IconButton
                    label={`Delete ${c.title}`}
                    size="sm"
                    className="!bg-ink/70 backdrop-blur hover:!bg-accent/30"
                    icon={<IconTrash size={15} />}
                    onClick={() => setPending(c)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1 p-3">
                <div className="truncate text-sm font-medium">{c.title}</div>
                <time className="text-xs text-text-muted" dateTime={c.createdAt}>
                  {new Date(c.createdAt).toLocaleString()}
                </time>
                <div className="flex items-center gap-1.5 text-xs text-text-dim">
                  {c.avatarUsed?.thumbnailUrl && (
                    <img
                      src={c.avatarUsed.thumbnailUrl}
                      alt=""
                      className="h-5 w-5 rounded object-contain"
                    />
                  )}
                  <span className="truncate">
                    {c.avatarUsed
                      ? `${c.avatarUsed.name} · ${TYPE_LABEL[c.avatarUsed.type] ?? c.avatarUsed.type}`
                      : 'No avatar'}
                  </span>
                </div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      <ConfirmDialog
        open={!!pending}
        title="Delete this photo?"
        description={pending ? `“${pending.title}” will be permanently removed.` : undefined}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setPending(null)}
      />
    </Panel>
  );
}
