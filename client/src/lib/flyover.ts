/**
 * The post-login Batman flyover plays once per successful sign-in. The sign-in sets a flag in
 * sessionStorage; the app shell consumes it once. Reloads and route changes don't replay it.
 */
const KEY = 'sagevatar.flyover';

/** Transparent cut-out made by `npm run cutout -w client` from the supplied still. */
export const FLYOVER_IMAGE = '/assets/batman-fly-cutout.png';
/** The supplied original (grey studio background). Used only if the cut-out is missing. */
export const FLYOVER_FALLBACK = '/assets/batman-fly.png';

export function markFlyoverPending() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* private mode etc. — the flyover just won't play */
  }
}

export function isFlyoverPending(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearFlyover() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
