import { useEffect, useRef, useState } from 'react';
import type { FaceAdjust, FaceBox, PosterStatus, PosterTemplate } from '../../lib/api';
import { drawFacePreview } from '../../lib/faces';
import { Modal } from '../../components/Modal';
import { Button, Pill } from '../../components/ui';
import { IconAlert, IconCake, IconSparkles, IconSwap } from '../../components/icons';
import { NO_ADJUST, autoArrange, slotOf, type Participant } from './state';

export type SceneMode = 'auto' | 'ai' | 'template';

/** A face box in the middle of the photo, used as a starting point for manual placement. */
const DEFAULT_FACE: FaceBox = { x: 0.34, y: 0.18, w: 0.32, h: 0.32 };

export function PositionsStep({
  template,
  selected,
  setSelected,
  scene,
  setScene,
  status,
  variation,
  onArranged,
}: {
  template: PosterTemplate;
  selected: Participant[];
  setSelected: (fn: (prev: Participant[]) => Participant[]) => void;
  scene: SceneMode;
  setScene: (s: SceneMode) => void;
  status: PosterStatus | null;
  variation: number;
  /** true = automatic arrangement, false = moved by hand. */
  onArranged: (auto: boolean) => void;
}) {
  const [active, setActive] = useState<string | null>(null); // person id
  const [adjusting, setAdjusting] = useState<Participant | null>(null);

  /** Moves a person to a slot; whoever was there swaps into their old slot. */
  const moveTo = (personId: string, slotId: string) => {
    onArranged(false);
    setSelected((prev) => {
      const me = prev.find((p) => p.person.id === personId);
      if (!me) return prev;
      const other = prev.find((p) => p.slot === slotId);
      return prev.map((p) =>
        p.person.id === personId
          ? { ...p, slot: slotId }
          : other && p.person.id === other.person.id
            ? { ...p, slot: me.slot }
            : p,
      );
    });
  };

  const clickSlot = (slotId: string) => {
    const occupant = selected.find((p) => p.slot === slotId);
    if (active) {
      if (occupant?.person.id !== active) moveTo(active, slotId);
      setActive(null);
    } else if (occupant) {
      setActive(occupant.person.id);
    }
  };

  const isPhoto = template.kind === 'photo';
  const usable = template.slots.slice(
    0,
    isPhoto ? template.slots.length : template.maxParticipants,
  );
  const { width: CW, height: CH } = template.canvas;
  const unfilled = isPhoto ? template.slots.length - selected.length : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <section className="glass flex flex-col gap-3 p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Group positions</h2>
            <p className="text-sm text-text-muted">
              {active
                ? 'Now click another position to move or swap.'
                : 'Click a person, then another position to move or swap them.'}
            </p>
          </div>
          <Button
            variant="subtle"
            size="sm"
            icon={<IconSwap size={14} />}
            onClick={() => {
              onArranged(true);
              setSelected((prev) => autoArrange(prev, template, variation));
            }}
          >
            Arrange automatically
          </Button>
        </header>
        <svg
          viewBox={`0 0 ${CW} ${CH}`}
          className="w-full rounded-2xl border border-glass-border bg-[#eef3f7]"
          role="group"
          aria-label="Poster layout"
        >
          {isPhoto && template.photoUrl ? (
            <image
              href={template.photoUrl}
              x="0"
              y="0"
              width={CW}
              height={CH}
              preserveAspectRatio="none"
              opacity="0.75"
            />
          ) : (
            <>
              <rect x="0" y="0" width="2000" height="330" fill="#ffffff" opacity="0.6" />
              <text
                x="1000"
                y="200"
                textAnchor="middle"
                fontSize="110"
                fontWeight="700"
                fill="#1d3c8f"
                opacity="0.35"
              >
                {template.heading}
              </text>
              <rect
                x="60"
                y="1120"
                width="1880"
                height="380"
                fill="#ffffff"
                stroke="#c9d3dd"
                strokeWidth="6"
              />
              <rect
                x="765"
                y="915"
                width="470"
                height="225"
                rx="14"
                fill="#ffffff"
                stroke="#1f9d55"
                strokeWidth="8"
              />
              <text x="1000" y="1060" textAnchor="middle" fontSize="54" fill="#1f9d55">
                🎂
              </text>
            </>
          )}
          {usable.map((s) => {
            const p = selected.find((x) => x.slot === s.id);
            const r = s.faceHeight * 0.55;
            const isActive = p && p.person.id === active;
            return (
              <g
                key={s.id}
                role="button"
                tabIndex={0}
                aria-label={`${s.label}${p ? `: ${p.person.name}` : ' (empty)'}`}
                onClick={() => clickSlot(s.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && clickSlot(s.id)}
                className="cursor-pointer outline-none"
                opacity={p || active ? 1 : 0.45}
              >
                <defs>
                  <clipPath id={`clip-${s.id}`}>
                    <circle cx={s.x} cy={s.y} r={r} />
                  </clipPath>
                </defs>
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={r + 10}
                  fill={p ? '#ffffff' : 'none'}
                  stroke={isActive ? '#7c5cff' : s.role === 'cutter' ? '#f2b632' : '#94a3b8'}
                  strokeWidth={isActive ? 18 : 10}
                  strokeDasharray={p ? undefined : '18 14'}
                />
                {p && (
                  <image
                    href={p.photo.thumbUrl}
                    x={s.x - r}
                    y={s.y - r}
                    width={r * 2}
                    height={r * 2}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#clip-${s.id})`}
                  />
                )}
                <text
                  x={s.x}
                  y={s.y + r + 56}
                  textAnchor="middle"
                  fontSize="42"
                  fontWeight="700"
                  fill={isPhoto ? '#ffffff' : '#0f172a'}
                  stroke={isPhoto ? '#0f172a' : 'none'}
                  strokeWidth={isPhoto ? 8 : 0}
                  paintOrder="stroke"
                >
                  {p
                    ? p.person.name.split(' ')[0]
                    : s.role === 'cutter'
                      ? 'Cake cutter'
                      : isPhoto
                        ? s.label
                        : '+'}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="flex items-center gap-2 text-xs text-text-dim">
          <IconCake size={14} /> Gold rings are the cake-cutting positions.
          {isPhoto &&
            unfilled > 0 &&
            ` ${unfilled} face${unfilled > 1 ? 's' : ''} in the photo will stay as in the template.`}
        </p>
      </section>

      <section className="glass flex flex-col gap-4 p-5">
        <h2 className="text-lg font-semibold">Participants</h2>
        <ul className="flex flex-col gap-2">
          {selected.map((p) => {
            const slot = slotOf(template, p.slot);
            const noFace = !p.face && !p.photo.face;
            return (
              <li
                key={p.person.id}
                className="flex items-center gap-3 rounded-2xl border border-glass-border bg-glass p-2"
              >
                <img
                  src={p.photo.thumbUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.person.name}{' '}
                    {slot?.role === 'cutter' && <Pill tone="warn">Cuts the cake</Pill>}
                  </p>
                  <select
                    value={p.slot}
                    onChange={(e) => moveTo(p.person.id, e.target.value)}
                    aria-label={`Position for ${p.person.name}`}
                    className="mt-1 w-full rounded-lg border border-glass-border bg-transparent px-2 py-1 text-xs"
                  >
                    {usable.map((s) => {
                      const who = selected.find(
                        (x) => x.slot === s.id && x.person.id !== p.person.id,
                      );
                      return (
                        <option key={s.id} value={s.id} className="text-black">
                          {s.label}
                          {who ? ` — swap with ${who.person.name}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <Button
                  size="sm"
                  variant={noFace ? 'primary' : 'ghost'}
                  icon={noFace ? <IconAlert size={14} /> : undefined}
                  onClick={() => setAdjusting(p)}
                >
                  {noFace ? 'Set face' : 'Adjust face'}
                </Button>
              </li>
            );
          })}
        </ul>

        {isPhoto ? (
          <p className="rounded-2xl border border-glass-border p-3 text-sm text-text-muted">
            Photo template: each person's real face replaces the face at their position in the
            photo. The logo, banner, cake and decorations stay exactly as in the template photo.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2 rounded-2xl border border-glass-border p-3">
            <legend className="px-1 text-sm font-medium">Scene</legend>
            {(
              [
                [
                  'auto',
                  'Automatic',
                  status?.ai.enabled
                    ? 'Photorealistic AI scene'
                    : 'Template scene (AI not available)',
                ],
                [
                  'ai',
                  'Photorealistic (AI)',
                  status?.ai.enabled
                    ? 'AI turns the layout into a photo; original faces are pasted back'
                    : (status?.ai.reason ?? ''),
                ],
                [
                  'template',
                  'Template illustration',
                  'Built-in SageIT scene with the real faces — no AI',
                ],
              ] as const
            ).map(([value, label, help]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="scene"
                  value={value}
                  checked={scene === value}
                  disabled={value === 'ai' && !status?.ai.enabled}
                  onChange={() => setScene(value)}
                  className="mt-1"
                />
                <span>
                  {label} {value === 'ai' && <IconSparkles size={13} className="inline" />}
                  <span className="block text-xs text-text-dim">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </section>

      {adjusting && (
        <FaceAdjustDialog
          participant={adjusting}
          onClose={() => setAdjusting(null)}
          onSave={(face, adjust) => {
            setSelected((prev) =>
              prev.map((p) => (p.person.id === adjusting.person.id ? { ...p, face, adjust } : p)),
            );
            setAdjusting(null);
          }}
        />
      )}
    </div>
  );
}

/** Manual face alignment with a live preview of exactly what the poster will use. */
function FaceAdjustDialog({
  participant,
  onClose,
  onSave,
}: {
  participant: Participant;
  onClose: () => void;
  onSave: (face: FaceBox | undefined, adjust: FaceAdjust) => void;
}) {
  const detected = participant.photo.face;
  const [face] = useState<FaceBox>(participant.face ?? detected ?? DEFAULT_FACE);
  const [adjust, setAdjust] = useState<FaceAdjust>(participant.adjust);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError('The photo could not be loaded.');
    i.src = participant.photo.fileUrl;
  }, [participant.photo.fileUrl]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx && img) drawFacePreview(ctx, img, face, adjust);
  }, [img, face, adjust]);

  const slider = (key: keyof FaceAdjust, label: string, min: number, max: number, step: number) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between">
        {label} <span className="text-text-dim">{adjust[key].toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={adjust[key]}
        onChange={(e) => setAdjust((a) => ({ ...a, [key]: Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Align ${participant.person.name}'s face`}
      description={
        detected
          ? 'Fit the face inside the dashed oval. This changes only this poster, never the original photo.'
          : 'No face was detected automatically. Move and zoom until the face fills the dashed oval.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => setAdjust(NO_ADJUST)}>
            Reset
          </Button>
          <Button onClick={() => onSave(detected && !participant.face ? undefined : face, adjust)}>
            Use this alignment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
        <canvas
          ref={canvas}
          width={260}
          height={260}
          className="rounded-2xl bg-black/30"
          aria-label="Face preview"
        />
        <div className="flex flex-col gap-3">
          {slider('zoom', 'Zoom', 0.5, 2, 0.01)}
          {slider('dx', 'Left / right', -1, 1, 0.01)}
          {slider('dy', 'Up / down', -1, 1, 0.01)}
          {slider('rotate', 'Rotate (°)', -45, 45, 0.5)}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-accent">{error}</p>}
    </Modal>
  );
}
