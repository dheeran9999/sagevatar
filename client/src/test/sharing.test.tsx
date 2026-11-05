import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { AppearanceProvider } from '../auth/AppearanceContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';
import { EmailDialog, PreviewDialog } from '../pages/studio/Dialogs';
import { EventGallery } from '../pages/events/EventGallery';
import type { EmailResult, EventPhoto, User } from '../lib/api';
import { photoFilename } from '../lib/filename';

const EMPLOYEE: User = {
  id: 'e1',
  email: 'erin@sageitinc.com',
  name: 'Erin Employee',
  role: 'EMPLOYEE',
  permissions: [
    'studio.use',
    'avatar.browse',
    'creation.manageOwn',
    'creation.download',
    'creation.email',
    'event.participate',
  ],
};

describe('meaningful file names', () => {
  it('names downloads by event or personal, avatar and time', () => {
    const at = new Date(2026, 10, 4, 9, 5);
    expect(
      photoFilename({ context: 'EVT-261104-YQTB', avatar: 'Hana · Full Body', at, ext: 'png' }),
    ).toBe('SageVatar_EVT-261104-YQTB_Hana-Full-Body_2026-11-04_09-05.png');
    expect(photoFilename({ context: 'Personal', at, ext: 'jpg' })).toBe(
      'SageVatar_Personal_2026-11-04_09-05.jpg',
    );
  });
});

describe('PreviewDialog', () => {
  it('shows original and final side by side with editor shortcuts and the event name', async () => {
    const calls = { avatar: 0, placement: 0, close: 0, download: 0 };
    const onFormat = vi.fn();
    render(
      <PreviewDialog
        open
        originalUrl="blob:original"
        finalUrl="blob:final"
        eventName="Annual Day 2026"
        avatarName="Hana"
        size={{ width: 1920, height: 1080 }}
        onClose={() => calls.close++}
        onChangeAvatar={() => calls.avatar++}
        onChangePlacement={() => calls.placement++}
        onDownload={() => calls.download++}
        onEmail={() => {}}
        downloading={false}
        format="jpg"
        onFormat={onFormat}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Preview · Annual Day 2026' });
    expect(within(dialog).getByText(/1920×1080 px/)).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Original photo' })).toHaveAttribute(
      'src',
      'blob:original',
    );
    expect(within(dialog).getByRole('img', { name: 'Final photo preview' })).toHaveAttribute(
      'src',
      'blob:final',
    );
    expect(within(dialog).getByText('Final · with Hana')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Change avatar' }));
    await user.click(within(dialog).getByRole('button', { name: 'Change placement' }));
    await user.click(within(dialog).getByRole('button', { name: 'Back to editor' }));
    await user.click(within(dialog).getByRole('radio', { name: 'PNG' }));
    await user.click(within(dialog).getByRole('button', { name: 'Download JPG' }));
    expect(calls).toEqual({ avatar: 1, placement: 1, close: 1, download: 1 });
    expect(onFormat).toHaveBeenCalledWith('png');
  });
});

describe('EmailDialog', () => {
  it('requires a valid recipient and a subject', async () => {
    const onSend = vi.fn();
    render(<EmailDialog open onClose={() => {}} onSend={onSend} defaultTo="" defaultSubject="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Enter the recipient’s email')).toBeInTheDocument();
    expect(screen.getByText('Enter a subject')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Recipient email *'), 'not-an-email');
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows real progress, then success only after the mail server accepted it', async () => {
    let finish!: (r: EmailResult) => void;
    const onSend = vi.fn(
      (_to: string, _s: string, _m: string, progress: (s: 'render' | 'save' | 'send') => void) =>
        new Promise<EmailResult>((resolve) => {
          progress('save');
          finish = resolve;
        }),
    );
    render(
      <EmailDialog
        open
        onClose={() => {}}
        onSend={onSend}
        defaultTo="friend@example.com"
        attachment={{ url: 'blob:x', name: 'SageVatar_Personal_2026-11-04_09-05.jpg' }}
      />,
    );
    expect(screen.getByText('SageVatar_Personal_2026-11-04_09-05.jpg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const progress = await screen.findByRole('status', { name: 'Sending progress' });
    expect(progress).toHaveTextContent('Saving it securely');
    expect(onSend.mock.calls[0].slice(0, 3)).toEqual([
      'friend@example.com',
      'My SageVatar photo',
      '',
    ]);

    finish({
      status: 'SENT',
      delivery: 'smtp',
      messageId: '<1@x>',
      acceptedBy: ['friend@example.com'],
    });
    expect(await screen.findByText('Email accepted for delivery')).toBeInTheDocument();
    expect(screen.getByText(/accepted it for friend@example.com/)).toBeInTheDocument();
  });

  it('is honest when email is not configured, and shows delivery failures', async () => {
    const { unmount } = render(
      <EmailDialog
        open
        onClose={() => {}}
        defaultTo="a@b.co"
        onSend={async () => ({
          status: 'SENT',
          delivery: 'dev-outbox',
          messageId: null,
          acceptedBy: ['a@b.co'],
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Not delivered — email isn’t configured/)).toBeInTheDocument();
    unmount();

    render(
      <EmailDialog
        open
        onClose={() => {}}
        defaultTo="blocked@example.com"
        onSend={async () => {
          throw new Error('The mail server refused to deliver to blocked@example.com.');
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('refused to deliver');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});

const PHOTO: EventPhoto = {
  id: 'p1',
  eventId: 'ev1',
  eventCode: 'EVT-261104-YQTB',
  eventName: 'Annual Day 2026',
  title: 'Event photo',
  owner: { id: 'e2', name: 'Bo Builder' },
  mine: false,
  album: null,
  avatarId: 'a1',
  generatedAvatarId: null,
  avatarUsed: { kind: 'library', name: 'Hana · Full Body', type: 'FULL_BODY' },
  source: 'CAMERA',
  capturedAt: '2026-11-04T10:15:00.000Z',
  createdAt: '2026-11-04T10:16:00.000Z',
  thumbUrl: '/t',
  finalUrl: '/f',
  downloadUrl: '/f?download=1&format=jpg',
  downloadPngUrl: '/f?download=1&format=png',
  originalUrl: null,
};

describe('EventGallery', () => {
  it('shows employee, capture date and avatar, and downloads in the chosen format', async () => {
    render(<EventGallery photos={[PHOTO]} onDelete={async () => {}} onEmail={() => {}} />);
    const tile = screen.getByRole('list', { name: 'Event photos' });
    expect(within(tile).getByText('Bo Builder')).toBeInTheDocument();
    expect(within(tile).getByText('Hana · Full Body')).toBeInTheDocument();
    expect(tile.querySelector('time')).toHaveAttribute('datetime', PHOTO.capturedAt);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open photo by Bo Builder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Photo by Bo Builder' });
    expect(dialog).toHaveTextContent('Annual Day 2026 · EVT-261104-YQTB');
    expect(within(dialog).getByRole('link', { name: /Download JPG/ })).toHaveAttribute(
      'href',
      PHOTO.downloadUrl,
    );
    await user.click(within(dialog).getByRole('radio', { name: 'PNG' }));
    expect(within(dialog).getByRole('link', { name: /Download PNG/ })).toHaveAttribute(
      'href',
      PHOTO.downloadPngUrl,
    );
    expect(within(dialog).queryByRole('button', { name: /Delete|Remove/ })).not.toBeInTheDocument();
  });

  it('offers a ZIP export to Creators', () => {
    render(
      <EventGallery
        photos={[PHOTO]}
        albums={[{ id: 'al1', name: 'Stage' }]}
        manage
        onDelete={async () => {}}
        exportHref={(a) => `/zip?album=${a}`}
      />,
    );
    expect(screen.getByRole('link', { name: /Export all photos \(ZIP\)/ })).toHaveAttribute(
      'href',
      '/zip?album=all',
    );
  });
});

describe('My Creations', () => {
  it('searches and filters on the server and shows the avatar used', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const body =
          url === '/api/auth/me'
            ? { user: EMPLOYEE }
            : url.startsWith('/api/creations')
              ? {
                  total: 1,
                  items: [
                    {
                      id: 'c1',
                      title: 'Hana · 04/11/2026',
                      createdAt: '2026-11-04T10:00:00.000Z',
                      metadata: { source: 'CAMERA', width: 800, height: 600 },
                      avatarUsed: {
                        kind: 'library',
                        name: 'Hana · Full Body',
                        type: 'FULL_BODY',
                        thumbnailUrl: '/a',
                      },
                    },
                  ],
                }
              : url === '/api/notifications'
                ? { items: [], unread: 0 }
                : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/history']}>
        <AuthProvider>
          <AppearanceProvider>
            <ToastProvider>
              <AppRoutes />
            </ToastProvider>
          </AppearanceProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    const list = await screen.findByRole('list', { name: 'My creations' });
    expect(await within(list).findByText('Hana · Full Body · Full Body')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /Download .* as JPG/ })).toHaveAttribute(
      'href',
      '/api/creations/c1/image/result?download=1&format=jpg',
    );

    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search my creations' }), 'hana');
    await waitFor(() => expect(calls.some((c) => c.includes('q=hana'))).toBe(true));
    await user.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(within(list).getByRole('link', { name: /as PNG/ })).toHaveAttribute(
      'href',
      '/api/creations/c1/image/result?download=1&format=png',
    );
  });
});
