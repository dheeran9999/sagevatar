/** Camera helpers: support checks, stream start, and friendly error messages. */

export type Facing = 'user' | 'environment';

export type CameraIssue =
  'insecure' | 'unsupported' | 'denied' | 'not-found' | 'in-use' | 'constraints' | 'unknown';

export interface CameraError {
  issue: CameraIssue;
  title: string;
  message: string;
}

/**
 * Browsers only expose the camera in a secure context (HTTPS or localhost).
 * Returns the reason the camera can't be used at all, or null if it can be tried.
 */
export function cameraSupportIssue(): CameraError | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return describe('insecure');
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return describe('unsupported');
  }
  return null;
}

export function describe(issue: CameraIssue, detail?: string): CameraError {
  switch (issue) {
    case 'insecure':
      return {
        issue,
        title: 'Camera needs a secure connection',
        message:
          'Open SageVatar over HTTPS (or on localhost) to use the camera. You can still upload a photo.',
      };
    case 'unsupported':
      return {
        issue,
        title: 'Camera not supported',
        message:
          'This browser can’t access a camera. Try a current Chrome, Edge, Safari or Firefox, or upload a photo.',
      };
    case 'denied':
      return {
        issue,
        title: 'Camera permission blocked',
        message:
          'Allow camera access using the camera icon in your browser’s address bar, then try again. You can also upload a photo.',
      };
    case 'not-found':
      return {
        issue,
        title: 'No camera found',
        message:
          'We couldn’t find a camera on this device. Connect one and try again, or upload a photo.',
      };
    case 'in-use':
      return {
        issue,
        title: 'Camera is busy',
        message: 'Another app may be using your camera. Close it and try again, or upload a photo.',
      };
    case 'constraints':
      return {
        issue,
        title: 'Camera mode not available',
        message:
          'That camera isn’t available on this device. Try switching cameras or upload a photo.',
      };
    default:
      return {
        issue: 'unknown',
        title: 'Couldn’t start the camera',
        message: detail
          ? `${detail} You can still upload a photo.`
          : 'Something went wrong. You can still upload a photo.',
      };
  }
}

/** Maps getUserMedia DOMException names to a friendly message. */
export function cameraErrorFrom(err: unknown): CameraError {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return describe('denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return name === 'OverconstrainedError' ? describe('constraints') : describe('not-found');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return describe('in-use');
    default:
      return describe('unknown', (err as Error)?.message);
  }
}

export async function startCamera(facing: Facing): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facing },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    // Some devices reject the resolution hint — retry with the bare minimum.
    if ((err as { name?: string })?.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw err;
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Number of video inputs (labels need permission; counting does not). */
export async function countCameras(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 0;
  }
}

/** Facing of the active track when the browser reports it (mobile), else the requested one. */
export function actualFacing(stream: MediaStream, requested: Facing): Facing {
  const s = stream.getVideoTracks()[0]?.getSettings?.();
  return (s?.facingMode as Facing | undefined) ?? requested;
}
