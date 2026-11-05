import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { passwordProblems } from '../../lib/password';
import { Button, ErrorText, OrbitLoader, PasswordField } from '../../components/ui';
import { PasswordStrength } from '../../components/PasswordStrength';
import { IconLock } from '../../components/icons';
import { AuthLayout, Notice } from './AuthLayout';

/** The token travels in the URL fragment so it never reaches server logs. */
const readToken = () => decodeURIComponent(window.location.hash.slice(1));

export default function ResetPasswordPage() {
  const [token] = useState(readToken);
  const [account, setAccount] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(() => (token ? '' : 'This reset link is incomplete.'));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Validate the link first so people don't type a new password into a dead form.
  useEffect(() => {
    if (!token) return;
    api.auth
      .checkReset(token)
      .then((r) => setAccount(r.email))
      .catch((e: Error) => setLinkError(e.message));
  }, [token]);

  const back = (
    <Link to="/login" className="font-medium text-brand-2 underline-offset-4 hover:underline">
      Back to sign in
    </Link>
  );

  if (linkError) {
    return (
      <AuthLayout
        title="Link not valid"
        footer={
          <Link
            to="/forgot-password"
            className="font-medium text-brand-2 underline-offset-4 hover:underline"
          >
            Request a new reset link
          </Link>
        }
      >
        <p role="alert" className="text-sm text-accent">
          {linkError}
        </p>
        <p className="text-sm text-text-muted">
          Reset links expire after 30 minutes and can be used once.
        </p>
      </AuthLayout>
    );
  }
  if (!account) {
    return (
      <AuthLayout title="Checking your link…">
        <OrbitLoader label="Checking your link" />
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout title="Password updated">
        <Notice title="Your password has been changed">
          Sign in with your new password. Any other signed-in devices have been signed out.
        </Notice>
        <Link
          to="/login"
          className="bg-gradient-brand btn-shine inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-medium text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
        >
          Continue to sign in
        </Link>
      </AuthLayout>
    );
  }

  const pwError = submitted
    ? !password
      ? 'Choose a new password'
      : passwordProblems(password).length
        ? 'Password is not strong enough'
        : ''
    : '';
  const confirmError = submitted
    ? !confirm
      ? 'Confirm your new password'
      : confirm !== password
        ? 'Passwords do not match'
        : ''
    : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!password || passwordProblems(password).length || confirm !== password) return;
    setBusy(true);
    setError('');
    try {
      await api.auth.resetPassword(token, password);
      history.replaceState(null, '', '/reset-password'); // drop the token from the address bar
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={
        <>
          For <strong className="text-text">{account}</strong>
        </>
      }
      footer={back}
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        aria-label="Reset password"
      >
        <div className="flex flex-col gap-2">
          <PasswordField
            label="New password"
            autoComplete="new-password"
            icon={<IconLock />}
            value={password}
            error={pwError}
            onChange={(e) => setPassword(e.target.value)}
            data-autofocus
          />
          <PasswordStrength password={password} />
        </div>
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          icon={<IconLock />}
          value={confirm}
          error={confirmError}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
