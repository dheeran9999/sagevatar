import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, useAnimationControls } from 'framer-motion';
import { useAuth } from '../auth/AuthContext';
import { Brand } from '../components/Brand';
import { Mascot } from '../components/Mascot';
import { AuthBackdrop } from '../components/AuthBackdrop';
import { Button, ErrorText, Field, PasswordField } from '../components/ui';
import { IconCheck, IconLock, IconMail } from '../components/icons';
import { useToast } from '../components/toast-context';
import { api, ApiError, type Role } from '../lib/api';
import { FLYOVER_IMAGE } from '../lib/flyover';
import { softSpring } from '../lib/motion';
import { EMAIL_RE, homeFor } from '../lib/password';

/** A deep link the user was bounced from wins over the role's home page. */
const destination = (from: string | undefined, role: Role) =>
  from && from !== '/' && !(from.startsWith('/creator') && role !== 'CREATOR')
    ? from
    : homeFor(role);

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const from = (location.state as { from?: string } | null)?.from;
  const card = useAnimationControls();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  // Warm the cache so the post-login flyover starts the moment the workspace appears.
  // (Fetch only — nothing is shown on this page.)
  useEffect(() => {
    const img = new Image();
    img.src = FLYOVER_IMAGE;
  }, []);

  if (user) return <Navigate to={destination(from, user.role)} replace />;

  const emailError = touched
    ? !email
      ? 'Enter your company email'
      : !EMAIL_RE.test(email)
        ? 'Enter a valid email address'
        : ''
    : '';
  const passwordError = touched && !password ? 'Enter your password' : '';

  const shake = () => card.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.45 } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setUnverified(false);
    setResent(false);
    if (!email || !EMAIL_RE.test(email) || !password) {
      setError('');
      shake();
      return;
    }
    setError('');
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password, remember);
      navigate(destination(from, signedIn.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      setError((err as Error).message);
      shake();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.auth.resendVerification(email.trim());
      setResent(true);
      toast.success('Verification email sent', 'Check your inbox for the new link.');
    } catch (err) {
      toast.error('Could not send the email', (err as Error).message);
    }
  };

  return (
    <main className="surface-dark relative flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-6">
      <AuthBackdrop />
      <div className="grid w-full max-w-5xl items-center gap-10 md:grid-cols-[1fr_1.05fr] md:gap-14 lg:gap-20">
        {/* Hero mascot */}
        <motion.div
          initial={{ opacity: 0, x: -30, rotate: -2 }}
          animate={{ opacity: 1, x: 0, rotate: 0 }}
          transition={{ ...softSpring, delay: 0.05 }}
          className="mx-auto w-full max-w-[220px] sm:max-w-[300px] md:max-w-[380px]"
        >
          <Mascot />
          <p className="mt-10 hidden text-center text-sm text-text-muted md:block">
            Meet <span className="font-medium text-text">Sagi</span> — your studio buddy for avatar
            photos.
          </p>
        </motion.div>

        {/* Login card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...softSpring, delay: 0.15 }}
        >
          <motion.form
            animate={card}
            onSubmit={submit}
            noValidate
            aria-describedby="login-intro"
            className="glass glass-strong mx-auto flex w-full max-w-md flex-col gap-5 p-7 sm:p-9"
          >
            <div className="gradient-hairline absolute inset-x-10 top-0" aria-hidden />
            <Brand size="lg" />
            <div>
              <h1 className="text-[26px] font-semibold leading-tight sm:text-3xl">Welcome back</h1>
              <p id="login-intro" className="mt-1.5 text-sm text-text-muted">
                Snap a photo, bring in your avatar, share the moment.
              </p>
            </div>

            <Field
              label="Company email"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="you@sageitinc.com"
              icon={<IconMail />}
              required
              value={email}
              error={emailError}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordField
              label="Password"
              autoComplete="current-password"
              placeholder="••••••••••"
              icon={<IconLock />}
              required
              value={password}
              error={passwordError}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="-mt-1 flex items-center justify-between gap-3 text-sm">
              <label className="group inline-flex cursor-pointer select-none items-center gap-2 text-text-muted">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span
                  aria-hidden
                  className="grid h-[18px] w-[18px] place-items-center rounded-md border border-glass-edge bg-ink/50 text-white transition peer-checked:border-transparent peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-2"
                >
                  {remember && <IconCheck size={12} />}
                </span>
                <span className="group-hover:text-text">Remember me</span>
              </label>
              <Link
                to="/forgot-password"
                state={{ email }}
                className="text-brand-2 underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <ErrorText>{error}</ErrorText>
            {unverified && (
              <Button type="button" variant="ghost" onClick={resend} disabled={resent}>
                {resent ? 'Verification email sent' : 'Resend verification email'}
              </Button>
            )}

            <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="text-center text-sm text-text-muted">
              New to SageVatar?{' '}
              <Link
                to="/signup"
                className="font-medium text-brand-2 underline-offset-4 hover:underline"
              >
                Create an account
              </Link>
            </p>
          </motion.form>
        </motion.div>
      </div>
    </main>
  );
}
