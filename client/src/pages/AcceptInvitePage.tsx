import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { Brand } from '../components/Brand';
import { MASCOT_POSTER } from '../components/Mascot';
import { AuthBackdrop } from '../components/AuthBackdrop';
import { Button, ErrorText, PasswordField, Spinner } from '../components/ui';
import { softSpring } from '../lib/motion';
import { homeFor } from '../lib/password';

/** The token travels in the URL fragment so it is never sent to servers or logged. */
const readToken = () => decodeURIComponent(window.location.hash.slice(1));

export default function AcceptInvitePage() {
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const [invitee, setInvitee] = useState<{ email: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(() => (token ? '' : 'This invitation link is incomplete.'));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.auth
      .invite(token)
      .then(setInvitee)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setError('');
    setBusy(true);
    try {
      const signedIn = await acceptInvite(token, password);
      history.replaceState(null, '', '/accept-invite'); // drop the token from the address bar
      navigate(homeFor(signedIn.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="surface-dark relative flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <AuthBackdrop />
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={softSpring}
        className="glass glass-strong relative flex w-full max-w-md flex-col gap-5 p-7 sm:p-9"
      >
        <div className="gradient-hairline absolute inset-x-10 top-0" aria-hidden />
        <div className="flex items-center justify-between gap-4">
          <Brand />
          <img
            src={MASCOT_POSTER}
            alt=""
            width={56}
            height={67}
            className="h-14 w-auto rounded-xl shadow-[var(--shadow-glow)]"
          />
        </div>
        <h1 className="text-2xl font-semibold">Welcome aboard</h1>
        {invitee ? (
          <p className="text-sm text-text-muted">
            Hi {invitee.name}, set a password for{' '}
            <strong className="text-text">{invitee.email}</strong>.
          </p>
        ) : (
          !error && (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Spinner size={15} /> Checking your invitation…
            </p>
          )
        )}
        {invitee && (
          <>
            <PasswordField
              label="New password"
              autoComplete="new-password"
              hint="At least 10 characters with upper- and lower-case letters, a number and a symbol."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordField
              label="Confirm password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        {invitee && (
          <Button type="submit" size="lg" loading={busy} disabled={!password || !confirm}>
            {busy ? 'Setting up…' : 'Set password and continue'}
          </Button>
        )}
      </motion.form>
    </main>
  );
}
