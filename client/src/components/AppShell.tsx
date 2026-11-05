import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { page } from '../lib/motion';
import { Brand } from './Brand';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { AppearanceDialog } from './AppearanceDialog';
import { Flyover } from './Flyover';
import { Modal } from './Modal';
import { useToast } from './toast-context';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { LiveNotificationsProvider, useLiveNotifications } from './live-notifications';
import { LiveToasts } from './LiveToasts';
import { Button, ErrorText, IconButton, PasswordField, Pill } from './ui';
import {
  IconBell,
  IconCake,
  IconCalendar,
  IconCamera,
  IconChart,
  IconChevronDown,
  IconFrame,
  IconImage,
  IconKey,
  IconLayers,
  IconLogout,
  IconMenu,
  IconPalette,
  IconShield,
  IconSparkles,
  IconUsers,
} from './icons';

type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number }>; end?: boolean };

/** Creator navigation (only two roles exist; the server enforces every permission). */
const CREATOR_NAV: NavItem[] = [
  { to: '/creator', label: 'Dashboard', icon: IconChart, end: true },
  { to: '/', label: 'Camera Studio', icon: IconCamera, end: true },
  { to: '/events', label: 'Events Management', icon: IconCalendar },
  { to: '/recognition', label: 'Recognition Template Studio', icon: IconCake },
  { to: '/history', label: 'My Creations', icon: IconImage },
  { to: '/creator/employees', label: 'Employees', icon: IconUsers },
  { to: '/creator/library', label: 'Avatar Library', icon: IconLayers },
  { to: '/creator/templates', label: 'Templates', icon: IconFrame },
  { to: '/notifications', label: 'Notifications', icon: IconBell },
  { to: '/creator/analytics', label: 'Analytics', icon: IconShield },
  { to: '/settings', label: 'Settings', icon: IconPalette },
];

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/events', label: 'My Events', icon: IconCalendar },
  { to: '/', label: 'Camera Studio', icon: IconCamera, end: true },
  { to: '/ai-finder', label: 'AI Avatar Finder', icon: IconSparkles },
  { to: '/recognition', label: 'Recognition Templates', icon: IconCake },
  { to: '/history', label: 'My Creations', icon: IconImage },
  { to: '/notifications', label: 'Notifications', icon: IconBell },
  { to: '/profile', label: 'Edit Profile', icon: IconUsers },
];

function NavItems({
  items,
  layout,
  unread,
  collapsed = false,
}: {
  items: NavItem[];
  layout: 'bar' | 'side';
  unread: number;
  collapsed?: boolean;
}) {
  const side = layout === 'side';
  return (
    <>
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          title={collapsed ? n.label : undefined}
          aria-label={collapsed ? n.label : undefined}
          className={({ isActive }) =>
            `relative inline-flex shrink-0 items-center gap-2.5 rounded-xl border text-sm transition-colors ${
              side ? (collapsed ? 'w-full justify-center px-0 py-2.5' : 'w-full px-3.5 py-2.5') : 'rounded-full px-3.5 py-2'
            } ${isActive ? 'border-transparent text-white' : 'neon-hover border-transparent text-text-muted hover:bg-fg/5 hover:text-text'}`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId={`nav-pill-${layout}`}
                  className={`bg-gradient-brand absolute inset-0 -z-10 shadow-[var(--shadow-glow)] ${side ? 'rounded-xl' : 'rounded-full'}`}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <n.icon size={side ? 17 : 16} />
              {!collapsed && <span className={side ? 'flex-1 truncate' : ''}>{n.label}</span>}
              {n.to === '/notifications' && unread > 0 && (
                <span
                  className={`rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white ${collapsed ? 'absolute right-1.5 top-1' : ''}`}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell() {
  return (
    <LiveNotificationsProvider>
      <Shell />
    </LiveNotificationsProvider>
  );
}

function Shell() {
  const { can } = useAuth();
  const { unread } = useLiveNotifications();
  const location = useLocation();
  const outlet = useOutlet();
  const items = can('employee.manage') ? CREATOR_NAV : EMPLOYEE_NAV;
  // One navigation landmark at a time: sidebar on large screens, header bar otherwise.
  const wide = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sagevatar.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('sagevatar.sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* per-browser convenience only */
      }
      return !c;
    });

  return (
    <>
      {/* Post-login background stays neutral; the only overlay is the one-time flyover. */}
      <Flyover />
      <LiveToasts />
      <div className="mx-auto flex min-h-[100dvh] max-w-7xl flex-col gap-5 px-3 pb-8 pt-3 sm:gap-6 sm:px-5 sm:pt-5">
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
          className="glass sticky top-3 z-30 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-2.5 sm:top-5 sm:px-5"
        >
          <Brand />
          {/* Small screens: scrolling nav in the header. Large screens use the sidebar. */}
          {!wide && (
            <nav aria-label="Main" className="no-scrollbar order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1">
              <NavItems items={items} layout="bar" unread={unread} />
            </nav>
          )}
          <div className="ml-auto">
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <NotificationBell />
              <span aria-hidden className="hidden h-6 w-px bg-glass-border sm:block" />
              <ThemeToggle />
              <span aria-hidden className="hidden h-6 w-px bg-glass-border sm:block" />
              <UserMenu />
              <SignOutButton />
            </div>
          </div>
        </motion.header>

        <div className="flex flex-1 gap-5 lg:gap-6">
          {wide && (
            <motion.aside
              animate={{ width: collapsed ? 68 : 240 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="shrink-0"
            >
              <div className="sticky top-28 flex flex-col gap-3">
                <nav aria-label="Main" className="glass glass-clear flex flex-col gap-1 p-2">
                  <NavItems items={items} layout="side" unread={unread} collapsed={collapsed} />
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    className={`mt-1 flex items-center gap-2.5 rounded-xl border-t border-glass-border px-3.5 pb-1.5 pt-2.5 text-xs text-text-dim transition-colors hover:text-text ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <IconMenu size={16} />
                    {!collapsed && 'Collapse'}
                  </button>
                </nav>
                {!collapsed && (
                  <div className="glass relative overflow-hidden p-4">
                    <span
                      aria-hidden
                      className="bg-gradient-brand absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-25 blur-2xl"
                    />
                    <span className="flex items-center gap-2.5">
                      <span className="bg-gradient-brand grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-[var(--shadow-glow)]">
                        <IconSparkles size={17} />
                      </span>
                      <span className="font-display text-sm font-semibold leading-snug">
                        Create, Capture.
                        <span className="text-gradient block">Transform.</span>
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </motion.aside>
          )}
          <main className="relative min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={location.pathname} variants={page} initial="initial" animate="enter" exit="exit">
                {outlet}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs text-text-dim">
          <span>
            <span className="font-medium text-text-muted">SageVatar</span> · AI Avatar &amp; Event
            Photo Studio
          </span>
          <span>SageIT internal</span>
        </footer>
      </div>
    </>
  );
}

function useSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  return async () => {
    await logout();
    toast.info('Signed out', 'See you next time.');
    navigate('/login', { replace: true });
  };
}

function SignOutButton() {
  const signOut = useSignOut();
  return (
    <IconButton
      label="Sign out"
      variant="subtle"
      className="hidden sm:inline-flex"
      icon={<IconLogout size={18} />}
      onClick={signOut}
    />
  );
}

function UserMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="flex items-center gap-2.5 rounded-full border border-transparent py-1 pl-1 pr-2.5 transition hover:border-glass-border hover:bg-glass"
      >
        <span className="bg-gradient-brand grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm">{user.name}</span>
          <span className="block text-[11px] text-text-muted">
            {user.role === 'CREATOR' ? 'Creator' : 'Employee'}
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-text-muted">
          <IconChevronDown size={15} />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            style={{ transformOrigin: 'top right' }}
            className="glass glass-popover absolute right-0 z-40 mt-2 w-60 !rounded-2xl p-1.5"
          >
            <div className="px-3 pb-2 pt-1.5">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-text-muted">{user.email}</div>
              <div className="mt-2">
                <Pill tone={user.role === 'CREATOR' ? 'brand' : 'neutral'}>
                  {user.role === 'CREATOR' ? 'Creator' : 'Employee'}
                </Pill>
              </div>
            </div>
            <div className="gradient-hairline my-1 opacity-40" />
            <MenuItem
              icon={<IconUsers size={16} />}
              onClick={() => {
                setOpen(false);
                navigate('/profile');
              }}
            >
              Edit Profile
            </MenuItem>
            <MenuItem
              icon={<IconPalette size={16} />}
              onClick={() => {
                setOpen(false);
                setLookOpen(true);
              }}
            >
              Appearance
            </MenuItem>
            <MenuItem
              icon={<IconKey size={16} />}
              onClick={() => {
                setOpen(false);
                setPwOpen(true);
              }}
            >
              Change password
            </MenuItem>
            <MenuItem
              icon={<IconLogout size={16} />}
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
            >
              Sign out
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <AppearanceDialog open={lookOpen} onClose={() => setLookOpen(false)} />
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-text-muted transition hover:bg-fg/10 hover:text-text"
    >
      {icon}
      {children}
    </button>
  );
}

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCurrent('');
    setNext('');
    setError('');
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.auth.changePassword(current, next);
      toast.success('Password updated', 'Other devices have been signed out.');
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      description="Changing it signs you out on every other device."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          data-autofocus
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint="At least 10 characters with upper- and lower-case letters, a number and a symbol."
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!current || !next}>
            Update password
          </Button>
        </div>
      </form>
    </Modal>
  );
}
