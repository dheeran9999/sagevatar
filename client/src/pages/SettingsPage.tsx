import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../auth/AuthContext';
import { useAppearance } from '../auth/AppearanceContext';
import { api, type EmployeePhoto, type MyProfile, type Person } from '../lib/api';
import { DEFAULT_APPEARANCE, type NotificationPrefs } from '../lib/appearance';
import { AppearanceDialog } from '../components/AppearanceDialog';
import { ChangePasswordModal } from '../components/AppShell';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ProfilePhotoDialog } from '../components/ProfilePhotoDialog';
import { useToast } from '../components/toast-context';
import { Button, ErrorText, Field, Panel, Pill, Skeleton } from '../components/ui';
import {
  IconBell,
  IconCamera,
  IconCheck,
  IconKey,
  IconMail,
  IconPalette,
  IconTrash,
  IconUpload,
} from '../components/icons';
import { UploadDialog } from './recognition/PeopleStep';

/**
 * Settings (Creators) and Edit Profile (Employees): one page, so nothing is duplicated.
 * People edit their display name, phone, photo, email (verified), password, appearance and
 * notification pop-ups. Role, Employee ID, department and designation are managed by Creators
 * and enforced on the server.
 */
export default function SettingsPage({ variant }: { variant: 'settings' | 'profile' }) {
  const { user, replaceUser, can } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [look, setLook] = useState(false);
  const [pw, setPw] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(() => {
    api.auth
      .profile()
      .then(setProfile)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const save = async (name: string, phone: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.auth.updateProfile({ name, phone: phone.trim() || null });
      replaceUser(r.user);
      setProfile(r.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast.success('Profile saved', 'Your changes are live across SageVatar.');
    } catch (e) {
      setError((e as Error).message);
      toast.error('Couldn’t save your profile', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelEmail = async () => {
    await api.auth.cancelEmailChange();
    toast.info('Email change cancelled');
    load();
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">
          {variant === 'profile' ? 'Your account' : 'Settings'}
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">{variant === 'profile' ? 'Edit Profile' : 'Settings'}</h1>
      </header>

      {!profile ? (
        <div className="glass p-6">
          <Skeleton className="h-40" />
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* ---- Profile card ---- */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass relative flex flex-col items-center gap-4 overflow-hidden p-6 text-center"
            aria-label="Profile"
          >
            <span aria-hidden className="bg-gradient-brand absolute inset-x-0 top-0 h-24 opacity-25" />
            <div className="relative mt-4">
              {profile.photo ? (
                <img
                  src={profile.photo.url}
                  alt={`${profile.name}'s profile photograph`}
                  className="h-28 w-28 rounded-full object-cover ring-4 ring-brand-2/40 shadow-[var(--shadow-glow)]"
                />
              ) : (
                <span className="bg-gradient-brand grid h-28 w-28 place-items-center rounded-full text-3xl font-semibold text-white ring-4 ring-brand-2/30">
                  {initials(profile.name)}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPhotoOpen(true)}
                aria-label={profile.photo ? 'Change profile photograph' : 'Add a profile photograph'}
                title={profile.photo ? 'Change photo' : 'Add photo'}
                className="bg-gradient-brand absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full text-white shadow-lg ring-2 ring-[var(--color-ink-2)] transition hover:scale-105"
              >
                <IconCamera size={16} />
              </button>
            </div>
            <div className="relative">
              <h2 className="text-xl font-semibold">{profile.name}</h2>
              <p className="text-sm text-text-muted">{profile.designation ?? (profile.role === 'CREATOR' ? 'Creator' : 'Employee')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              <Pill tone={profile.role === 'CREATOR' ? 'brand' : 'neutral'}>
                {profile.role === 'CREATOR' ? 'Creator' : 'Employee'}
              </Pill>
              {profile.employeeCode && <Pill>ID {profile.employeeCode}</Pill>}
            </div>
            <dl className="w-full divide-y divide-glass-border text-left text-sm">
              <Row label="Company email" value={profile.email} />
              <Row label="Employee ID" value={profile.employeeCode ?? 'Not assigned yet'} />
              <Row label="Department" value={profile.department ?? '—'} />
              <Row label="Designation" value={profile.designation ?? '—'} />
              <Row label="Phone" value={profile.phone ?? '—'} />
              <Row label="Member since" value={new Date(profile.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} />
            </dl>
          </motion.section>

          <div className="flex min-w-0 flex-col gap-5">
            {/* ---- Edit form ---- */}
            <Panel title="Personal details" subtitle="Your name appears on posters, notifications and event galleries.">
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void save(String(f.get('name')), String(f.get('phone') ?? ''));
                }}
              >
                <Field label="Display name" name="name" defaultValue={user?.name ?? profile.name} required maxLength={100} />
                <Field
                  label="Phone number"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  defaultValue={profile.phone ?? ''}
                  maxLength={32}
                  placeholder="+91 98765 43210"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                  <p className="text-xs text-text-dim">
                    Role, Employee ID, department and designation are managed by{' '}
                    {profile.role === 'EMPLOYEE' ? 'SageIT Creators' : 'SageIT IT'}.
                  </p>
                  <Button type="submit" loading={busy} icon={saved ? <IconCheck size={16} /> : undefined}>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={saved ? 's' : 'n'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                        {saved ? 'Saved' : 'Save changes'}
                      </motion.span>
                    </AnimatePresence>
                  </Button>
                </div>
              </form>
              <ErrorText>{error}</ErrorText>
            </Panel>

            {/* ---- Email ---- */}
            <Panel
              title="Company email"
              subtitle="Changing your sign-in email needs your password and a confirmation link sent to the new address."
              actions={
                <Button variant="ghost" size="sm" icon={<IconMail size={15} />} onClick={() => setEmailOpen(true)}>
                  Change email
                </Button>
              }
            >
              <p className="text-sm">{profile.email}</p>
              {profile.pendingEmail && (
                <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-2/10 px-3 py-2 text-sm text-brand-2">
                  <span>
                    Waiting for you to confirm <strong>{profile.pendingEmail}</strong> — check that inbox.
                  </span>
                  <Button size="sm" variant="subtle" onClick={cancelEmail}>
                    Cancel change
                  </Button>
                </div>
              )}
            </Panel>

            <NotificationPrefsPanel />

            <Panel title="Look and security">
              <div className="flex flex-wrap gap-2">
                <Button variant="subtle" icon={<IconPalette size={16} />} onClick={() => setLook(true)}>
                  Appearance
                </Button>
                <Button variant="subtle" icon={<IconKey size={16} />} onClick={() => setPw(true)}>
                  Change password
                </Button>
                {can('template.manage') && (
                  <Link
                    to="/creator/templates"
                    className="inline-flex h-10 items-center rounded-full border border-glass-border px-4 text-sm hover:bg-glass"
                  >
                    Corporate branding &amp; poster templates
                  </Link>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {can('poster.create') && <RecognitionPhotos />}

      {user && (
        <ProfilePhotoDialog
          open={photoOpen}
          onClose={() => setPhotoOpen(false)}
          userId={user.id}
          onSaved={() => {
            toast.success('Profile photo updated', 'It’s now used across your profile and recognition posters.');
            load();
          }}
        />
      )}
      <EmailChangeDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onRequested={(to, delivery) => {
          toast.success(
            'Check your new inbox',
            delivery === 'smtp'
              ? `We sent a confirmation link to ${to}.`
              : `Email isn’t configured on this server, so the link was saved to the server outbox for ${to}.`,
          );
          load();
        }}
      />
      <AppearanceDialog open={look} onClose={() => setLook(false)} />
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-xs text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}

function EmailChangeDialog({
  open,
  onClose,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  onRequested: (to: string, delivery: string) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Change company email" description="We’ll send a confirmation link to the new address. Your current email keeps working until you confirm.">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError('');
          try {
            const r = await api.auth.requestEmailChange(String(f.get('email')), String(f.get('password')));
            onRequested(r.pendingEmail, r.emailDelivery);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="New company email" name="email" type="email" autoComplete="email" required data-autofocus />
        <Field label="Current password" name="password" type="password" autoComplete="current-password" required />
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Send confirmation link
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const NOTIFY_OPTIONS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'events', label: 'Events', hint: 'Assignments and event updates' },
  { key: 'recognition', label: 'Recognition', hint: 'Anniversary, nomination and group posters' },
  { key: 'creations', label: 'Photos', hint: 'Photos created in your events' },
  { key: 'aiAvatars', label: 'AI avatars', hint: 'Generated avatars and library updates' },
  { key: 'account', label: 'Account', hint: 'Joins, invitations and security' },
];

/** Live pop-up preferences (saved with your account; the Notifications page keeps everything). */
function NotificationPrefsPanel() {
  const { appearance, update } = useAppearance();
  const prefs = appearance.notifications ?? DEFAULT_APPEARANCE.notifications;
  const set = (patch: Partial<NotificationPrefs>) => update({ notifications: { ...prefs, ...patch } });
  return (
    <Panel title="Notification preferences" subtitle="Choose which live pop-ups appear. Everything is still kept in Notifications.">
      <label className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-glass-border px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <IconBell size={16} /> Show live pop-ups
        </span>
        <Toggle on={prefs.popups} onChange={(v) => set({ popups: v })} label="Show live pop-ups" />
      </label>
      <div className={`grid gap-2 sm:grid-cols-2 ${prefs.popups ? '' : 'pointer-events-none opacity-50'}`}>
        {NOTIFY_OPTIONS.map((o) => (
          <label key={o.key} className="flex items-center justify-between gap-3 rounded-xl border border-glass-border px-3 py-2">
            <span>
              <span className="block text-sm">{o.label}</span>
              <span className="block text-[11px] text-text-dim">{o.hint}</span>
            </span>
            <Toggle on={prefs[o.key]} onChange={(v) => set({ [o.key]: v })} label={`${o.label} pop-ups`} disabled={!prefs.popups} />
          </label>
        ))}
      </div>
    </Panel>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-gradient-brand' : 'bg-glass-strong border border-glass-border'}`}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`}
      />
    </button>
  );
}

/** Your own photos for recognition posters: add, choose your profile photo, share, withdraw. */
function RecognitionPhotos() {
  const { user } = useAuth();
  const toast = useToast();
  const [photos, setPhotos] = useState<EmployeePhoto[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EmployeePhoto | null>(null);

  const load = useCallback(() => api.people.photos('me').then(setPhotos).catch(() => setPhotos([])), []);
  useEffect(() => {
    void load();
  }, [load]);

  const update = async (ph: EmployeePhoto, body: Parameters<typeof api.people.updatePhoto>[1], ok: string) => {
    try {
      await api.people.updatePhoto(ph.id, body);
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error('Couldn’t update the photo', (e as Error).message);
    }
  };

  const me: Person | null = user
    ? { id: user.id, name: user.name, email: user.email, employeeCode: null, role: user.role, isSelf: true, photoCount: 0, primaryPhoto: null }
    : null;

  return (
    <Panel
      title="My recognition photos"
      subtitle="Photos of you that can be used in Happy Work Anniversary posters. You decide whether colleagues may use them."
      actions={
        <Button icon={<IconUpload size={16} />} onClick={() => setAdding(true)}>
          Add a photo
        </Button>
      }
    >
      {photos === null ? (
        <Skeleton className="h-32" />
      ) : photos.length === 0 ? (
        <p className="text-sm text-text-muted">No photos yet. A clear, front-facing head-and-shoulders photo works best.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((ph) => (
            <li key={ph.id} className="overflow-hidden rounded-2xl border border-glass-border bg-glass">
              <img src={ph.thumbUrl} alt="" className="aspect-square w-full object-cover" />
              <div className="flex flex-col gap-2 p-2 text-xs">
                <div className="flex flex-wrap gap-1">
                  {ph.isPrimary && <Pill tone="brand">Profile photo</Pill>}
                  <Pill tone={ph.face ? 'ok' : 'warn'}>{ph.face ? 'Face found' : 'No face found'}</Pill>
                  {ph.consentBasis === 'CREATOR_CONFIRMED' && <Pill>Added by {ph.uploadedBy ?? 'a Creator'}</Pill>}
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ph.shareWithColleagues}
                    onChange={(e) =>
                      update(ph, { shareWithColleagues: e.target.checked }, e.target.checked ? 'Colleagues can now use this photo' : 'Photo is private again')
                    }
                  />
                  Colleagues may use it
                </label>
                <div className="flex gap-1">
                  {!ph.isPrimary && (
                    <Button size="sm" variant="ghost" onClick={() => update(ph, { isPrimary: true }, 'Profile photo set')}>
                      Make profile
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<IconTrash size={13} />} onClick={() => setRemoving(ph)}>
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && me && (
        <UploadDialog
          person={me}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        title="Remove this photo?"
        description="It is deleted and can’t be used in any new poster. Posters already made are not changed."
        confirmLabel="Remove photo"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) {
            await api.people.withdrawPhoto(removing.id).catch((e: Error) => toast.error('Couldn’t remove it', e.message));
            await load();
          }
          setRemoving(null);
        }}
      />
    </Panel>
  );
}
