import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../auth/AuthContext';
import {
  api,
  type AiStatus,
  type Avatar,
  type AvatarType,
  type AvatarTypeInfo,
  type Category,
  type GeneratedImage,
  type GenerationJob,
  type GenerationStyle,
} from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Chips } from '../../components/Chips';
import { Button, ErrorText, Field, Skeleton, Spinner } from '../../components/ui';
import { Select } from '../../components/Select';
import { useToast } from '../../components/toast-context';
import { IconAlert, IconCheck, IconSparkles } from '../../components/icons';

const TYPE_OPTIONS: { value: AvatarType; label: string }[] = [
  { value: 'FACE', label: 'Face' },
  { value: 'HALF_BODY', label: 'Half Body' },
  { value: 'FULL_BODY', label: 'Full Body' },
  { value: 'BACKGROUND', label: 'Background' },
];

const EXAMPLE =
  'Create an original futuristic superhero wearing a blue and silver suit, full-body standing pose and transparent background.';

/** Turns a generated image into something the Studio composer can use like a library avatar. */
export function generatedToAvatar(g: GeneratedImage, types: AvatarTypeInfo[]): Avatar {
  const t = types.find((x) => x.code === g.type);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    type: g.type,
    fileUrl: g.fileUrl,
    thumbnailUrl: g.thumbnailUrl,
    isAnimated: false,
    width: g.width,
    height: g.height,
    defaultPlacement: t?.defaultPlacement ?? { layer: 'beside', x: 0.72, y: 1, scale: 0.6 },
    category: { slug: 'ai', name: 'AI generated' },
    source: g.source,
    origin: 'generated',
  };
}

/**
 * "Generate with AI": description + style + type → the configured AI image service (server side).
 * Progress is the job's real state (images returned so far). Results are the actual images.
 */
export function AiGeneratorDialog({
  open,
  onClose,
  initialPrompt,
  types,
  categories,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  initialPrompt: string;
  types: AvatarTypeInfo[];
  categories: Category[];
  onUse: (a: Avatar) => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState<GenerationStyle>('SUPERHERO');
  const [type, setType] = useState<AvatarType>('FULL_BODY');
  const [count, setCount] = useState(2);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<GeneratedImage | null>(null);
  const [recent, setRecent] = useState<GeneratedImage[] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const poll = useRef<number | undefined>(undefined);

  const refreshStatus = useCallback(() => {
    api.ai
      .status()
      .then(setStatus)
      .catch((e: Error) => setStatusError(e.message));
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshStatus();
    api.ai
      .images()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [open, refreshStatus]);

  useEffect(() => () => window.clearTimeout(poll.current), []);

  const running = job?.status === 'RUNNING';
  useEffect(() => {
    if (!running || !job) return;
    const started = new Date(job.createdAt).getTime();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [running, job]);

  const follow = (id: string) => {
    window.clearTimeout(poll.current);
    poll.current = window.setTimeout(async () => {
      try {
        const j = await api.ai.job(id);
        setJob(j);
        if (j.status === 'RUNNING') follow(id);
        else {
          refreshStatus();
          if (j.images[0]) setSelected(j.images[0]);
          if (j.status === 'FAILED') setError(j.error ?? 'Generation failed');
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1200);
  };

  const generate = async () => {
    setError('');
    setSelected(null);
    setStarting(true);
    try {
      const j = await api.ai.generate({ prompt: prompt.trim(), style, type, count });
      setJob(j);
      setElapsed(0);
      follow(j.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const use = (g: GeneratedImage) => {
    onUse(generatedToAvatar(g, types));
    toast.success('Avatar added', 'Your AI avatar is in the photo editor.');
    onClose();
  };

  const gen = status?.generation;
  const disabled = !!status && !gen?.enabled;
  const left = gen ? Math.max(0, gen.dailyLimit - gen.usedToday) : 0;
  const canGenerate =
    !!gen?.enabled && prompt.trim().length >= 10 && !starting && !running && count <= left;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate with AI"
      description="Describe an original avatar. Images come from the AI service configured by SageIT."
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {statusError && <ErrorText>{statusError}</ErrorText>}
        {disabled && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
          >
            <IconAlert size={16} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <div className="font-medium">AI generation isn't available</div>
              <div className="text-text-muted">
                {gen?.reason} Searching the avatar library still works.
              </div>
            </div>
          </div>
        )}

        <fieldset disabled={disabled} className="flex flex-col gap-4 disabled:opacity-60">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">Describe your avatar</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={EXAMPLE}
              className="rounded-2xl border border-glass-border bg-ink/50 px-4 py-3 text-[15px] text-text outline-none transition placeholder:text-text-dim hover:border-glass-edge focus:border-brand-2/70"
            />
            <span className="flex justify-between text-xs text-text-dim">
              <button
                type="button"
                className="text-brand-2 hover:underline"
                onClick={() => setPrompt(EXAMPLE)}
              >
                Use the example
              </button>
              <span>Original characters only — named franchise characters are declined.</span>
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">Style</span>
            <Chips
              label="Generation style"
              role="radiogroup"
              layoutId="gen-style"
              wrap
              value={style}
              onChange={(v) => setStyle(v as GenerationStyle)}
              options={(status?.styles ?? []).map((s) => ({ value: s.value, label: s.label }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-text-muted">Avatar type</span>
              <Chips
                label="Avatar type to generate"
                role="radiogroup"
                layoutId="gen-type"
                wrap
                value={type}
                onChange={(v) => setType(v as AvatarType)}
                options={TYPE_OPTIONS}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-text-muted">Images</span>
              <Chips
                label="Number of images"
                role="radiogroup"
                layoutId="gen-count"
                wrap
                value={String(count)}
                onChange={(v) => setCount(Number(v))}
                options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
              />
            </div>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            icon={<IconSparkles size={16} />}
            onClick={generate}
            loading={starting}
            disabled={!canGenerate}
          >
            {job && !running ? 'Regenerate' : 'Generate'}
          </Button>
          {gen?.enabled && (
            <span className="text-xs text-text-dim">
              {left} of {gen.dailyLimit} images left today · {gen.model}
            </span>
          )}
        </div>

        <ErrorText>{error}</ErrorText>

        {job && (
          <section aria-label="Generation results" className="flex flex-col gap-3">
            {running && (
              <div role="status" className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={14} />
                    Generating… {job.completed} of {job.count} image{job.count > 1 ? 's' : ''} ready
                    {job.failed ? ` · ${job.failed} failed` : ''}
                  </span>
                  <span className="text-xs text-text-dim">{elapsed}s</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
                  <motion.div
                    className="bg-gradient-brand h-full rounded-full"
                    initial={false}
                    animate={{
                      width: `${Math.max(4, ((job.completed + job.failed) / job.count) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-text-dim">
                  Each image usually takes 20–60 seconds. The bar moves as images actually arrive.
                </p>
              </div>
            )}
            {!running && job.status !== 'FAILED' && (
              <p className="text-sm text-text-muted">
                {job.images.length} image{job.images.length === 1 ? '' : 's'} generated
                {job.failed ? ` · ${job.failed} failed (${job.error})` : ''}. Pick one to use.
              </p>
            )}
            <ResultGrid
              images={job.images}
              pending={running ? job.count - job.completed - job.failed : 0}
              selected={selected}
              onSelect={setSelected}
            />
          </section>
        )}

        <AnimatePresence>
          {selected && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              aria-label="Selected AI avatar"
              className="grid gap-4 rounded-2xl border border-glass-border bg-ink/40 p-3 sm:grid-cols-[1fr_1fr]"
            >
              <div className="grid min-h-56 place-items-center rounded-xl bg-[repeating-conic-gradient(rgb(128_128_128/0.18)_0%_25%,transparent_0%_50%)] bg-[length:18px_18px]">
                <img
                  src={selected.fileUrl}
                  alt={selected.description}
                  className="max-h-[40vh] max-w-full object-contain"
                />
              </div>
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <div className="font-medium">{selected.styleLabel}</div>
                  <div className="text-xs text-text-dim">
                    {TYPE_OPTIONS.find((t) => t.value === selected.type)?.label} · {selected.width}×
                    {selected.height} · {selected.source.name}
                  </div>
                </div>
                <p className="line-clamp-4 text-text-muted">{selected.description}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button icon={<IconCheck size={16} />} onClick={() => use(selected)}>
                    Use this avatar
                  </Button>
                </div>
                {can('library.manage') && <PublishForm image={selected} categories={categories} />}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {!job && recent && recent.length > 0 && (
          <section aria-label="Your recent AI avatars" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Your recent AI avatars</h3>
            <ResultGrid images={recent.slice(0, 8)} selected={selected} onSelect={setSelected} />
          </section>
        )}
        {!job && recent === null && open && gen?.enabled && (
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-20 !rounded-xl" />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultGrid({
  images,
  pending = 0,
  selected,
  onSelect,
}: {
  images: GeneratedImage[];
  pending?: number;
  selected: GeneratedImage | null;
  onSelect: (g: GeneratedImage) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {images.map((g) => (
        <motion.li
          key={g.id}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <button
            type="button"
            onClick={() => onSelect(g)}
            aria-pressed={selected?.id === g.id}
            aria-label={`Preview ${g.styleLabel} image`}
            className={`grid aspect-square w-full place-items-center overflow-hidden rounded-xl border bg-[repeating-conic-gradient(rgb(128_128_128/0.18)_0%_25%,transparent_0%_50%)] bg-[length:14px_14px] transition hover:-translate-y-0.5 ${
              selected?.id === g.id ? 'ring-gradient border-transparent' : 'border-glass-border'
            }`}
          >
            <img src={g.thumbnailUrl} alt="" className="max-h-full max-w-full object-contain" />
          </button>
        </motion.li>
      ))}
      {Array.from({ length: pending }, (_, i) => (
        <li key={`p${i}`}>
          <Skeleton className="aspect-square w-full !rounded-xl" />
        </li>
      ))}
    </ul>
  );
}

/** Creator only: copy the selected image into the shared library. */
function PublishForm({ image, categories }: { image: GeneratedImage; categories: Category[] }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(!!image.publishedAvatarId);

  if (done) {
    return <p className="text-xs text-success">Published to the shared library.</p>;
  }
  return (
    <details className="rounded-xl border border-glass-border p-3">
      <summary className="cursor-pointer text-xs font-medium text-text-muted">
        Publish to shared library (Creator)
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <Field
          label="Library name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Silver Comet"
        />
        <Select
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <ErrorText>{error}</ErrorText>
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          disabled={name.trim().length < 2 || !categoryId}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api.ai.publish(image.id, { name: name.trim(), categoryId });
              setDone(true);
              toast.success('Published', `${name.trim()} is now in the shared library.`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Publish
        </Button>
      </div>
    </details>
  );
}
