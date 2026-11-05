import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AppearanceProvider } from './auth/AppearanceContext';
import { FullScreenMessage, RequireAuth, RequirePermission } from './auth/guards';
import { AuroraBackground } from './components/AuroraBackground';
import { CityBackdrop } from './components/CityBackdrop';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/Toast';
import LoginPage from './pages/LoginPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import SignUpPage from './pages/auth/SignUpPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ConfirmEmailChangePage from './pages/auth/ConfirmEmailChangePage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import StudioPage from './pages/studio/StudioPage';
import HistoryPage from './pages/HistoryPage';
import EventsPage from './pages/events/EventsPage';
import EventPage from './pages/events/EventPage';
import EventCapturePage from './pages/events/EventCapturePage';
import RecognitionPage from './pages/recognition/RecognitionPage';
import NotificationsPage from './pages/NotificationsPage';
import { CreatorCreationPage, PosterViewPage } from './pages/CreationViewPage';

import SettingsPage from './pages/SettingsPage';

// Creator code is only downloaded by people who can open it.
const CreatorConsole = lazy(() => import('./pages/creator/CreatorConsole'));
const DashboardPage = lazy(() => import('./pages/creator/DashboardPage'));

/** Creator-only page, lazily loaded. */
function CreatorOnly({
  children,
  permission = 'employee.manage',
}: {
  children: React.ReactNode;
  permission?: Parameters<typeof RequirePermission>[0]['permission'];
}) {
  return (
    <RequirePermission permission={permission}>
      <Suspense fallback={<FullScreenMessage>Loading…</FullScreenMessage>}>{children}</Suspense>
    </RequirePermission>
  );
}

/** /creator: the Dashboard; old /creator?tab=… links go to their section. */
function CreatorHome() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  if (tab && ['employees', 'library', 'templates', 'analytics', 'audit'].includes(tab)) {
    const rest = new URLSearchParams(params);
    rest.delete('tab');
    const q = rest.toString();
    return (
      <Navigate to={`/creator/${tab === 'audit' ? 'analytics' : tab}${q ? `?${q}` : ''}`} replace />
    );
  }
  return <DashboardPage />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/confirm-email" element={<ConfirmEmailChangePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<StudioPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:id" element={<EventPage />} />
          <Route path="events/:id/capture" element={<EventCapturePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="posters/:id" element={<PosterViewPage />} />
          <Route
            path="creator/creations/:id"
            element={
              <RequirePermission permission="employee.manage">
                <CreatorCreationPage />
              </RequirePermission>
            }
          />
          <Route
            path="recognition"
            element={
              <RequirePermission permission="poster.create">
                <RecognitionPage />
              </RequirePermission>
            }
          />
          <Route path="ai-finder" element={<StudioPage />} />
          <Route path="settings" element={<SettingsPage variant="settings" />} />
          <Route path="profile" element={<SettingsPage variant="profile" />} />
          <Route
            path="creator"
            element={
              <CreatorOnly permission="analytics.view">
                <CreatorHome />
              </CreatorOnly>
            }
          />
          <Route
            path="creator/employees"
            element={
              <CreatorOnly>
                <CreatorConsole only={['employees']} />
              </CreatorOnly>
            }
          />
          <Route
            path="creator/library"
            element={
              <CreatorOnly permission="library.manage">
                <CreatorConsole only={['library']} />
              </CreatorOnly>
            }
          />
          <Route
            path="creator/templates"
            element={
              <CreatorOnly permission="template.manage">
                <CreatorConsole only={['templates']} />
              </CreatorOnly>
            }
          />
          <Route
            path="creator/analytics"
            element={
              <CreatorOnly permission="analytics.view">
                <CreatorConsole only={['analytics', 'audit']} />
              </CreatorOnly>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Applies the user's Appearance settings and wraps the app in Framer's MotionConfig
            (OS "reduce motion" is always honoured; users can also reduce or switch off motion). */}
        <AppearanceProvider>
          <ToastProvider>
            {/* Dark theme: cinematic night city; light theme: soft aurora. */}
            <CityBackdrop />
            <AuroraBackground />
            <AppRoutes />
          </ToastProvider>
        </AppearanceProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
