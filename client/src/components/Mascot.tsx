import { useState } from 'react';
import { useReducedMotionConfig } from 'framer-motion';

/**
 * "Sagi", the studio mascot — an original animated GIF generated locally by
 * client/scripts/generate-mascot.mjs (no external or hotlinked assets).
 *
 * - Reduced-motion users get the static poster frame.
 * - If the GIF fails to load we fall back to the poster, then to a CSS glow orb.
 * - The GIF is opaque by design; rounded clipping here keeps edges anti-aliased.
 */
export const MASCOT_GIF = '/mascot/sagi.gif';
export const MASCOT_POSTER = '/mascot/sagi-poster.png';

export function Mascot({ className = '' }: { className?: string }) {
  const reduce = useReducedMotionConfig();
  const [stage, setStage] = useState<'gif' | 'poster' | 'none'>('gif');
  const src = reduce || stage === 'poster' ? MASCOT_POSTER : MASCOT_GIF;

  return (
    <div className={`relative isolate ${className}`}>
      {/* Orbit rings live in CSS — cheaper than animating them inside the GIF. */}
      <div aria-hidden className="pointer-events-none absolute -inset-8 -z-10 sm:-inset-10">
        <div className="absolute inset-0 rounded-full border border-dashed border-brand/35 animate-spin-slow" />
        <div className="absolute inset-6 rounded-full border border-dotted border-brand-2/30 animate-spin-slower" />
        <div className="absolute inset-[18%] rounded-full bg-brand/30 blur-3xl animate-pulse-soft" />
      </div>

      <div className="ring-gradient rounded-[2rem] shadow-[0_30px_80px_-20px_rgb(124_92_255/0.6)]">
        <div className="viewfinder relative overflow-hidden rounded-[2rem] bg-ink-2">
          {stage === 'none' ? (
            <div
              role="img"
              aria-label="SageVatar mascot"
              className="aspect-[5/6] w-full bg-[radial-gradient(circle_at_50%_45%,var(--color-brand)_0%,#22304f_45%,#0a0f2a_75%)]"
            />
          ) : (
            <img
              src={src}
              alt="Sagi, the SageVatar camera bot, waving and taking a photo"
              width={400}
              height={480}
              decoding="async"
              {...{ fetchpriority: 'high' }}
              draggable={false}
              onError={() => setStage((s) => (s === 'gif' && !reduce ? 'poster' : 'none'))}
              className="block aspect-[5/6] h-auto w-full select-none"
            />
          )}
          <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-ink/60 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-white/90 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-soft" />
            LIVE STUDIO
          </span>
        </div>
      </div>
    </div>
  );
}
