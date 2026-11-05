import { useEffect, useState, type AnimationEvent } from 'react';
import { useAppearance } from '../auth/AppearanceContext';
import { motionReduced } from '../lib/appearance';
import { clearFlyover, FLYOVER_FALLBACK, FLYOVER_IMAGE, isFlyoverPending } from '../lib/flyover';

/**
 * Post-login flyover: the supplied Batman still crosses the screen once after a successful
 * sign-in, right to left (the art faces left), along a gentle arc.
 *
 * Only the image's position, rotation and scale are animated (CSS keyframes) — the character
 * itself is a still. Swap FLYOVER_IMAGE for a real animated asset later if one is licensed.
 *
 * pointer-events: none on every layer, so nothing underneath is ever blocked. It lives in the
 * app shell (never on Login / Sign Up) and is plain DOM, so it can't reach exported photos,
 * which are drawn on a separate canvas.
 */
export function Flyover() {
  const { appearance } = useAppearance();
  const reduced = motionReduced(appearance);
  // Read (not consume) here so StrictMode's double render sees the same answer.
  const [run] = useState(() => (isFlyoverPending() ? 1 : 0));
  const [finished, setFinished] = useState(0);
  const [src, setSrc] = useState(FLYOVER_IMAGE);
  const [broken, setBroken] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState('');

  useEffect(() => {
    clearFlyover(); // once per sign-in: reloads and route changes won't replay it
  }, []);

  if (run === 0 || finished === run || reduced || broken) return null;

  const onEnd = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) setFinished(run);
  };

  return (
    <div
      aria-hidden
      data-testid="flyover"
      className="pointer-events-none fixed inset-0 z-[45] overflow-hidden"
    >
      <div
        key={run}
        className="flyover-path"
        style={{ animationPlayState: loadedSrc === src ? 'running' : 'paused' }}
        onAnimationEnd={onEnd}
      >
        <div className="flyover-bob">
          {/* Trailing, blurred copy = cheap motion blur. */}
          <img src={src} alt="" className="flyover-ghost" draggable={false} />
          <img
            src={src}
            alt=""
            className="flyover-sprite"
            draggable={false}
            onLoad={() => setLoadedSrc(src)}
            onError={() => (src === FLYOVER_IMAGE ? setSrc(FLYOVER_FALLBACK) : setBroken(true))}
          />
        </div>
      </div>
    </div>
  );
}
