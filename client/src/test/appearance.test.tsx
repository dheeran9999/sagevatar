import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { AppearanceProvider } from '../auth/AppearanceContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';
import type { Permission, User } from '../lib/api';
import { applyAppearance, DEFAULT_APPEARANCE, type Appearance } from '../lib/appearance';

const SHARED: Permission[] = ['studio.use', 'photo.capture', 'photo.upload', 'avatar.browse'];
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
  permissions: [...SHARED, 'library.manage', 'employee.manage', 'analytics.view'],
};

/** Fake API with a signed-out start; login returns `loginAs`; preferences are stored in memory. */
function mockApi(opts: { me?: User | null; loginAs?: User; prefs?: Partial<Appearance> }) {
  let prefs: Appearance = { ...DEFAULT_APPEARANCE, ...opts.prefs };
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      let status = 200;
      let body: unknown = [];
      if (url === '/api/auth/me') {
        if (opts.me) body = { user: opts.me };
        else [status, body] = [401, { error: 'Authentication required' }];
      } else if (url === '/api/auth/login') body = { user: opts.loginAs };
      else if (url === '/api/auth/preferences') {
        if (init?.method === 'PUT') prefs = JSON.parse(String(init.body));
        body = { preferences: prefs };
      } else if (url.startsWith('/api/creations')) body = { items: [], total: 0 };
      else if (url.startsWith('/api/creator/analytics'))
        body = {
          users: { employees: 0, activeEmployees: 0, pendingInvites: 0, activeUsers7d: 0 },
          creations: { total: 0, last7Days: 0, perDay: {} },
          emails: { QUEUED: 0, SENT: 0, FAILED: 0 },
          topAvatars: [],
        };
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
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

async function signIn(email: string, role: User['role'] = 'EMPLOYEE') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Company email'), email);
  await user.type(screen.getByLabelText('Password'), 'Correct-pass-1');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  // Role-based landing: Creator → Creator workspace, Employee → Studio.
  if (role === 'CREATOR') await screen.findByText('Creator Dashboard');
  else await screen.findByRole('region', { name: 'Avatar tray' });
  return user;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('applyAppearance', () => {
  it('writes every setting onto <html>', () => {
    const root = document.createElement('html');
    applyAppearance(
      {
        theme: 'light',
        accent: 'emerald-green',
        glass: 'strong',
        animations: false,
        motion: 'reduced',
        backgroundEffects: false,
        density: 'compact',
        notifications: DEFAULT_APPEARANCE.notifications,
      },
      root,
    );
    expect(root.dataset).toMatchObject({
      theme: 'light',
      accent: 'emerald-green',
      glass: 'strong',
      animations: 'off',
      motion: 'reduced',
      bgEffects: 'off',
      density: 'compact',
    });
  });

  it('resolves "system" from the OS colour scheme', () => {
    const root = document.createElement('html');
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: q.includes('dark'), media: q }) as MediaQueryList,
    );
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'system' }, root);
    expect(root.dataset.theme).toBe('dark');
  });
});

describe('login and sign-up pages', () => {
  it('use the city backdrop and never show the flyover', async () => {
    mockApi({ me: null });
    renderAt('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.getByTestId('auth-backdrop')).toBeInTheDocument();
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === 'SageVatar').length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('AI Avatar & Event Photo Studio')).toBeInTheDocument();
  });
});

describe('post-login flyover', () => {
  for (const who of [EMPLOYEE, CREATOR]) {
    it(`plays once after a successful ${who.role} sign-in`, async () => {
      mockApi({ me: null, loginAs: who });
      renderAt('/login');
      await signIn(who.email, who.role);

      const fly = await screen.findByTestId('flyover');
      expect(fly).toHaveAttribute('aria-hidden', 'true');
      expect(fly.className).toContain('pointer-events-none');
      // The sign-in backdrop is gone after login.
      expect(screen.queryByTestId('auth-backdrop')).not.toBeInTheDocument();
      // The trigger is consumed, so it won't replay on reload / navigation.
      expect(sessionStorage.getItem('sagevatar.flyover')).toBeNull();
    });
  }

  it('disappears when the flight ends and does not replay on navigation', async () => {
    mockApi({ me: null, loginAs: EMPLOYEE });
    renderAt('/login');
    const user = await signIn(EMPLOYEE.email);
    const path = (await screen.findByTestId('flyover')).firstElementChild!;
    // jsdom makes React listen for the prefixed name; real browsers use "animationend".
    fireEvent.animationEnd(path);
    fireEvent(path, new Event('webkitAnimationEnd', { bubbles: true }));
    await waitFor(() => expect(screen.queryByTestId('flyover')).not.toBeInTheDocument());

    await user.click(screen.getByRole('link', { name: 'My Creations' }));
    await user.click(screen.getByRole('link', { name: 'Camera Studio' }));
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });

  it('does not play for an existing session (page reload)', async () => {
    mockApi({ me: EMPLOYEE });
    renderAt('/');
    await screen.findByRole('region', { name: 'Avatar tray' });
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });

  it('is skipped when the user has animations off', async () => {
    localStorage.setItem(
      'sagevatar.appearance.e1',
      JSON.stringify({ ...DEFAULT_APPEARANCE, animations: false }),
    );
    mockApi({ me: null, loginAs: EMPLOYEE, prefs: { animations: false } });
    renderAt('/login');
    await signIn(EMPLOYEE.email);
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });

  it('has no replay control — it only flies after clicking Sign in', async () => {
    mockApi({ me: EMPLOYEE });
    renderAt('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    expect(screen.queryByRole('menuitem', { name: /replay/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('flyover')).not.toBeInTheDocument();
  });
});

describe('Appearance settings', () => {
  it('apply instantly and save to the account', async () => {
    const calls = mockApi({ me: CREATOR });
    renderAt('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Appearance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Appearance' });

    await user.click(within(dialog).getByRole('radio', { name: 'Light' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Rose Pink' }));
    await user.click(
      within(within(dialog).getByRole('radiogroup', { name: 'Layout' })).getByRole('radio', {
        name: 'Compact',
      }),
    );
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'light',
      accent: 'rose-pink',
      density: 'compact',
    });

    await waitFor(() => {
      const put = calls.filter((c) => c.init?.method === 'PUT').at(-1);
      expect(put && JSON.parse(String(put.init!.body))).toMatchObject({
        theme: 'light',
        accent: 'rose-pink',
        density: 'compact',
      });
    });
  });

  it("load the signed-in user's saved settings", async () => {
    mockApi({ me: EMPLOYEE, prefs: { theme: 'light', accent: 'lavender', glass: 'subtle' } });
    renderAt('/');
    await waitFor(() =>
      expect(document.documentElement.dataset).toMatchObject({
        theme: 'light',
        accent: 'lavender',
        glass: 'subtle',
      }),
    );
  });
});
