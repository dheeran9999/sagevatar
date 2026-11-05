import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { AppearanceProvider } from '../auth/AppearanceContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';
import type { Permission, User } from '../lib/api';

const SHARED: Permission[] = [
  'studio.use',
  'photo.capture',
  'photo.upload',
  'avatar.browse',
  'creation.manageOwn',
  'creation.download',
  'creation.email',
];
const EMPLOYEE: User = {
  id: 'e1',
  email: 'e@x.io',
  name: 'Erin Employee',
  role: 'EMPLOYEE',
  permissions: SHARED,
};
const CREATOR: User = {
  id: 'c1',
  email: 'c@x.io',
  name: 'Cara Creator',
  role: 'CREATOR',
  permissions: [
    ...SHARED,
    'library.manage',
    'template.manage',
    'employee.manage',
    'analytics.view',
    'audit.view',
  ],
};

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;

/** Fake API: answers /api/auth/me with `user` (or 401) and empty lists elsewhere. */
function mockApi(user: User | null, extra?: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const custom = extra?.(url, init);
    const { status, body } =
      custom ??
      (url === '/api/auth/me'
        ? user
          ? { status: 200, body: { user } }
          : { status: 401, body: { error: 'Authentication required' } }
        : url.startsWith('/api/creator/analytics')
          ? {
              status: 200,
              body: {
                users: { employees: 0, activeEmployees: 0, pendingInvites: 0, activeUsers7d: 0 },
                creations: { total: 0, last7Days: 0, perDay: {} },
                emails: { QUEUED: 0, SENT: 0, FAILED: 0 },
                topAvatars: [],
              },
            }
          : url.startsWith('/api/creations')
            ? { status: 200, body: { items: [], total: 0 } }
            : { status: 200, body: [] });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderAt(path: string) {
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

describe('route protection', () => {
  it('sends signed-out visitors to the login page', async () => {
    mockApi(null);
    renderAt('/creator');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the Studio to an Employee', async () => {
    mockApi(EMPLOYEE);
    renderAt('/');
    expect(await screen.findByRole('region', { name: 'Avatar tray' })).toBeInTheDocument();
    expect(screen.getByText('Erin Employee')).toBeInTheDocument();
  });

  it('shows Employees only the Employee navigation', async () => {
    mockApi(EMPLOYEE);
    renderAt('/');
    await screen.findByText('Erin Employee');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'My Events',
      'Camera Studio',
      'AI Avatar Finder',
      'Recognition Templates',
      'My Creations',
      'Notifications',
      'Edit Profile',
    ]);
    for (const creatorOnly of ['Dashboard', 'Employees', 'Avatar Library', 'Analytics']) {
      expect(within(nav).queryByRole('link', { name: creatorOnly })).not.toBeInTheDocument();
    }
  });

  it('blocks Employees who open /creator directly and never calls Creator APIs', async () => {
    const calls = mockApi(EMPLOYEE);
    renderAt('/creator');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not available for your role');
    expect(calls.some((c) => c.url.startsWith('/api/creator'))).toBe(false);
  });

  it('shows Creators the Creator navigation, landing on the Dashboard', async () => {
    mockApi(CREATOR);
    renderAt('/creator');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Camera Studio',
      'Events Management',
      'Recognition Template Studio',
      'My Creations',
      'Employees',
      'Avatar Library',
      'Templates',
      'Notifications',
      'Analytics',
      'Settings',
    ]);
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Creator Dashboard')).toBeInTheDocument();
  });

  it('opens each Creator section from its own route (Analytics keeps the audit log tab)', async () => {
    mockApi(CREATOR);
    renderAt('/creator/analytics');
    for (const tab of ['Analytics', 'Audit log']) {
      expect(await screen.findByRole('tab', { name: tab })).toBeInTheDocument();
    }
    expect(screen.queryByRole('tab', { name: 'Employees' })).not.toBeInTheDocument();
  });
});

describe('login flow', () => {
  it('shows the server error and stays on the login page on bad credentials', async () => {
    mockApi(null, (url) =>
      url === '/api/auth/login'
        ? { status: 401, body: { error: 'Invalid email or password' } }
        : undefined,
    );
    renderAt('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Company email'), 'e@x.io');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('sends the CSRF header and enters the Studio on success', async () => {
    const calls = mockApi(null, (url) =>
      url === '/api/auth/login' ? { status: 200, body: { user: EMPLOYEE } } : undefined,
    );
    renderAt('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Company email'), 'e@x.io');
    await user.type(screen.getByLabelText('Password'), 'Correct-pass-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('region', { name: 'Avatar tray' });
    const login = calls.find((c) => c.url === '/api/auth/login')!;
    expect((login.init?.headers as Record<string, string>)['x-sageavatar-request']).toBe('1');
    expect(login.init?.credentials).toBe('include');
  });

  it('drops back to login when the API reports the session has ended', async () => {
    mockApi(EMPLOYEE, (url) =>
      url.startsWith('/api/catalog')
        ? { status: 401, body: { error: 'Authentication required' } }
        : undefined,
    );
    renderAt('/');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
  });
});
