import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, type EmailDelivery } from '../../lib/api';
import { EMAIL_RE } from '../../lib/password';
import { Button, ErrorText, Field } from '../../components/ui';
import { IconMail } from '../../components/icons';
import { AuthLayout, DevOutboxNote, Notice } from './AuthLayout';

export default function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState(
    () => (location.state as { email?: string } | null)?.email ?? '',
  );
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<EmailDelivery | null>(null);

  const fieldError = touched
    ? !email.trim()
      ? 'Enter your registered email'
      : !EMAIL_RE.test(email.trim())
        ? 'Enter a valid email address'
        : ''
    : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!email.trim() || !EMAIL_RE.test(email.trim())) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.auth.forgotPassword(email.trim());
      setSent(r.emailDelivery);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link to="/login" className="font-medium text-brand-2 underline-offset-4 hover:underline">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthLayout title="Check your email" footer={back}>
        {/* Same message whether or not the account exists, so emails can't be probed. */}
        <Notice title="Reset link sent">
          If an account exists for <strong className="text-text">{email.trim()}</strong>, we've
          emailed a link to reset the password. It expires in 30 minutes.
        </Notice>
        {sent === 'dev-outbox' && <DevOutboxNote />}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter the email you registered with and we'll send you a secure reset link."
      footer={back}
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        aria-label="Forgot password"
      >
        <Field
          label="Registered email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@sageitinc.com"
          icon={<IconMail />}
          value={email}
          error={fieldError}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthLayout>
  );
}
