import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  api,
  ApiError,
  type EmployeePhoto,
  type FaceBox,
  type Person,
  type PosterTemplate,
} from '../../lib/api';
import { ACCEPT_ATTR, loadPhotoFile, type Photo } from '../../lib/image';
import { detectFace, personMask } from '../../lib/faces';
import { useAuth } from '../../auth/AuthContext';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/toast-context';
import {
  Button,
  EmptyState,
  ErrorText,
  IconButton,
  Pill,
  Skeleton,
  Spinner,
  inputClass,
} from '../../components/ui';
import {
  IconAlert,
  IconCheck,
  IconSearch,
  IconUpload,
  IconUsers,
  IconX,
  IconRefresh,
} from '../../components/icons';
import { NO_ADJUST, freeSlot, type Participant } from './state';

export function PeopleStep({
  template,
  eventId,
  selected,
  setSelected,
  target,
  setTarget,
}: {
  template: PosterTemplate;
  eventId?: string;
  selected: Participant[];
  setSelected: (fn: (prev: Participant[]) => Participant[]) => void;
  target: number;
  setTarget: (n: number) => void;
}) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<Person | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      api.people
        .search(q.trim(), eventId)
        .then((r) => {
          setPeople(r.items);
          setCanManage(r.canManage);
          setError('');
        })
        .catch((e: Error) => setError(e.message));
    }, 220);
    return () => clearTimeout(t);
  }, [q, eventId, reload]);

  const choose = (person: Person, photo: EmployeePhoto) => {
    setSelected((prev) => {
      const existing = prev.find((p) => p.person.id === person.id);
      if (existing)
        return prev.map((p) =>
          p.person.id === person.id ? { ...p, photo, face: undefined, adjust: NO_ADJUST } : p,
        );
      if (prev.length >= template.maxParticipants) return prev;
      return [...prev, { person, photo, slot: freeSlot(prev, template), adjust: NO_ADJUST }];
    });
    setPicking(null);
  };
  const full = selected.length >= template.maxParticipants;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <section className="glass flex flex-col gap-4 p-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Select employees</h2>
            <p className="text-sm text-text-muted">
              {canManage
                ? 'Search every employee by name or Employee ID. Only authorised photographs can be used.'
                : 'You can use your own photos, and colleagues’ photos they have chosen to share.'}
            </p>
          </div>
        </header>
        <label className="relative">
          <span className="sr-only">Search employees</span>
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or Employee ID…"
            className={`${inputClass} pl-10`}
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <ul
          className="flex max-h-[460px] flex-col gap-1.5 overflow-y-auto pr-1"
          aria-label="Employees"
        >
          {people === null &&
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 !rounded-2xl" />)}
          {people?.length === 0 && (
            <EmptyState icon={<IconUsers size={22} />} title="No one found">
              {q ? 'Try another name or Employee ID.' : 'No colleagues have shared photos yet.'}
            </EmptyState>
          )}
          {people?.map((p) => {
            const chosen = selected.find((s) => s.person.id === p.id);
            return (
              <li key={p.id}>
                <button
                  onClick={() => setPicking(p)}
                  disabled={!chosen && full}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                    chosen ? 'border-brand/50 bg-brand/10' : 'border-transparent hover:bg-glass'
                  }`}
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-glass-border bg-glass text-sm font-semibold">
                    {p.primaryPhoto ? (
                      <img
                        src={p.primaryPhoto.thumbUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      p.name.slice(0, 1)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {p.name} {p.isSelf && <span className="text-text-dim">(you)</span>}
                    </span>
                    <span className="block truncate text-xs text-text-dim">
                      {p.employeeCode ?? 'No Employee ID'} ·{' '}
                      {p.photoCount
                        ? `${p.photoCount} authorised photo${p.photoCount > 1 ? 's' : ''}`
                        : 'no photo yet'}
                    </span>
                  </span>
                  {chosen ? (
                    <Pill tone="brand">
                      <IconCheck size={12} /> Selected
                    </Pill>
                  ) : (
                    <Pill>Choose photo</Pill>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="glass flex flex-col gap-4 p-5" aria-label="Selected participants">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Participants</h2>
            <p className="text-sm text-text-muted">
              {selected.length} of {target} selected · up to {template.maxParticipants}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Group size
            <input
              type="number"
              min={template.minParticipants}
              max={template.maxParticipants}
              value={target}
              onChange={(e) =>
                setTarget(
                  Math.max(
                    template.minParticipants,
                    Math.min(template.maxParticipants, Number(e.target.value) || 0),
                  ),
                )
              }
              className={`${inputClass} !h-9 !w-20 text-center`}
              aria-label="Number of participants"
            />
          </label>
        </header>
        {selected.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-glass-border p-6 text-center text-sm text-text-muted">
            Pick people on the left. The first two you choose cut the cake (you can change this
            next).
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <AnimatePresence initial={false}>
              {selected.map((s) => (
                <motion.li
                  key={s.person.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative overflow-hidden rounded-2xl border border-glass-border bg-glass"
                >
                  <img
                    src={s.photo.thumbUrl}
                    alt={`${s.person.name}'s photo`}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="p-2">
                    <p className="truncate text-sm font-medium">{s.person.name}</p>
                    {!s.photo.face && !s.face ? (
                      <p className="flex items-center gap-1 text-[11px] text-accent">
                        <IconAlert size={12} /> Face not found
                      </p>
                    ) : (
                      <p className="text-[11px] text-text-dim">
                        {s.photo.faceSource === 'auto' ? 'Face detected' : 'Face set manually'}
                      </p>
                    )}
                  </div>
                  <div className="absolute right-1.5 top-1.5 flex gap-1">
                    <IconButton
                      size="sm"
                      label={`Replace ${s.person.name}'s photo`}
                      icon={<IconRefresh size={14} />}
                      className="!bg-black/50 !text-white"
                      onClick={() => setPicking(s.person)}
                    />
                    <IconButton
                      size="sm"
                      label={`Remove ${s.person.name}`}
                      icon={<IconX size={14} />}
                      className="!bg-black/50 !text-white"
                      onClick={() =>
                        setSelected((prev) => prev.filter((p) => p.person.id !== s.person.id))
                      }
                    />
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {picking && (
        <PhotoPicker
          person={picking}
          eventId={eventId}
          canManage={canManage}
          current={selected.find((s) => s.person.id === picking.id)?.photo.id}
          onClose={() => setPicking(null)}
          onChoose={(photo) => choose(picking, photo)}
          onUploaded={() => setReload((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** One person's authorised photos; pick one or add a new one. */
function PhotoPicker({
  person,
  eventId,
  canManage,
  current,
  onClose,
  onChoose,
  onUploaded,
}: {
  person: Person;
  eventId?: string;
  canManage: boolean;
  current?: string;
  onClose: () => void;
  onChoose: (p: EmployeePhoto) => void;
  onUploaded: () => void;
}) {
  const [photos, setPhotos] = useState<EmployeePhoto[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const canUpload = person.isSelf || canManage;

  useEffect(() => {
    api.people
      .photos(person.id, eventId)
      .then(setPhotos)
      .catch((e: Error) => setError(e.message));
  }, [person.id, eventId]);

  if (uploading) {
    return (
      <UploadDialog
        person={person}
        onClose={() => setUploading(false)}
        onDone={(ph) => {
          setUploading(false);
          setPhotos((prev) => [ph, ...(prev ?? [])]);
          onUploaded();
        }}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${person.name}'s photographs`}
      description="Choose the photograph to use. Only photos with recorded permission are shown."
      footer={
        canUpload ? (
          <Button
            variant="subtle"
            icon={<IconUpload size={16} />}
            onClick={() => setUploading(true)}
          >
            Upload {person.isSelf ? 'a photo of yourself' : 'authorised photo'}
          </Button>
        ) : undefined
      }
    >
      <ErrorText>{error}</ErrorText>
      {photos === null ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-glass-border p-6 text-center text-sm text-text-muted">
          No authorised photograph yet.{' '}
          {canUpload
            ? 'Upload one to continue.'
            : 'Ask them to upload one and share it, or ask a Creator.'}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((ph) => (
            <li key={ph.id}>
              <button
                onClick={() => onChoose(ph)}
                className={`group w-full overflow-hidden rounded-2xl border text-left transition-all ${
                  ph.id === current
                    ? 'border-brand ring-2 ring-brand/50'
                    : 'border-glass-border hover:border-brand/50'
                }`}
              >
                <img src={ph.thumbUrl} alt="" className="aspect-square w-full object-cover" />
                <span className="flex flex-wrap gap-1 p-2">
                  {ph.isPrimary && <Pill tone="brand">Profile</Pill>}
                  <Pill tone={ph.face ? 'ok' : 'warn'}>
                    {ph.face ? 'Face found' : 'No face found'}
                  </Pill>
                  <Pill>{ph.consentBasis === 'SELF' ? 'Own upload' : 'Creator authorised'}</Pill>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type Analysis = { face: FaceBox | null; count: number; mask: Blob | null; note: string };

/** Upload with on-device face detection + person mask, and recorded permission. */
export function UploadDialog({
  person,
  onClose,
  onDone,
}: {
  person: Person;
  onClose: () => void;
  onDone: (p: EmployeePhoto) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [share, setShare] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const self = person.id === user?.id;

  const pick = async (file: File) => {
    setError('');
    setAnalysis(null);
    try {
      const p = await loadPhotoFile(file);
      setPhoto(p);
      setAnalysing(true);
      const [faceR, maskR] = await Promise.allSettled([detectFace(p.canvas), personMask(p.canvas)]);
      const face = faceR.status === 'fulfilled' ? faceR.value : { face: null, count: 0 };
      const mask = maskR.status === 'fulfilled' ? maskR.value : null;
      const note =
        faceR.status === 'rejected'
          ? `Face detection couldn’t run (${(faceR.reason as Error).message}). You can set the face manually later.`
          : face.count === 0
            ? 'No face was found. You can still upload it and set the face position manually.'
            : face.count > 1
              ? `${face.count} faces were found — the largest one is used. Use a photo of ${person.name} alone if this is wrong.`
              : 'Face detected.';
      setAnalysis({ ...face, mask, note });
    } catch (e) {
      setPhoto(null);
      setError((e as Error).message);
    } finally {
      setAnalysing(false);
    }
  };

  // Preview with the detected face box.
  useEffect(() => {
    const c = preview.current;
    if (!c || !photo) return;
    const scale = Math.min(1, 520 / photo.width);
    c.width = Math.round(photo.width * scale);
    c.height = Math.round(photo.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(photo.canvas, 0, 0, c.width, c.height);
    const f = analysis?.face;
    if (f) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.strokeRect(f.x * c.width, f.y * c.height, f.w * c.width, f.h * c.height);
    }
  }, [photo, analysis]);

  const upload = async () => {
    if (!photo || !analysis) return;
    if (!self && !consent) {
      setError(`Confirm that ${person.name} has authorised this photograph.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', photo.original, photo.name);
      if (analysis.mask) form.append('mask', analysis.mask, 'mask.png');
      if (analysis.face) {
        form.append('face', JSON.stringify(analysis.face));
        form.append('faceSource', 'auto');
      }
      if (!self) form.append('consentConfirmed', 'true');
      if (self) form.append('shareWithColleagues', String(share));
      const saved = await api.people.upload(self ? 'me' : person.id, form);
      toast.success(
        'Photo added',
        saved.face ? 'Face detected and ready to use.' : 'Set the face position before generating.',
      );
      onDone(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={self ? 'Add a photo of yourself' : `Add an authorised photo of ${person.name}`}
      description="JPG, PNG or WebP, at least 200 px. A clear, front-facing head-and-shoulders photo works best."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={upload}
            loading={busy}
            disabled={!photo || analysing || (!self && !consent)}
          >
            Upload photo
          </Button>
        </>
      }
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        aria-label="Photo file"
        onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
      />
      {!photo ? (
        <button
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-glass-border p-8 text-sm text-text-muted hover:border-brand/50"
        >
          <IconUpload size={22} /> Choose a photograph
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <canvas ref={preview} className="mx-auto max-h-80 max-w-full rounded-xl" />
          {analysing ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Spinner size={14} /> Finding the face on your device…
            </p>
          ) : (
            analysis && (
              <p
                className={`text-sm ${analysis.face && analysis.count === 1 ? 'text-success' : 'text-accent'}`}
              >
                {analysis.note}
              </p>
            )
          )}
          <button
            onClick={() => input.current?.click()}
            className="self-start text-sm text-brand-2 hover:underline"
          >
            Choose a different photo
          </button>
        </div>
      )}
      {self ? (
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="mt-1"
          />
          <span>
            Let colleagues use this photo in their Happy Work Anniversary designs. You can change
            this or remove the photo at any time.
          </span>
        </label>
      ) : (
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1"
          />
          <span>
            I confirm that <strong>{person.name}</strong> has authorised SageIT to use this
            photograph for official recognition designs. This confirmation is recorded with my name.
          </span>
        </label>
      )}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
