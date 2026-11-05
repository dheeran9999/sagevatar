import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { AppearanceProvider } from '../auth/AppearanceContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';
import type { Avatar, User } from '../lib/api';

const EMPLOYEE: User = {
  id: 'e1',
  email: 'e@x.io',
  name: 'Erin Employee',
  role: 'EMPLOYEE',
  permissions: [
    'studio.use',
    'photo.capture',
    'photo.upload',
    'avatar.browse',
    'creation.manageOwn',
    'creation.download',
    'creation.email',
  ],
};

const CATEGORIES = ['Anime', 'Superhero', 'Business', 'Corporate'].map((name, i) => ({
  id: `c${i}`,
  name,
  slug: name.toLowerCase(),
  description: '',
}));
const TYPES = [
  ['FACE', 'Face', 'front'],
  ['HALF_BODY', 'Half Body', 'beside'],
  ['FULL_BODY', 'Full Body', 'behind'],
  ['BACKGROUND', 'Background', 'background'],
].map(([code, name, layer]) => ({
  code,
  name,
  description: '',
  defaultPlacement: { layer, x: 0.5, y: 0.5, scale: 1 },
}));
const avatar = (
  id: string,
  name: string,
  slug: string,
  type: Avatar['type'],
  layer = 'beside',
): Avatar => ({
  id,
  name,
  type,
  fileUrl: `/media/avatars/${id}.svg`,
  thumbnailUrl: null,
  isAnimated: false,
  width: 400,
  height: 900,
  defaultPlacement: { layer: layer as 'beside', x: 0.7, y: 0.5, scale: 0.9 },
  category: { slug, name: slug },
});
const AVATARS = [
  {
    ...avatar('a1', 'Anime Full Body', 'anime', 'FULL_BODY', 'behind'),
    description: 'Cheerful student',
    tags: ['wink', 'school uniform'],
  },
  avatar('a2', 'Superhero Face', 'superhero', 'FACE', 'front'),
  avatar('a3', 'Corporate Half Body', 'corporate', 'HALF_BODY'),
  avatar('a4', 'Business Background', 'business', 'BACKGROUND', 'background'),
];

/** Fake server-side finder: name / description / tag match, rights notice for franchise names. */
function searchBody(url: string) {
  const q = new URL(url, 'http://x').searchParams.get('q')!.toLowerCase();
  const withSource = (a: Avatar) => ({
    ...a,
    source: { type: 'ORIGINAL', name: 'SageVatar starter collection', license: 'Original work' },
    match: { type: 'keyword', score: 0.9 },
  });
  const batman = q.includes('batman');
  const results = batman
    ? [withSource(AVATARS[1])]
    : AVATARS.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q) ||
          (a.tags ?? []).some((t) => t.includes(q)),
      ).map(withSource);
  return {
    query: q,
    mode: 'keyword',
    semanticError: null,
    notice: batman
      ? {
          kind: 'rights',
          term: 'Batman',
          message: 'Exact Batman artwork needs usage rights from its owner.',
          suggestion: 'an original night-time vigilante',
        }
      : null,
    results,
  };
}

const GEN_IMAGE = {
  id: 'g1',
  name: 'AI: silver hero',
  description: 'an original futuristic superhero in silver',
  type: 'FULL_BODY',
  style: 'SUPERHERO',
  styleLabel: 'Original Superhero-inspired',
  width: 1024,
  height: 1536,
  isAnimated: false,
  createdAt: new Date().toISOString(),
  publishedAvatarId: null,
  source: { type: 'AI_GENERATED', name: 'openai gpt-image-1', license: 'Generated for you' },
  fileUrl: '/api/ai/images/g1/file',
  thumbnailUrl: '/api/ai/images/g1/thumb',
};
let aiEnabled = false;
const fetchCalls: { url: string; init?: RequestInit }[] = [];

function aiBody(url: string, init?: RequestInit) {
  if (url === '/api/ai/status')
    return {
      generation: {
        enabled: aiEnabled,
        reason: aiEnabled
          ? null
          : 'AI generation is not configured on this server (OPENAI_API_KEY is not set).',
        provider: aiEnabled ? 'openai' : null,
        model: aiEnabled ? 'gpt-image-1' : null,
        dailyLimit: 24,
        usedToday: 0,
      },
      semanticSearch: { enabled: false, model: null },
      styles: [
        { value: 'ANIME', label: 'Anime-inspired' },
        { value: 'SUPERHERO', label: 'Original Superhero-inspired' },
      ],
    };
  if (url === '/api/ai/images') return [];
  const job = {
    id: 'j1',
    count: 1,
    failed: 0,
    error: null,
    prompt: GEN_IMAGE.description,
    style: 'SUPERHERO',
    type: 'FULL_BODY',
    createdAt: new Date().toISOString(),
  };
  if (url === '/api/ai/generations' && init?.method === 'POST')
    return { ...job, status: 'RUNNING', completed: 0, finishedAt: null, images: [] };
  if (url === '/api/ai/generations/j1')
    return {
      ...job,
      status: 'SUCCEEDED',
      completed: 1,
      finishedAt: new Date().toISOString(),
      images: [GEN_IMAGE],
    };
  return undefined;
}

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      const body = url.startsWith('/api/catalog/search')
        ? searchBody(url)
        : url.startsWith('/api/ai/')
          ? aiBody(url, init)
          : url === '/api/auth/me'
            ? { user: EMPLOYEE }
            : url === '/api/catalog/categories'
              ? CATEGORIES
              : url === '/api/catalog/avatar-types'
                ? TYPES
                : url === '/api/catalog/avatars'
                  ? AVATARS
                  : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/']}>
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

beforeEach(() => {
  mockApi();
  vi.stubGlobal('isSecureContext', true);
});

describe('Camera Studio — camera access', () => {
  it('explains when the page is not a secure context and still offers upload', async () => {
    vi.stubGlobal('isSecureContext', false);
    renderStudio();
    const alert = await screen.findByText('Camera needs a secure connection');
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(within(box).getByRole('button', { name: /upload photo/i })).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('shows a clear message when camera permission is denied', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    const user = userEvent.setup();
    renderStudio();
    await user.click((await screen.findAllByRole('button', { name: 'Turn on camera' }))[0]);
    expect(await screen.findByText('Camera permission blocked')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('handles a device with no camera', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }));
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    const user = userEvent.setup();
    renderStudio();
    await user.click((await screen.findAllByRole('button', { name: 'Turn on camera' }))[0]);
    expect(await screen.findByText('No camera found')).toBeInTheDocument();
  });

  it('goes live and offers Capture once permission is granted', async () => {
    const track = {
      stop: vi.fn(),
      addEventListener: vi.fn(),
      getSettings: () => ({ facingMode: 'user' }),
    };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'videoinput' }]),
      },
    });
    const user = userEvent.setup();
    renderStudio();
    await user.click((await screen.findAllByRole('button', { name: 'Turn on camera' }))[0]);
    expect(await screen.findByRole('button', { name: 'Capture photo' })).toBeInTheDocument();
    expect(screen.getByText('Camera live')).toBeInTheDocument();
    // Single camera → switching is disabled.
    expect(screen.getByRole('button', { name: 'Switch camera' })).toBeDisabled();
  });
});

describe('Camera Studio — upload validation', () => {
  it('rejects an unsupported file with a helpful notification', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderStudio();
    await screen.findByRole('region', { name: 'Avatar tray' });
    const input = screen.getByLabelText(/Upload a JPG, PNG or WebP photo/);
    await user.upload(
      input,
      new File(['%PDF-1.4 not an image'], 'scan.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText('Please choose a JPG, PNG or WebP image.')).toBeInTheDocument();
  });
});

describe('Camera Studio — avatar tray and placement', () => {
  it('shows category tabs and type filters on the same screen', async () => {
    renderStudio();
    const tabs = await screen.findByRole('tablist', { name: 'Avatar categories' });
    await waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['All', 'Anime', 'Superhero', 'Business', 'Corporate']),
    );
    const typeGroup = screen.getByRole('radiogroup', { name: 'Avatar type' });
    expect(
      within(typeGroup)
        .getAllByRole('radio')
        .map((t) => t.textContent),
    ).toEqual(['All types', 'Face', 'Half Body', 'Full Body', 'Background']);
  });

  it('filters by category and type without leaving the page', async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByRole('button', { name: /^Anime Full Body,/ });
    await user.click(screen.getByRole('tab', { name: 'Corporate' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Anime Full Body,/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /^Corporate Half Body,/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await user.click(screen.getByRole('radio', { name: 'Face' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { pressed: false, name: /, / })).toHaveLength(1),
    );
    expect(screen.getByRole('button', { name: /^Superhero Face,/ })).toBeInTheDocument();
  });

  it('highlights the selected avatar, enables placements and lets you switch avatars', async () => {
    const user = userEvent.setup();
    renderStudio();
    const placements = await screen.findByRole('radiogroup', { name: 'Avatar placement' });
    // Face filter and full-body come first, then the scene placements.
    expect(
      within(placements)
        .getAllByRole('radio')
        .map((r) => r.textContent?.split(/(On|Standing|Peeking|In front|Fitted)/)[0]),
    ).toEqual([
      'Face Filter',
      'Full-Body Avatar',
      'Beside',
      'Behind person',
      'Left',
      'Right',
      'Foreground',
    ]);
    // The Studio opens in Face Filter mode.
    expect(within(placements).getByRole('radio', { name: /^Face Filter/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const anime = await screen.findByRole('button', { name: /^Anime Full Body,/ });
    await user.click(anime);
    expect(anime).toHaveAttribute('aria-pressed', 'true');
    // Picking a body avatar applies it to the person (Full-Body mode).
    expect(within(placements).getByRole('radio', { name: /^Full-Body Avatar/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(within(placements).getByRole('radio', { name: /^Left/ }));
    expect(within(placements).getByRole('radio', { name: /^Left/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const corporate = screen.getByRole('button', { name: /^Corporate Half Body,/ });
    await user.click(corporate);
    expect(corporate).toHaveAttribute('aria-pressed', 'true');
    expect(anime).toHaveAttribute('aria-pressed', 'false');
    // The user's chosen placement is kept when switching avatars.
    expect(within(placements).getByRole('radio', { name: /^Left/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('AI Avatar Finder: searches the library on the server, previews, then uses the avatar', async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByRole('button', { name: /^Anime Full Body,/ });
    const box = screen.getByRole('searchbox', { name: 'Search avatars' });
    expect(box).toHaveAttribute(
      'placeholder',
      'Search an avatar by name or describe what you want...',
    );
    await user.type(box, 'uniform');
    expect(
      await screen.findByText(/1 match in the SageIT avatar library · keyword search/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Superhero Face,/ })).not.toBeInTheDocument();
    expect(fetchCalls.some((c) => c.url.startsWith('/api/catalog/search?q=uniform'))).toBe(true);

    // Clicking a result opens the larger preview (with source info) instead of selecting.
    await user.click(screen.getByRole('button', { name: /^Anime Full Body,/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Anime Full Body' });
    expect(within(dialog).getByText('SageVatar starter collection')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Use This Avatar' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Anime Full Body,/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    await user.clear(box);
    await user.type(box, 'zzz');
    expect(await screen.findByText(/No library avatars match “zzz”/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate one with AI' })).toBeInTheDocument();
  });

  it('explains rights for franchise characters and offers an original', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(await screen.findByRole('button', { name: 'Batman' }));
    expect(await screen.findByRole('note')).toHaveTextContent('needs usage rights');
    await user.click(screen.getByRole('button', { name: 'Generate an original' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generate with AI' });
    expect(within(dialog).getByRole('textbox')).toHaveValue(
      'Create an original night-time vigilante',
    );
  });

  it('shows that AI generation is not configured, without breaking search', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(await screen.findByRole('button', { name: 'Generate with AI' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generate with AI' });
    expect(await within(dialog).findByText("AI generation isn't available")).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('generates with AI, shows the real returned image and adds it to the photo', async () => {
    aiEnabled = true;
    const user = userEvent.setup();
    renderStudio();
    await user.click(await screen.findByRole('button', { name: 'Generate with AI' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generate with AI' });
    await within(dialog).findByText(/images left today/);
    await user.click(within(dialog).getByRole('button', { name: 'Use the example' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Original Superhero-inspired' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Full Body' }));
    await user.click(within(dialog).getByRole('radio', { name: '1' }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }));

    expect(await within(dialog).findByText(/Generating… 0 of 1 image ready/)).toBeInTheDocument();
    const post = fetchCalls.find((c) => c.url === '/api/ai/generations')!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({
      style: 'SUPERHERO',
      type: 'FULL_BODY',
      count: 1,
    });

    const selected = await within(dialog).findByRole(
      'region',
      { name: 'Selected AI avatar' },
      { timeout: 4000 },
    );
    expect(within(selected).getByRole('img')).toHaveAttribute('src', '/api/ai/images/g1/file');
    expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeEnabled();
    // Employees don't see the Creator-only publish option.
    expect(within(dialog).queryByText(/Publish to shared library/)).not.toBeInTheDocument();
    await user.click(within(selected).getByRole('button', { name: 'Use this avatar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    aiEnabled = false;
  });

  it('previews an avatar design and can use it from the preview', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(await screen.findByRole('button', { name: 'Preview Anime Full Body' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anime Full Body' });
    expect(within(dialog).getByText('Cheerful student')).toBeInTheDocument();
    expect(within(dialog).getByText('school uniform')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Use This Avatar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Anime Full Body,/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('background avatars replace the scene instead of using placements', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(await screen.findByRole('button', { name: /^Business Background,/ }));
    expect(screen.getByText(/Background avatars replace the scene/)).toBeInTheDocument();
  });

  it('keeps output actions disabled until there is a photo', async () => {
    renderStudio();
    await screen.findByRole('region', { name: 'Avatar tray' });
    for (const name of ['Preview', 'Email', 'Download JPG']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    // The JPG / PNG choice is always available.
    expect(screen.getAllByRole('radio', { name: 'PNG' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Select avatar' })).toBeEnabled();
  });
});
