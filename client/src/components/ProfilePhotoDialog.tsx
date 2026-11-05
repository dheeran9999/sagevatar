import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api, type EmployeePhoto } from '../lib/api';
import { loadPhotoFile, PhotoError, ACCEPT_ATTR, MAX_PHOTO_MB, type Photo } from '../lib/image';
import { detectFace, personMask } from '../lib/faces';
import { Modal } from './Modal';
import { Button, ErrorText } from './ui';
import { IconRefresh, IconUpload } from './icons';

/** Output size of the saved profile photograph (square). */
const OUT = 800;
const VIEW = 280;

/**
 * Profile photograph: choose an image (JPG/PNG/WebP, size-checked), drag to position, zoom and
 * rotate inside a round guide, then save a square 800×800 crop. Faces and a person mask are
 * detected on the device so the photo also works in recognition posters. The person confirms
 * consent before it can be used in official SageIT content.
 */
export function ProfilePhotoDialog({
  open,
  onClose,
  userId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  onSaved: (photo: EmployeePhoto) => void;
}) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [consent, setConsent] = useState(false);
  const [share, setShare] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);

  const reset = () => {
    setPhoto(null);
    setZoom(1);
    setRotate(0);
    setPan({ x: 0, y: 0 });
    setConsent(false);
    setShare(false);
    setError('');
  };

  /** Draws the current crop onto `ctx` (size × size). */
  const drawCrop = (ctx: CanvasRenderingContext2D, size: number, p: Photo) => {
    const base = size / Math.min(p.width, p.height); // "cover" the square at zoom 1
    const k = base * zoom;
    ctx.save();
    ctx.fillStyle = '#0b1222';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2 + pan.x * size, size / 2 + pan.y * size);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.scale(k, k);
    ctx.drawImage(p.canvas, -p.width / 2, -p.height / 2);
    ctx.restore();
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c || !photo) return;
    const ctx = c.getContext('2d');
    if (ctx) drawCrop(ctx, VIEW, photo);
  });

  const choose = async (f: File) => {
    setError('');
    try {
      const p = await loadPhotoFile(f);
      setPhoto(p);
      setZoom(1);
      setRotate(0);
      setPan({ x: 0, y: 0 });
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : 'This image couldn’t be read.');
    }
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan };
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.pan.x + (e.clientX - d.x) / VIEW, y: d.pan.y + (e.clientY - d.y) / VIEW });
  };

  const save = async () => {
    if (!photo) return;
    if (!consent) {
      setError('Please confirm the consent statement first.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const out = document.createElement('canvas');
      out.width = out.height = OUT;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      drawCrop(ctx, OUT, photo);
      const blob = await new Promise<Blob>((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t encode the photo.'))), 'image/jpeg', 0.92),
      );
      // Face box + person mask (on-device) so posters can align and cut out the photo.
      const [faceR, maskR] = await Promise.allSettled([detectFace(out), personMask(out)]);
      const form = new FormData();
      form.append('photo', blob, 'profile.jpg');
      if (maskR.status === 'fulfilled') form.append('mask', maskR.value, 'mask.png');
      if (faceR.status === 'fulfilled' && faceR.value.face) {
        form.append('face', JSON.stringify(faceR.value.face));
        form.append('faceSource', 'auto');
      }
      form.append('makePrimary', 'true');
      form.append('shareWithColleagues', String(share));
      const saved = await api.people.upload(userId, form);
      onSaved(saved);
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
      onClose={() => {
        reset();
        onClose();
      }}
      title="Profile photograph"
      size="lg"
      description={`JPG, PNG or WebP up to ${MAX_PHOTO_MB} MB. Drag to position, then zoom or rotate.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!photo || !consent}>
            Save photo
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <div className="relative" style={{ width: VIEW, height: VIEW }}>
            {photo ? (
              <canvas
                ref={canvas}
                width={VIEW}
                height={VIEW}
                aria-label="Crop preview: drag to position"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                className="h-full w-full cursor-grab touch-none rounded-2xl active:cursor-grabbing"
              />
            ) : (
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-glass-edge text-sm text-text-muted hover:text-text"
              >
                <span className="flex flex-col items-center gap-2">
                  <IconUpload size={22} /> Choose a photo
                </span>
              </button>
            )}
            {photo && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_0_9999px_rgb(0_0_0/0.45)]"
                style={{ clipPath: 'none', WebkitMaskImage: 'radial-gradient(circle at center, transparent 48%, black 49%)', maskImage: 'radial-gradient(circle at center, transparent 48%, black 49%)' }}
              />
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void choose(f);
            }}
          />
          {photo && (
            <Button variant="subtle" size="sm" icon={<IconUpload size={14} />} onClick={() => input.current?.click()}>
              Choose another
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="flex justify-between text-text-muted">
              Zoom <span className="text-text">{Math.round(zoom * 100)}%</span>
            </span>
            <input type="range" min={100} max={400} value={Math.round(zoom * 100)} disabled={!photo} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="studio-range" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="flex justify-between text-text-muted">
              Rotate <span className="text-text">{rotate}°</span>
            </span>
            <input type="range" min={-180} max={180} value={rotate} disabled={!photo} onChange={(e) => setRotate(Number(e.target.value))} className="studio-range" />
          </label>
          <Button
            variant="subtle"
            size="sm"
            icon={<IconRefresh size={14} />}
            disabled={!photo}
            onClick={() => {
              setZoom(1);
              setRotate(0);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset crop
          </Button>
          <p className="text-xs text-text-dim">Saved as a {OUT}×{OUT} px square. Your original file is not stored.</p>

          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-2)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              This is a photograph of me, and I consent to SageIT using it in my profile and in official recognition
              content (anniversary, nomination and group posters). I can withdraw it at any time.
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-2)]" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>Also let colleagues use it in recognition posters they create.</span>
          </label>
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </Modal>
  );
}
