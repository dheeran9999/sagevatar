import type { NotificationCategory } from '../lib/api';
import { IconCake, IconCalendar, IconImage, IconSparkles, IconUsers } from './icons';

const ICON = {
  event: IconCalendar,
  photo: IconImage,
  ai: IconSparkles,
  poster: IconCake,
  account: IconUsers,
} as const;

const TONE: Record<NotificationCategory, string> = {
  event: 'border-brand-2/30 bg-brand-2/15 text-brand-2',
  photo: 'border-success/30 bg-success/15 text-success',
  ai: 'border-brand/30 bg-brand/15 text-brand',
  poster: 'border-accent/30 bg-accent/15 text-accent',
  account: 'border-glass-border bg-glass text-text-muted',
};

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  event: 'Events',
  photo: 'Photos',
  ai: 'AI avatars',
  poster: 'Recognition',
  account: 'Account',
};

export function CategoryIcon({ category, size = 36 }: { category: NotificationCategory; size?: number }) {
  const Icon = ICON[category] ?? IconCalendar;
  return (
    <span
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-xl border ${TONE[category] ?? TONE.event}`}
    >
      <Icon size={Math.round(size * 0.46)} />
    </span>
  );
}

export function timeLabel(iso: string) {
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
