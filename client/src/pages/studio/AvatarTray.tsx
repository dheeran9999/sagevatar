import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  api,
  type Avatar,
  type AvatarSearchResponse,
  type AvatarSearchResult,
  type AvatarType,
  type AvatarTypeInfo,
  type Category,
} from '../../lib/api';
import { AiGeneratorDialog } from './AiGenerator';
import { Button, ErrorText, Pill, Skeleton, Spinner, inputClass } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { Chips } from '../../components/Chips';
import { IconCheck, IconEye, IconSearch, IconSparkles } from '../../components/icons';

const TYPE_NAME: Record<AvatarType, string> = {
  FACE: 'Face',
  HALF_BODY: 'Half Body',
  FULL_BODY: 'Full Body',
  BACKGROUND: 'Background',
};

const SEARCH_PLACEHOLDER = 'Search an avatar by name or describe what you want...';
const EXAMPLES = [
  'Spider-Man',
  'Batman',
  'Anime character',
  'Female superhero',
  'Business professional',
  'Corporate mascot',
  'Futuristic robot',
  'Cute cartoon character',
];

const SOURCE_NAME: Record<string, string> = {
  ORIGINAL: 'Original',
  IN_HOUSE: 'In-house',
  LICENSED: 'Licensed',
  PUBLIC_DOMAIN: 'Public domain',
  AI_GENERATED: 'AI-generated',
};

interface TrayProps {
  categories: Category[];
  types: AvatarTypeInfo[];
  avatars: Avatar[] | null;
  error: string;
  category: string;
  type: AvatarType | 'all';
  selectedId: string | null;
  onCategory: (slug: string) => void;
  onType: (t: AvatarType | 'all') => void;
  onSelect: (a: Avatar) => void;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; data: AvatarSearchResponse }
  | { status: 'error'; query: string; message: string };

/**
 * Avatar Finder + tray, directly under the camera.
 * Empty search → browse the library by category/type. Typing → the server searches the approved
 * company library (keyword, plus semantic when AI is configured). Thumbnails open a larger
 * preview with source details; "Use This Avatar" adds it to the photo. "Generate with AI" makes
 * a new original avatar.
 */
export const AvatarTray = forwardRef<HTMLElement, TrayProps>(function AvatarTray(p, ref) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [previewing, setPreviewing] = useState<Avatar | null>(null);
  const location = useLocation();
  // /ai-finder (navigation) focuses the finder; ?ai=1 (AI notification) opens the generator.
  const [genOpen, setGenOpen] = useState(() => new URLSearchParams(location.search).get('ai') === '1');
  const finderInput = useRef<HTMLInputElement>(null);
  const finderRoute = location.pathname === '/ai-finder';
  useEffect(() => {
    if (!finderRoute) return;
    finderInput.current?.scrollIntoView({ block: 'center' });
    finderInput.current?.focus();
  }, [finderRoute]);
  const [genPrompt, setGenPrompt] = useState('');
  const query = q.trim();

  // Debounced server search; stale responses are ignored.
  useEffect(() => {
    if (!query) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setSearch({ status: 'loading', query });
      api.catalog
        .search(query, {
          type: p.type === 'all' ? undefined : p.type,
          category: p.category === 'all' ? undefined : p.category,
        })
        .then((data) => alive && setSearch({ status: 'done', query, data }))
        .catch((e: Error) => alive && setSearch({ status: 'error', query, message: e.message }));
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query, p.type, p.category]);

  const browsing = useMemo(
    () =>
      (p.avatars ?? []).filter(
        (a) =>
          (p.category === 'all' || a.category.slug === p.category) &&
          (p.type === 'all' || a.type === p.type),
      ),
    [p.avatars, p.category, p.type],
  );

  const searching = !!query;
  const current = searching && search.status !== 'idle' && search.query === query ? search : null;
  const results: AvatarSearchResult[] = current?.status === 'done' ? current.data.results : [];
  const loading = searching && (!current || current.status === 'loading');
  const visible: Avatar[] = searching ? results : browsing;

  const openGenerator = (prompt = '') => {
    setGenPrompt(prompt);
    setGenOpen(true);
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="glass p-3 outline-none sm:p-4"
      aria-label="Avatar tray"
    >
      <div className="flex flex-col gap-2.5">
        {/* --- AI Avatar Finder --- */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div role="search" className="group relative min-w-0 flex-1">
            <IconSearch
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-dim transition-colors group-focus-within:text-brand-2"
            />
            <input
              ref={finderInput}
              type="search"
              aria-label="Search avatars"
              placeholder={SEARCH_PLACEHOLDER}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${inputClass} !rounded-full !py-3 pl-11 pr-10 text-[15px]`}
            />
            {loading && (
              <Spinner
                size={16}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-2"
              />
            )}
          </div>
          <Button
            variant="ghost"
            icon={<IconSparkles size={16} />}
            onClick={() => openGenerator(query ? `Create an original ${query}` : '')}
            className="neon-ring shrink-0 !border-brand-2/50 text-brand-2 hover:text-white"
          >
            Generate with AI
          </Button>
        </div>

        {!searching && (
          <div className="no-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 text-xs">
            <span className="shrink-0 text-text-dim">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setQ(ex)}
                className="shrink-0 rounded-full border border-glass-border px-2.5 py-1 text-text-muted transition hover:border-glass-edge hover:text-text"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Chips
              label="Avatar categories"
              role="tablist"
              layoutId="category-pill"
              value={p.category}
              onChange={p.onCategory}
              options={[
                { value: 'all', label: 'All' },
                ...p.categories.map((c) => ({ value: c.slug, label: c.name })),
              ]}
              strong
            />
          </div>
        </div>
        <Chips
          label="Avatar type"
          role="radiogroup"
          layoutId="type-pill"
          value={p.type}
          onChange={(v) => p.onType(v as AvatarType | 'all')}
          options={[
            { value: 'all', label: 'All types' },
            ...p.types.map((t) => ({ value: t.code, label: t.name })),
          ]}
        />
      </div>

      <ErrorText>{p.error}</ErrorText>

      {searching && (
        <div className="mt-3 flex flex-col gap-2">
          {current?.status === 'error' && <ErrorText>{current.message}</ErrorText>}
          {current?.status === 'done' && current.data.notice && (
            <div
              role="note"
              className="flex flex-col gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center"
            >
              <span className="flex-1">{current.data.notice.message}</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconSparkles size={14} />}
                onClick={() => openGenerator(`Create ${current.data.notice!.suggestion}`)}
              >
                Generate an original
              </Button>
            </div>
          )}
          {current?.status === 'done' && (
            <p role="status" className="text-xs text-text-dim">
              {results.length} match{results.length === 1 ? '' : 'es'} in the SageIT avatar library
              · {current.data.mode === 'semantic' ? 'smart (semantic) search' : 'keyword search'}
              {current.data.semanticError ? ' (smart search unavailable right now)' : ''}
            </p>
          )}
        </div>
      )}

      <ul className="tray-scroll mask-fade-x -mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-2 pt-1.5">
        {(loading || (p.avatars === null && !p.error && !searching)) &&
          Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="shrink-0">
              <Skeleton className="h-[132px] w-[112px] !rounded-2xl" />
            </li>
          ))}
        <AnimatePresence mode="popLayout" initial={false}>
          {!loading &&
            visible.map((a, i) => (
              <motion.li
                key={a.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: { delay: Math.min(i, 10) * 0.025 },
                }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                className="shrink-0"
              >
                <AvatarCard
                  avatar={a}
                  selected={p.selectedId === a.id}
                  // In search results a click opens the larger preview first.
                  onSelect={() => (searching ? setPreviewing(a) : p.onSelect(a))}
                  onPreview={() => setPreviewing(a)}
                  detail={searching ? `${a.category.name} · ${TYPE_NAME[a.type]}` : undefined}
                />
              </motion.li>
            ))}
        </AnimatePresence>
        {!loading && !searching && p.avatars !== null && !visible.length && (
          <li className="px-3 py-8 text-sm text-text-muted">No avatars match these filters yet.</li>
        )}
        {!loading && searching && current?.status === 'done' && !results.length && (
          <li className="flex flex-col items-start gap-2 px-3 py-6 text-sm text-text-muted">
            No library avatars match “{query}”.
            <Button
              size="sm"
              variant="ghost"
              icon={<IconSparkles size={14} />}
              onClick={() => openGenerator(`Create an original ${query}`)}
            >
              Generate one with AI
            </Button>
          </li>
        )}
      </ul>

      <Modal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        title={previewing?.name ?? ''}
        description={
          previewing ? `${previewing.category.name} · ${TYPE_NAME[previewing.type]}` : undefined
        }
        size="lg"
        footer={
          previewing && (
            <Button
              icon={<IconSparkles size={16} />}
              onClick={() => {
                p.onSelect(previewing);
                setPreviewing(null);
              }}
              data-autofocus
            >
              {p.selectedId === previewing.id ? 'Selected' : 'Use This Avatar'}
            </Button>
          )
        }
      >
        {previewing && (
          <div className="grid gap-5 sm:grid-cols-[1.2fr_1fr]">
            <div className="grid min-h-64 place-items-center overflow-hidden rounded-2xl border border-glass-border bg-[radial-gradient(circle_at_50%_60%,color-mix(in_srgb,var(--color-brand)_25%,transparent),transparent_70%)] bg-ink/60">
              <img
                src={previewing.fileUrl}
                alt={previewing.name}
                className="max-h-[50vh] max-w-full object-contain p-3"
              />
            </div>
            <div className="flex flex-col gap-3 text-sm">
              {previewing.description && (
                <p className="text-text-muted">{previewing.description}</p>
              )}
              {!!previewing.tags?.length && (
                <div className="flex flex-wrap gap-1.5">
                  {previewing.tags.map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </div>
              )}
              {previewing.source && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-glass-border p-3 text-xs">
                  <dt className="text-text-dim">Source</dt>
                  <dd>{SOURCE_NAME[previewing.source.type] ?? previewing.source.type}</dd>
                  {previewing.source.name && (
                    <>
                      <dt className="text-text-dim">By</dt>
                      <dd>{previewing.source.name}</dd>
                    </>
                  )}
                  <dt className="text-text-dim">Licence</dt>
                  <dd>{previewing.source.license}</dd>
                </dl>
              )}
              {previewing.attribution && (
                <p className="text-xs text-text-dim">Credit: {previewing.attribution}</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <AiGeneratorDialog
        key={genOpen ? genPrompt : 'closed'}
        open={genOpen}
        onClose={() => setGenOpen(false)}
        initialPrompt={genPrompt}
        types={p.types}
        categories={p.categories}
        onUse={p.onSelect}
      />
    </section>
  );
});

function AvatarCard({
  avatar,
  selected,
  onSelect,
  onPreview,
  detail,
}: {
  avatar: Avatar;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  /** Extra line under the name (search results: category · type). */
  detail?: string;
}) {
  return (
    <div className="group/card relative">
      <motion.button
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${avatar.name}, ${avatar.type.replace('_', ' ').toLowerCase()}`}
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        className={`group relative flex w-[112px] flex-col items-center gap-1.5 rounded-2xl border p-2 pb-2.5 transition-[background-color,border-color,box-shadow] duration-300 ${
          selected
            ? 'ring-gradient border-transparent bg-fg/12 shadow-[var(--shadow-neon)]'
            : 'neon-hover border-glass-border bg-glass hover:bg-glass-strong'
        }`}
      >
        <span className="relative grid h-[84px] w-full place-items-center overflow-hidden rounded-xl bg-ink/40">
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_70%,color-mix(in_srgb,var(--color-brand)_25%,transparent),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <img
            src={avatar.thumbnailUrl ?? avatar.fileUrl}
            alt=""
            className="relative h-full w-full object-contain p-1 transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        </span>
        <span className="w-full truncate text-center text-xs font-medium">{avatar.name}</span>
        {detail && (
          <span className="-mt-1 w-full truncate text-center text-[10px] text-text-dim">
            {detail}
          </span>
        )}
        <AnimatePresence>
          {selected && (
            <motion.span
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              className="bg-gradient-brand absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full text-white shadow-lg"
            >
              <IconCheck size={13} strokeWidth={2.6} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${avatar.name}`}
        title="Preview"
        className="absolute left-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-glass-border bg-ink/70 text-text opacity-100 backdrop-blur transition hover:bg-ink sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100"
      >
        <IconEye size={14} />
      </button>
    </div>
  );
}
