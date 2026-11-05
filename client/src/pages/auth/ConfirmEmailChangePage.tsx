import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { OrbitLoader } from '../../components/ui';
import { AuthLayout, Notice } from './AuthLayout';

/** The token travels in the URL fragment so it never reaches server logs. */
const readToken = () => decodeURIComponent(window.location.hash.slice(1));

/** Confirms a company-email change from the link sent to the NEW address. */
export default function ConfirmEmailChangePage() {
  const { user, replaceUser } = useAuth();
  const [token] = useState(readToken);
  const [state, setState] = useState<
    { kind: 'checking' } | { kind: 'ok'; email: string } | { kind: 'error'; message: string }
  >(() => (token ? { kind: 'checking' } : { kind: 'error', message: 'This confirmation link is incomplete.' }));
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return; // single-use links: don't post twice in StrictMode
    ran.current = true;
    api.auth
      .confirmEmailChange(token)
      .then(({ email }) => {
        history.replaceState(null, '', '/confirm-email');
        setState({ kind: 'ok', email });
        if (user) void api.auth.me().then((r) => replaceUser(r.user)).catch(() => undefined);
      })
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per link
  }, [token]);

  const next = (
    <Link
      to={user ? '/profile' : '/login'}
      className="bg-gradient-brand btn-shine inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-medium text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
    >
      {user ? 'Back to your profile' : 'Continue to sign in'}
    </Link>
  );

  if (state.kind === 'checking') {
    return (
      <AuthLayout title="Confirming your new email…">
        <OrbitLoader label="Checking your link" />
      </AuthLayout>
    );
  }
  if (state.kind === 'ok') {
    return (
      <AuthLayout title="Email updated">
        <Notice title="All set">From now on, sign in with {state.email}.</Notice>
        {next}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Link not valid">
      <p role="alert" className="text-sm text-accent">
        {state.message}
      </p>
      <p className="text-sm text-text-muted">
        Confirmation links expire and work once. Request a new one from Edit Profile.
      </p>
      {next}
    </AuthLayout>
  );
}
