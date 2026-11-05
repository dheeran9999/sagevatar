import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/toast-context';
import { useCamera } from '../../hooks/useCamera';
import {
  api,
  type Avatar,
  type AvatarType,
  type AvatarTypeInfo,
  type Category,
} from '../../lib/api';
import {
  clampTransform,
  defaultPlacementFor,
  exportScene,
  loadAvatarImage,
  needsCutout,
  presetFor,
  type Placement,
  type Scene,
  type StudioMode,
  type Transform,
} from '../../lib/compose';
import { captureFrame, loadPhotoFile, PhotoError, type Photo } from '../../lib/image';
import { cutOutPerson, warmUpSegmentation } from '../../lib/segmentation';
import { detectFaceMeshes, warmUpFaceMesh, type FaceGeom } from '../../lib/facemesh';
import {
  BUILT_IN_FILTERS,
  characterFilter,
  clampAdjust,
  faceHandle,
  NO_ADJUST,
  type FaceFilter,
  type FilterAdjust,
} from '../../lib/faceFilters';
import { customFilter, readCustomFilters, type CustomFilterRecord } from '../../lib/customFilters';
import {
  avatarAnchors,
  bodyFrame,
  facePatch,
  fitAvatarToBody,
  poseFrame,
  type BodyFrame,
  removePerson,
} from '../../lib/bodyAvatar';
import { detectPose, warmUpPose, type PoseResult } from '../../lib/pose';
import { CameraStage, type FaceMarker, type StageHandle } from './CameraStage';
import { AvatarTray } from './AvatarTray';
import { StudioPanel, type Adjustable, type CutoutState, type DetectState } from './StudioPanel';
import {
  AddFilterDialog,
  FilterBrowser,
  FilterCarousel,
  type CarouselView,
  type FilterItem,
} from './FilterCarousel';
import { EmailDialog, PreviewDialog, type SendStage } from './Dialogs';
import { photoFilename } from '../../lib/filename';
import type { EmailResult, PhotoFormat } from '../../lib/api';

const NEUTRAL: Transform = presetFor('beside', 'FULL_BODY');

const SOURCE_LABEL: Record<BodyFrame['source'], string> = {
  'pose+face': 'body pose + face landmarks',
  pose: 'body pose landmarks',
  'face+silhouette': 'face landmarks + body silhouette',
  face: 'face landmarks',
  silhouette: 'body silhouette',
};

/**
 * Camera Studio — the main workspace. Camera (or uploaded photo) on top, the filter carousel
 * or avatar gallery directly underneath, the three-step workflow alongside.
 *
 * Pipeline: capture/upload → working canvas → Face Mesh landmarks (+ person segmentation when
 * needed) → face filter / full-body fit / placement → one `renderScene` for preview and export.
 */
/** When set, the Studio works inside an event: photos are saved to that event automatically. */
export interface StudioEvent {
  id: string;
  code: string;
  name: string;
}

export default function StudioPage({ event }: { event?: StudioEvent } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const camera = useCamera();
  const trayRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // ---- catalog ----
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<AvatarTypeInfo[]>([]);
  const [avatars, setAvatars] = useState<Avatar[] | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [category, setCategory] = useState('all');
  const [typeFilter, setTypeFilter] = useState<AvatarType | 'all'>('all');

  useEffect(() => {
    Promise.all([api.catalog.categories(), api.catalog.types(), api.catalog.avatars()])
      .then(([c, t, a]) => {
        setCategories(c);
        setTypes(t);
        setAvatars(a);
      })
      .catch((e: Error) => setCatalogError(e.message));
  }, []);

  // ---- mode ----
  const [mode, setMode] = useState<StudioMode>('face');

  // ---- photo ----
  const [photo, setPhoto] = useState<Photo | null>(null);
  const photoSeq = useRef(0);
  const [photoId, setPhotoId] = useState(0);
  const [capturing, setCapturing] = useState(false);
  /** When the current photo was captured or uploaded (stored with event photos). */
  const capturedAt = useRef<Date>(new Date());

  useEffect(() => warmUpFaceMesh(), []);
  useEffect(() => {
    if (mode === 'body') warmUpPose();
  }, [mode]);

  /** Which faces get the filter (indices left to right), reset for every new photo. */
  const [targets, setTargets] = useState<'all' | number[]>('all');

  const adoptPhoto = useCallback(
    (p: Photo) => {
      capturedAt.current = new Date();
      photoSeq.current += 1;
      setPhotoId(photoSeq.current);
      setPhoto(p);
      setTargets('all');
      camera.stop();
      warmUpSegmentation();
    },
    [camera],
  );

  const capture = async () => {
    const v = camera.videoRef.current;
    if (!v) return;
    setCapturing(true);
    try {
      adoptPhoto(await captureFrame(v, camera.mirrored));
    } catch (e) {
      toast.error('Couldn’t capture', (e as Error).message);
    } finally {
      setTimeout(() => setCapturing(false), 450);
    }
  };

  const upload = async (file: File) => {
    try {
      adoptPhoto(await loadPhotoFile(file));
      toast.success('Photo ready', 'Finding faces — then pick a filter or avatar.');
    } catch (e) {
      toast.error(
        'Can’t use that photo',
        e instanceof PhotoError ? e.message : 'The image couldn’t be read.',
      );
    }
  };

  /** The person's own authorised profile photograph (Edit Profile), usable as the Studio photo. */
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  useEffect(() => {
    api.auth
      .profile()
      .then((pr) => setProfilePhoto(pr.photo?.url ?? null))
      .catch(() => undefined);
  }, []);
  const applyProfilePhoto = async () => {
    if (!profilePhoto) return;
    try {
      const r = await fetch(profilePhoto, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Your profile photo couldn’t be loaded.');
      const blob = await r.blob();
      await upload(new File([blob], 'profile-photo.jpg', { type: blob.type || 'image/jpeg' }));
    } catch (e) {
      toast.error('Profile photo unavailable', (e as Error).message);
    }
  };

  const retake = () => {
    setPhoto(null);
    setCutout(null);
    setFaceData(null);
    camera.start();
  };

  // ---- face landmarks (every photo) ----
  const [faceData, setFaceData] = useState<{ photoId: number; faces: FaceGeom[] } | null>(null);
  const [faceFailedFor, setFaceFailedFor] = useState(0);
  const detectState: DetectState = !photo
    ? 'idle'
    : faceData?.photoId === photoId
      ? 'ready'
      : faceFailedFor === photoId
        ? 'failed'
        : 'working';

  useEffect(() => {
    if (detectState !== 'working' || !photo) return;
    let alive = true;
    detectFaceMeshes(photo.canvas)
      .then((faces) => alive && setFaceData({ photoId, faces }))
      .catch(() => alive && setFaceFailedFor(photoId));
    return () => {
      alive = false;
    };
  }, [detectState, photo, photoId]);

  /** Faces left to right, so "Face 1" is the leftmost person. */
  const faces = useMemo(
    () =>
      faceData?.photoId === photoId
        ? [...faceData.faces].sort((a, b) => a.origin.x - b.origin.x)
        : [],
    [faceData, photoId],
  );
  const primaryFace = useMemo(
    () => [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0] ?? null,
    [faces],
  );

  // ---- face filters ----
  const [customRecs, setCustomRecs] = useState<CustomFilterRecord[]>(readCustomFilters);
  const items = useMemo<FilterItem[]>(
    () => [
      ...BUILT_IN_FILTERS.map((f) => ({
        id: f.id,
        name: f.name,
        category: f.category,
        tags: f.tags,
        featured: f.featured,
        filter: f,
      })),
      ...(avatars ?? [])
        .filter((a) => a.type === 'FACE')
        .map<FilterItem>((a) => ({
          id: `char-${a.id}`,
          name: a.name.replace(/\s·\s.*$/, ''),
          category: 'characters',
          tags: [a.category.name, 'character', 'avatar', ...(a.tags ?? [])],
          thumb: a.thumbnailUrl ?? undefined,
        })),
      ...customRecs.map<FilterItem>((r) => ({
        id: r.id,
        name: r.name,
        category: 'custom',
        tags: ['custom', 'my filter'],
        thumb: r.dataUrl,
      })),
    ],
    [avatars, customRecs],
  );
  const [view, setView] = useState<CarouselView>('all');
  const [filterSel, setFilterSel] = useState<{ item: FilterItem; filter: FaceFilter } | null>(
    null,
  );
  const [loadingFilter, setLoadingFilter] = useState<string | null>(null);
  const filterSeq = useRef(0);
  const [adjust, setAdjust] = useState<FilterAdjust>(NO_ADJUST);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const resolveFilter = async (item: FilterItem): Promise<FaceFilter> => {
    if (item.filter) return item.filter;
    if (item.category === 'characters') {
      const a = avatars?.find((x) => `char-${x.id}` === item.id);
      if (!a) throw new Error('This character is no longer in the library.');
      const img = await loadAvatarImage(a.fileUrl);
      const anchors = avatarAnchors(img, 'FACE');
      return characterFilter({
        id: item.id,
        name: item.name,
        image: img,
        head: anchors.head,
        thumbUrl: item.thumb,
      });
    }
    const rec = customRecs.find((r) => r.id === item.id);
    if (!rec) throw new Error('This filter is no longer available.');
    return customFilter(rec);
  };

  const chooseFilter = async (item: FilterItem | null) => {
    setMode('face');
    const seq = ++filterSeq.current;
    if (!item) {
      setFilterSel(null);
      return;
    }
    setLoadingFilter(item.id);
    try {
      const f = await resolveFilter(item);
      if (seq !== filterSeq.current) return;
      setFilterSel({ item, filter: f });
      setAdjust(NO_ADJUST);
    } catch (e) {
      toast.error('Filter unavailable', (e as Error).message);
    } finally {
      if (seq === filterSeq.current) setLoadingFilter(null);
    }
  };

  const targetFaces = useMemo(
    () => (targets === 'all' ? faces : faces.filter((_, i) => targets.includes(i))),
    [faces, targets],
  );

  // ---- avatar + placement ----
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [avatarImg, setAvatarImg] = useState<{ id: string; img: HTMLImageElement } | null>(null);
  const [placement, setPlacement] = useState<Placement>('beside');
  const [placementChosen, setPlacementChosen] = useState(false);
  const [transform, setTransform] = useState<Transform>(NEUTRAL);
  const [customizing, setCustomizing] = useState(false);
  /** Last automatic body fit — refitted when the photo, avatar or detection changes. */
  const lastFit = useRef('');
  const [fitNonce, setFitNonce] = useState(0);

  const selectAvatar = (a: Avatar) => {
    setAvatar(a);
    lastFit.current = '';
    let m = mode;
    if (a.type === 'BACKGROUND') m = 'place';
    else if (mode === 'face') m = 'body';
    setMode(m);
    const pl = placementChosen ? placement : defaultPlacementFor(a);
    setPlacement(pl);
    setTransform(presetFor(pl, a.type));
  };

  const choosePlacement = (pl: Placement) => {
    setPlacement(pl);
    setPlacementChosen(true);
    if (avatar) setTransform(presetFor(pl, avatar.type));
  };

  const focusTray = () => {
    // The gallery is shown outside face mode; wait for it to mount.
    setTimeout(() => {
      trayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      trayRef.current?.focus({ preventScroll: true });
    }, 60);
  };

  const changeMode = (m: StudioMode, pl?: Placement) => {
    setMode(m);
    if (m === 'place' && pl) choosePlacement(pl);
    if (m === 'body') {
      lastFit.current = '';
      if (!avatar || avatar.type === 'BACKGROUND') {
        toast.info('Pick a full-body avatar', 'Choose one from the gallery under the camera.');
        focusTray();
      }
    }
  };

  const updateTransform = (t: Transform) => setTransform(clampTransform(t));

  useEffect(() => {
    if (!avatar || avatarImg?.id === avatar.id) return;
    let alive = true;
    loadAvatarImage(avatar.fileUrl)
      .then((img) => alive && setAvatarImg({ id: avatar.id, img }))
      .catch((e: Error) => toast.error('Avatar unavailable', e.message));
    return () => {
      alive = false;
    };
  }, [avatar, avatarImg?.id, toast]);

  const avatarReadyImg = avatar && avatarImg?.id === avatar.id ? avatarImg.img : null;

  // ---- body pose + full-body mask (Full-Body mode, once per photo) ----
  const wantsBody = !!photo && mode === 'body' && !!avatar && avatar.type !== 'BACKGROUND';
  const [poseData, setPoseData] = useState<{ photoId: number; pose: PoseResult | null } | null>(
    null,
  );
  const poseState: DetectState = !wantsBody
    ? 'idle'
    : poseData?.photoId === photoId
      ? 'ready'
      : 'working';
  const pose = poseData?.photoId === photoId ? poseData.pose : null;

  useEffect(() => {
    if (poseState !== 'working' || !photo) return;
    let alive = true;
    detectPose(photo.canvas)
      .then((r) => alive && setPoseData({ photoId, pose: r }))
      .catch(() => alive && setPoseData({ photoId, pose: null }));
    return () => {
      alive = false;
    };
  }, [poseState, photo, photoId]);

  // ---- person cut-out (only when needed, once per photo) ----
  const [cutout, setCutout] = useState<{ photoId: number; canvas: HTMLCanvasElement } | null>(null);
  const [cutoutFailedFor, setCutoutFailedFor] = useState(0);
  const wantsCutout =
    !!photo &&
    // Full-body mode uses the pose mask; selfie segmentation is its fallback.
    ((wantsBody && poseState === 'ready' && !pose?.cutout) ||
      (mode === 'place' && needsCutout(avatar, placement)));
  const cutoutState: CutoutState = !wantsCutout
    ? 'idle'
    : cutout?.photoId === photoId
      ? 'ready'
      : cutoutFailedFor === photoId
        ? 'failed'
        : 'working';
  const cutoutCanvas = cutout?.photoId === photoId ? cutout.canvas : null;

  useEffect(() => {
    if (cutoutState !== 'working' || !photo) return;
    let alive = true;
    cutOutPerson(photo.canvas)
      .then((canvas) => alive && setCutout({ photoId, canvas }))
      .catch(() => alive && setCutoutFailedFor(photoId));
    return () => {
      alive = false;
    };
  }, [cutoutState, photo, photoId]);

  // ---- full-body fit ----
  const [bodyStyle, setBodyStyle] = useState<'overlay' | 'replace'>('overlay');
  const [keepFace, setKeepFace] = useState(false);
  const bodyInputsReady =
    mode === 'body' &&
    detectState !== 'working' &&
    poseState !== 'working' &&
    cutoutState !== 'working';
  /** The person's mask for replace mode / fallback framing: pose mask first. */
  const bodyCutout = pose?.cutout ?? cutoutCanvas;
  const frame = useMemo(
    () =>
      photo && bodyInputsReady
        ? ((pose ? poseFrame(pose, primaryFace, photo.width, photo.height) : null) ??
          bodyFrame(primaryFace, bodyCutout, photo.width, photo.height))
        : null,
    [photo, bodyInputsReady, pose, primaryFace, bodyCutout],
  );

  useEffect(() => {
    if (mode !== 'body' || !photo || !avatar || !avatarReadyImg || !frame) return;
    if (avatar.type === 'BACKGROUND') return;
    const key = `${photoId}:${avatar.id}:${frame.source}:${fitNonce}`;
    if (lastFit.current === key) return;
    lastFit.current = key;
    const anchors = avatarAnchors(avatarReadyImg, avatar.type);
    if (anchors.opaqueBackground) {
      toast.info(
        'This avatar has a solid background',
        'It will cover the photo as a rectangle. Avatars with transparent backgrounds work best.',
      );
    }
    setTransform(
      fitAvatarToBody(
        frame,
        anchors,
        {
          width: avatarReadyImg.naturalWidth || avatar.width,
          height: avatarReadyImg.naturalHeight || avatar.height,
          type: avatar.type,
        },
        photo.width,
        photo.height,
      ),
    );
  }, [mode, photo, photoId, avatar, avatarReadyImg, frame, toast, fitNonce]);

  const removed = useMemo(
    () =>
      mode === 'body' && bodyStyle === 'replace' && photo && bodyCutout
        ? removePerson(photo.canvas, bodyCutout)
        : null,
    [mode, bodyStyle, photo, bodyCutout],
  );
  const facePatchCanvas = useMemo(
    () =>
      mode === 'body' && keepFace && photo && primaryFace ? facePatch(photo.canvas, primaryFace) : null,
    [mode, keepFace, photo, primaryFace],
  );

  // ---- scene ----
  const scene = useMemo<Omit<Scene, 'photo'> | null>(() => {
    if (!photo) return null;
    return {
      mode,
      cutout: cutoutCanvas,
      avatar: avatarReadyImg
        ? {
            image: avatarReadyImg,
            width: avatarReadyImg.naturalWidth || avatar!.width,
            height: avatarReadyImg.naturalHeight || avatar!.height,
            type: avatar!.type,
          }
        : null,
      placement,
      transform,
      filter:
        mode === 'face' && filterSel
          ? { filter: filterSel.filter, faces: targetFaces, adjust }
          : null,
      body:
        mode === 'body'
          ? { style: bodyStyle, background: removed, facePatch: facePatchCanvas }
          : null,
    };
  }, [
    photo,
    mode,
    cutoutCanvas,
    avatarReadyImg,
    avatar,
    placement,
    transform,
    filterSel,
    targetFaces,
    adjust,
    bodyStyle,
    removed,
    facePatchCanvas,
  ]);

  // ---- manipulation (stage drag, wheel, keys, panel nudges) ----
  const W = photo?.width ?? camera.videoRef.current?.videoWidth ?? 1280;
  const H = photo?.height ?? camera.videoRef.current?.videoHeight ?? 720;
  const refFace = primaryFace;

  const nudge = (dx: number, dy: number) => {
    if (mode === 'face') {
      const u = refFace?.u ?? W * 0.06;
      const roll = refFace?.roll ?? 0;
      const px = dx * W;
      const py = dy * H;
      const c = Math.cos(-roll);
      const s = Math.sin(-roll);
      setAdjust((a) =>
        clampAdjust({ ...a, dx: a.dx + (px * c - py * s) / u, dy: a.dy + (px * s + py * c) / u }),
      );
      return;
    }
    setTransform((t) => clampTransform({ ...t, x: t.x + dx, y: t.y + dy }));
  };
  const zoom = (k: number) => {
    if (mode === 'face') setAdjust((a) => clampAdjust({ ...a, scale: a.scale * k }));
    else setTransform((t) => clampTransform({ ...t, scale: t.scale * k }));
  };

  const refit = () => {
    lastFit.current = '';
    if (mode === 'body') {
      // Re-run the automatic body fit.
      setFitNonce((n) => n + 1);
    } else if (avatar) setTransform(presetFor(placement, avatar.type));
  };

  const adjustable: Adjustable | null =
    mode === 'face'
      ? filterSel
        ? {
            size: adjust.scale * 100,
            sizeRange: [40, 250],
            rotation: adjust.rotation,
            opacity: adjust.opacity * 100,
            onSize: (v) => setAdjust((a) => clampAdjust({ ...a, scale: v / 100 })),
            onRotation: (v) => setAdjust((a) => clampAdjust({ ...a, rotation: v })),
            onOpacity: (v) => setAdjust((a) => clampAdjust({ ...a, opacity: v / 100 })),
            onNudge: nudge,
            onReset: () => setAdjust(NO_ADJUST),
          }
        : null
      : avatar && avatar.type !== 'BACKGROUND'
        ? {
            size: transform.scale * 100,
            sizeRange: [8, 160],
            rotation: transform.rotation,
            opacity: transform.opacity * 100,
            onSize: (v) => updateTransform({ ...transform, scale: v / 100 }),
            onRotation: (v) => updateTransform({ ...transform, rotation: v }),
            onOpacity: (v) => updateTransform({ ...transform, opacity: v / 100 }),
            onNudge: nudge,
            mirror: {
              on: transform.flipX,
              toggle: () => updateTransform({ ...transform, flipX: !transform.flipX }),
            },
            onReset: refit,
          }
        : null;

  const live = camera.status === 'live' && !photo;
  const [liveFaces, setLiveFaces] = useState(0);
  const [liveScanToken, setLiveScanToken] = useState(0);

  const handles: StageHandle[] =
    mode === 'face'
      ? filterSel && photo
        ? targetFaces.map((f) => {
            const h = faceHandle(f, adjust, W, H);
            return { x: h.x, y: h.y, w: h.w, h: h.h, rotation: h.rotation };
          })
        : []
      : avatar && avatar.type !== 'BACKGROUND'
        ? [
            {
              x: transform.x,
              y: transform.y,
              h: transform.scale,
              w: (transform.scale * H * (avatar.width / avatar.height)) / W,
              rotation: transform.rotation,
            },
          ]
        : [];

  const editable =
    mode === 'face'
      ? !!filterSel && ((!!photo && faces.length > 0) || live)
      : !!avatar && avatar.type !== 'BACKGROUND' && (!!photo || (live && mode === 'place'));

  const faceMarkers: FaceMarker[] =
    mode === 'face' && photo && faces.length > 1
      ? faces.map((f, i) => ({
          x: (f.box.x + f.box.w / 2) / W,
          y: Math.min(0.97, (f.box.y + f.box.h) / H + 0.035),
          label: String(i + 1),
          active: targets === 'all' || targets.includes(i),
        }))
      : [];
  const toggleFace = (i: number) => {
    const cur = targets === 'all' ? faces.map((_, k) => k) : targets;
    const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b);
    setTargets(next.length === faces.length || !next.length ? 'all' : next);
  };

  // ---- scan ----
  const [scanning, setScanning] = useState(false);
  const [scanShown, setScanShown] = useState(false);
  const scan = async () => {
    if (photo) {
      setScanning(true);
      try {
        const found = await detectFaceMeshes(photo.canvas);
        setFaceData({ photoId, faces: found });
        setScanShown(true);
        setTimeout(() => setScanShown(false), 2600);
        if (found.length)
          toast.success(
            found.length === 1 ? '1 face found' : `${found.length} faces found`,
            found.length > 1 ? 'Use the numbered markers to choose who gets the filter.' : 'Filters will attach to it.',
          );
        else toast.info('No face found', 'Try a clearer, front-facing photo, or adjust by hand.');
      } catch (e) {
        toast.error('Scan failed', (e as Error).message);
      } finally {
        setScanning(false);
      }
    } else if (live) {
      setLiveScanToken((n) => n + 1);
    } else {
      toast.info('Nothing to scan yet', 'Turn on the camera or upload a photo first.');
    }
  };
  const scanOverlay =
    scanShown && photo
      ? faces.map((f) => f.ovalPx.map((q) => ({ x: q.x / W, y: q.y / H })))
      : null;

  // ---- output ----
  const [busy, setBusy] = useState<'download' | 'email' | 'preview' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [format, setFormat] = useState<PhotoFormat>('jpg');
  const [emailOpen, setEmailOpen] = useState(false);
  const saved = useRef<{ key: string; id: string } | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  useEffect(
    () => () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    },
    [originalUrl],
  );

  /**
   * The actual combined photograph at the photo's full working resolution — drawn on its own
   * canvas, so no app UI, overlays or decorative animation can end up in it.
   */
  const render = async (fmt: PhotoFormat = 'jpg') => {
    if (!photo || !scene) throw new Error('Take or upload a photo first.');
    return fmt === 'png'
      ? exportScene({ ...scene, photo: photo.canvas }, 'image/png')
      : exportScene({ ...scene, photo: photo.canvas }, 'image/jpeg', 0.95);
  };
  const effectName = mode === 'face' ? filterSel?.item.name : avatar?.name;
  const fileName = (fmt: PhotoFormat) =>
    photoFilename({ context: event?.code ?? 'Personal', avatar: effectName, ext: fmt });

  /** Saves this exact composition to My Creations once; re-saves only if it changed. */
  const save = async (result: Blob): Promise<string> => {
    const key = JSON.stringify({
      photoId,
      mode,
      a: avatar?.id,
      f: filterSel?.item.id,
      placement,
      transform,
      adjust,
      targets,
      bodyStyle,
      keepFace,
    });
    if (saved.current?.key === key) return saved.current.id;
    const form = new FormData();
    const ext =
      photo!.original.type === 'image/png'
        ? 'png'
        : photo!.original.type === 'image/webp'
          ? 'webp'
          : 'jpg';
    form.append('photo', photo!.original, `original.${ext}`);
    form.append('result', result, 'result.jpg');
    form.append('source', photo!.source);
    form.append(
      'title',
      effectName ? `${effectName} · ${new Date().toLocaleDateString()}` : 'Photo',
    );
    // Library avatar → avatarId; the user's own AI image → generatedAvatarId.
    const usesAvatar = mode !== 'face' && !!avatar;
    const generated = usesAvatar && avatar?.origin === 'generated';
    if (usesAvatar && !generated) form.append('avatarId', avatar!.id);
    if (generated) form.append('generatedAvatarId', avatar!.id);
    form.append(
      'layout',
      JSON.stringify({
        version: 2,
        mode,
        photo: { width: photo!.width, height: photo!.height, mirrored: photo!.mirrored },
        avatarId: usesAvatar && !generated ? avatar!.id : null,
        generatedAvatarId: generated ? avatar!.id : null,
        avatarType: usesAvatar ? avatar!.type : null,
        placement,
        transform,
        filter: mode === 'face' && filterSel ? { id: filterSel.item.id, adjust, targets, faces: faces.length } : null,
        body: mode === 'body' ? { style: bodyStyle, keepFace, fit: frame?.source ?? null } : null,
        cutout: !!scene?.cutout,
      }),
    );
    // Event mode: the photo belongs to the open event (never asks which one).
    // Personal mode: it goes to My creations. The two are stored separately.
    if (event) {
      form.append('capturedAt', capturedAt.current.toISOString());
      const p = await api.events.savePhoto(event.id, form);
      saved.current = { key, id: p.id };
      return p.id;
    }
    const c = await api.creations.create(form);
    saved.current = { key, id: c.id };
    return c.id;
  };

  const preview = async () => {
    setBusy('preview');
    try {
      const blob = await render('jpg');
      setPreviewUrl(URL.createObjectURL(blob));
      if (photo) setOriginalUrl(URL.createObjectURL(photo.original));
      setPreviewOpen(true);
    } catch (e) {
      toast.error('Couldn’t build the preview', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy('download');
    try {
      const blob = await render(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName(format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      try {
        // The stored copy is always a high-quality JPG (PNG masters can exceed upload limits).
        await save(format === 'jpg' ? blob : await render('jpg'));
        toast.success(
          'Downloaded',
          event ? `A copy is saved to ${event.name}.` : 'A copy is saved in My creations.',
        );
      } catch (e) {
        toast.info('Downloaded', `Couldn’t save a copy: ${(e as Error).message}`);
      }
    } catch (e) {
      toast.error('Download failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Real steps: render → save (event or My creations) → server emails the stored final photo. */
  const sendEmail = async (
    to: string,
    subject: string,
    message: string,
    progress: (s: SendStage) => void,
  ): Promise<EmailResult> => {
    progress('render');
    const blob = await render('jpg');
    progress('save');
    const id = await save(blob);
    progress('send');
    const r = event
      ? await api.events.emailPhoto(event.id, id, { to, subject, message })
      : await api.creations.email(id, { to, subject, message });
    if (r.delivery === 'smtp')
      toast.success('Email accepted', `The mail server accepted it for ${to}.`);
    return r;
  };

  const showPlacement = () => {
    setPreviewOpen(false);
    document
      .getElementById('studio-placement')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /** "Save to Event" → the event's gallery. */
  const [savingToEvent, setSavingToEvent] = useState(false);
  const saveToEvent = async () => {
    if (!event) return;
    setSavingToEvent(true);
    try {
      await save(await render());
      toast.success('Saved to event', `Added to the ${event.name} gallery.`);
      navigate(`/events/${event.id}`);
    } catch (e) {
      toast.error('Couldn’t save to the event', (e as Error).message);
    } finally {
      setSavingToEvent(false);
    }
  };

  /** Clears every effect; the original photo is untouched. */
  const resetAll = () => {
    filterSeq.current++;
    setFilterSel(null);
    setAdjust(NO_ADJUST);
    setTargets('all');
    setAvatar(null);
    setTransform(NEUTRAL);
    setKeepFace(false);
    setBodyStyle('overlay');
    lastFit.current = '';
    toast.info('Composition reset', 'Your original photo is unchanged.');
  };

  const create = () => {
    if (photo) {
      stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCustomizing(true);
    } else if (live) capture();
    else camera.start();
  };

  const busyLabel =
    detectState === 'working' && mode !== 'place'
      ? 'Finding faces…'
      : poseState === 'working'
        ? 'Detecting body pose…'
        : cutoutState === 'working'
        ? 'Finding you in the photo…'
        : null;

  const hint = (() => {
    if (live && mode === 'body') return 'Full-body fitting is applied when you capture or upload a photo.';
    if (live && mode === 'face' && filterSel && liveFaces === 0)
      return 'Looking for a face — face the camera in good light.';
    if (photo && mode === 'face' && detectState === 'ready' && !faces.length)
      return 'No face detected in this photo. Try another photo, or use Full-Body / placement.';
    if (photo && mode === 'body' && avatar && bodyInputsReady && !frame)
      return 'Couldn’t find a person — drag the avatar into place.';
    return null;
  })();

  const filterStatus = (() => {
    if (live) {
      return filterSel
        ? `Live · ${liveFaces === 1 ? '1 face tracked' : `${liveFaces} faces tracked`}`
        : 'Live camera · pick a filter to try it on';
    }
    if (!photo) return 'Turn on the camera or upload a photo to try filters.';
    if (detectState === 'working') return 'Finding faces…';
    if (detectState === 'failed') return 'Face tracking is unavailable in this browser.';
    return faces.length ? `${faces.length === 1 ? '1 face' : `${faces.length} faces`} detected` : 'No face detected';
  })();

  return (
    <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4 sm:gap-5" ref={stageRef}>
        <CameraStage
          videoRef={camera.videoRef}
          status={camera.status}
          error={camera.error}
          mirrored={camera.mirrored}
          canSwitch={camera.canSwitch}
          photo={photo}
          scene={scene}
          mode={mode}
          avatar={mode === 'face' ? null : avatar}
          transform={transform}
          handles={handles}
          editable={editable}
          busyLabel={busyLabel}
          capturing={capturing}
          faceMarkers={faceMarkers}
          onFaceToggle={toggleFace}
          scanOverlay={scanOverlay}
          liveFilter={mode === 'face' && filterSel ? { filter: filterSel.filter, adjust } : null}
          liveScanToken={liveScanToken}
          onLiveFaces={setLiveFaces}
          hint={hint}
          onStartCamera={() => camera.start()}
          onCapture={capture}
          onRetake={retake}
          onSwitch={camera.switchCamera}
          onUpload={upload}
          onNudge={nudge}
          onZoom={zoom}
          uploadInputRef={uploadRef}
          onUseProfilePhoto={profilePhoto ? applyProfilePhoto : undefined}
        />
          <FilterCarousel
            items={items}
            selectedId={mode === 'face' ? (filterSel?.item.id ?? null) : null}
            onSelect={chooseFilter}
            view={view}
            onView={setView}
            onAdd={() => setAddOpen(true)}
            onCreate={create}
            onScan={scan}
            onBrowse={() => setBrowseOpen(true)}
            onExplore={() => setView((v) => (v === 'featured' ? 'all' : 'featured'))}
            scanning={scanning}
            loadingId={loadingFilter}
            status={filterStatus}
          />
          <AvatarTray
            ref={trayRef}
            categories={categories}
            types={types}
            avatars={avatars}
            error={catalogError}
            category={category}
            type={typeFilter}
            selectedId={avatar?.id ?? null}
            onCategory={setCategory}
            onType={setTypeFilter}
            onSelect={selectAvatar}
          />
      </div>

      <div className="lg:sticky lg:top-28">
        <StudioPanel
          hasPhoto={!!photo}
          mode={mode}
          placement={placement}
          avatar={avatar}
          filterName={filterSel?.item.name ?? null}
          onBrowseFilters={() => {
            setMode('face');
            setBrowseOpen(true);
          }}
          onSelectAvatar={() => {
            if (mode === 'face') setMode('body');
            focusTray();
          }}
          onMode={changeMode}
          faces={{ count: faces.length, state: detectState, targets }}
          onTargets={setTargets}
          body={{
            style: bodyStyle,
            keepFace,
            source: frame ? SOURCE_LABEL[frame.source] : null,
          }}
          onBodyStyle={setBodyStyle}
          onKeepFace={(on) => {
            setKeepFace(on);
            if (on && photo && detectState === 'ready' && !primaryFace)
              toast.info('No face found', 'There’s no face in this photo to keep.');
          }}
          cutout={cutoutState}
          adjust={adjustable}
          customizing={customizing}
          onToggleCustomize={() => setCustomizing((c) => !c)}
          onRemoveFilter={() => chooseFilter(null)}
          onResetAll={resetAll}
          busy={busy}
          onPreview={preview}
          onDownload={download}
          format={format}
          onFormat={setFormat}
          onEmail={() => setEmailOpen(true)}
          onSaveToEvent={event ? saveToEvent : undefined}
          savingToEvent={savingToEvent}
        />
      </div>

      <FilterBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        items={items}
        selectedId={filterSel?.item.id ?? null}
        onSelect={chooseFilter}
      />
      <AddFilterDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(rec) => {
          setCustomRecs(readCustomFilters());
          setView('custom');
          toast.success('Filter added', `${rec.name} is in “My filters”.`);
          void customFilter(rec).then((f) => {
            setMode('face');
            setFilterSel({
              item: { id: rec.id, name: rec.name, category: 'custom', tags: [], thumb: rec.dataUrl },
              filter: f,
            });
            setAdjust(NO_ADJUST);
          });
        }}
      />
      <PreviewDialog
        open={previewOpen}
        originalUrl={originalUrl}
        finalUrl={previewUrl}
        eventName={event?.name}
        avatarName={effectName}
        size={photo ? { width: photo.width, height: photo.height } : undefined}
        onClose={() => setPreviewOpen(false)}
        onChangeAvatar={() => {
          setPreviewOpen(false);
          if (mode === 'face') setBrowseOpen(true);
          else focusTray();
        }}
        onChangePlacement={showPlacement}
        downloading={busy === 'download'}
        onDownload={download}
        format={format}
        onFormat={setFormat}
        onEmail={() => {
          setPreviewOpen(false);
          setEmailOpen(true);
        }}
      />
      {emailOpen && (
        <EmailDialog
          open
          onClose={() => setEmailOpen(false)}
          onSend={sendEmail}
          defaultTo={user?.email ?? ''}
          defaultSubject={event ? `${event.name} — SageVatar photo` : 'My SageVatar photo'}
          attachment={{ url: previewUrl, name: fileName('jpg') }}
        />
      )}
    </div>
  );
}
