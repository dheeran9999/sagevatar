import type { Appearance } from './appearance';

export type Role = 'CREATOR' | 'EMPLOYEE';
export type AvatarType = 'FACE' | 'HALF_BODY' | 'FULL_BODY' | 'BACKGROUND';

/** Mirrors server/src/lib/permissions.ts. The server is the authority; the UI only reads this. */
export type Permission =
  | 'studio.use'
  | 'photo.capture'
  | 'photo.upload'
  | 'avatar.browse'
  | 'avatar.generate'
  | 'event.participate'
  | 'event.manage'
  | 'creation.manageOwn'
  | 'creation.download'
  | 'creation.email'
  | 'poster.create'
  | 'people.photos.manage'
  | 'library.manage'
  | 'template.manage'
  | 'employee.manage'
  | 'analytics.view'
  | 'audit.view';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
}

export interface Placement {
  layer: 'behind' | 'beside' | 'front' | 'background';
  x: number;
  y: number;
  scale: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder?: number;
  isActive?: boolean;
  _count?: { avatars: number };
}

export interface AvatarTypeInfo {
  code: AvatarType;
  name: string;
  description: string;
  defaultPlacement: Placement;
  isActive?: boolean;
  sortOrder?: number;
}

export type AvatarStyle = 'PROFESSIONAL' | 'CASUAL' | 'THEMED';
export type AssetSource = 'ORIGINAL' | 'IN_HOUSE' | 'LICENSED' | 'PUBLIC_DOMAIN' | 'AI_GENERATED';

/** Where an avatar came from (shown in the finder and preview). */
export interface AvatarSource {
  type: AssetSource;
  name: string;
  license: string;
}

export interface Avatar {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  style?: AvatarStyle;
  attribution?: string;
  type: AvatarType;
  /** Authenticated URL served from private storage. */
  fileUrl: string;
  thumbnailUrl: string | null;
  isAnimated: boolean;
  width: number;
  height: number;
  defaultPlacement: Placement;
  category: { slug: string; name: string };
  source?: AvatarSource;
  /** 'generated' = the user's own AI image (not in the shared library). */
  origin?: 'library' | 'generated';
}

export interface AvatarSearchResult extends Avatar {
  match: { type: 'keyword' | 'semantic'; score: number };
}

export interface AvatarSearchResponse {
  query: string;
  mode: 'keyword' | 'semantic';
  semanticError: string | null;
  notice: { kind: 'rights'; term: string; message: string; suggestion: string } | null;
  results: AvatarSearchResult[];
}

export type GenerationStyle =
  'ANIME' | 'SUPERHERO' | 'BUSINESS' | 'MASCOT' | 'CARTOON_2D' | 'CHARACTER_3D' | 'DIGITAL_HUMAN';

export interface AiStatus {
  generation: {
    enabled: boolean;
    reason: string | null;
    provider: string | null;
    model: string | null;
    dailyLimit: number;
    usedToday: number;
  };
  semanticSearch: { enabled: boolean; model: string | null };
  styles: { value: GenerationStyle; label: string }[];
}

export interface GeneratedImage {
  id: string;
  name: string;
  description: string;
  type: AvatarType;
  style: GenerationStyle;
  styleLabel: string;
  width: number;
  height: number;
  isAnimated: false;
  createdAt: string;
  publishedAvatarId: string | null;
  source: AvatarSource;
  fileUrl: string;
  thumbnailUrl: string;
}

export interface GenerationJob {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  count: number;
  completed: number;
  failed: number;
  error: string | null;
  prompt: string;
  style: GenerationStyle;
  type: AvatarType;
  createdAt: string;
  finishedAt: string | null;
  images: GeneratedImage[];
}

export interface LicenseInfo {
  sourceType: AssetSource;
  sourceName: string;
  sourceUrl: string | null;
  licenseName: string;
  licenseUrl: string | null;
  licenseNotes: string;
  attribution: string;
  licenseExpiresAt: string | null;
}

export interface LibraryAvatar extends LicenseInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  style: AvatarStyle;
  typeCode: AvatarType;
  isActive: boolean;
  categoryId: string;
  category: { id: string; name: string; slug: string };
  fileUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  sizeBytes: number | null;
  isAnimated: boolean;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  createdBy: { name: string };
  rightsConfirmedAt: string | null;
  rightsConfirmedBy: { name: string } | null;
  usageCount: number;
  licenseExpired: boolean;
}

export type AvatarUpdate = Partial<
  Pick<LibraryAvatar, 'name' | 'description' | 'tags' | 'style' | 'categoryId' | 'isActive'> &
    Omit<LicenseInfo, 'licenseExpiresAt'> & { type: AvatarType; licenseExpiresAt: string | null }
>;

export interface Template {
  id: string;
  name: string;
  description: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  isActive?: boolean;
}

/** "Avatar used" summary on personal and event photos. */
export interface AvatarUsed {
  kind: 'library' | 'generated';
  id?: string;
  name: string;
  type: AvatarType;
  thumbnailUrl?: string | null;
}

export interface Creation {
  id: string;
  title: string;
  createdAt: string;
  metadata: { source: 'CAMERA' | 'UPLOAD'; width: number; height: number } | null;
  avatarId?: string | null;
  generatedAvatarId?: string | null;
  avatarUsed?: AvatarUsed | null;
  thumbnailUrl?: string;
}

export interface CreationFilters {
  q?: string;
  source?: 'CAMERA' | 'UPLOAD';
  avatarType?: AvatarType;
  avatarKind?: 'library' | 'generated' | 'none';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest';
}

export type PhotoFormat = 'jpg' | 'png';

/** What the server reports after an email: smtp = accepted by the mail server. */
export interface EmailResult {
  status: 'SENT';
  delivery: EmailDelivery;
  messageId: string | null;
  acceptedBy: string[];
}

/** The signed-in person's own profile (Edit Profile). */
export interface MyProfile {
  name: string;
  email: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  phone: string | null;
  /** A new company email waiting for verification. */
  pendingEmail: string | null;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  /** The chosen (consented) profile photograph. */
  photo: { id: string; url: string; thumbUrl: string } | null;
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  status: 'ACTIVE_ACCOUNT' | 'INVITE_PENDING' | 'EMAIL_UNVERIFIED';
  createdAt: string;
  lastLoginAt: string | null;
  inviteExpiresAt: string | null;
  employeeCode: string | null;
  department?: string | null;
  designation?: string | null;
  phone?: string | null;
  pendingEmail?: string | null;
  counts?: { creations: number; eventPhotos: number; events: number };
}

export interface EmployeeProfile extends ManagedUser {
  invitedBy: string | null;
  photo: { id: string; url: string; thumbUrl: string } | null;
  counts: { creations: number; eventPhotos: number; events: number; aiImages: number; recognitionPhotos: number; posters: number };
  creations: { id: string; title: string; createdAt: string; avatar: string | null; kind: 'photo' | 'poster'; thumbUrl: string; link: string }[];
  eventPhotos: {
    id: string;
    title: string;
    createdAt: string;
    event: { name: string; code: string };
    avatar: string | null;
    thumbUrl: string;
    link: string;
  }[];
  assignments: { id: string; code: string; name: string; eventDate: string; location: string; status: EventStatus; assignedAt: string }[];
}

export interface CreatorDashboard {
  stats: {
    totalEmployees: number;
    activeEmployees: number;
    avatarAssets: number;
    aiGenerated: number;
    photoCreations: number;
    totalEvents: number;
    activeEvents: number;
    upcomingEvents: number;
    eventPhotos: number;
    recognitionPosters: number;
  };
  recent: {
    employees: { id: string; name: string; email: string; employeeCode: string | null; createdAt: string; status: 'ACTIVE' | 'INVITE_PENDING' | 'DEACTIVATED' }[];
    events: { id: string; code: string; name: string; eventDate: string; location: string; status: EventStatus; participants: number; photos: number; createdAt: string }[];
    creations: { id: string; title: string; createdAt: string; owner: { id: string; name: string; employeeCode: string | null; role: Role }; avatar: string | null; kind: 'photo' | 'poster'; link: string }[];
    posters: { id: string; title: string; template: string; people: number; createdBy: string; official: boolean; event: string | null; createdAt: string; link: string }[];
    avatars: { id: string; name: string; type: AvatarType; category: string; source: AssetSource; isActive: boolean; createdBy: string; createdAt: string; thumbnailUrl: string | null }[];
    eventActivity: { id: string; actor: string; text: string; event: string | null; link: string | null; at: string }[];
  };
}

export interface Invite {
  inviteUrl: string;
  expiresAt: string;
}

export interface Analytics {
  users: {
    employees: number;
    activeEmployees: number;
    pendingInvites: number;
    activeUsers7d: number;
  };
  creations: { total: number; last7Days: number; perDay: Record<string, number> };
  emails: Record<'QUEUED' | 'SENT' | 'FAILED', number>;
  topAvatars: { id?: string; name?: string; thumbnailUrl?: string | null; uses: number }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: { name: string; email: string; roleCode: Role } | null;
}

export interface Health {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  email: 'configured-untested' | 'not-configured';
}

// ---------------------------------------------------------------- Events

export type EventStatus = 'DRAFT' | 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
export type GalleryVisibility = 'PARTICIPANTS' | 'PRIVATE';

export interface EventInfo {
  id: string;
  /** Human Event ID, e.g. EVT-261104-7K2Q. */
  code: string;
  name: string;
  description: string;
  instructions: string;
  location: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  /** Effective status (Upcoming turns Active while the event is running). */
  status: EventStatus;
  storedStatus: EventStatus;
  galleryVisibility: GalleryVisibility;
  coverUrl: string | null;
  coverFullUrl: string | null;
  canCapture: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MyEvent extends EventInfo {
  photoCount: number;
  myPhotoCount: number;
}

export interface EventWorkspaceInfo extends MyEvent {
  participantCount: number;
}

export interface ManagedEventSummary extends EventInfo {
  createdBy: string;
  photoCount: number;
  participantCount: number;
}

export interface ManagedEvent extends EventInfo {
  createdBy: string;
  photoCount: number;
  participants: {
    userId: string;
    name: string;
    email: string;
    isActive: boolean;
    assignedAt: string;
    photoCount: number;
  }[];
  albums: { id: string; name: string; description: string; photoCount: number }[];
}

export interface EventPhoto {
  id: string;
  eventId: string;
  eventCode: string;
  title: string;
  owner: { id: string; name: string };
  mine: boolean;
  album: { id: string; name: string } | null;
  avatarId: string | null;
  generatedAvatarId: string | null;
  source: 'CAMERA' | 'UPLOAD';
  capturedAt: string;
  createdAt: string;
  thumbUrl: string;
  finalUrl: string;
  downloadUrl: string;
  originalUrl: string | null;
  eventName?: string;
  avatarUsed?: AvatarUsed | null;
  downloadPngUrl?: string;
}

export interface EventForm {
  name: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  instructions: string;
  galleryVisibility: GalleryVisibility;
  status?: EventStatus;
  timezoneOffset: number;
}

export type NotificationCategory = 'event' | 'photo' | 'ai' | 'poster' | 'account';
export interface AppNotification {
  id: string;
  type:
    | 'EVENT_ASSIGNED'
    | 'EVENT_UPDATED'
    | 'EVENT_CANCELLED'
    | 'EVENT_COMPLETED'
    | 'PHOTO_CREATED'
    | 'AI_GENERATION_DONE'
    | 'AI_GENERATION_ACTIVITY'
    | 'POSTER_SHARED'
    | 'POSTER_CREATED'
    | 'ACCOUNT_WELCOME'
    | 'EMPLOYEE_JOINED'
    | string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  eventId: string | null;
  actor: { name: string } | null;
  /** Labelled details, e.g. { Employee: 'Rahul Kumar', 'Employee ID': 'SAGE102' }. */
  data: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}
export interface CreatorCreationView {
  id: string;
  title: string;
  createdAt: string;
  owner: { id: string; name: string; email: string; employeeCode: string | null };
  avatar: string | null;
  kind: 'photo' | 'poster';
  source: 'CAMERA' | 'UPLOAD' | null;
  imageUrl: string;
  originalUrl: string;
  downloadUrl: string;
}

/** smtp = really sent; dev-outbox = saved on the server only (SMTP not configured). */
export type EmailDelivery = 'smtp' | 'dev-outbox' | 'disabled';
export interface SignupInfo {
  domains: string[];
  emailDelivery: EmailDelivery;
}

// ---- Group anniversary posters ----------------------------------------------

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}
export interface FaceAdjust {
  dx: number;
  dy: number;
  zoom: number;
  rotate: number;
}
export type SlotRole = 'cutter' | 'stand';
export interface PosterSlot {
  id: string;
  label: string;
  role: SlotRole;
  row: 'front' | 'back';
  side: 'left' | 'right' | 'center';
  /** Face centre on the template canvas. */
  x: number;
  y: number;
  faceHeight: number;
  /** Photo templates: the face box in the base photo (0–1) and head tilt. */
  box?: { x: number; y: number; w: number; h: number };
  angle?: number;
}
/** A face to replace in a photo template (normalised to the photo). */
export interface PhotoFaceSlot {
  id: string;
  label: string;
  role: SlotRole;
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}
export interface PosterTemplate {
  key: string;
  kind: 'illustrated' | 'photo';
  showNames: boolean;
  photoUrl: string | null;
  canvas: { width: number; height: number };
  name: string;
  description: string;
  heading: string;
  maxParticipants: number;
  minParticipants: number;
  isPublished: boolean;
  previewUrl: string;
  slots: PosterSlot[];
  palette: { primary: string; accent: string; heading: string };
}
export interface PosterStatus {
  ai: { enabled: boolean; reason: string | null };
  branding: { companyName: string; tagline: string; logoUrl: string | null };
  canUseAllPhotos: boolean;
}
export interface Person {
  id: string;
  name: string;
  email: string | null;
  employeeCode: string | null;
  role: Role;
  isSelf: boolean;
  photoCount: number;
  primaryPhoto: { id: string; thumbUrl: string } | null;
}
export interface EmployeePhoto {
  id: string;
  userId: string;
  fileUrl: string;
  thumbUrl: string;
  hasMask: boolean;
  maskUrl: string | null;
  width: number;
  height: number;
  face: FaceBox | null;
  faceSource: 'auto' | 'manual' | 'none';
  isPrimary: boolean;
  consentBasis: 'SELF' | 'CREATOR_CONFIRMED';
  consentConfirmedAt: string;
  shareWithColleagues: boolean;
  uploadedBy: string | null;
  createdAt: string;
  canEdit: boolean;
  canShare: boolean;
}
export interface PosterParticipantInput {
  userId: string;
  photoId: string;
  slot: string;
  adjust?: FaceAdjust;
  face?: FaceBox;
}
export interface Poster {
  id: string;
  title: string;
  templateKey: string;
  templateName: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  stage: string;
  progress: number;
  error: string | null;
  mode: 'ai' | 'template' | 'photo';
  mine: boolean;
  createdBy: string | null;
  sharedAt: string | null;
  modeNote: string | null;
  variation: number;
  participants: {
    userId: string;
    name: string;
    photoId: string;
    slot: string;
    slotLabel: string;
    adjust: FaceAdjust;
    face: FaceBox | null;
    cutout: 'mask' | 'oval' | null;
  }[];
  event: { id: string; code: string; name: string } | null;
  width: number | null;
  height: number | null;
  savedCreationId: string | null;
  savedEventPhotoId: string | null;
  createdAt: string;
  finishedAt: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  downloadPngUrl: string | null;
  downloadJpgUrl: string | null;
}
export interface ParticipantProblem {
  userId: string;
  photoId: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
    /** Machine-readable reason, e.g. EMAIL_NOT_VERIFIED. */
    public code?: string,
  ) {
    super(message);
  }
}

/** Fired on any 401 so the auth layer can drop a stale session. */
export const UNAUTHORIZED_EVENT = 'sageavatar:unauthorized';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'x-sageavatar-request': '1',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const details = data.details?.length ? `: ${data.details[0].message}` : '';
    const err = new ApiError(res.status, (data.error ?? res.statusText) + details, data.details, data.code);
    if (data.problems) (err as ApiError & { problems?: ParticipantProblem[] }).problems = data.problems;
    throw err;
  }
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const del = (url: string) => request<void>('DELETE', url);

export const api = {
  health: () => get<Health>('/api/health'),

  /** Employee directory + authorised employee photographs (group posters). */
  people: {
    search: (q: string, eventId?: string) =>
      get<{ canManage: boolean; items: Person[] }>(
        `/api/people?${new URLSearchParams({ ...(q ? { q } : {}), ...(eventId ? { eventId } : {}) })}`,
      ),
    photos: (userId: string, eventId?: string) =>
      get<EmployeePhoto[]>(
        `/api/people/${encodeURIComponent(userId)}/photos${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`,
      ),
    upload: (userId: string, form: FormData) =>
      post<EmployeePhoto>(`/api/people/${encodeURIComponent(userId)}/photos`, form),
    updatePhoto: (
      photoId: string,
      body: { face?: FaceBox | null; faceSource?: 'auto' | 'manual'; shareWithColleagues?: boolean; isPrimary?: true },
    ) => patch<EmployeePhoto>(`/api/people/photos/${encodeURIComponent(photoId)}`, body),
    withdrawPhoto: (photoId: string) => del(`/api/people/photos/${encodeURIComponent(photoId)}`),
    setEmployeeCode: (userId: string, employeeCode: string | null) =>
      put<{ id: string; employeeCode: string | null }>(
        `/api/people/${encodeURIComponent(userId)}/employee-code`,
        { employeeCode },
      ),
  },

  posters: {
    status: () => get<PosterStatus>('/api/posters/status'),
    templates: () => get<PosterTemplate[]>('/api/posters/templates'),
    list: () => get<Poster[]>('/api/posters'),
    get: (id: string) => get<Poster>(`/api/posters/${encodeURIComponent(id)}`),
    generate: (body: {
      templateKey: string;
      eventId?: string;
      scene: 'auto' | 'ai' | 'template';
      variation: number;
      participants: PosterParticipantInput[];
    }) => post<Poster>('/api/posters', body),
    email: (id: string, body: { to: string; subject: string; message?: string }) =>
      post<EmailResult>(`/api/posters/${encodeURIComponent(id)}/email`, body),
    saveToCreations: (id: string) =>
      post<{ creationId: string; already: boolean }>(`/api/posters/${encodeURIComponent(id)}/save-creation`),
    saveToEvent: (id: string) =>
      post<{ eventPhotoId: string; eventId: string; already: boolean }>(
        `/api/posters/${encodeURIComponent(id)}/save-event`,
      ),
    remove: (id: string) => del(`/api/posters/${encodeURIComponent(id)}`),
  },

  /** Creator: official poster templates and corporate branding. */
  posterAdmin: {
    templates: () => get<PosterTemplate[]>('/api/creator/posters/templates'),
    updateTemplate: (
      key: string,
      body: Partial<Pick<PosterTemplate, 'name' | 'description' | 'heading' | 'maxParticipants' | 'isPublished' | 'showNames'>> & {
        faceSlots?: PhotoFaceSlot[];
      },
    ) => patch<PosterTemplate>(`/api/creator/posters/templates/${encodeURIComponent(key)}`, body),
    createPhotoTemplate: (form: FormData) => post<PosterTemplate>('/api/creator/posters/photo-templates', form),
    deleteTemplate: (key: string) => del(`/api/creator/posters/templates/${encodeURIComponent(key)}`),
    branding: () => get<PosterStatus['branding']>('/api/creator/posters/branding'),
    updateBranding: (body: { companyName: string; tagline: string }) =>
      put<PosterStatus['branding']>('/api/creator/posters/branding', body),
    uploadLogo: (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return post<PosterStatus['branding']>('/api/creator/posters/branding/logo', form);
    },
    removeLogo: () => request<PosterStatus['branding']>('DELETE', '/api/creator/posters/branding/logo'),
  },

  auth: {
    me: () => get<{ user: User }>('/api/auth/me'),
    profile: () => get<MyProfile>('/api/auth/profile'),
    updateProfile: (body: { name?: string; phone?: string | null }) =>
      patch<{ user: User; profile: MyProfile }>('/api/auth/profile', body),
    requestEmailChange: (email: string, password: string) =>
      post<{ pendingEmail: string; emailDelivery: 'smtp' | 'dev-outbox' | 'disabled' }>(
        '/api/auth/profile/email-change',
        { email, password },
      ),
    cancelEmailChange: () => del('/api/auth/profile/email-change'),
    confirmEmailChange: (token: string) => post<{ email: string }>('/api/auth/confirm-email', { token }),
    login: (email: string, password: string, remember = false) =>
      post<{ user: User }>('/api/auth/login', { email, password, remember }),
    signupInfo: () => get<SignupInfo>('/api/auth/signup-info'),
    register: (name: string, email: string, password: string) =>
      post<{ email: string; emailDelivery: EmailDelivery }>('/api/auth/register', {
        name,
        email,
        password,
      }),
    verifyEmail: (token: string) => post<{ email: string }>('/api/auth/verify-email', { token }),
    resendVerification: (email: string) =>
      post<{ ok: true }>('/api/auth/resend-verification', { email }),
    forgotPassword: (email: string) =>
      post<{ ok: true; emailDelivery: EmailDelivery }>('/api/auth/forgot-password', { email }),
    checkReset: (token: string) =>
      get<{ email: string }>(`/api/auth/reset-password/${encodeURIComponent(token)}`),
    resetPassword: (token: string, password: string) =>
      post<{ email: string }>('/api/auth/reset-password', { token, password }),
    logout: () => post<void>('/api/auth/logout'),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<void>('/api/auth/change-password', { currentPassword, newPassword }),
    invite: (token: string) =>
      get<{ email: string; name: string }>(`/api/auth/invite/${encodeURIComponent(token)}`),
    acceptInvite: (token: string, password: string) =>
      post<{ user: User }>('/api/auth/accept-invite', { token, password }),
    preferences: () => get<{ preferences: Appearance }>('/api/auth/preferences'),
    savePreferences: (preferences: Appearance) =>
      put<{ preferences: Appearance }>('/api/auth/preferences', preferences),
  },

  ai: {
    status: () => get<AiStatus>('/api/ai/status'),
    generate: (body: { prompt: string; style: GenerationStyle; type: AvatarType; count: number }) =>
      post<GenerationJob>('/api/ai/generations', body),
    job: (id: string) => get<GenerationJob>(`/api/ai/generations/${encodeURIComponent(id)}`),
    images: () => get<GeneratedImage[]>('/api/ai/images'),
    deleteImage: (id: string) => del(`/api/ai/images/${encodeURIComponent(id)}`),
    /** Creator only. */
    publish: (
      id: string,
      body: { name: string; categoryId: string; description?: string; tags?: string[] },
    ) =>
      post<{ id: string; name: string; isActive: boolean }>(
        `/api/creator/ai-images/${encodeURIComponent(id)}/publish`,
        body,
      ),
  },

  catalog: {
    search: (q: string, opts: { type?: AvatarType; category?: string } = {}) => {
      const params = new URLSearchParams({ q });
      if (opts.type) params.set('type', opts.type);
      if (opts.category) params.set('category', opts.category);
      return get<AvatarSearchResponse>(`/api/catalog/search?${params}`);
    },
    categories: () => get<Category[]>('/api/catalog/categories'),
    types: () => get<AvatarTypeInfo[]>('/api/catalog/avatar-types'),
    avatars: () => get<Avatar[]>('/api/catalog/avatars'),
    templates: () => get<Template[]>('/api/catalog/templates'),
  },

  /** Events the signed-in user may enter (assignment is checked on the server). */
  events: {
    mine: () => get<MyEvent[]>('/api/events/mine'),
    get: (id: string) => get<EventWorkspaceInfo>(`/api/events/${encodeURIComponent(id)}`),
    photos: (id: string) => get<EventPhoto[]>(`/api/events/${encodeURIComponent(id)}/photos`),
    savePhoto: (id: string, form: FormData) =>
      post<EventPhoto>(`/api/events/${encodeURIComponent(id)}/photos`, form),
    deletePhoto: (id: string, photoId: string) =>
      del(`/api/events/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`),
    emailPhoto: (
      id: string,
      photoId: string,
      body: { to: string; subject: string; message?: string },
    ) =>
      post<EmailResult>(
        `/api/events/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}/email`,
        body,
      ),
  },

  notifications: {
    list: (q: { category?: NotificationCategory; unread?: boolean; before?: string; take?: number } = {}) =>
      get<{ items: AppNotification[]; unread: number; hasMore: boolean }>(
        `/api/notifications?${new URLSearchParams({
          ...(q.category ? { category: q.category } : {}),
          ...(q.unread ? { unread: '1' } : {}),
          ...(q.before ? { before: q.before } : {}),
          ...(q.take ? { take: String(q.take) } : {}),
        })}`,
      ),
    read: (ids: string[]) => post<{ updated: number; unread: number }>('/api/notifications/read', { ids }),
    readAll: () => post<{ updated: number; unread: number }>('/api/notifications/read-all'),
    streamUrl: '/api/notifications/stream',
  },

  /** Creator: read-only view of an employee's saved creation (the "View Creation" target). */
  creatorCreations: {
    get: (id: string) => get<CreatorCreationView>(`/api/creator/creations/${encodeURIComponent(id)}`),
  },

  /** Creator event management. */
  manageEvents: {
    list: () => get<ManagedEventSummary[]>('/api/creator/events'),
    get: (id: string) => get<ManagedEvent>(`/api/creator/events/${encodeURIComponent(id)}`),
    create: (body: EventForm) => post<ManagedEvent>('/api/creator/events', body),
    update: (id: string, body: Partial<EventForm>) =>
      patch<ManagedEvent>(`/api/creator/events/${encodeURIComponent(id)}`, body),
    uploadCover: (id: string, file: File) => {
      const form = new FormData();
      form.append('cover', file);
      return post<ManagedEvent>(`/api/creator/events/${encodeURIComponent(id)}/cover`, form);
    },
    removeCover: (id: string) =>
      request<ManagedEvent>('DELETE', `/api/creator/events/${encodeURIComponent(id)}/cover`),
    assign: (id: string, userIds: string[]) =>
      post<{ added: string[]; alreadyAssigned: string[]; event: ManagedEvent }>(
        `/api/creator/events/${encodeURIComponent(id)}/assignments`,
        { userIds },
      ),
    unassign: (id: string, userId: string) =>
      request<ManagedEvent>(
        'DELETE',
        `/api/creator/events/${encodeURIComponent(id)}/assignments/${encodeURIComponent(userId)}`,
      ),
    photos: (id: string) =>
      get<EventPhoto[]>(`/api/creator/events/${encodeURIComponent(id)}/photos`),
    removePhoto: (id: string, photoId: string) =>
      del(`/api/creator/events/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`),
    createAlbum: (id: string, name: string) =>
      post<ManagedEvent>(`/api/creator/events/${encodeURIComponent(id)}/albums`, { name }),
    renameAlbum: (id: string, albumId: string, name: string) =>
      patch<ManagedEvent>(
        `/api/creator/events/${encodeURIComponent(id)}/albums/${encodeURIComponent(albumId)}`,
        { name },
      ),
    deleteAlbum: (id: string, albumId: string) =>
      request<ManagedEvent>(
        'DELETE',
        `/api/creator/events/${encodeURIComponent(id)}/albums/${encodeURIComponent(albumId)}`,
      ),
    /** ZIP of the event's photos (or one album: an album id, or 'none' for Unsorted). */
    exportUrl: (id: string, albumId?: string) =>
      `/api/creator/events/${encodeURIComponent(id)}/export.zip${albumId ? `?albumId=${encodeURIComponent(albumId)}` : ''}`,
    movePhoto: (id: string, photoId: string, albumId: string | null) =>
      request<void>(
        'PUT',
        `/api/creator/events/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}/album`,
        { albumId },
      ),
  },
  creations: {
    list: (filters: CreationFilters = {}) => {
      const params = new URLSearchParams({ take: '60' });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
      return get<{ items: Creation[]; total: number }>(`/api/creations?${params}`);
    },
    imageUrl: (
      id: string,
      kind: 'result' | 'source' = 'result',
      download = false,
      format?: PhotoFormat,
    ) => {
      const q = new URLSearchParams();
      if (download) q.set('download', '1');
      if (format) q.set('format', format);
      const qs = q.toString();
      return `/api/creations/${id}/image/${kind}${qs ? `?${qs}` : ''}`;
    },
    create: (form: FormData) => post<Creation>('/api/creations', form),
    email: (id: string, body: { to: string; subject: string; message?: string }) =>
      post<EmailResult>(`/api/creations/${id}/email`, body),
    rename: (id: string, title: string) => patch<Creation>(`/api/creations/${id}`, { title }),
    remove: (id: string) => del(`/api/creations/${id}`),
  },

  creator: {
    users: (q?: string) => get<ManagedUser[]>(`/api/creator/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    profile: (id: string) => get<EmployeeProfile>(`/api/creator/users/${id}/profile`),
    updateEmployee: (
      id: string,
      body: {
        name?: string;
        employeeCode?: string | null;
        isActive?: boolean;
        department?: string | null;
        designation?: string | null;
        phone?: string | null;
      },
    ) =>
      patch<ManagedUser>(`/api/creator/users/${id}`, body),
    dashboard: () => get<CreatorDashboard>('/api/creator/dashboard'),
    invite: (email: string, name: string) =>
      post<{ user: ManagedUser } & Invite>('/api/creator/users/invite', { email, name }),
    reinvite: (id: string) => post<Invite>(`/api/creator/users/${id}/reinvite`),
    setActive: (id: string, isActive: boolean) =>
      patch<ManagedUser>(`/api/creator/users/${id}`, { isActive }),

    categories: () => get<Category[]>('/api/creator/library/categories'),
    createCategory: (name: string) => post<Category>('/api/creator/library/categories', { name }),
    updateCategory: (
      id: string,
      data: Partial<Pick<Category, 'name' | 'isActive' | 'sortOrder'>>,
    ) => patch<Category>(`/api/creator/library/categories/${id}`, data),

    types: () => get<AvatarTypeInfo[]>('/api/creator/library/avatar-types'),
    updateType: (code: AvatarType, data: Partial<Pick<AvatarTypeInfo, 'name' | 'isActive'>>) =>
      patch<AvatarTypeInfo>(`/api/creator/library/avatar-types/${code}`, data),

    avatars: () => get<LibraryAvatar[]>('/api/creator/library/avatars'),
    uploadAvatar: (form: FormData) => post<LibraryAvatar>('/api/creator/library/avatars', form),
    updateAvatar: (id: string, data: AvatarUpdate) =>
      patch<LibraryAvatar>(`/api/creator/library/avatars/${id}`, data),
    deleteAvatar: (id: string) => del(`/api/creator/library/avatars/${id}`),
    cleanupAvatarFiles: () =>
      post<{ removed: number; kept: number }>('/api/creator/library/avatars/cleanup'),

    templates: () => get<Template[]>('/api/creator/templates'),
    uploadTemplate: (form: FormData) => post<Template>('/api/creator/templates', form),
    updateTemplate: (id: string, data: { isActive?: boolean; name?: string }) =>
      patch<Template>(`/api/creator/templates/${id}`, data),

    analytics: () => get<Analytics>('/api/creator/analytics'),
    audit: (action?: string) =>
      get<{ items: AuditEntry[]; total: number }>(
        `/api/creator/audit?take=100${action ? `&action=${encodeURIComponent(action)}` : ''}`,
      ),
  },
};
