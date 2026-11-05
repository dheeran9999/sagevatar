import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Permission } from '../lib/api';
import { useAuth } from './AuthContext';
import { OrbitLoader } from '../components/ui';
import { IconShield } from '../components/icons';

/**
 * UI-level guards. They only decide what to render — every protected action is
 * also enforced by the API, so bypassing these in the browser gains nothing.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(permission)) return <NotAuthorized />;
  return <>{children}</>;
}

/** Renders children only when allowed — for buttons, links and panels. */
export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : null;
}

export function NotAuthorized() {
  return (
    <section
      role="alert"
      className="glass mx-auto mt-10 flex max-w-md flex-col items-center p-8 text-center"
    >
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
        <IconShield size={24} />
      </div>
      <h2 className="mb-2 text-xl font-semibold">Not available for your role</h2>
      <p className="mb-6 text-sm text-text-muted">
        This area is for Creators. If you think you need access, contact your SageVatar Creator.
      </p>
      <Link
        to="/"
        className="bg-gradient-brand btn-shine rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-glow)] transition hover:-translate-y-0.5"
      >
        Back to Studio
      </Link>
    </section>
  );
}

export function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <OrbitLoader label={typeof children === 'string' ? children : 'Loading…'} />
    </div>
  );
}
