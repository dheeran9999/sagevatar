import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { canonicalFace } from '../../lib/facemesh';
import {
  ANCHOR_LABEL,
  CATEGORY_LABEL,
  FILTER_CATEGORIES,
  filterThumb,
  imageFilter,
  type FaceFilter,
  type FilterAnchor,
  type FilterCategory,
} from '../../lib/faceFilters';
import { addCustomFilter, type CustomFilterRecord } from '../../lib/customFilters';
import { Modal } from '../../components/Modal';
import { Button, ErrorText, Spinner, inputClass, selectClass } from '../../components/ui';
import {
  IconExpand,
  IconSearch,
  IconSparkles,
  IconUpload,
  IconX,
  IconCamera,
  IconUsers,
} from '../../components/icons';

/** One entry in the carousel (built-in, library character or the user's own). */
export interface FilterItem {
  id: string;
  name: string;
  category: FilterCategory;
  tags: string[];
  featured?: boolean;
  /** Ready-to-draw filter; character/custom items may resolve it on selection. */
  filter?: FaceFilter;
  thumb?: string;
}

export type CarouselView = 'all' | 'featured' | FilterCategory;

const FACE = canonicalFace();

export function thumbFor(item: FilterItem) {
  if (item.thumb) return item.thumb;
  return item.filter ? filterThumb(item.filter, FACE) : '';
}

function matches(item: FilterItem, q: string) {
  if (!q) return true;
  const hay = `${item.name} ${CATEGORY_LABEL[item.category]} ${item.tags.join(' ')}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

interface CarouselProps {
  items: FilterItem[];
  selectedId: string | null;
  onSelect: (item: FilterItem | null) => void;
  view: CarouselView;
  onView: (v: CarouselView) => void;
  onAdd: () => void;
  /** Toolbar */
  onCreate: () => void;
  onScan: () => void;
  onBrowse: () => void;
  onExplore: () => void;
  scanning: boolean;
  /** Short status under the toolbar (faces found, applying…). */
  status?: ReactNode;
  loadingId?: string | null;
}

/**
 * The AR filter carousel under the camera: search, category chips, a horizontally scrolling
 * row of round thumbnails (selected one ringed and centred) and the Create / Scan Face /
 * Browse / Explore toolbar. Clicking a thumbnail applies the filter immediately.
 */
export function FilterCarousel(p: CarouselProps) {
  const [q, setQ] = useState('');
  const row = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const byView = p.items.filter((i) =>
      p.view === 'all' ? true : p.view === 'featured' ? i.featured : i.category === p.view,
    );
    return byView.filter((i) => matches(i, q.trim()));
  }, [p.items, p.view, q]);

  // Keep the selected thumbnail in view.
  useEffect(() => {
    if (!p.selectedId) return;
    const el = row.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(p.selectedId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [p.selectedId, visible.length]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = visible.findIndex((v) => v.id === p.selectedId);
    const n = e.key === 'ArrowRight' ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
    if (visible[n]) {
      p.onSelect(visible[n]);
      row.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(visible[n].id)}"]`)?.focus();
    }
  };

  const chips: { id: CarouselView; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'featured', label: 'Featured' },
    ...FILTER_CATEGORIES.filter((c) => p.items.some((i) => i.category === c.id)),
  ];

  return (
    <section aria-label="Face filters" className="glass flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search filters</span>
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search filters — bunny, glasses, hero mask…"
            className={`${inputClass} !rounded-full pl-9`}
          />
        </label>
      </div>
      <div role="group" aria-label="Filter categories" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {chips.map((c) => {
          const active = p.view === c.id;
          return (
            <button
              key={c.id}
              aria-pressed={active}
              onClick={() => p.onView(c.id)}
              className={`relative shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-transparent text-white'
                  : 'border-glass-border text-text-muted hover:border-glass-edge hover:text-text'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="filter-chip"
                  className="bg-gradient-brand absolute inset-0 -z-10 rounded-full"
                  transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                />
              )}
              {c.label}
            </button>
          );
        })}
      </div>

      <div
        ref={row}
        role="listbox"
        aria-label="Filters"
        aria-orientation="horizontal"
        onKeyDown={onKey}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto scroll-smooth px-1 pb-1 pt-1"
      >
        <Thumb
          id="none"
          name="No filter"
          sub="Remove"
          selected={!p.selectedId}
          onClick={() => p.onSelect(null)}
        >
          <IconX size={22} />
        </Thumb>
        {visible.map((item) => (
          <Thumb
            key={item.id}
            id={item.id}
            name={item.name}
            sub={CATEGORY_LABEL[item.category]}
            selected={p.selectedId === item.id}
            loading={p.loadingId === item.id}
            onClick={() => p.onSelect(item)}
          >
            <ThumbImage item={item} />
          </Thumb>
        ))}
        {!visible.length && (
          <p className="self-center px-2 text-sm text-text-muted">No filters match “{q}”.</p>
        )}
        <Thumb id="add" name="Add filter" sub="Your artwork" onClick={p.onAdd} dashed>
          <span className="text-2xl leading-none">+</span>
        </Thumb>
      </div>

      <div className="flex items-center justify-around gap-1 border-t border-glass-border pt-2">
        <ToolButton label="Create" onClick={p.onCreate} icon={<IconCamera size={18} />} />
        <ToolButton
          label={p.scanning ? 'Scanning…' : 'Scan Face'}
          onClick={p.onScan}
          icon={p.scanning ? <Spinner size={16} /> : <IconUsers size={18} />}
          disabled={p.scanning}
        />
        <ToolButton label="Browse" onClick={p.onBrowse} icon={<IconExpand size={18} />} active={false} />
        <ToolButton
          label="Explore"
          onClick={p.onExplore}
          icon={<IconSparkles size={18} />}
          active={p.view === 'featured'}
        />
      </div>
      {p.status && (
        <div role="status" aria-live="polite" className="-mt-1 text-center text-xs text-text-muted">
          {p.status}
        </div>
      )}
    </section>
  );
}

function ThumbImage({ item }: { item: FilterItem }) {
  const src = useMemo(() => thumbFor(item), [item]);
  return src ? (
    <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
  ) : (
    <IconSparkles size={20} />
  );
}

function Thumb({
  id,
  name,
  sub,
  selected,
  loading,
  dashed,
  onClick,
  children,
}: {
  id: string;
  name: string;
  sub: string;
  selected?: boolean;
  loading?: boolean;
  dashed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      data-id={id}
      role={dashed ? undefined : 'option'}
      aria-selected={dashed ? undefined : !!selected}
      aria-label={`${name}${dashed ? '' : `, ${sub}`}`}
      title={name}
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.92 }}
      tabIndex={dashed || selected ? 0 : -1}
      className="group flex w-[4.75rem] shrink-0 snap-center flex-col items-center gap-1 outline-none sm:w-20"
    >
      <span
        className={`relative grid h-16 w-16 place-items-center overflow-hidden rounded-full transition-all sm:h-[4.5rem] sm:w-[4.5rem] ${
          selected
            ? 'scale-105 ring-[3px] ring-brand-2 ring-offset-2 ring-offset-[var(--color-ink-2,#0b1222)] shadow-[0_0_18px_-2px_rgb(34_211_238/0.6)]'
            : dashed
              ? 'border-2 border-dashed border-glass-edge text-text-muted group-hover:text-text'
              : 'border border-glass-border bg-glass-strong text-text-muted group-hover:border-glass-edge'
        } group-focus-visible:ring-2 group-focus-visible:ring-brand-2/80`}
      >
        <span className="absolute inset-0 grid place-items-center bg-gradient-to-b from-white/10 to-transparent">
          {children}
        </span>
        {loading && (
          <span className="absolute inset-0 grid place-items-center bg-black/40">
            <Spinner size={18} className="text-white" />
          </span>
        )}
      </span>
      <span className={`line-clamp-1 text-[11px] font-medium ${selected ? 'text-text' : 'text-text-muted'}`}>
        {name}
      </span>
      <span className="-mt-1 text-[10px] text-text-dim">{sub}</span>
    </motion.button>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.92 }}
      className={`flex min-w-16 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
        active ? 'text-brand-2' : 'text-text-muted hover:bg-glass hover:text-text'
      }`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full border border-glass-border bg-glass">
        {icon}
      </span>
      {label}
    </motion.button>
  );
}

// ------------------------------------------------------------------ browse dialog

/** The full filter library, grouped by category, with search. */
export function FilterBrowser({
  open,
  onClose,
  items,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  items: FilterItem[];
  selectedId: string | null;
  onSelect: (item: FilterItem) => void;
}) {
  const [q, setQ] = useState('');
  const groups = FILTER_CATEGORIES.map((c) => ({
    ...c,
    items: items.filter((i) => i.category === c.id && matches(i, q.trim())),
  })).filter((g) => g.items.length);
  return (
    <Modal open={open} onClose={onClose} title="Filter library" description="Every face filter, by category." size="lg">
      <label className="relative mb-4 block">
        <span className="sr-only">Search the filter library</span>
        <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
        <input
          data-autofocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search filters"
          className={`${inputClass} !rounded-full pl-9`}
        />
      </label>
      <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g.id}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">{g.label}</h3>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              {g.items.map((item) => (
                <Thumb
                  key={item.id}
                  id={item.id}
                  name={item.name}
                  sub={g.label}
                  selected={selectedId === item.id}
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <ThumbImage item={item} />
                </Thumb>
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <p className="text-sm text-text-muted">Nothing matches “{q}”.</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ add dialog

const ANCHORS = Object.keys(ANCHOR_LABEL) as FilterAnchor[];

/** Upload a transparent PNG/WebP, choose where it attaches, preview it on a face, save. */
export function AddFilterDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (rec: CustomFilterRecord) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState('');
  const [anchor, setAnchor] = useState<FilterAnchor>('head');
  const [size, setSize] = useState(1.2);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Live preview on the neutral face.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const preview: FilterItem = {
      id: 'preview',
      name: 'preview',
      category: 'custom',
      tags: [],
      filter: img
        ? imageFilter({ id: 'preview', name: 'p', category: 'custom', image: img, anchor, size })
        : undefined,
    };
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const url = preview.filter ? filterThumbFresh(preview.filter) : '';
    ctx.clearRect(0, 0, c.width, c.height);
    if (url) {
      const i = new Image();
      i.onload = () => ctx.drawImage(i, 0, 0, c.width, c.height);
      i.src = url;
    }
  }, [img, anchor, size]);

  const reset = () => {
    setFile(null);
    setImg(null);
    setName('');
    setError('');
    setAnchor('head');
    setSize(1.2);
  };

  const save = async () => {
    if (!file) return setError('Choose an image first.');
    setSaving(true);
    setError('');
    try {
      const rec = await addCustomFilter(file, { name: name || file.name.replace(/\.\w+$/, ''), anchor, size });
      onAdded(rec);
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a new filter"
      description="Use your own transparent PNG or WebP artwork. It’s kept in this browser."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!file}>
            Add filter
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Image (PNG or WebP, transparent background)</span>
            <span className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<IconUpload size={15} />}
                onClick={() => document.getElementById('add-filter-file')?.click()}
              >
                {file ? 'Change image' : 'Choose image'}
              </Button>
              <span className="truncate text-xs text-text-dim">{file?.name}</span>
            </span>
            <input
              id="add-filter-file"
              type="file"
              accept="image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (!f) setImg(null);
                setFile(f);
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputClass} placeholder="e.g. Team cap" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Attach to</span>
            <select value={anchor} onChange={(e) => setAnchor(e.target.value as FilterAnchor)} className={selectClass}>
              {ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {ANCHOR_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="flex justify-between text-text-muted">
              Width <span className="text-text">{Math.round(size * 100)}% of face</span>
            </span>
            <input type="range" min={30} max={250} value={Math.round(size * 100)} onChange={(e) => setSize(Number(e.target.value) / 100)} className="studio-range" />
          </label>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
        <div className="flex flex-col items-center gap-2">
          <canvas ref={canvas} width={160} height={160} className="rounded-full border border-glass-border bg-glass" aria-label="Filter preview" />
          <span className="text-xs text-text-dim">Preview</span>
        </div>
      </div>
    </Modal>
  );
}

/** Uncached thumbnail (the add-filter preview changes on every edit). */
function filterThumbFresh(f: FaceFilter) {
  return filterThumb(f, FACE, 160, false);
}
