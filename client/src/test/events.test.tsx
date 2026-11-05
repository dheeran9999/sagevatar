import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  'avatar.generate',
  'event.participate',
  'creation.manageOwn',
  'creation.download',
  'creation.email',
];
const EMPLOYEE: User = {
  id: 'e1',
  email: 'erin@sageitinc.com',
  name: 'Erin Employee',
  role: 'EMPLOYEE',
  permissions: SHARED,
};
const CREATOR: User = {
  id: 'c1',
  email: 'cara@sageitinc.com',
  name: 'Cara Creator',
  role: 'CREATOR',
  permissions: [...SHARED, 'library.manage', 'event.manage', 'employee.manage', 'analytics.view'],
};

const EVENT = {
  id: 'ev1',
  code: 'EVT-261111-7K2Q',
  name: 'Annual Day 2026',
  description: 'Company celebration',
  instructions: 'Use corporate avatars only.',
  location: 'Hyderabad HQ',
  eventDate: '2026-11-11',
  startTime: '10:00',
  endTime: '18:00',
  startsAt: '2026-11-11T04:30:00.000Z',
  endsAt: '2026-11-11T12:30:00.000Z',
  status: 'UPCOMING',
  storedStatus: 'UPCOMING',
  galleryVisibility: 'PARTICIPANTS',
  coverUrl: null,
  coverFullUrl: null,
  canCapture: true,
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
};
const photo = (id: string, mine: boolean, owner: string) => ({
  id,
  eventId: 'ev1',
  eventCode: EVENT.code,
  title: 'Event photo',
  owner: { id: mine ? 'e1' : 'e2', name: owner },
  mine,
  album: null,
  avatarId: null,
  generatedAvatarId: null,
  source: 'CAMERA',
  capturedAt: '2026-11-11T05:00:00.000Z',
  createdAt: '2026-11-11T05:00:00.000Z',
  thumbUrl: `/api/events/ev1/photos/${id}/image/thumb`,
  finalUrl: `/api/events/ev1/photos/${id}/image/final`,
  downloadUrl: `/api/events/ev1/photos/${id}/image/final?download=1`,
  originalUrl: mine ? `/api/events/ev1/photos/${id}/image/original` : null,
});
const MANAGED = {
  ...EVENT,
  storedStatus: 'DRAFT',
  status: 'DRAFT',
  createdBy: 'Cara Creator',
  photoCount: 0,
  participants: [],
  albums: [],
};

type Reply = { status?: number; body: unknown } | undefined;
let calls: { url: string; method: string; body?: unknown }[] = [];

function mockApi(user: User, handler: (url: string, method: string) => Reply = () => undefined) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      let body: unknown;
      try {
        body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      } catch {
        body = undefined;
      }
      calls.push({ url, method, body });
      const r =
        handler(url, method) ??
        (url === '/api/auth/me'
          ? { body: { user } }
          : url === '/api/notifications'
            ? { body: { items: [], unread: 0 } }
            : url.startsWith('/api/creations')
              ? { body: { items: [], total: 0 } }
              : { body: [] });
      return new Response(r.status === 204 ? null : JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
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

beforeEach(() => sessionStorage.clear());

describe('Employee: My Events', () => {
  it('lists only assigned events with the card details and an Enter Event button', async () => {
    mockApi(EMPLOYEE, (url) =>
      url === '/api/events/mine'
        ? { body: [{ ...EVENT, photoCount: 3, myPhotoCount: 1 }] }
        : undefined,
    );
    renderAt('/events');
    const card = await screen.findByRole('article', { name: 'Annual Day 2026' });
    expect(within(card).getByText('Upcoming')).toBeInTheDocument();
    expect(within(card).getByText('Hyderabad HQ')).toBeInTheDocument();
    expect(within(card).getByText(/10:00–18:00/)).toBeInTheDocument();
    expect(within(card).getByText('3 photos')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Enter Event' })).toHaveAttribute(
      'href',
      '/events/ev1',
    );
    expect(screen.getByRole('link', { name: 'My Events' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New event' })).not.toBeInTheDocument();
  });
});

describe('Employee: event workspace', () => {
  it('shows event info, instructions, Capture Photos and the event gallery', async () => {
    mockApi(EMPLOYEE, (url, method) => {
      if (url === '/api/events/ev1')
        return { body: { ...EVENT, photoCount: 2, myPhotoCount: 1, participantCount: 4 } };
      if (url === '/api/events/ev1/photos')
        return { body: [photo('p1', true, 'Erin'), photo('p2', false, 'Bo Builder')] };
      if (url === '/api/events/ev1/photos/p1' && method === 'DELETE')
        return { status: 204, body: null };
      return undefined;
    });
    renderAt('/events/ev1');
    expect(await screen.findByRole('heading', { name: 'Annual Day 2026' })).toBeInTheDocument();
    expect(screen.getByText(`Event ID ${EVENT.code}`)).toBeInTheDocument();
    expect(screen.getByText('Use corporate avatars only.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Capture Photos' })).toHaveAttribute(
      'href',
      '/events/ev1/capture',
    );

    const gallery = screen.getByRole('list', { name: 'Event photos' });
    expect(within(gallery).getAllByRole('listitem')).toHaveLength(2);

    // Someone else's photo: download/email yes, delete no.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open photo by Bo Builder' }));
    let dialog = await screen.findByRole('dialog', { name: 'Photo by Bo Builder' });
    expect(within(dialog).getByRole('link', { name: /Download/ })).toHaveAttribute(
      'href',
      '/api/events/ev1/photos/p2/image/final?download=1',
    );
    expect(within(dialog).getByRole('button', { name: /Email/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Own photo can be deleted.
    await user.click(screen.getByRole('button', { name: 'Open photo by you' }));
    dialog = await screen.findByRole('dialog', { name: 'Photo by you' });
    await user.click(within(dialog).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this photo?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === '/api/events/ev1/photos/p1' && c.method === 'DELETE'),
      ).toBe(true),
    );
  });

  it('refuses events the employee is not assigned to', async () => {
    mockApi(EMPLOYEE, (url) =>
      url.startsWith('/api/events/ev9')
        ? { status: 404, body: { error: 'Event not found' } }
        : undefined,
    );
    renderAt('/events/ev9');
    expect(await screen.findByText('Event not available')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Capture Photos' })).not.toBeInTheDocument();
  });

  it('opens the Studio bound to the event, with Save to Event', async () => {
    mockApi(EMPLOYEE, (url) =>
      url === '/api/events/ev1'
        ? { body: { ...EVENT, photoCount: 0, myPhotoCount: 0, participantCount: 2 } }
        : undefined,
    );
    renderAt('/events/ev1/capture');
    const banner = await screen.findByRole('region', { name: 'Current event' });
    expect(banner).toHaveTextContent('Capturing for Annual Day 2026');
    expect(banner).toHaveTextContent(EVENT.code);
    expect(await screen.findByRole('button', { name: 'Save to Event' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Avatar tray' })).toBeInTheDocument();
  });
});

describe('Creator: event management', () => {
  it('validates and creates an event with the required fields', async () => {
    mockApi(CREATOR, (url, method) =>
      url === '/api/creator/events' && method === 'POST'
        ? { status: 201, body: MANAGED }
        : url === '/api/creator/events/ev1'
          ? { body: MANAGED }
          : undefined,
    );
    renderAt('/events');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New event' }));
    const dialog = await screen.findByRole('dialog', { name: 'New event' });
    await user.click(within(dialog).getByRole('button', { name: 'Create event' }));
    expect(within(dialog).getByText('Enter the event name')).toBeInTheDocument();
    expect(within(dialog).getByText('Pick the event date')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the location')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Event name'), 'Annual Day 2026');
    await user.type(within(dialog).getByLabelText('Event date'), '2026-11-11');
    await user.type(within(dialog).getByLabelText('Location'), 'Hyderabad HQ');
    await user.click(within(dialog).getByRole('button', { name: 'Create event' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/creator/events' && c.method === 'POST')).toBe(true),
    );
    const post = calls.find((c) => c.url === '/api/creator/events' && c.method === 'POST')!;
    expect(post.body).toMatchObject({
      name: 'Annual Day 2026',
      eventDate: '2026-11-11',
      startTime: '09:00',
      endTime: '17:00',
      location: 'Hyderabad HQ',
      galleryVisibility: 'PARTICIPANTS',
      status: 'UPCOMING', // published by default, so participants are notified
      timezoneOffset: expect.any(Number),
    });
    expect(await screen.findByRole('heading', { name: 'Annual Day 2026' })).toBeInTheDocument();
  });

  it('assigns employees and publishes', async () => {
    const employees = [
      {
        id: 'e1',
        name: 'Erin Employee',
        email: 'erin@x.io',
        role: 'EMPLOYEE',
        isActive: true,
        status: 'ACTIVE_ACCOUNT',
      },
      {
        id: 'e2',
        name: 'Bo Builder',
        email: 'bo@x.io',
        role: 'EMPLOYEE',
        isActive: true,
        status: 'ACTIVE_ACCOUNT',
      },
      {
        id: 'c1',
        name: 'Cara Creator',
        email: 'cara@x.io',
        role: 'CREATOR',
        isActive: true,
        status: 'ACTIVE_ACCOUNT',
      },
    ];
    mockApi(CREATOR, (url, method) => {
      if (url === '/api/creator/events/ev1' && method === 'GET') return { body: MANAGED };
      if (url === '/api/creator/events/ev1' && method === 'PATCH')
        return { body: { ...MANAGED, status: 'UPCOMING', storedStatus: 'UPCOMING' } };
      if (url === '/api/creator/events/ev1/photos') return { body: [] };
      if (url === '/api/creator/users') return { body: employees };
      if (url === '/api/creator/events/ev1/assignments')
        return {
          body: {
            added: ['e1', 'e2'],
            alreadyAssigned: [],
            event: {
              ...MANAGED,
              participants: employees.slice(0, 2).map((e) => ({
                userId: e.id,
                name: e.name,
                email: e.email,
                isActive: true,
                assignedAt: '',
                photoCount: 0,
              })),
            },
          },
        };
      return undefined;
    });
    renderAt('/events/ev1');
    const user = userEvent.setup();
    const assignPanel = await screen.findByRole('region', { name: 'Assign employees' });
    await within(assignPanel).findByText('Erin Employee');
    // Creators aren't offered for assignment.
    expect(within(assignPanel).queryByText('Cara Creator')).not.toBeInTheDocument();
    await user.click(within(assignPanel).getByRole('checkbox', { name: /Erin Employee/ }));
    await user.click(within(assignPanel).getByRole('checkbox', { name: /Bo Builder/ }));
    await user.click(within(assignPanel).getByRole('button', { name: /Assign 2 selected/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/creator/events/ev1/assignments')?.body).toEqual({
        userIds: ['e1', 'e2'],
      }),
    );
    const list = await screen.findByRole('region', { name: 'Assigned participants' });
    expect(within(list).getByText('Bo Builder')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const confirm = await screen.findByRole('dialog', { name: 'Publish?' });
    await user.click(within(confirm).getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ status: 'UPCOMING' }),
    );
  });
});

describe('notifications bell', () => {
  it('shows server notifications; opening does not mark them read, clicking one does and opens the event', async () => {
    mockApi(EMPLOYEE, (url) =>
      url.startsWith('/api/notifications?')
        ? {
            body: {
              unread: 1,
              items: [
                {
                  id: 'n1',
                  type: 'EVENT_ASSIGNED',
                  category: 'event',
                  title: 'New Event Assigned!',
                  body: 'You have been assigned to Annual Day 2026.',
                  link: '/events/ev1',
                  eventId: 'ev1',
                  actor: { name: 'Studio Creator' },
                  data: { Event: 'Annual Day 2026' },
                  readAt: null,
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          }
        : url === '/api/notifications/read'
          ? { body: { updated: 1, unread: 0 } }
          : url === '/api/events/ev1'
            ? { body: { ...EVENT, photoCount: 0, myPhotoCount: 0, participantCount: 1 } }
            : url === '/api/events/ev1/photos'
              ? { body: [] }
              : undefined,
    );
    renderAt('/history');
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await userEvent.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(calls.some((c) => c.url === '/api/notifications/read')).toBe(false);
    await userEvent.click(within(panel).getByRole('button', { name: /You have been assigned to Annual Day 2026/ }));
    await waitFor(() => {
      const read = calls.find((c) => c.url === '/api/notifications/read');
      expect(read?.body).toEqual({ ids: ['n1'] });
    });
    // The click opened the event workspace.
    expect(await screen.findByRole('heading', { name: EVENT.name })).toBeInTheDocument();
  });
});
