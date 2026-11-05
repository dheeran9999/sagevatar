import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../auth/AuthContext';
import {
  api,
  ApiError,
  type ParticipantProblem,
  type Poster,
  type PosterStatus,
  type PosterTemplate,
} from '../../lib/api';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/toast-context';
import { Button, EmptyState, ErrorText, Pill, Skeleton } from '../../components/ui';
import {
  IconAlert,
  IconCalendar,
  IconCake,
  IconCheck,
  IconDownload,
  IconExpand,
  IconFrame,
  IconImage,
  IconMail,
  IconRefresh,
  IconSparkles,
  IconUsers,
} from '../../components/icons';
import { EmailDialog } from '../studio/Dialogs';
import { PeopleStep } from './PeopleStep';
import { PositionsStep, type SceneMode } from './PositionsStep';
import { autoArrange, validate, type Participant, type Step } from './state';

const STEPS: { id: Step; label: string }[] = [
  { id: 'template', label: 'Template' },
  { id: 'people', label: 'Employees' },
  { id: 'positions', label: 'Positions' },
  { id: 'result', label: 'Poster' },
];

/**
 * Recognition Template Studio — "Happy Work Anniversary – Group Cake Cutting".
 * Opened from an event (?eventId=…) the poster can also be saved to that event's gallery.
 */
export default function RecognitionPage() {
  const [params] = useSearchParams();
  const eventId = params.get('eventId') ?? undefined;
  const { user } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<PosterTemplate[] | null>(null);
  const [status, setStatus] = useState<PosterStatus | null>(null);
  const [event, setEvent] = useState<{ id: string; code: string; name: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [template, setTemplate] = useState<PosterTemplate | null>(null);
  const [selected, setSelectedState] = useState<Participant[]>([]);
  /** Group size: follows the selection until the user sets it. */
  const [manualTarget, setManualTarget] = useState<number | null>(null);
  const [scene, setScene] = useState<SceneMode>('auto');
  const [variation, setVariation] = useState(0);
  /** False once someone positions people by hand (then Generate Again keeps their positions). */
  const [autoPositions, setAutoPositions] = useState(true);
  const [poster, setPoster] = useState<Poster | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [problems, setProblems] = useState<ParticipantProblem[]>([]);
  const poll = useRef<number>(0);

  const setSelected = useCallback(
    (fn: (prev: Participant[]) => Participant[]) => setSelectedState((prev) => fn(prev)),
    [],
  );
  const target = manualTarget ?? Math.max(2, selected.length);

  useEffect(() => {
    Promise.all([api.posters.templates(), api.posters.status()])
      .then(([t, s]) => {
        setTemplates(t);
        setStatus(s);
        if (t.length === 1) setTemplate(t[0]);
      })
      .catch((e: Error) => setLoadError(e.message));
    if (eventId) {
      api.events
        .get(eventId)
        .then((e) => setEvent({ id: e.id, code: e.code, name: e.name }))
        .catch(() => setLoadError('This event is not available to you.'));
    }
  }, [eventId]);

  useEffect(() => () => window.clearTimeout(poll.current), []);

  const problemsNow = validate(selected, template, target);

  const watch = (id: string) => {
    window.clearTimeout(poll.current);
    const tick = async () => {
      try {
        const p = await api.posters.get(id);
        setPoster(p);
        if (p.status === 'RUNNING') {
          poll.current = window.setTimeout(tick, 700);
          return;
        }
        setGenerating(false);
        if (p.status === 'SUCCEEDED') toast.success('Poster ready', p.modeNote ?? undefined);
        else setGenError(p.error ?? 'Generation failed.');
      } catch (e) {
        setGenerating(false);
        setGenError((e as Error).message);
      }
    };
    void tick();
  };

  const generate = async (nextVariation = variation, list = selected) => {
    if (!template) return;
    const issues = validate(list, template, target);
    if (issues.length) {
      setGenError(issues[0]);
      return;
    }
    setGenError('');
    setProblems([]);
    setGenerating(true);
    setStep('result');
    try {
      const p = await api.posters.generate({
        templateKey: template.key,
        eventId,
        scene,
        variation: nextVariation,
        participants: list.map((s) => ({
          userId: s.person.id,
          photoId: s.photo.id,
          slot: s.slot,
          adjust: s.adjust,
          ...(s.face ? { face: s.face } : {}),
        })),
      });
      setPoster(p);
      watch(p.id);
    } catch (e) {
      setGenerating(false);
      const err = e as ApiError & { problems?: ParticipantProblem[] };
      setGenError(
        err.status === 503
          ? `The generation service is unavailable: ${err.message}`
          : err.status === 507
            ? `Storage failure: ${err.message}`
            : err.message,
      );
      setProblems(err.problems ?? []);
      if (err.status === 422) setStep('positions');
    }
  };

  const again = () => {
    // A new arrangement/design variation; same people, same photos, same branding.
    // Manual positions are kept; an automatic arrangement gets a fresh one.
    const v = variation + 1;
    setVariation(v);
    const list = template && autoPositions ? autoArrange(selected, template, v) : selected;
    setSelected(() => list);
    void generate(v, list);
  };

  if (loadError) {
    return (
      <EmptyState icon={<IconAlert size={22} />} title="Can’t open the template studio">
        {loadError}
      </EmptyState>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canGo = (s: Step) =>
    s === 'template' ||
    (s === 'people' && !!template) ||
    (s === 'positions' && !!template && selected.length >= 2) ||
    (s === 'result' && !!poster);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">
            Recognition Template Studio
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Happy Work Anniversary – Group Cake Cutting
          </h1>
        </div>
        {event && (
          <Link
            to={`/events/${event.id}`}
            className="glass-subtle inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm"
          >
            <IconCalendar size={15} /> {event.name}{' '}
            <span className="text-text-dim">{event.code}</span>
          </Link>
        )}
      </header>

      <nav
        aria-label="Steps"
        className="glass no-scrollbar flex gap-1 overflow-x-auto !rounded-full p-1.5"
      >
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => canGo(s.id) && setStep(s.id)}
            disabled={!canGo(s.id)}
            aria-current={s.id === step ? 'step' : undefined}
            className={`relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors disabled:opacity-40 ${
              s.id === step ? 'text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            {s.id === step && (
              <motion.span
                layoutId="recog-step"
                className="bg-gradient-brand absolute inset-0 -z-10 rounded-full"
              />
            )}
            <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[11px]">
              {i < stepIndex ? <IconCheck size={12} /> : i + 1}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          {step === 'template' && (
            <TemplateStep
              templates={templates}
              selected={template}
              onSelect={(t) => {
                setTemplate(t);
                setSelected((prev) => autoArrange(prev.slice(0, t.maxParticipants), t, variation));
                setStep('people');
              }}
            />
          )}
          {step === 'people' && template && (
            <PeopleStep
              template={template}
              eventId={eventId}
              selected={selected}
              setSelected={setSelected}
              target={target}
              setTarget={setManualTarget}
            />
          )}
          {step === 'positions' && template && (
            <PositionsStep
              template={template}
              selected={selected}
              setSelected={setSelected}
              scene={scene}
              setScene={setScene}
              status={status}
              variation={variation}
              onArranged={setAutoPositions}
            />
          )}
          {step === 'result' && (
            <ResultStep
              poster={poster}
              generating={generating}
              error={genError}
              eventId={eventId}
              userEmail={user?.email ?? ''}
              onAgain={again}
              onStep={setStep}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {(step === 'people' || step === 'positions') && (
        <div className="glass z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:sticky lg:bottom-3">
          <div className="min-w-0 text-sm">
            {genError || problems.length ? (
              <div className="text-accent">
                <p className="flex items-center gap-1.5">
                  <IconAlert size={15} /> {genError}
                </p>
                {problems.slice(1).map((p) => (
                  <p key={p.photoId} className="pl-5 text-xs">
                    {p.message}
                  </p>
                ))}
              </div>
            ) : problemsNow.length ? (
              <p className="text-text-muted">{problemsNow[0]}</p>
            ) : (
              <p className="text-success">
                {selected.length} people ready ·{' '}
                {selected
                  .filter((s) => s.slot.startsWith('cut'))
                  .map((s) => s.person.name)
                  .join(' & ')}{' '}
                cut the cake
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'people' ? (
              <Button
                onClick={() => setStep('positions')}
                disabled={selected.length < 2}
                icon={<IconUsers size={16} />}
              >
                Next: positions
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setStep('people')}>
                Back
              </Button>
            )}
            <Button
              size="lg"
              onClick={() => generate()}
              loading={generating}
              disabled={problemsNow.length > 0}
              icon={<IconSparkles size={18} />}
              className={problemsNow.length ? '' : 'neon-breathe'}
            >
              Generate with Image
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateStep({
  templates,
  selected,
  onSelect,
}: {
  templates: PosterTemplate[] | null;
  selected: PosterTemplate | null;
  onSelect: (t: PosterTemplate) => void;
}) {
  if (!templates) return <Skeleton className="h-80 !rounded-3xl" />;
  if (!templates.length) {
    return (
      <EmptyState icon={<IconFrame size={22} />} title="No published templates">
        A Creator needs to publish the anniversary template first.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {templates.map((t) => (
        <li
          key={t.key}
          className={`glass overflow-hidden ${selected?.key === t.key ? 'ring-2 ring-brand' : ''}`}
        >
          <img
            src={t.previewUrl}
            alt={`${t.name} preview`}
            className="aspect-[4/3] w-full object-cover"
          />
          <div className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{t.name}</h2>
              {!t.isPublished && <Pill tone="warn">Unpublished</Pill>}
            </div>
            <p className="text-sm text-text-muted">{t.description}</p>
            <p className="text-xs text-text-dim">
              {t.kind === 'photo' ? 'Photo template' : `“${t.heading}”`} ·{' '}
              {t.slots.filter((s) => s.role === 'cutter').length} cake cutter(s) ·{' '}
              {t.minParticipants}–{t.maxParticipants} people
            </p>
            <Button
              onClick={() => onSelect(t)}
              icon={<IconCake size={16} />}
              className="self-start"
            >
              Use this template
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ResultStep({
  poster,
  generating,
  error,
  eventId,
  userEmail,
  onAgain,
  onStep,
}: {
  poster: Poster | null;
  generating: boolean;
  error: string;
  eventId?: string;
  userEmail: string;
  onAgain: () => void;
  onStep: (s: Step) => void;
}) {
  const toast = useToast();
  const [full, setFull] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [saving, setSaving] = useState<'creations' | 'event' | null>(null);
  /** Saved in this view, per poster id (the server's saved flags are also honoured). */
  const [savedNow, setSavedNow] = useState<Record<string, { creations?: boolean; event?: boolean }>>({});
  const done = poster?.status === 'SUCCEEDED';
  const saved = {
    creations: !!poster?.savedCreationId || !!(poster && savedNow[poster.id]?.creations),
    event: !!poster?.savedEventPhotoId || !!(poster && savedNow[poster.id]?.event),
  };

  const save = async (where: 'creations' | 'event') => {
    if (!poster) return;
    setSaving(where);
    try {
      if (where === 'creations') await api.posters.saveToCreations(poster.id);
      else await api.posters.saveToEvent(poster.id);
      setSavedNow((s) => ({ ...s, [poster.id]: { ...s[poster.id], [where]: true } }));
      toast.success(where === 'creations' ? 'Saved to My Creations' : 'Saved to the event gallery');
    } catch (e) {
      toast.error('Couldn’t save', (e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <section className="glass flex flex-col gap-3 p-4">
        {done && poster?.imageUrl ? (
          <button
            onClick={() => setFull(true)}
            className="group relative overflow-hidden rounded-2xl"
            aria-label="Preview full image"
          >
            <img src={poster.imageUrl} alt={`Group poster: ${poster.title}`} className="w-full" />
            <span className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <IconExpand size={16} />
            </span>
          </button>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 rounded-2xl border border-glass-border bg-glass p-6 text-center">
            {generating || poster?.status === 'RUNNING' ? (
              <>
                <IconSparkles size={28} className="animate-pulse text-brand-2" />
                <p className="font-medium">{poster?.stage ?? 'Starting…'}</p>
                <div
                  className="h-2 w-full max-w-md overflow-hidden rounded-full bg-glass-border"
                  role="progressbar"
                  aria-valuenow={poster?.progress ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Generation progress"
                >
                  <motion.div
                    className="bg-gradient-brand h-full"
                    animate={{ width: `${poster?.progress ?? 2}%` }}
                  />
                </div>
                <p className="text-xs text-text-dim">
                  {poster?.progress ?? 0}% · progress is reported by the server as each step
                  finishes
                </p>
              </>
            ) : (
              <>
                <IconAlert size={28} className="text-accent" />
                <p className="font-medium">Generation failed</p>
                <ErrorText>{error || poster?.error || 'Something went wrong.'}</ErrorText>
                <div className="flex gap-2">
                  <Button variant="subtle" onClick={() => onStep('positions')}>
                    Fix positions or faces
                  </Button>
                  <Button onClick={onAgain} icon={<IconRefresh size={16} />}>
                    Try again
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <aside className="glass flex flex-col gap-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-dim">Status</p>
          <p className="flex items-center gap-2 font-medium">
            {poster?.status === 'SUCCEEDED' ? (
              <Pill tone="ok">Ready</Pill>
            ) : poster?.status === 'FAILED' ? (
              <Pill tone="warn">Failed</Pill>
            ) : (
              <Pill tone="brand">Generating</Pill>
            )}
            {poster &&
              (poster.mode === 'ai' ? (
                <Pill tone="brand">Photorealistic AI</Pill>
              ) : poster.mode === 'photo' ? (
                <Pill tone="brand">Photo template · faces replaced</Pill>
              ) : (
                <Pill>Template composition</Pill>
              ))}
          </p>
          {poster?.modeNote && <p className="mt-1 text-xs text-text-dim">{poster.modeNote}</p>}
        </div>
        {poster && (
          <>
            <div>
              <p className="text-xs uppercase tracking-wider text-text-dim">Template</p>
              <p className="text-sm">{poster.templateName}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-text-dim">
                Employees ({poster.participants.length})
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                {poster.participants.map((p) => (
                  <li key={p.userId} className="flex justify-between gap-2">
                    <span>{p.name}</span>
                    <span className="text-xs text-text-dim">{p.slotLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={onAgain}
            loading={generating}
            icon={<IconRefresh size={15} />}
            className="col-span-2"
          >
            Generate Again
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => onStep('template')}
            icon={<IconFrame size={14} />}
          >
            Change Template
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => onStep('people')}
            icon={<IconUsers size={14} />}
          >
            Change Employees
          </Button>
          <Button variant="subtle" size="sm" onClick={() => onStep('positions')}>
            Edit Positions
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={!done}
            onClick={() => setFull(true)}
            icon={<IconExpand size={14} />}
          >
            Preview Full Image
          </Button>
          <a
            href={done ? poster!.downloadPngUrl! : undefined}
            aria-disabled={!done}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-glass-border px-3 text-xs font-medium ${done ? 'hover:bg-glass' : 'pointer-events-none opacity-50'}`}
          >
            <IconDownload size={14} /> Download PNG
          </a>
          <a
            href={done ? poster!.downloadJpgUrl! : undefined}
            aria-disabled={!done}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-glass-border px-3 text-xs font-medium ${done ? 'hover:bg-glass' : 'pointer-events-none opacity-50'}`}
          >
            <IconDownload size={14} /> Download JPG
          </a>
          <Button
            variant="subtle"
            size="sm"
            disabled={!done}
            onClick={() => setEmailing(true)}
            icon={<IconMail size={14} />}
          >
            Send Email
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={!done || saved.creations}
            loading={saving === 'creations'}
            onClick={() => save('creations')}
            icon={saved.creations ? <IconCheck size={14} /> : <IconImage size={14} />}
          >
            {saved.creations ? 'In My Creations' : 'Save to My Creations'}
          </Button>
          {eventId && (
            <Button
              variant="subtle"
              size="sm"
              className="col-span-2"
              disabled={!done || saved.event}
              loading={saving === 'event'}
              onClick={() => save('event')}
              icon={saved.event ? <IconCheck size={14} /> : <IconCalendar size={14} />}
            >
              {saved.event
                ? 'In the event gallery'
                : `Save to Event Gallery${poster?.event ? ` (${poster.event.code})` : ''}`}
            </Button>
          )}
        </div>
      </aside>

      {full && poster?.imageUrl && (
        <Modal open onClose={() => setFull(false)} size="lg" title={poster.title}>
          <img src={poster.imageUrl} alt={poster.title} className="w-full rounded-xl" />
        </Modal>
      )}
      {emailing && poster && (
        <EmailDialog
          open
          onClose={() => setEmailing(false)}
          defaultTo={userEmail}
          defaultSubject="Happy Work Anniversary! 🎉"
          attachment={{ url: poster.thumbUrl, name: 'Group anniversary poster (JPG)' }}
          onSend={async (to, subject, message, progress) => {
            progress('send');
            return api.posters.email(poster.id, { to, subject, message });
          }}
        />
      )}
    </div>
  );
}
