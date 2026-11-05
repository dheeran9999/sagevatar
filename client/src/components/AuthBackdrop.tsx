import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Full-screen background for the Login and Sign Up (accept-invite) pages only.
 *
 * Default: the supplied city/superhero still (client/public/backgrounds/city-hero.webp,
 * a single-frame 448×448 WebP — so it is animated with a CSS push-in, not played as video).
 * If it fails to load, the original city-canyon illustration is used instead.
 *
 * Override with VITE_AUTH_BACKGROUND in client/.env. A .mp4 / .webm value plays as a muted,
 * looping background video; anything else is treated as a still image.
 */
const DEFAULT_BACKGROUND = '/backgrounds/city-hero.webp';
export const FALLBACK_BACKGROUND = '/backgrounds/city-canyon.svg';
export const AUTH_BACKGROUND: string =
  (import.meta.env.VITE_AUTH_BACKGROUND as string | undefined) || DEFAULT_BACKGROUND;

const isVideo = (src: string) => /\.(mp4|webm)(\?|#|$)/i.test(src);

export function AuthBackdrop() {
  const [src, setSrc] = useState(AUTH_BACKGROUND);
  const [ready, setReady] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Pointer parallax: a few pixels of drift, written straight to CSS variables (no re-renders).
  useEffect(() => {
    const el = layer.current;
    if (!el || reduced || !window.matchMedia?.('(pointer: fine)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--px', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        el.style.setProperty('--py', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, [reduced]);

  const fallback = () => {
    if (src !== FALLBACK_BACKGROUND) setSrc(FALLBACK_BACKGROUND);
  };
  const shown = `auth-bg-media transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'}`;

  return (
    <div
      aria-hidden
      data-testid="auth-backdrop"
      className="pointer-events-none fixed inset-0 -z-[15] overflow-hidden bg-ink"
    >
      <div ref={layer} className="auth-bg-parallax">
        {isVideo(src) ? (
          <video
            key={src}
            src={src}
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => setReady(true)}
            onError={fallback}
            className={shown}
          />
        ) : (
          <img
            key={src}
            src={src}
            alt=""
            decoding="async"
            onLoad={() => setReady(true)}
            onError={fallback}
            className={shown}
          />
        )}
      </div>
      {/* Readability: dark tint, vignette and a soft accent wash keep the glass card legible. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(6_10_28/0.55),rgb(6_10_28/0.35)_45%,rgb(6_10_28/0.75))]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgb(6_10_28/0.8)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-br from-brand/20 via-transparent to-brand-2/15" />
    </div>
  );
}
