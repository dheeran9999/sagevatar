import { useCallback, useEffect, useRef, useState } from 'react';
import {
  actualFacing,
  cameraErrorFrom,
  cameraSupportIssue,
  countCameras,
  startCamera,
  stopStream,
  type CameraError,
  type Facing,
} from '../lib/camera';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';

/**
 * Camera lifecycle: permission request, start/stop, front/rear switching.
 * The stream is always stopped on unmount, when a photo is taken, and when the tab is hidden
 * — so the camera light never stays on in the background.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(() => cameraSupportIssue());
  const [facing, setFacing] = useState<Facing>('user');
  const [cameraCount, setCameraCount] = useState(0);

  const attach = useCallback(async (stream: MediaStream) => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    try {
      await v.play();
    } catch {
      /* autoplay is allowed for muted inline video; ignore benign interruptions */
    }
  }, []);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus((s) => (s === 'error' ? s : 'idle'));
  }, []);

  const start = useCallback(
    async (want: Facing = facing) => {
      const unsupported = cameraSupportIssue();
      if (unsupported) {
        setError(unsupported);
        setStatus('error');
        return false;
      }
      setStatus('starting');
      setError(null);
      try {
        stopStream(streamRef.current);
        const stream = await startCamera(want);
        streamRef.current = stream;
        setFacing(actualFacing(stream, want));
        setStatus('live');
        await attach(stream);
        setCameraCount(await countCameras());
        // A track can end on its own (camera unplugged, permission revoked).
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (streamRef.current === stream) {
            streamRef.current = null;
            setError(cameraErrorFrom({ name: 'NotReadableError' }));
            setStatus('error');
          }
        });
        return true;
      } catch (e) {
        streamRef.current = null;
        setError(cameraErrorFrom(e));
        setStatus('error');
        return false;
      }
    },
    [attach, facing],
  );

  const switchCamera = useCallback(
    () => start(facing === 'user' ? 'environment' : 'user'),
    [facing, start],
  );

  // The <video> may mount after the stream is ready; attach once it exists.
  useEffect(() => {
    if (status === 'live' && streamRef.current && videoRef.current && !videoRef.current.srcObject) {
      attach(streamRef.current);
    }
  });

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && streamRef.current) stop();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [stop]);

  return {
    videoRef,
    status,
    error,
    facing,
    /** Front cameras are previewed (and captured) mirrored, like a mirror. */
    mirrored: facing === 'user',
    canSwitch: cameraCount > 1,
    start,
    stop,
    switchCamera,
  };
}
