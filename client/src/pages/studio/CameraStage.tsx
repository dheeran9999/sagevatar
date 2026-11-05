import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Avatar } from '../../lib/api';
import type { CameraError } from '../../lib/camera';
import { renderScene, type Scene, type StudioMode, type Transform } from '../../lib/compose';
import { smoothFaces, trackFaces, type FaceGeom } from '../../lib/facemesh';
import { drawFilterOnFace, type FaceFilter, type FilterAdjust } from '../../lib/faceFilters';
import { ACCEPT_ATTR, MAX_PHOTO_MB, type Photo } from '../../lib/image';
import type { CameraStatus } from '../../hooks/useCamera';
import { useContainSize } from '../../hooks/useContainSize';
import { Button, Pill, Spinner } from '../../components/ui';
import {
  IconAlert,
  IconCamera,
  IconCompare,
  IconFlip,
  IconSparkles,
  IconUpload,
} from '../../components/icons';

/** Preview canvas is capped for speed; export always renders at full photo resolution. */
const PREVIEW_MAX = 1600;
/** Live filter canvas cap (keeps real-time drawing cheap on phones). */
const LIVE_MAX = 1280;

/** A draggable thing on the stage, as fractions of the media box. */
export interface StageHandle {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface FaceMarker {
  x: number;
  y: number;
  label: string;
  active: boolean;
}

export interface StageProps {
  videoRef: RefObject<HTMLVideoElement>;
  status: CameraStatus;
  error: CameraError | null;
  mirrored: boolean;
  canSwitch: boolean;
  photo: Photo | null;
  scene: Omit<Scene, 'photo'> | null;
  mode: StudioMode;
  avatar: Avatar | null;
  transform: Transform;
  /** Outline(s) of what dragging moves. */
  handles: StageHandle[];
  editable: boolean;
  busyLabel: string | null;
  capturing: boolean;
  /** Face markers for choosing which face gets the filter (photo mode). */
  faceMarkers: FaceMarker[];
  onFaceToggle: (i: number) => void;
  /** Face outlines briefly shown after "Scan Face" (fractions). */
  scanOverlay: { x: number; y: number }[][] | null;
  /** Live camera face filter (applied in real time). */
  liveFilter: { filter: FaceFilter; adjust: FilterAdjust } | null;
  /** Increments to request a live scan overlay. */
  liveScanToken: number;
  onLiveFaces: (count: number) => void;
  /** Short hint over the media (e.g. "Full-body fit applies after you capture"). */
  hint: string | null;
  onStartCamera: () => void;
  onCapture: () => void;
  onRetake: () => void;
  onSwitch: () => void;
  onUpload: (file: File) => void;
  /** Drag by a fraction of the media box. */
  onNudge: (dx: number, dy: number) => void;
  /** Resize by a factor. */
  onZoom: (k: number) => void;
  uploadInputRef: RefObject<HTMLInputElement>;
  /** Shown when the person has an authorised profile photograph. */
  onUseProfilePhoto?: () => void;
}

export function CameraStage({ videoRef, uploadInputRef, ...p }: StageProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const live = p.status === 'live' && !p.photo;
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const ratio = p.photo ? p.photo.width / p.photo.height : live ? videoRatio : 16 / 9;
  const hasMedia = !!p.photo || live;
  const box = useContainSize(areaRef, ratio);
  const [comparing, setComparing] = useState(false);

  // Draw the composition whenever the scene changes (or the original while comparing).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !p.photo || !p.scene) return;
    const k = Math.min(1, PREVIEW_MAX / Math.max(p.photo.width, p.photo.height));
    c.width = Math.round(p.photo.width * k);
    c.height = Math.round(p.photo.height * k);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (comparing) ctx.drawImage(p.photo.canvas, 0, 0, c.width, c.height);
    else renderScene(ctx, { ...p.scene, photo: p.photo.canvas });
  }, [p.photo, p.scene, comparing]);

  // ---- live camera: track faces every frame and draw the filter on top of the video ----
  // The draw loop reads the latest props through refs, so switching filters never restarts it.
  const filterRef = useRef(p.liveFilter);
  const mirroredRef = useRef(p.mirrored);
  const onLiveFacesRef = useRef(p.onLiveFaces);
  useEffect(() => {
    filterRef.current = p.liveFilter;
    mirroredRef.current = p.mirrored;
    onLiveFacesRef.current = p.onLiveFaces;
  });
  const scanUntil = useRef(0);
  const wantsLiveFilter = live && !!p.liveFilter;

  useEffect(() => {
    if (p.liveScanToken) scanUntil.current = performance.now() + 2200;
  }, [p.liveScanToken]);

  useEffect(() => {
    if (!live || (!wantsLiveFilter && !p.liveScanToken)) return;
    const video = videoRef.current;
    const canvas = liveRef.current;
    if (!video || !canvas) return;
    let alive = true;
    let raf = 0;
    let busy = false;
    let faces: FaceGeom[] = [];
    let lastCount = -1;
    const t0 = performance.now();

    const draw = () => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || video.readyState < 2) return;
      const k = Math.min(1, LIVE_MAX / Math.max(vw, vh));
      const cw = Math.round(vw * k);
      const ch = Math.round(vh * k);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Detection runs as fast as the engine allows; drawing never waits for it.
      if (!busy) {
        busy = true;
        trackFaces(video, mirroredRef.current)
          .then((next) => {
            faces = smoothFaces(faces, next);
            if (next.length !== lastCount) {
              lastCount = next.length;
              onLiveFacesRef.current(next.length);
            }
          })
          .catch(() => undefined)
          .finally(() => (busy = false));
      }
      ctx.save();
      if (mirroredRef.current) {
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, cw, ch);
      ctx.restore();
      const f = filterRef.current;
      const t = (performance.now() - t0) / 1000;
      if (f) for (const face of faces) drawFilterOnFace(ctx, f.filter, face, f.adjust, t, k);
      if (performance.now() < scanUntil.current) drawScan(ctx, faces, k);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [live, wantsLiveFilter, p.liveScanToken, videoRef]);

  // ---- direct manipulation: drag to move, wheel to resize, keys for both ----
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!p.editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !box.width) return;
    p.onNudge((e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = () => (drag.current = null);
  const onWheel = (e: React.WheelEvent) => {
    if (!p.editable) return;
    p.onZoom(e.deltaY < 0 ? 1.05 : 0.95);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!p.editable) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const map: Record<string, () => void> = {
      ArrowLeft: () => p.onNudge(-step, 0),
      ArrowRight: () => p.onNudge(step, 0),
      ArrowUp: () => p.onNudge(0, -step),
      ArrowDown: () => p.onNudge(0, step),
      '+': () => p.onZoom(1.05),
      '=': () => p.onZoom(1.05),
      '-': () => p.onZoom(0.95),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  };

  // Live preview of a placed avatar (place/body modes) before a photo exists.
  const showLiveOverlay = live && !!p.avatar && p.avatar.type !== 'BACKGROUND' && p.mode === 'place';
  const aspect = p.avatar ? p.avatar.width / p.avatar.height : 1;
  const overlayStyle = {
    left: `${p.transform.x * 100}%`,
    top: `${p.transform.y * 100}%`,
    height: `${p.transform.scale * 100}%`,
    aspectRatio: `${aspect}`,
    transform: `translate(-50%, -50%) rotate(${p.transform.rotation}deg) scaleX(${p.transform.flipX ? -1 : 1})`,
    opacity: p.transform.opacity,
  } as const;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) p.onUpload(f);
  };

  const label =
    p.mode === 'face' ? 'filter' : p.mode === 'body' ? 'avatar' : p.avatar?.name ?? 'avatar';

  return (
    <section
      aria-label="Camera"
      className={`glass viewfinder neon-ring relative flex flex-col overflow-hidden !rounded-[1.75rem] ${
        hasMedia ? 'surface-dark bg-ink-2/90' : ''
      } ${
        hasMedia ? 'min-h-[22rem]' : 'min-h-[30rem] aspect-[3/4] sm:aspect-[4/3] lg:aspect-[16/10]'
      }`}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,rgb(31_111_255/0.2),transparent_60%),radial-gradient(90%_70%_at_50%_120%,rgb(34_211_238/0.1),transparent_60%)]"
      />

      {/* With media the work area takes the media's shape (capped to the viewport) so phones
          don't get letterbox bands; without media it fills the fixed-shape stage. */}
      <div
        ref={areaRef}
        className={`relative mx-3 mb-24 mt-14 flex items-center justify-center sm:mx-6 sm:mb-28 ${hasMedia ? '' : 'flex-1'}`}
        style={hasMedia ? { aspectRatio: String(ratio), maxHeight: '68vh' } : undefined}
      >
        {/* Media box: exactly the photo/video aspect so pointer maths match the pixels. */}
        <div
          className={`relative overflow-hidden rounded-2xl ${p.photo || live ? 'shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)]' : ''}`}
          style={{ width: box.width || undefined, height: box.height || undefined }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Live camera preview"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setVideoRatio(v.videoWidth / v.videoHeight);
            }}
            className={`absolute inset-0 h-full w-full object-cover ${live ? '' : 'hidden'} ${wantsLiveFilter ? 'opacity-0' : ''}`}
            style={{ transform: p.mirrored ? 'scaleX(-1)' : undefined }}
          />
          {live && (wantsLiveFilter || p.liveScanToken > 0) && (
            <canvas
              ref={liveRef}
              aria-label="Live camera with face filter"
              role="img"
              className={`absolute inset-0 h-full w-full ${wantsLiveFilter ? '' : 'pointer-events-none'}`}
            />
          )}
          {p.photo && (
            <canvas
              ref={canvasRef}
              aria-label={comparing ? 'Your original photo' : 'Your photo with the effect applied'}
              role="img"
              className="absolute inset-0 h-full w-full"
            />
          )}

          {showLiveOverlay && (
            <img
              src={p.avatar!.fileUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={overlayStyle}
            />
          )}

          {/* Manipulation layer */}
          {(p.photo || live) && (
            <div
              role="application"
              tabIndex={p.editable ? 0 : -1}
              aria-label={`Move the ${label}: drag, or use arrow keys to move and plus or minus to resize.`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onWheel={onWheel}
              onKeyDown={onKeyDown}
              className={`absolute inset-0 touch-none outline-none ${p.editable ? 'cursor-grab active:cursor-grabbing' : ''} focus-visible:ring-2 focus-visible:ring-brand-2/70 rounded-2xl`}
            >
              {p.editable &&
                !comparing &&
                p.handles.map((h, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="pointer-events-none absolute rounded-xl border-2 border-dashed border-white/45 shadow-[0_0_0_1px_rgb(0_0_0/0.25)]"
                    style={{
                      left: `${h.x * 100}%`,
                      top: `${h.y * 100}%`,
                      width: `${h.w * 100}%`,
                      height: `${h.h * 100}%`,
                      transform: `translate(-50%, -50%) rotate(${h.rotation}deg)`,
                    }}
                  />
                ))}
            </div>
          )}

          {/* Scan overlay: detected face outlines. */}
          <AnimatePresence>
            {p.scanOverlay && p.photo && (
              <motion.svg
                key="scan"
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {p.scanOverlay.map((pts, i) => (
                  <polygon
                    key={i}
                    points={pts.map((q) => `${q.x},${q.y}`).join(' ')}
                    fill="rgb(34 211 238 / 0.12)"
                    stroke="rgb(103 232 249)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="6 4"
                  />
                ))}
              </motion.svg>
            )}
          </AnimatePresence>

          {/* Face picker: which faces receive the filter. */}
          {p.photo &&
            !comparing &&
            p.faceMarkers.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={() => p.onFaceToggle(i)}
                aria-pressed={m.active}
                aria-label={`Face ${m.label}: ${m.active ? 'filter on' : 'filter off'}`}
                title={m.active ? 'Filter applied — click to skip this face' : 'Click to apply the filter to this face'}
                className={`absolute z-10 grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border px-1.5 text-xs font-bold shadow-lg transition-colors ${
                  m.active
                    ? 'border-white/70 bg-brand-2 text-ink-2'
                    : 'border-white/40 bg-black/55 text-white/80 hover:bg-black/70'
                }`}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              >
                {m.label}
              </button>
            ))}

          {/* Compare: hold to see the untouched original. */}
          {p.photo && (
            <button
              type="button"
              aria-pressed={comparing}
              onPointerDown={() => setComparing(true)}
              onPointerUp={() => setComparing(false)}
              onPointerLeave={() => setComparing(false)}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setComparing(true)}
              onKeyUp={() => setComparing(false)}
              onBlur={() => setComparing(false)}
              className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/65"
            >
              <IconCompare size={14} /> {comparing ? 'Original' : 'Hold to compare'}
            </button>
          )}

          {p.hint && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center">
              <span className="rounded-full bg-black/60 px-3 py-1.5 text-center text-xs text-white backdrop-blur-sm">
                {p.hint}
              </span>
            </div>
          )}

          <AnimatePresence>
            {p.capturing && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-white"
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45 }}
              />
            )}
          </AnimatePresence>
        </div>

        {!p.photo && !live && (
          <EmptyStage
            status={p.status}
            error={p.error}
            onStart={p.onStartCamera}
            onUpload={() => uploadInputRef.current?.click()}
            onUseProfilePhoto={p.onUseProfilePhoto}
          />
        )}
      </div>

      {/* Status chips */}
      <div className="absolute left-[3.25rem] right-4 top-4 flex items-center justify-between gap-2 sm:left-14 sm:right-5 sm:top-5">
        <Pill tone={live ? 'ok' : p.photo ? 'brand' : 'neutral'}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-success animate-pulse-soft' : p.photo ? 'bg-[#c4b5fd]' : 'bg-text-dim'}`}
          />
          {live
            ? 'Camera live'
            : p.photo
              ? p.photo.source === 'CAMERA'
                ? 'Photo captured'
                : 'Photo uploaded'
              : 'Camera off'}
        </Pill>
        <AnimatePresence>
          {p.busyLabel ? (
            <motion.span
              key="busy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Pill tone="brand">
                <Spinner size={11} /> {p.busyLabel}
              </Pill>
            </motion.span>
          ) : (
            (p.liveFilter || p.avatar) && (
              <motion.span
                key={p.liveFilter?.filter.id ?? p.avatar?.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Pill tone="brand">
                  <IconSparkles size={12} />{' '}
                  {p.mode === 'face' ? (p.liveFilter?.filter.name ?? '') : p.avatar?.name}
                </Pill>
              </motion.span>
            )
          )}
        </AnimatePresence>
      </div>

      {/* Control dock */}
      <div className="absolute inset-x-0 bottom-4 flex justify-center sm:bottom-5">
        <div className="glass glass-popover flex items-center gap-3 !rounded-full px-3 py-2 sm:gap-5 sm:px-4">
          <DockButton label="Upload photo" onClick={() => uploadInputRef.current?.click()}>
            <IconUpload size={18} />
          </DockButton>

          {p.photo ? (
            <motion.button
              type="button"
              onClick={p.onRetake}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              className="inline-flex h-14 items-center gap-2 rounded-full border border-glass-edge bg-white/10 px-5 text-sm font-medium text-white"
            >
              <IconCamera size={18} /> Retake
            </motion.button>
          ) : (
            <motion.button
              type="button"
              aria-label={live ? 'Capture photo' : 'Turn on camera'}
              onClick={live ? p.onCapture : p.onStartCamera}
              disabled={p.status === 'starting' || p.capturing}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.9 }}
              className="group relative grid h-16 w-16 place-items-center rounded-full disabled:opacity-60"
            >
              <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_180deg,var(--color-brand),var(--color-blue),var(--color-brand-2),var(--color-brand))] p-[3px]">
                <span className="block h-full w-full rounded-full bg-ink-2" />
              </span>
              {p.status === 'starting' ? (
                <Spinner size={22} className="relative text-text" />
              ) : live ? (
                <span className="relative h-11 w-11 rounded-full bg-white transition group-hover:bg-white/90" />
              ) : (
                <IconCamera size={22} className="relative text-text" />
              )}
            </motion.button>
          )}

          <DockButton label="Switch camera" onClick={p.onSwitch} disabled={!live || !p.canSwitch}>
            <IconFlip size={18} />
          </DockButton>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={onFile}
        className="sr-only"
        tabIndex={-1}
        aria-label={`Upload a JPG, PNG or WebP photo up to ${MAX_PHOTO_MB} MB`}
      />
    </section>
  );
}

/** Face-oval outlines + landmark-ish dots for the live "Scan Face" feedback. */
function drawScan(ctx: CanvasRenderingContext2D, faces: FaceGeom[], k: number) {
  ctx.save();
  ctx.scale(k, k);
  ctx.strokeStyle = 'rgba(103,232,249,0.95)';
  ctx.fillStyle = 'rgba(34,211,238,0.12)';
  ctx.lineWidth = 2 / k;
  ctx.setLineDash([8 / k, 6 / k]);
  for (const f of faces) {
    ctx.beginPath();
    f.ovalPx.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function DockButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      className="grid h-11 w-11 place-items-center rounded-full border border-glass-border bg-glass text-text transition-colors hover:bg-glass-strong disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </motion.button>
  );
}

function EmptyStage({
  status,
  error,
  onStart,
  onUpload,
  onUseProfilePhoto,
}: {
  status: CameraStatus;
  error: CameraError | null;
  onStart: () => void;
  onUpload: () => void;
  onUseProfilePhoto?: () => void;
}) {
  const blocked = error && (error.issue === 'insecure' || error.issue === 'unsupported');
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex max-w-md flex-col items-center gap-3"
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
            <IconAlert size={24} />
          </span>
          <p className="font-display text-lg font-semibold">{error.title}</p>
          <p className="text-sm text-text-muted">{error.message}</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {!blocked && (
              <Button onClick={onStart} icon={<IconCamera size={16} />}>
                Try again
              </Button>
            )}
            <Button variant="ghost" onClick={onUpload} icon={<IconUpload size={16} />}>
              Upload photo
            </Button>
          </div>
        </motion.div>
      ) : (
        <>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 18 }}
            className="relative grid h-20 w-20 place-items-center"
          >
            <span className="absolute inset-0 rounded-full border border-brand-2/40 animate-pulse-soft" />
            <span className="absolute inset-2 rounded-full bg-gradient-brand opacity-25 blur-md" />
            <span className="relative grid h-14 w-14 place-items-center rounded-full border border-glass-edge bg-glass-strong text-text">
              {status === 'starting' ? <Spinner size={22} /> : <IconCamera size={24} />}
            </span>
          </motion.div>
          <div>
            <p className="font-display text-lg font-semibold sm:text-xl">
              {status === 'starting'
                ? 'Waiting for camera permission…'
                : 'Ready for your close-up?'}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {status === 'starting'
                ? 'Choose “Allow” in your browser’s prompt.'
                : 'Turn on your camera or upload a JPG, PNG or WebP photo.'}
            </p>
          </div>
          {status !== 'starting' && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={onStart} icon={<IconCamera size={16} />} className="neon-breathe">
                Turn on camera
              </Button>
              <Button variant="ghost" onClick={onUpload} icon={<IconUpload size={16} />}>
                Upload photo
              </Button>
              {onUseProfilePhoto && (
                <Button variant="ghost" onClick={onUseProfilePhoto} icon={<IconSparkles size={16} />}>
                  Use my profile photo
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
