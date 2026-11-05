import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { OrbitLoader } from '../../components/ui';
import { AuthLayout, Notice } from './AuthLayout';

/** The token travels in the URL fragment so it never reaches server logs. */
const readToken = () => decodeURIComponent(window.location.hash.slice(1));

export default function VerifyEmailPage() {
  const [token] = useState(readToken);
  const [state, setState] = useState<
    { kind: 'checking' } | { kind: 'ok'; email: string } | { kind: 'error'; message: string }
  >(() =>
    token
      ? { kind: 'checking' }
      : { kind: 'error', message: 'This verification link is incomplete.' },
  );
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return; // links are single-use: don't post twice in StrictMode
    ran.current = true;
    api.auth
      .verifyEmail(token)
      .then(({ email }) => {
        history.replaceState(null, '', '/verify-email');
        setState({ kind: 'ok', email });
      })
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, [token]);

  const signIn = (
    <Link
      to="/login"
      className="bg-gradient-brand btn-shine inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-medium text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
    >
      Continue to sign in
    </Link>
  );

  if (state.kind === 'checking') {
    return (
      <AuthLayout title="Verifying your email…">
        <OrbitLoader label="Checking your link" />
      </AuthLayout>
    );
  }
  if (state.kind === 'ok') {
    return (
      <AuthLayout title="Email verified">
        <Notice title="You're all set">
          {state.email} is confirmed. Sign in to start creating avatar photos.
        </Notice>
        {signIn}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="Link not valid"
      footer={
        <Link to="/signup" className="font-medium text-brand-2 underline-offset-4 hover:underline">
          Sign up again
        </Link>
      }
    >
      <p role="alert" className="text-sm text-accent">
        {state.message}
      </p>
      <p className="text-sm text-text-muted">
        Verification links expire after 24 hours and work once. Sign in to request a new one, or
        sign up again with the same email.
      </p>
      {signIn}
    </AuthLayout>
  );
}
