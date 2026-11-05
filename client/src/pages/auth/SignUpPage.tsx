import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError, type EmailDelivery } from '../../lib/api';
import { EMAIL_RE, homeFor, passwordProblems } from '../../lib/password';
import { Button, ErrorText, Field, PasswordField } from '../../components/ui';
import { PasswordStrength } from '../../components/PasswordStrength';
import { IconLock, IconMail, IconUsers } from '../../components/icons';
import { useToast } from '../../components/toast-context';
import { AuthLayout, DevOutboxNote, Notice } from './AuthLayout';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'confirm', string>>;

/**
 * Public sign-up. Always creates an EMPLOYEE account: the server hard-codes the role and rejects
 * any role field outright. There is deliberately no role choice here.
 */
export default function SignUpPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [domains, setDomains] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ email: string; delivery: EmailDelivery } | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.auth
      .signupInfo()
      .then((i) => setDomains(i.domains))
      .catch(() => {});
  }, []);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const domainOk = (e: string) =>
    !domains.length || domains.includes(e.split('@')[1]?.toLowerCase() ?? '');
  const validate = (): Errors => {
    const errs: Errors = {};
    if (!name.trim()) errs.name = 'Enter your full name';
    else if (name.trim().length < 2) errs.name = 'Name is too short';
    if (!email.trim()) errs.email = 'Enter your company email';
    else if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address';
    else if (!domainOk(email.trim()))
      errs.email = `Use your company email (${domains.map((d) => '@' + d).join(', ')})`;
    if (!password) errs.password = 'Choose a password';
    else if (passwordProblems(password).length) errs.password = 'Password is not strong enough';
    if (!confirm) errs.confirm = 'Confirm your password';
    else if (confirm !== password) errs.confirm = 'Passwords do not match';
    return errs;
  };
  const errors = submitted ? validate() : {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    setNotice('');
    if (Object.keys(validate()).length) return;
    setBusy(true);
    try {
      const r = await api.auth.register(name.trim(), email.trim(), password);
      setDone({ email: r.email, delivery: r.emailDelivery });
      toast.success('Account created', 'Check your email to verify your address.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_UNVERIFIED') setNotice(err.message);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!done) return;
    try {
      await api.auth.resendVerification(done.email);
      toast.success('Email sent again', 'Check your inbox (and junk folder).');
    } catch (err) {
      toast.error('Could not send the email', (err as Error).message);
    }
  };

  if (done) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a verification link to <strong className="text-text">{done.email}</strong>.
          </>
        }
        footer={
          <Link to="/login" className="font-medium text-brand-2 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Notice title="Registration successful">
          Open the link in the email to verify your address, then sign in. The link expires in 24
          hours.
        </Notice>
        {done.delivery === 'dev-outbox' && <DevOutboxNote />}
        <Button variant="ghost" onClick={resend}>
          Resend verification email
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join SageVatar with your company email. New accounts are Employee accounts."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-2 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Sign up">
        <Field
          label="Full name"
          autoComplete="name"
          placeholder="Alex Morgan"
          icon={<IconUsers />}
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Field
          label="Company email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={`you@${domains[0] ?? 'sageitinc.com'}`}
          icon={<IconMail />}
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label="Password"
            autoComplete="new-password"
            icon={<IconLock />}
            value={password}
            error={errors.password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <PasswordStrength password={password} />
        </div>
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          icon={<IconLock />}
          value={confirm}
          error={errors.confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

        <AnimatePresence>
          {notice && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Notice tone="info" title="Almost there">
                {notice}
              </Notice>
            </motion.div>
          )}
        </AnimatePresence>
        <ErrorText>{error}</ErrorText>

        <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
