import { useEffect, useState } from 'react';
import { api, type Avatar } from '../lib/api';

/**
 * Decorative avatar characters drifting slowly at the screen edges after login.
 *
 * - Picked from the live catalog (one per category, face/half-body), so they always show
 *   active, licensed library art and load through the authenticated asset route.
 * - Lives in its own fixed layer *behind* the app (`-z-10`), never receives pointer
 *   events and is hidden from assistive tech, so it can't block buttons, text or the camera.
 * - Low opacity, CSS transform animation only; paused for reduced-motion users (global rule).
 * - Fewer characters on smaller screens; none on phones.
 * - `data-export-exclude`: this layer is UI chrome. Photo export renders only the composition
 *   canvas, never the page, so these can't appear in downloaded or emailed photos.
 */
const SLOTS = [
  { pos: 'left-[1.5%] top-[16%] w-20', delay: '0s', dur: '19s', show: '' },
  { pos: 'right-[1.5%] top-[24%] w-24', delay: '-6s', dur: '23s', show: '' },
  { pos: 'left-[3%] bottom-[12%] w-16', delay: '-11s', dur: '21s', show: 'hidden lg:block' },
  { pos: 'right-[3%] bottom-[8%] w-20', delay: '-3s', dur: '25s', show: 'hidden lg:block' },
];

function pick(avatars: Avatar[]): Avatar[] {
  const chosen: Avatar[] = [];
  const seen = new Set<string>();
  for (const a of avatars) {
    if ((a.type === 'FACE' || a.type === 'HALF_BODY') && !seen.has(a.category.slug)) {
      seen.add(a.category.slug);
      chosen.push(a);
    }
  }
  return chosen.slice(0, SLOTS.length);
}

export function FloatingAvatars() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);

  useEffect(() => {
    // Not worth a request on phones, where the layer is hidden.
    if (window.matchMedia?.('(max-width: 767px)').matches) return;
    let alive = true;
    api.catalog
      .avatars()
      .then((all) => alive && setAvatars(pick(all)))
      .catch(() => undefined); // purely decorative
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div
      aria-hidden
      data-export-exclude
      data-testid="decorative-avatars"
      className="pointer-events-none fixed inset-0 -z-10 hidden select-none overflow-hidden md:block"
    >
      {avatars.map((a, i) => {
        const slot = SLOTS[i];
        return (
          <img
            key={a.id}
            src={a.thumbnailUrl ?? a.fileUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={(e) => (e.currentTarget.style.display = 'none')}
            className={`absolute opacity-[0.22] blur-[0.3px] drop-shadow-[0_12px_30px_rgba(124,92,255,0.35)] animate-drift will-change-transform ${slot.pos} ${slot.show}`}
            style={{ animationDelay: slot.delay, animationDuration: slot.dur }}
          />
        );
      })}
    </div>
  );
}
