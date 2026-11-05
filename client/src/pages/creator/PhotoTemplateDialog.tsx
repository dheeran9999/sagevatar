import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { api, type PhotoFaceSlot, type PosterTemplate } from '../../lib/api';
import { ACCEPT_ATTR, loadPhotoFile } from '../../lib/image';
import { detectFaces } from '../../lib/faces';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/toast-context';
import { Button, ErrorText, Field, Spinner } from '../../components/ui';
import { IconCake, IconTrash, IconUpload } from '../../components/icons';

/**
 * Create (or edit the faces of) a photo template: a celebration photograph whose marked faces
 * are replaced by the selected employees' real faces when a poster is generated.
 */
export function PhotoTemplateDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing?: PosterTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<string | null>(existing?.photoUrl ?? null);
  const [slots, setSlots] = useState<PhotoFaceSlot[]>(() =>
    existing
      ? existing.slots.map((s) => ({
          id: s.id,
          label: s.label,
          role: s.role,
          ...(s.box ?? { x: 0, y: 0, w: 0.05, h: 0.05 }),
          ...(s.angle !== undefined ? { angle: s.angle } : {}),
        }))
      : [],
  );
  const [active, setActive] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [note, setNote] = useState('');
  const [rights, setRights] = useState(!!existing);
  const [showNames, setShowNames] = useState(existing?.showNames ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
  }, [src]);

  const nextId = (list: PhotoFaceSlot[]) => {
    for (let i = 1; i < 100; i++) if (!list.some((s) => s.id === `face-${i}`)) return `face-${i}`;
    return `face-${list.length + 1}`;
  };

  const pick = async (f: File) => {
    setError('');
    try {
      const photo = await loadPhotoFile(f);
      setFile(f);
      setSrc(URL.createObjectURL(f));
      setDetecting(true);
      const faces = await detectFaces(photo.canvas).catch((e: Error) => {
        setNote(`Automatic face detection couldn’t run (${e.message}). Click on each face to mark it.`);
        return [];
      });
      // The two faces closest to the middle start as the cake cutters.
      const byCentre = [...faces].sort((a, b) => Math.abs(a.x + a.w / 2 - 0.5) - Math.abs(b.x + b.w / 2 - 0.5));
      const cutters = new Set(byCentre.slice(0, 2));
      setSlots(
        faces.map((f2, i) => ({
          id: `face-${i + 1}`,
          label: `Person ${i + 1}`,
          role: cutters.has(f2) ? 'cutter' : 'stand',
          x: f2.x,
          y: f2.y,
          w: f2.w,
          h: f2.h,
          ...(f2.angle !== undefined ? { angle: f2.angle } : {}),
        })),
      );
      if (faces.length) setNote(`${faces.length} face${faces.length > 1 ? 's' : ''} found. Check them, mark the cake cutters, and click on any face that was missed.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  /** Click on the photo: add a face there (sized like the others). */
  const addAt = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.face) return;
    const r = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width;
    const cy = (e.clientY - r.top) / r.height;
    const w = slots.length ? slots.reduce((s, x) => s + x.w, 0) / slots.length : 0.07;
    const h = slots.length ? slots.reduce((s, x) => s + x.h, 0) / slots.length : (0.07 * r.width) / r.height;
    setSlots((prev) => {
      const id = nextId(prev);
      setActive(id);
      return [...prev, { id, label: `Person ${prev.length + 1}`, role: 'stand', x: cx - w / 2, y: cy - h / 2, w, h }];
    });
  };

  const update = (id: string, patch: Partial<PhotoFaceSlot>) =>
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const resize = (id: string, k: number) =>
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        return { ...s, x: cx - (s.w * k) / 2, y: cy - (s.h * k) / 2, w: s.w * k, h: s.h * k };
      }),
    );
  const nudge = (id: string, dx: number, dy: number) =>
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, x: s.x + dx, y: s.y + dy } : s)));

  const save = async (name: string, description: string) => {
    setError('');
    if (!slots.length) return setError('Mark at least one face to replace.');
    if (!rights) return setError('Confirm the rights to use this photograph.');
    setBusy(true);
    try {
      if (existing) {
        await api.posterAdmin.updateTemplate(existing.key, { name, description, showNames, faceSlots: slots });
      } else {
        const form = new FormData();
        form.append('photo', file!, file!.name);
        form.append('name', name);
        form.append('description', description);
        form.append('faceSlots', JSON.stringify(slots));
        form.append('showNames', String(showNames));
        form.append('rightsConfirmed', 'true');
        await api.posterAdmin.createPhotoTemplate(form);
      }
      toast.success(existing ? 'Photo template updated' : 'Photo template added', 'Employees can now use it to generate posters.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = slots.find((s) => s.id === active);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={existing ? `Faces in “${existing.name}”` : 'Add a photo template'}
      description="Upload a celebration photo (e.g. the SageIT cake cutting). The marked faces are replaced by the selected employees’ real faces; everything else stays as it is."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save(String(f.get('name')), String(f.get('description') ?? ''));
        }}
      >
        <input ref={input} type="file" accept={ACCEPT_ATTR} className="sr-only" aria-label="Template photo" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        {!src ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-glass-border p-10 text-sm text-text-muted hover:border-brand/50"
          >
            <IconUpload size={22} /> Choose the template photograph (at least 800 px wide)
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative cursor-crosshair select-none overflow-hidden rounded-xl" onClick={addAt}>
              <img src={src} alt="Template photograph" className="block w-full" draggable={false} />
              {slots.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  data-face="1"
                  onClick={() => setActive(s.id)}
                  aria-label={`${s.label}${s.role === 'cutter' ? ' (cake cutter)' : ''}`}
                  style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}
                  className={`absolute rounded-[45%] border-[3px] ${s.role === 'cutter' ? 'border-amber-400' : 'border-white'} ${
                    active === s.id ? 'ring-4 ring-brand' : ''
                  } bg-white/10`}
                >
                  <span data-face="1" className={`absolute -top-6 left-1/2 -translate-x-1/2 rounded-full px-1.5 text-[11px] font-bold text-white ${s.role === 'cutter' ? 'bg-amber-500' : 'bg-[#1d3c8f]'}`}>
                    {i + 1}
                  </span>
                </button>
              ))}
              {detecting && (
                <div className="absolute inset-0 grid place-items-center bg-black/40 text-sm text-white">
                  <span className="flex items-center gap-2"><Spinner size={16} /> Finding faces on your device…</span>
                </div>
              )}
            </div>
            <p className="text-xs text-text-muted">{note || 'Click on a face in the photo to add it; click a marked face to edit it.'}</p>
            {!existing && (
              <button type="button" onClick={() => input.current?.click()} className="self-start text-xs text-brand-2 hover:underline">
                Choose a different photo
              </button>
            )}
          </div>
        )}

        {current && (
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-glass-border p-3">
            <label className="flex flex-col gap-1 text-xs">
              Label
              <input
                value={current.label}
                onChange={(e) => update(current.id, { label: e.target.value })}
                className="h-8 rounded-lg border border-glass-border bg-transparent px-2 text-sm"
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant={current.role === 'cutter' ? 'primary' : 'subtle'}
              icon={<IconCake size={14} />}
              onClick={() => update(current.id, { role: current.role === 'cutter' ? 'stand' : 'cutter' })}
            >
              {current.role === 'cutter' ? 'Cuts the cake' : 'Mark as cake cutter'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => resize(current.id, 0.9)}>Smaller</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => resize(current.id, 1.1)}>Larger</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => nudge(current.id, 0, -0.005)} aria-label="Move up">↑</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => nudge(current.id, 0, 0.005)} aria-label="Move down">↓</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => nudge(current.id, -0.005, 0)} aria-label="Move left">←</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => nudge(current.id, 0.005, 0)} aria-label="Move right">→</Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              icon={<IconTrash size={14} />}
              onClick={() => {
                setSlots((prev) => prev.filter((s) => s.id !== current.id));
                setActive(null);
              }}
            >
              Remove
            </Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template name" name="name" defaultValue={existing?.name ?? 'SageIT Cake Cutting (photo)'} required maxLength={80} />
          <Field label="Description (optional)" name="description" defaultValue={existing?.description ?? ''} maxLength={300} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
          Print the participants’ names on a ribbon at the bottom
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
          <span>
            I confirm SageIT has the rights to use this photograph for recognition posters, and that the people shown in it
            (if real) have agreed to their image being used as a template.
          </span>
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!src || detecting}>
            {existing ? 'Save faces' : 'Add photo template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
