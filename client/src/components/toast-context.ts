import { createContext, useContext } from 'react';
import { IconAlert, IconCheck, IconInfo } from './icons';

/**
 * Toast/notification context and hooks. Kept apart from the components in Toast.tsx so that
 * hot reloading the UI never recreates the context (which would orphan open providers).
 */
export type Tone = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  tone: Tone;
  title: string;
  message?: string;
}

export interface ToastApi {
  notify: (tone: Tone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

export interface NotificationItem extends Toast {
  at: number;
  read: boolean;
}

export interface NotificationsApi {
  items: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  clear: () => void;
}

export const ToastContext = createContext<ToastApi | null>(null);
export const NotificationsContext = createContext<NotificationsApi | null>(null);
export const HISTORY_MAX = 20;

export const TONE = {
  success: {
    icon: IconCheck,
    ring: 'text-success bg-success/15 border-success/30',
    bar: 'bg-success',
  },
  error: { icon: IconAlert, ring: 'text-accent bg-accent/15 border-accent/30', bar: 'bg-accent' },
  info: { icon: IconInfo, ring: 'text-brand-2 bg-brand-2/15 border-brand-2/30', bar: 'bg-brand-2' },
} as const;

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** This session's notification history (for the header bell). */
export function useNotifications(): NotificationsApi {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside <ToastProvider>');
  return ctx;
}
