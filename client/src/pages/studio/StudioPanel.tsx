import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Avatar, PhotoFormat } from '../../lib/api';
import { FormatPicker } from './Dialogs';
import { PLACEMENT_LABEL, type Placement, type StudioMode } from '../../lib/compose';
import { Button } from '../../components/ui';
import {
  IconBody,
  IconCheck,
  IconDownload,
  IconEye,
  IconFace,
  IconFlip,
  IconLayers,
  IconMail,
  IconSparkles,
  IconX,
} from '../../components/icons';

export type CutoutState = 'idle' | 'working' | 'ready' | 'failed';
export type DetectState = 'idle' | 'working' | 'ready' | 'failed';

/** What Step 3's sliders edit — the face filter adjustment or the avatar transform. */
export interface Adjustable {
  size: number; // percent
  sizeRange: [number, number];
  rotation: number;
  opacity: number; // percent
  onSize: (v: number) => void;
  onRotation: (v: number) => void;
  onOpacity: (v: number) => void;
  onNudge: (dx: number, dy: number) => void;
  mirror?: { on: boolean; toggle: () => void };
  onReset: () => void;
}

interface PanelProps {
  hasPhoto: boolean;
  mode: StudioMode;
  placement: Placement;
  avatar: Avatar | null;
  filterName: string | null;
  /** Step 1 */
  onBrowseFilters: () => void;
  onSelectAvatar: () => void;
  /** Step 2 */
  onMode: (m: StudioMode, placement?: Placement) => void;
  faces: { count: number; state: DetectState; targets: 'all' | number[] };
  onTargets: (t: 'all' | number[]) => void;
  body: { style: 'overlay' | 'replace'; keepFace: boolean; source: string | null };
  onBodyStyle: (s: 'overlay' | 'replace') => void;
  onKeepFace: (on: boolean) => void;
  cutout: CutoutState;
  /** Step 3 */
  adjust: Adjustable | null;
  customizing: boolean;
  onToggleCustomize: () => void;
  onRemoveFilter: () => void;
  onResetAll: () => void;
  busy: 'download' | 'email' | 'preview' | null;
  onPreview: () => void;
  onDownload: () => void;
  format: PhotoFormat;
  onFormat: (f: PhotoFormat) => void;
  onEmail: () => void;
  /** Event mode only: primary "Save to Event" action. */
  onSaveToEvent?: () => void;
  savingToEvent?: boolean;
}

const OPTIONS: { id: string; mode: StudioMode; placement?: Placement; label: string; hint: string; icon?: ReactNode }[] = [
  { id: 'face', mode: 'face', label: 'Face Filter', hint: 'On the detected face', icon: <IconFace size={16} /> },
  { id: 'body', mode: 'body', label: 'Full-Body Avatar', hint: 'Fitted to your body', icon: <IconBody size={16} /> },
  { id: 'beside', mode: 'place', placement: 'beside', label: PLACEMENT_LABEL.beside, hint: 'Standing next to you' },
  { id: 'behind', mode: 'place', placement: 'behind', label: PLACEMENT_LABEL.behind, hint: 'Peeking out behind you' },
  { id: 'left', mode: 'place', placement: 'left', label: PLACEMENT_LABEL.left, hint: 'On your left side' },
  { id: 'right', mode: 'place', placement: 'right', label: PLACEMENT_LABEL.right, hint: 'On your right side' },
  { id: 'foreground', mode: 'place', placement: 'foreground', label: PLACEMENT_LABEL.foreground, hint: 'In front, near the bottom' },
];

/** The three-step workflow: choose → apply → customize & export. */
export function StudioPanel(p: PanelProps) {
  const isBackground = p.avatar?.type === 'BACKGROUND';
  const ready = p.hasPhoto;
  const activeId = p.mode === 'place' ? p.placement : p.mode;
  const chosen = p.mode === 'face' ? !!p.filterName : !!p.avatar;

  return (
    <aside aria-label="Studio controls" className="flex flex-col gap-4">
      <Section step={1} title="Choose Avatar or Filter" done={chosen}>
        <p className="mb-3 text-sm text-text-muted">
          {p.mode === 'face' ? (
            p.filterName ? (
              <>
                Filter: <span className="text-text">{p.filterName}</span>
              </>
            ) : (
              'Tap a filter in the carousel under the camera.'
            )
          ) : p.avatar ? (
            <>
              <span className="text-text">{p.avatar.name}</span> · {p.avatar.category.name}
            </>
          ) : (
            'Pick an avatar from the gallery under the camera.'
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant={p.mode === 'face' ? 'primary' : 'ghost'} size="sm" icon={<IconFace size={15} />} onClick={p.onBrowseFilters}>
            Browse filters
          </Button>
          <Button variant={p.mode === 'face' ? 'ghost' : 'primary'} size="sm" icon={<IconSparkles size={15} />} onClick={p.onSelectAvatar}>
            Select avatar
          </Button>
        </div>
      </Section>

      <Section step={2} title="Apply Face or Full-Body Effect" done={chosen && ready} id="studio-placement">
        <div role="radiogroup" aria-label="Avatar placement" className="grid grid-cols-2 gap-2">
          {OPTIONS.map((o) => {
            const active = activeId === o.id;
            const wide = o.id === 'face' || o.id === 'body';
            return (
              <motion.button
                key={o.id}
                role="radio"
                aria-checked={active}
                onClick={() => p.onMode(o.mode, o.placement)}
                whileTap={{ scale: 0.96 }}
                title={o.hint}
                className={`relative rounded-2xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  wide ? '' : o.id === 'foreground' ? 'col-span-2' : ''
                } ${active ? 'border-transparent text-white' : 'border-glass-border text-text-muted hover:border-glass-edge hover:text-text'}`}
              >
                {active && (
                  <motion.span
                    layoutId="apply-pill"
                    className="bg-gradient-brand absolute inset-0 -z-10 rounded-2xl opacity-90 shadow-[var(--shadow-glow)]"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                  />
                )}
                <span className="flex items-center gap-1.5 font-medium">
                  {o.icon}
                  {o.label}
                </span>
                <span className={`block text-[11px] ${active ? 'text-white/80' : 'text-text-dim'}`}>{o.hint}</span>
              </motion.button>
            );
          })}
        </div>

        {p.mode === 'face' && <FaceOptions {...p} />}
        {p.mode === 'body' && <BodyOptions {...p} />}
        {p.mode === 'place' && isBackground && (
          <p className="mt-3 text-sm text-text-muted">
            Background avatars replace the scene behind you — no placement needed.
          </p>
        )}
        {p.mode === 'place' && p.placement === 'behind' && !p.hasPhoto && (
          <p className="mt-2 text-xs text-text-dim">“Behind person” is applied once you take or upload a photo.</p>
        )}
        <CutoutNote state={p.cutout} />
      </Section>

      <Section
        step={3}
        title="Customize and Preview"
        action={
          <Button
            variant={p.customizing && p.adjust ? 'primary' : 'ghost'}
            size="sm"
            aria-expanded={p.customizing && !!p.adjust}
            aria-controls="customize-controls"
            disabled={!p.adjust}
            onClick={p.onToggleCustomize}
          >
            {p.customizing && p.adjust ? 'Done' : 'Customize'}
          </Button>
        }
      >
        <AnimatePresence initial={false}>
          {p.customizing && p.adjust ? (
            <motion.div
              id="customize-controls"
              key="ctl"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-3 pt-1">
                <Slider label="Size" min={p.adjust.sizeRange[0]} max={p.adjust.sizeRange[1]} value={Math.round(p.adjust.size)} suffix="%" onChange={p.adjust.onSize} />
                <Slider label="Rotation" min={-180} max={180} value={Math.round(p.adjust.rotation)} suffix="°" onChange={p.adjust.onRotation} />
                <Slider label="Opacity" min={10} max={100} value={Math.round(p.adjust.opacity)} suffix="%" onChange={p.adjust.onOpacity} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">Position</span>
                  <Nudge onNudge={p.adjust.onNudge} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.adjust.mirror && (
                    <Button
                      size="sm"
                      variant={p.adjust.mirror.on ? 'primary' : 'ghost'}
                      aria-pressed={p.adjust.mirror.on}
                      icon={<IconFlip size={14} />}
                      onClick={p.adjust.mirror.toggle}
                    >
                      Mirror
                    </Button>
                  )}
                  <Button size="sm" variant="subtle" onClick={p.adjust.onReset}>
                    Reset alignment
                  </Button>
                  {p.mode === 'face' && (
                    <Button size="sm" variant="subtle" icon={<IconX size={14} />} onClick={p.onRemoveFilter}>
                      Remove filter
                    </Button>
                  )}
                </div>
                <p className="text-xs text-text-dim">
                  Tip: drag on the photo, scroll to resize, or use arrow keys. Hold “Compare” on the photo to see the original.
                </p>
              </div>
            </motion.div>
          ) : (
            <p className="text-sm text-text-muted">
              {p.adjust
                ? 'Fine-tune size, position, rotation and opacity — your original photo is never changed.'
                : 'Choose a filter or avatar to customize it.'}
            </p>
          )}
        </AnimatePresence>
        {p.hasPhoto && (
          <button type="button" onClick={p.onResetAll} className="mt-2 text-xs text-text-dim underline-offset-2 hover:text-text hover:underline">
            Reset composition
          </button>
        )}
      </Section>

      <div className="glass flex flex-col gap-2 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" icon={<IconEye size={16} />} disabled={!ready} loading={p.busy === 'preview'} onClick={p.onPreview}>
            Preview
          </Button>
          <Button variant="ghost" icon={<IconMail size={16} />} disabled={!ready} loading={p.busy === 'email'} onClick={p.onEmail}>
            Email
          </Button>
        </div>
        {p.onSaveToEvent && (
          <Button size="lg" icon={<IconCheck size={18} />} disabled={!ready} loading={p.savingToEvent} onClick={p.onSaveToEvent}>
            Save to Event
          </Button>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-text-dim">Download as</span>
          <FormatPicker value={p.format} onChange={p.onFormat} id="panel" />
        </div>
        <Button
          size="lg"
          variant={p.onSaveToEvent ? 'ghost' : 'primary'}
          icon={<IconDownload size={18} />}
          disabled={!ready}
          loading={p.busy === 'download'}
          onClick={p.onDownload}
        >
          Download {p.format.toUpperCase()}
        </Button>
        {!ready && <p className="text-center text-xs text-text-dim">Take or upload a photo to finish.</p>}
      </div>
    </aside>
  );
}

function FaceOptions(p: PanelProps) {
  const { count, state, targets } = p.faces;
  if (!p.hasPhoto) {
    return (
      <p className="mt-3 text-xs text-text-dim">
        Filters follow your face live on the camera, or upload a photo to apply them.
      </p>
    );
  }
  if (state === 'working') return <Note>Finding faces in your photo…</Note>;
  if (state === 'failed') return <Note warn>The face tracker couldn’t run in this browser. Try reloading the page.</Note>;
  if (!count) {
    return (
      <Note warn>
        No face found in this photo. Try a clearer, front-facing photo — or use Full-Body Avatar or a placement instead.
      </Note>
    );
  }
  const isOn = (i: number) => targets === 'all' || targets.includes(i);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <span className="text-xs text-text-muted">
        {count === 1 ? '1 face found.' : `${count} faces found — choose who gets the filter:`}
      </span>
      {count > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <ChipButton active={targets === 'all'} onClick={() => p.onTargets('all')}>
            All faces
          </ChipButton>
          {Array.from({ length: count }, (_, i) => (
            <ChipButton
              key={i}
              active={targets !== 'all' && isOn(i)}
              onClick={() => {
                const cur = targets === 'all' ? [] : targets;
                const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
                p.onTargets(next.length ? next.sort((a, b) => a - b) : 'all');
              }}
            >
              Face {i + 1}
            </ChipButton>
          ))}
        </div>
      )}
    </div>
  );
}

function BodyOptions(p: PanelProps) {
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <div role="radiogroup" aria-label="Full-body style" className="grid grid-cols-2 gap-1.5">
        {(
          [
            ['overlay', 'Character overlay', 'Over you, background kept'],
            ['replace', 'Full replacement', 'You’re removed, avatar stands in'],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={p.body.style === id}
            onClick={() => p.onBodyStyle(id)}
            className={`rounded-xl border px-2.5 py-2 text-left text-xs transition-colors ${
              p.body.style === id ? 'border-brand-2/70 bg-brand-2/10 text-text' : 'border-glass-border text-text-muted hover:text-text'
            }`}
          >
            <span className="block font-medium">{label}</span>
            <span className="text-[10px] text-text-dim">{hint}</span>
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-2 text-sm">
        <span>
          Keep my face
          <span className="block text-[11px] text-text-dim">Your real face on the avatar’s head</span>
        </span>
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand-2)]" checked={p.body.keepFace} onChange={(e) => p.onKeepFace(e.target.checked)} />
      </label>
      {p.hasPhoto && p.body.source && <span className="text-[11px] text-text-dim">Aligned using {p.body.source}.</span>}
      {!p.hasPhoto && <p className="text-xs text-text-dim">The avatar is fitted to your body once you capture or upload a photo.</p>}
      {p.avatar?.type === 'BACKGROUND' && <Note warn>Background avatars can’t be worn — pick a full-body or half-body avatar.</Note>}
    </div>
  );
}

function Note({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <p role={warn ? 'alert' : 'status'} className={`mt-3 rounded-xl px-3 py-2 text-xs ${warn ? 'bg-accent/10 text-accent' : 'bg-brand-2/10 text-brand-2'}`}>
      {children}
    </p>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? 'border-brand-2/70 bg-brand-2/15 text-text' : 'border-glass-border text-text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function Nudge({ onNudge }: { onNudge: (dx: number, dy: number) => void }) {
  const b = 'grid h-7 w-7 place-items-center rounded-lg border border-glass-border text-text-muted hover:text-text hover:border-glass-edge';
  const s = 0.01;
  return (
    <div className="grid grid-cols-3 gap-1" aria-label="Move">
      <span />
      <button type="button" aria-label="Move up" className={b} onClick={() => onNudge(0, -s)}>↑</button>
      <span />
      <button type="button" aria-label="Move left" className={b} onClick={() => onNudge(-s, 0)}>←</button>
      <button type="button" aria-label="Move down" className={b} onClick={() => onNudge(0, s)}>↓</button>
      <button type="button" aria-label="Move right" className={b} onClick={() => onNudge(s, 0)}>→</button>
    </div>
  );
}

function Section({
  step,
  title,
  done,
  action,
  children,
  id,
}: {
  step: number;
  title: string;
  done?: boolean;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="glass scroll-mt-28 p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold">
          <span
            className={`grid h-6 w-6 place-items-center rounded-full text-[11px] transition-colors ${
              done ? 'bg-gradient-brand text-white' : 'border border-glass-border text-text-muted'
            }`}
          >
            {step}
          </span>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  suffix,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="flex justify-between text-text-muted">
        {label}
        <span className="tabular-nums text-text">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-range"
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </label>
  );
}

function CutoutNote({ state }: { state: CutoutState }) {
  if (state === 'idle' || state === 'ready') return null;
  return (
    <p
      role={state === 'failed' ? 'alert' : 'status'}
      className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
        state === 'failed' ? 'bg-accent/10 text-accent' : 'bg-brand-2/10 text-brand-2'
      }`}
    >
      <IconLayers size={14} className="mt-px shrink-0" />
      {state === 'working'
        ? 'Finding you in the photo… (first time loads the cut-out engine)'
        : 'Couldn’t separate you from the background, so the avatar is drawn in front. Try a photo with clearer lighting.'}
    </p>
  );
}
