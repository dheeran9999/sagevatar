import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { AppearanceProvider } from '../auth/AppearanceContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';
import type { User } from '../lib/api';

type Reply = { status: number; body?: unknown };
type Handler = (url: string, init?: RequestInit) => Reply | undefined;

const CREATOR: User = {
  id: 'c1',
  email: 'c@sageitinc.com',
  name: 'Cara Creator',
  role: 'CREATOR',
  permissions: ['studio.use', 'employee.manage', 'library.manage', 'analytics.view'],
};

/** Signed-out fake API. `handler` answers the endpoints under test. */
function mockApi(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r: Reply =
        handler(url, init) ??
        (url === '/api/auth/me'
          ? { status: 401, body: { error: 'Authentication required' } }
          : url === '/api/auth/signup-info'
            ? { status: 200, body: { domains: ['sageitinc.com'], emailDelivery: 'smtp' } }
            : url.startsWith('/api/creator/analytics')
              ? {
                  status: 200,
                  body: {
                    users: {
                      employees: 0,
                      activeEmployees: 0,
                      pendingInvites: 0,
                      activeUsers7d: 0,
                    },
                    creations: { total: 0, last7Days: 0, perDay: {} },
                    emails: { QUEUED: 0, SENT: 0, FAILED: 0 },
                    topAvatars: [],
                  },
                }
              : { status: 200, body: [] });
      return new Response(JSON.stringify(r.body ?? {}), {
        status: r.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

const bodyOf = (calls: { url: string; init?: RequestInit }[], url: string) => {
  const c = calls.find((x) => x.url === url);
  return c ? JSON.parse(String(c.init?.body)) : undefined;
};

function renderAt(path: string) {
  window.history.replaceState(null, '', path); // pages read the token from location.hash
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppearanceProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AppearanceProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => sessionStorage.clear());

describe('login page', () => {
  it('has company email, password with show/hide, remember me, forgot password and sign up', async () => {
    mockApi(() => undefined);
    renderAt('/login');
    expect(await screen.findByLabelText('Company email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });

  it('validates before calling the API', async () => {
    const calls = mockApi(() => undefined);
    renderAt('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your company email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Company email'), 'nope');
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/auth/login')).toBe(false);
  });

  it('sends "remember me" and takes a Creator to the Creator workspace with the flyover', async () => {
    const calls = mockApi((url) =>
      url === '/api/auth/login' ? { status: 200, body: { user: CREATOR } } : undefined,
    );
    renderAt('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Company email'), CREATOR.email);
    await user.type(screen.getByLabelText('Password'), 'Correct-pass-1!');
    await user.click(screen.getByRole('checkbox', { name: 'Remember me' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Creator Dashboard')).toBeInTheDocument();
    expect(bodyOf(calls, '/api/auth/login')).toMatchObject({ remember: true });
    expect(screen.getByTestId('flyover')).toBeInTheDocument();
  });

  it('offers to resend the verification email for unverified accounts', async () => {
    const calls = mockApi((url) =>
      url === '/api/auth/login'
        ? {
            status: 403,
            body: { error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' },
          }
        : url === '/api/auth/resend-verification'
          ? { status: 202, body: { ok: true } }
          : undefined,
    );
    renderAt('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Company email'), 'new@sageitinc.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-pass-1!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('verify your email');
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() =>
      expect(bodyOf(calls, '/api/auth/resend-verification')).toEqual({
        email: 'new@sageitinc.com',
      }),
    );
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });
});

describe('sign up page', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, v: Record<string, string>) {
    if (v.name) await user.type(screen.getByLabelText('Full name'), v.name);
    if (v.email) await user.type(screen.getByLabelText('Company email'), v.email);
    if (v.password) await user.type(screen.getByLabelText('Password'), v.password);
    if (v.confirm) await user.type(screen.getByLabelText('Confirm password'), v.confirm);
  }

  it('has no role selection', async () => {
    mockApi(() => undefined);
    renderAt('/signup');
    await screen.findByRole('heading', { name: 'Create your account' });
    expect(screen.queryByText(/creator/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });

  it('validates required fields, email, domain, strength and confirmation', async () => {
    const calls = mockApi(() => undefined);
    renderAt('/signup');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter your full name')).toBeInTheDocument();
    expect(screen.getByText('Enter your company email')).toBeInTheDocument();
    expect(screen.getByText('Choose a password')).toBeInTheDocument();
    expect(screen.getByText('Confirm your password')).toBeInTheDocument();

    await fill(user, {
      name: 'Alex Morgan',
      email: 'alex@gmail.com',
      password: 'weakpass',
      confirm: 'other',
    });
    expect(screen.getByText(/Use your company email/)).toBeInTheDocument();
    expect(screen.getByText('Password is not strong enough')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    const rule = (text: string) =>
      screen.getByText((_, el) => el?.tagName === 'LI' && el.textContent === text);
    expect(rule('An upper-case letter (not met)')).toBeInTheDocument();
    expect(rule('A lower-case letter (met)')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/auth/register')).toBe(false);
  });

  it('registers an account (no role sent) and shows the success message', async () => {
    const calls = mockApi((url) =>
      url === '/api/auth/register'
        ? { status: 201, body: { email: 'alex@sageitinc.com', emailDelivery: 'smtp' } }
        : undefined,
    );
    renderAt('/signup');
    const user = userEvent.setup();
    await screen.findByLabelText('Full name');
    await fill(user, {
      name: 'Alex Morgan',
      email: 'alex@sageitinc.com',
      password: 'Strong-pass-123',
      confirm: 'Strong-pass-123',
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('Registration successful')).toBeInTheDocument();
    expect(bodyOf(calls, '/api/auth/register')).toEqual({
      name: 'Alex Morgan',
      email: 'alex@sageitinc.com',
      password: 'Strong-pass-123',
    });
  });

  it('shows the duplicate-account failure from the server', async () => {
    mockApi((url) =>
      url === '/api/auth/register'
        ? { status: 409, body: { error: 'An account with this email already exists.' } }
        : undefined,
    );
    renderAt('/signup');
    const user = userEvent.setup();
    await screen.findByLabelText('Full name');
    await fill(user, {
      name: 'Alex Morgan',
      email: 'alex@sageitinc.com',
      password: 'Strong-pass-123',
      confirm: 'Strong-pass-123',
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('email verification page', () => {
  it('verifies the token from the link once', async () => {
    const calls = mockApi((url) =>
      url === '/api/auth/verify-email'
        ? { status: 200, body: { email: 'alex@sageitinc.com' } }
        : undefined,
    );
    renderAt('/verify-email#tok_abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/api/auth/verify-email')).toHaveLength(1);
    expect(bodyOf(calls, '/api/auth/verify-email')).toEqual({
      token: 'tok_abcdefghijklmnopqrstuvwxyz',
    });
  });

  it('explains invalid links', async () => {
    mockApi((url) =>
      url === '/api/auth/verify-email'
        ? { status: 400, body: { error: 'This link is invalid or has expired' } }
        : undefined,
    );
    renderAt('/verify-email#tok_abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  });
});

describe('forgot / reset password', () => {
  it('requests a reset link and shows the same confirmation for any address', async () => {
    const calls = mockApi((url) =>
      url === '/api/auth/forgot-password'
        ? { status: 202, body: { ok: true, emailDelivery: 'smtp' } }
        : undefined,
    );
    renderAt('/forgot-password');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter your registered email')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Registered email'), 'alex@sageitinc.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Reset link sent')).toBeInTheDocument();
    expect(bodyOf(calls, '/api/auth/forgot-password')).toEqual({ email: 'alex@sageitinc.com' });
  });

  it('checks the token, then sets a new password', async () => {
    const calls = mockApi((url) =>
      url.startsWith('/api/auth/reset-password/')
        ? { status: 200, body: { email: 'alex@sageitinc.com' } }
        : url === '/api/auth/reset-password'
          ? { status: 200, body: { email: 'alex@sageitinc.com' } }
          : undefined,
    );
    renderAt('/reset-password#tok_abcdefghijklmnopqrstuvwxyz');
    const user = userEvent.setup();
    expect(await screen.findByText('alex@sageitinc.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New password'), 'weak');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByText('Password is not strong enough')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'Brand-new-pass-77');
    await user.type(screen.getByLabelText('Confirm new password'), 'Brand-new-pass-77');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Your password has been changed')).toBeInTheDocument();
    expect(bodyOf(calls, '/api/auth/reset-password')).toEqual({
      token: 'tok_abcdefghijklmnopqrstuvwxyz',
      password: 'Brand-new-pass-77',
    });
  });

  it('rejects an invalid reset link before showing the form', async () => {
    mockApi((url) =>
      url.startsWith('/api/auth/reset-password/')
        ? { status: 400, body: { error: 'This link is invalid or has expired' } }
        : undefined,
    );
    renderAt('/reset-password#tok_abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
