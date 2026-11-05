/**
 * The legacy MediaPipe solutions (selfie segmentation, face detection, face mesh) all hand
 * their WASM loader to the page through the same two globals. When a second solution starts
 * while the first one's loader is still on `window`, it picks up the wrong loader, requests
 * the other solution's files and aborts. Starting engines one at a time with those globals
 * cleared lets every solution load its own runtime, so they can share a page.
 */
const GLOBALS = ['createMediapipeSolutionsWasm', 'createMediapipeSolutionsPackedAssets'] as const;

let chain: Promise<unknown> = Promise.resolve();

function clear() {
  const w = window as unknown as Record<string, unknown>;
  for (const g of GLOBALS) {
    try {
      delete w[g];
    } catch {
      w[g] = undefined;
    }
  }
}

/** Runs `start` (construct + initialize a solution) with the shared loader globals isolated. */
export function initMediapipe<T>(start: () => Promise<T>): Promise<T> {
  const job = chain.then(async () => {
    clear();
    try {
      return await start();
    } finally {
      clear();
    }
  });
  chain = job.catch(() => undefined);
  return job;
}
