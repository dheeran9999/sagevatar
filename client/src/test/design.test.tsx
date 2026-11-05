import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { PasswordField, Button } from '../components/ui';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import { ToastProvider } from '../components/Toast';
import { useToast } from '../components/toast-context';
import { Mascot, MASCOT_GIF, MASCOT_POSTER } from '../components/Mascot';
import { FloatingAvatars } from '../components/FloatingAvatars';

describe('PasswordField', () => {
  it('toggles password visibility with an accessible button', async () => {
    const user = userEvent.setup();
    render(<PasswordField label="Password" defaultValue="secret-123" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});

describe('Button', () => {
  it('shows a spinner and blocks clicks while loading', async () => {
    let clicks = 0;
    render(
      <Button loading onClick={() => clicks++}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    fireEvent.click(btn);
    expect(clicks).toBe(0);
  });
});

function SelectHarness() {
  const [v, setV] = useState('all');
  return (
    <>
      <Select
        label="Avatar type"
        value={v}
        onChange={setV}
        options={[
          { value: 'all', label: 'All types' },
          { value: 'FACE', label: 'Face' },
          { value: 'FULL_BODY', label: 'Full Body' },
        ]}
      />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('Select (animated dropdown)', () => {
  it('opens on click and selects with the mouse', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);
    const combo = screen.getByRole('combobox', { name: 'Avatar type' });
    await user.click(combo);
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('option', { name: 'Face' }));
    expect(screen.getByTestId('value')).toHaveTextContent('FACE');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('is fully keyboard operable', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);
    screen.getByRole('combobox').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{End}{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('FULL_BODY');
    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByTestId('value')).toHaveTextContent('FULL_BODY');
  });
});

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Change password">
        <input aria-label="First field" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('opens as an accessible dialog, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

function ToastHarness() {
  const toast = useToast();
  return (
    <button onClick={() => toast.success('Avatar uploaded', 'Activate it when ready')}>
      Notify
    </button>
  );
}

describe('Toasts', () => {
  it('announces a notification and can be dismissed', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(await screen.findByText('Avatar uploaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    await waitFor(() => expect(screen.queryByText('Avatar uploaded')).not.toBeInTheDocument());
  });
});

describe('Login mascot', () => {
  it('plays the local animated GIF by default', () => {
    render(<Mascot />);
    expect(screen.getByRole('img', { name: /Sagi/ })).toHaveAttribute('src', MASCOT_GIF);
    expect(MASCOT_GIF.startsWith('/')).toBe(true); // served locally, never hotlinked
  });

  it('uses the static poster for reduced-motion users', () => {
    render(
      <MotionConfig reducedMotion="always">
        <Mascot />
      </MotionConfig>,
    );
    expect(screen.getByRole('img', { name: /Sagi/ })).toHaveAttribute('src', MASCOT_POSTER);
  });

  it('falls back to the poster, then to a CSS orb, if images fail to load', () => {
    render(<Mascot />);
    act(() => {
      fireEvent.error(screen.getByRole('img', { name: /Sagi/ }));
    });
    const img = screen.getByRole('img', { name: /Sagi/ });
    expect(img).toHaveAttribute('src', MASCOT_POSTER);
    act(() => {
      fireEvent.error(img);
    });
    expect(screen.getByRole('img', { name: 'SageVatar mascot' }).tagName).toBe('DIV');
  });
});

describe('Decorative floating avatars', () => {
  it('sit behind the UI, ignore pointer events, are hidden from assistive tech and excluded from export', async () => {
    const av = (id: string, slug: string, type: string) => ({
      id,
      name: id,
      type,
      fileUrl: '/api/assets/avatars/' + id + '/file',
      thumbnailUrl: '/api/assets/avatars/' + id + '/thumb',
      category: { slug, name: slug },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              av('a', 'anime', 'FACE'),
              av('b', 'anime', 'HALF_BODY'), // same category — skipped
              av('c', 'business', 'BACKGROUND'), // backgrounds — skipped
              av('d', 'business', 'HALF_BODY'),
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    render(<FloatingAvatars />);
    await waitFor(() =>
      expect(screen.getByTestId('decorative-avatars').querySelectorAll('img')).toHaveLength(2),
    );
    const layer = screen.getByTestId('decorative-avatars');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveAttribute('data-export-exclude');
    expect(layer.className).toMatch(/pointer-events-none/);
    expect(layer.className).toMatch(/-z-10/);
    expect(layer.querySelectorAll('img').length).toBeGreaterThan(0);
    layer.querySelectorAll('img').forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });
});
