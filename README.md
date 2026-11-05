# SageVatar

**AI Avatar & Event Photo Studio**

> Formerly "SageAvatar Studio". Only visible branding changed; folder, package, database and
> header names (`@sageavatar/*`, `x-sageavatar-request`, …) keep their existing names.

Internal SageIT app: capture or upload a photo, place a digital avatar beside or behind the
person, customize, preview, download and email the result.

Roles: **CREATOR** (manages the avatar library, can also compose) and **EMPLOYEE** (composes).

## Stack

| Layer    | Tech                                                                 |
| -------- | -------------------------------------------------------------------- |
| Client   | React 18, Vite, TypeScript, Tailwind CSS v4, Framer Motion           |
| Server   | Node, Express 5, TypeScript, zod                                     |
| Database | Prisma 6 — SQLite in dev, PostgreSQL in prod (change `provider`)     |
| Vision   | MediaPipe Face Mesh, Face Detection, Pose, Selfie Segmentation — in the browser, self-hosted |

## Getting started

> New to the project? **[SETUP.md](SETUP.md)** is a step-by-step guide for running it on a fresh
> computer and testing the camera.

### Prerequisites

| Software | Version | Notes |
| -------- | ------- | ----- |
| Node.js  | **20.19+** (22 LTS recommended) | includes npm 10+ |
| Git      | any recent | to clone the repository |
| Browser  | Chrome / Edge / Firefox (current) | camera needs `localhost` or HTTPS |
| Docker Desktop | optional | only for the Docker setup below |

No database server is needed: development uses **SQLite** (a single file created by Prisma).
No external services are required: email and AI are optional (see `server/.env.example`).

### Install and run (local, recommended)

```bash
npm install                          # all workspaces; also generates the Prisma client
cp server/.env.example server/.env   # Windows (cmd): copy server\.env.example server\.env
npm run db:migrate                   # creates server/prisma/dev.db, applies migrations, seeds data
npm run dev                          # API http://localhost:4000 + web http://localhost:5173
```

Open **http://localhost:5173** and sign in with a seed account from `server/.env`
(`SEED_CREATOR_*` / `SEED_EMPLOYEE_*`). Edit `JWT_SECRET` in `server/.env` before sharing a
running instance with anyone.

### Database

- `npm run db:migrate` — creates/updates the SQLite database (`prisma migrate dev`) and runs the seed.
- `npm run db:seed` — re-runs the seed (idempotent): the two roles, avatar types and categories, a
  Creator and an Employee demo account, and the original generated starter avatars.
- `npm run db:reset` — **deletes** the local database and recreates it from scratch.
- Data lives in `server/prisma/dev.db` and uploads in `server/storage/` — both git-ignored.
- Production: switch the Prisma `provider` to PostgreSQL, set `DATABASE_URL`, and run
  `npx prisma migrate deploy` (non-interactive).

### Camera checklist

The Studio uses `navigator.mediaDevices.getUserMedia` (front/back camera selection, fallback when
the preferred camera isn't available, friendly errors for blocked / missing / busy cameras). Browsers
only allow cameras on **secure origins**: `http://localhost` counts as secure, a LAN address over
`http://` does not.

| Symptom | Fix |
| ------- | --- |
| "Camera blocked" | Click the camera/lock icon in the address bar → Allow camera → reload. Windows: Settings → Privacy & security → Camera → allow desktop apps / your browser. macOS: System Settings → Privacy & Security → Camera → enable your browser. |
| "No camera found" | Plug in / enable a webcam; check it works in another app. Use **Upload photo** meanwhile. |
| "Camera is busy" | Close Teams / Zoom / other tabs using the camera, then **Try again**. |
| "Needs a secure connection" | Open `http://localhost:5173` on the same computer, or use the HTTPS address (Docker, port 8443). |
| Black preview | Reload the page; check the camera isn't covered by a privacy shutter. |

Production: `npm run build`, then run the server build (`npm run start -w server` or
`node server/dist/index.js`) behind HTTPS and serve `client/dist`.

### Run in Docker (optional)

Needs `server/.env` (as above). The first run builds both images (several minutes).

```bash
docker compose up -d --build     # http://localhost:8080  ·  HTTPS https://localhost:8443
docker compose logs -f api       # server log (email links appear here while SMTP is not set)
docker compose down              # stop; data in ./docker-data is kept
```

Two images: `sagevatar-web` (nginx serving the built app, proxying `/api` and `/media`) and
`sagevatar-api` (Express + Prisma; runs `prisma migrate deploy` on start). Settings come from
`server/.env` (never baked into an image); the database and uploads live in `./docker-data`
(`sagevatar.db` + `storage/`). Set `SAGEVATAR_URL=http://<LAN-IP>:8080` before `up` so emailed
links point at the shared address. The compose file runs the API with `NODE_ENV=development`
and `COOKIE_SECURE=false` for plain-HTTP LAN use; for production use HTTPS, `NODE_ENV=production`
and SMTP.

#### Share a link with people on the same Wi-Fi (with camera)

1. Find this computer's Wi-Fi IPv4 address (`ipconfig` on Windows, `ipconfig getifaddr en0` on macOS).
2. Create a certificate for it and restart the web container:
   `sh docker/make-cert.sh <your-IP>` then `docker compose restart web`.
3. Allow inbound TCP **8443** in the firewall (Windows: an admin PowerShell —
   `New-NetFirewallRule -DisplayName "SageVatar HTTPS (8443)" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Any -RemoteAddress LocalSubnet`).
4. Share **`https://<your-IP>:8443`**. The first visit shows a "not private" warning because the
   certificate is self-signed: **Advanced → Continue**, then allow the camera.

### Sharing on your local network (dev)

With `DEV_HOST=true` in `client/.env` (off by default) the Vite dev server listens on all interfaces, so teammates on the same
network can open `http://<this-PC's-LAN-IP>:5173` (e.g. `http://192.168.x.y:5173` — the Wi-Fi /
Ethernet address, **not** a `172.x` Hyper-V/WSL "vEthernet" address).

- Windows must allow inbound connections: set the network to **Private**, or add an inbound
  firewall rule for TCP 5173 (Node.js).
- Set `CLIENT_ORIGIN` in `server/.env` to that same address so emailed links (invites,
  verification, password reset, email change) open for teammates.
- Browsers only allow the **live camera** on HTTPS or `localhost`. Over plain `http://<LAN-IP>`,
  teammates can upload photos and use every filter/avatar; for their live camera, serve over HTTPS.

Dev seed accounts are defined in `server/.env` (`SEED_*`, development only — the seed refuses
to run in production). Seeded avatars are original, generated animated SVG placeholders in
`server/storage/public/avatars/` — replace with licensed art.

## Roles and access

Only two roles exist: **CREATOR** and **EMPLOYEE** (enforced by a DB enum + `Role` table).
Permissions live in `server/src/lib/permissions.ts`; the API checks them on every request and
the client only reads them (from `/api/auth/me`) to shape the UI.

| Capability                                       | Employee | Creator |
| ------------------------------------------------ | :------: | :-----: |
| Studio, capture/upload, avatars, download, email |    ✓     |    ✓    |
| Own photo history (only ever your own)           |    ✓     |    ✓    |
| Avatar library, categories, types, templates     |          |    ✓    |
| Invite / deactivate **Employees**                |          |    ✓    |
| Usage analytics, audit log                       |          |    ✓    |

- **Creators are provisioned out-of-band** — no API or UI can create a Creator or change a role:
  ```bash
  npm run creator:provision -- --email jane@sageitinc.com --name "Jane Doe"
  ```
  This prints a one-time setup link; the person chooses their own password.
- **Employees are invited** from the Creator console (one-time link, 72 h, token stored hashed).
- Sessions: httpOnly, SameSite=Strict JWT cookie; role re-read from the DB on every request;
  deactivation or password change revokes all sessions immediately.
- Passwords: bcrypt (12 rounds), min 10 chars with a letter and a number; 5 failed attempts →
  15 min lockout; login endpoints rate-limited.
- CSRF: state-changing requests require the `x-sageavatar-request: 1` header.
- Personal photos are stored under `server/storage/private/` (never served statically) and
  streamed only to their owner; other users get 404.
- Important actions are written to `AuditLog` (logins, denials, invites, library changes…).

## Design system

Glassmorphism "creative studio" look. Dark by default; every user can switch theme, accent and
motion under **Account menu → Appearance**.

- **Tokens** (`client/src/styles/index.css`): colours, glass surfaces (`.glass`, `.glass-strong`,
  `.glass-subtle`, `.glass-popover` for menus/dialogs), shadows, easing and keyframes. Fonts are
  Sora (display) and Inter (UI), self-hosted via `@fontsource-variable` — no external requests.
- **Components** (`client/src/components/`): `Button` (gradient + shine, loading state),
  `Field` / `PasswordField` (visibility toggle), `Select` (animated, keyboard-accessible dropdown),
  `Modal` / `ConfirmDialog` (focus-trapped), `ToastProvider` / `useToast`, `Spinner`, `Skeleton`,
  `OrbitLoader`, `EmptyState`, `Pill`, `Panel`, inline `icons`.
- **Motion** (`client/src/lib/motion.ts`): shared springs and page transitions. The app runs under
  `<MotionConfig reducedMotion="user">`, and CSS loops stop under `prefers-reduced-motion`.
- **Login mascot**: "Sagi", an original camera bot rendered to an animated GIF by
  `npm run mascot -w client` → `client/public/mascot/` (≈380 KB GIF + 19 KB poster used for
  reduced motion and as a load-failure fallback).
- **Login / Sign Up background**: the supplied city still
  (`client/public/backgrounds/city-hero.webp`, a single-frame WebP) with a slow CSS push-in,
  pointer parallax and a dark gradient overlay. Falls back to the original `city-canyon.svg`.
  `VITE_AUTH_BACKGROUND` can point at another image, or at an `.mp4`/`.webm` to play a muted
  looping video. Used on those two pages only.
- **Post-login flyover**: after each successful sign-in (both roles, login or invite), the supplied
  Batman still flies once across the app, right to left, then disappears
  (`components/Flyover.tsx`). Only its position, rotation and scale animate; the figure is a
  still image. Its grey background was removed with `npm run cutout -w client -- <in> <out.png>`
  (`public/assets/batman-fly.png` → `batman-fly-cutout.png`). The layer is
  `pointer-events: none`, skipped when motion is reduced or animations are off, and never part of
  exported photos (those are drawn on a separate canvas). **Account menu → Replay welcome flight**
  plays it again.
- **Post-login background (dark theme)**: a cinematic night city with an **original** caped hero on a far-left rooftop (`client/public/backgrounds/cyber-city.svg`, regenerated with `node client/scripts/generate-cyber-city.mjs` — no franchise character or artwork), slow light rays, floating particles and a scrim that keeps the centre/right readable. Midnight-navy glass with electric-blue/cyan neon edges. The light theme keeps a soft aurora. "Background effects: Off" hides it; reduced motion stops the loops.
  The earlier floating-avatar layer (`FloatingAvatars.tsx`) is no longer rendered.
- **Appearance settings** (`lib/appearance.ts`, `auth/AppearanceContext.tsx`,
  `components/AppearanceDialog.tsx`): theme Light / Dark / System default; accent Sage Blue,
  Royal Purple, Ocean Cyan, Emerald Green, Rose Pink, Sunset Orange, Lavender; glass Subtle /
  Standard / Strong; animations On / Off; motion Reduced / Standard; background effects On / Off;
  layout Compact / Comfortable. They are applied as `data-*` attributes on `<html>`, which swap
  CSS tokens. They're saved per user via `GET/PUT /api/auth/preferences` (validated, own account
  only) and cached locally so the right theme paints straight away. The camera stage and sign-in
  pages stay dark (`.surface-dark`) in every theme.

> **Third-party characters.** The city still and the Batman image were supplied by SageIT. Batman
> is a DC character and the city still is a frame from a Spider-Man film (Marvel/Sony). Using them,
> even internally, needs permission from the rights holders. To remove them, delete the files
> (or set `VITE_AUTH_BACKGROUND`): both features fall back automatically (the original city
> illustration, or no flyover).

## Authentication

- **Roles**: exactly two, CREATOR and EMPLOYEE.
  - **Public sign-up** (`/signup`) always creates an EMPLOYEE. The server hard-codes the role and rejects any `role` field with a 400.
  - **Creators** are provisioned only with `npm run creator:provision`.
  - Creators can **invite Employees**, but nothing can promote anyone to Creator.
- **Sign up**: full name, company email, password and confirmation.
  - Only company domains in `SIGNUP_EMAIL_DOMAINS` (default `sageitinc.com`) are accepted, and duplicate accounts are refused.
  - Passwords need 10+ characters with upper case, lower case, a number and a symbol, and must not contain the email name.
  - Users must **verify their email** (single-use link, 24 h) before they can sign in.
- **Login**: Remember me (30-day cookie; otherwise the session ends when the browser closes).
  - Locks out after 5 failed attempts.
  - Creators land on **Creator workspace** (`/creator`); Employees land on **Studio** (`/`).
  - The Batman flyover plays once after each successful sign-in. It doesn't replay on reload or navigation, and there's no replay control.
- **Forgot password**: always answers the same way, so it can't be used to find accounts.
  - Sends a single-use 30-minute link.
  - The link is checked before the form is shown.
  - Resetting signs out every session and clears any lockout.
- **Tokens** travel in the URL fragment (`#…`) so they never reach server logs; only SHA-256 hashes are stored.
- **Email** (`server/src/lib/mailer.ts`):
  - With `SMTP_HOST` set, mail is sent over SMTP. Tests check this path against a real local SMTP server.
  - In development without SMTP, emails are **not delivered**. They're saved to `server/storage/outbox/` and their links printed in the API console, and the UI says so.
  - In production without SMTP, sign-up returns 503.
  - Real delivery to an inbox needs your SMTP details in `server/.env` and hasn't been tested yet.

## Avatar library

- **Starter collection** — 44 original assets generated in code (`server/prisma/starter-art.ts`):
  12 characters (3 per category: Anime, Superhero, Business, Corporate) × face / half-body /
  full-body, plus 2 backgrounds per category. Varied faces, expressions, poses, outfits and
  professional / casual / themed styles. Superhero characters (Captain Nova, Night Lynx,
  Arc Sentinel) are original, genre-inspired designs — **no franchise characters or artwork**.
- **Private storage** — library files live in `server/storage/private/library/` and are served by
  `/api/assets/...` only to signed-in users; employees only receive active avatars in active
  categories/types. Nothing is served statically. (Old `/media` files are moved on first start.)
- **Creator administration** — upload (drag & drop, local preview, transparency check), name,
  description, tags, style, category, type; edit details; activate/deactivate; safe removal (only
  inactive avatars no creation uses); clean-up of orphaned files; full audit trail.
- **Source & licensing** — every avatar records source (Original / In-house / Licensed / Public
  domain), author or vendor, licence name/URL/reference, attribution, expiry, and who confirmed the
  rights and when. Expired licences can't be activated. Uploads naming well-known franchise
  characters are refused unless recorded as **Licensed** with licence details.
- **Upload rules** — Face / Half / Full body: transparent PNG or WebP; Background: PNG, WebP or JPEG;
  10 MB max; type checked from file contents; SVG uploads refused.
- **Employees** — browse, search (name, description, tags) and filter in the Studio tray, preview any
  design, and use it in compositions.

## AI Avatar Finder & Generator

- **Finder** (a search bar at the top of the avatar tray):
  - Search by name or description, or tap an example.
  - Searches only the **approved SageIT library**, through `GET /api/catalog/search`. No external providers are used and nothing is scraped from the web.
  - Ranking:
    - Keyword ranking (name, tags, category, type, style, description, plus everyday synonyms) is always on.
    - **Semantic search** (OpenAI embeddings, cached per avatar in the database) is added when `OPENAI_API_KEY` is set.
  - Results show name, category, type and source. Clicking one opens a larger preview with source and licence details, and **Use This Avatar** adds it to the photo.
  - Searching a franchise name (Batman, Spider-Man, …) explains that exact artwork needs usage rights, shows original superhero avatars, and offers to **generate an original**. Only Creator-recorded LICENSED assets would match those names directly.
- **Generate with AI** (`/api/ai/*`, server-side OpenAI Images, default `gpt-image-1`):
  - You set the description, style (7 options), avatar type (Face / Half / Full / Background) and number of images (1–4).
  - Character types are requested with a **transparent background**; backgrounds are opaque landscape images.
  - Each request runs as a job. The progress bar counts **images actually returned**; generation is not simulated.
  - The images shown are the real returned files, stored privately per user (`storage/private/ai/<userId>/`).
  - You can preview, regenerate, and use an image in the photo. Exported photos record it as `generatedAvatarId`.
  - **Safeguards:**
    - Prompts naming protected characters are refused before the AI is called, with an original suggestion.
    - Every prompt also tells the model to create an original design.
    - Content-policy refusals and upstream errors are shown as they are.
- **Roles**:
  - **Both roles** can search and generate (`avatar.generate`). `AI_EMPLOYEE_GENERATION=false` limits generation to Creators.
  - There's a per-user daily limit (`AI_DAILY_IMAGE_LIMIT`).
  - A generated image is visible only to its owner (other users get 404, Creators included).
  - **Creators** can **publish** their own generated images to the shared library (`POST /api/creator/ai-images/:id/publish`). Published images are recorded as source `AI_GENERATED` with the model and prompt, and audited.
  - Employees can't publish or change shared assets (403).
- **Not configured?** Without an OpenAI key, generation shows "not available" and search falls back to keywords. If the embedding call fails, search also falls back to keywords and says so. The library keeps working either way.
- **Testing**: server tests run the real OpenAI HTTP client against a local stand-in that speaks the same API (`tests/ai.test.ts`). **Real OpenAI generation hasn't been verified yet**: that needs `OPENAI_API_KEY` in `server/.env`.

## Events

- **Creators** (`event.manage`, the **Events** nav item):
  - Create events. Name, date, start/end time and location are required. Description, instructions, cover image and gallery visibility are optional.
  - Every event gets a unique **Event ID** (`EVT-YYMMDD-XXXX`).
  - Edit details, assign or remove Employees (duplicates are ignored), and view participants with their photo counts.
  - View the event's gallery, remove unwanted photos (files are deleted and the removal is audited), and manage albums.
  - Change status: Draft → Upcoming, (Active), Completed, Cancelled, Archived.
  - Creators manage every event in the organisation.
- **Statuses**:
  - Upcoming shows as **Active** automatically while the event is running.
  - Drafts and archived events are hidden from Employees.
  - New photos are accepted only while an event is Upcoming or Active.
- **Employees** (`event.participate`, **My Events**):
  - Only events they're assigned to, shown as cards with cover, date and time, location, status, photo count and **Enter Event**.
  - The workspace shows the event info and instructions, **Capture Photos**, and the event gallery.
  - **Capture Photos** opens the Camera Studio bound to that event (`/events/:id/capture`, with an event banner).
  - **Save to Event** stores the photo in that event and returns to its gallery. Employees never pick the event again.
- **Event photo record** (`EventPhoto`, stored separately from personal `PhotoCreation`s): photo ID, event ID, employee ID, avatar ID or generated-avatar reference, original and final image paths (private storage `events/<id>/photos/`), capture time and created time.
- **Gallery visibility**:
  - Default: shared with assigned participants.
  - **Private**: Employees see only their own photos; Creators see all.
  - Unedited originals are only for the owner and Creators.
  - Employees can download and email photos they can see, and delete only their own.
- **Notifications**:
  - Sent for a new assignment, publishing a draft, changed details, cancellation and completion.
  - They appear in-app (the header bell, `GET /api/notifications`) and are emailed through the configured mailer, which is best effort.
- **Security**:
  - Every event route re-checks the assignment on the server.
  - Unassigned users get 404.
  - Photos are always looked up together with their event, so there's no access across events.
  - Covers and photos are streamed only after those checks.

## Photo output & sharing

- **Preview:**
  - The original and final photos are shown side by side, at the actual export size.
  - **Back to editor**, **Change avatar** and **Change placement** return you to the editor.
  - Inside an event, the event name is shown.
- **Download:**
  - **JPG** (quality 95) or **PNG** (lossless).
  - The image is rendered on its own canvas at the photo's full working resolution (up to 4096 px on the long side), so no app UI, overlays or animations can appear in it.
  - File names are meaningful: `SageVatar_<Event ID|Personal>_[<employee>_]<avatar>_<YYYY-MM-DD_HH-mm>[_<id>].<ext>`.
  - Stored photos can be downloaded in either format: `?download=1&format=jpg|png`.
- **Email** (`lib/share.ts`):
  - Recipient and subject are required, the message is optional, and the stored final photo is attached on the server.
  - The client shows real progress: preparing the photo, saving it, then the server sending it.
  - Success is reported only after the SMTP server **accepts** the message.
  - Refused recipients (422), unreachable servers or failed sign-in (502) and temporary errors (503) are shown clearly.
  - Every attempt is logged in `EmailActivity` (SENT or FAILED, delivery mode, provider message ID).
  - SMTP credentials stay in `server/.env`.
  - Without SMTP in development, the UI says **not delivered**.
  - Verified in tests and in the browser against a real local SMTP server: the attachment is byte-identical to the stored photo. Delivery to a real inbox needs your SMTP settings.
- **My Creations** (personal only):
  - Thumbnails, creation date and the avatar used (library or AI-generated).
  - Download as JPG or PNG, and delete.
  - Server-side search (title or avatar) and filters for source, avatar kind, avatar type, date range and sort.
- **Event galleries:**
  - Event name, thumbnails, employee, capture date and time, and avatar.
  - Download as JPG or PNG, and email.
  - Creators can **export a ZIP** of all photos or one album: final images in album folders, plus `manifest.csv`. It's streamed and audited (`EVENT_EXPORTED`).
- **Separation:** personal history (`PhotoCreation`) and event photos (`EventPhoto`) are stored and listed separately. Employees manage only their own photos and see only event galleries they're assigned to.

## Recognition Template Studio (Happy Work Anniversary – Group Cake Cutting)

- **Flow** (`/recognition`, or **Anniversary poster** inside an event): Template → Employees → Positions →
  **Generate with Image** → Poster. Progress is reported by the server as each step finishes.
- **Templates**
  - _SageIT Office Celebration_ (built in): a drawn SageIT office scene (brand sign on the wall, script banner,
    branded cake, gifts) with each employee's **real face and shoulders** on an illustrated body.
  - _Photo templates_ (Creator → Templates → **Add photo template**): upload a real celebration photo; faces
    are detected in the browser, the Creator marks the cake cutters and adjusts positions, and confirms the
    rights to the photo. Generation replaces each marked face with the selected employee's face (aligned to the
    target's size and tilt, brightness-matched, skin tone kept). Unselected faces stay as in the photo.
- **Identity**: faces always come from the employee's original photo (cut out with the stored person mask or a
  feathered oval), never from a text prompt. Optional AI realism (`OPENAI_API_KEY`) restyles the drawn layout
  into a photo with `images/edits`, then pastes the original faces and text back on top. Not verified against
  real OpenAI yet; without a key the template composition is used and the poster says so.
- **Employee photos** (`/api/people`): stored privately with recorded permission — uploaded by the person
  (`SELF`) or by a Creator who confirmed the person's authorisation (`CREATOR_CONFIRMED`). Employees use their
  own photos and colleagues' photos only when that colleague turned on sharing (inside an event: event
  participants only). Face detection (MediaPipe Face Detection, Apache-2.0) and the person mask run in the
  browser; manual face alignment is available for every participant.
- **Results**: download PNG/JPG (meaningful names), email, Save to My Creations, Save to Event Gallery (with
  participant and creator metadata). An official (Creator) poster is shared with — and only viewable by — the
  people in it.
- Dev only: `npx tsx --env-file=.env scripts/seed-poster-demo.ts` adds six synthetic test employees
  ("Test Portrait A–F"); `--remove` deletes them.

## Notifications

- Stored per user (`Notification`), pushed instantly over **Server-Sent Events** (`GET /api/notifications/stream`),
  with a 20 s polling fallback; a duplicate key prevents repeats. Popups appear top-right with details, time,
  an action button, close and auto-dismiss; the bell and **Notification Center** (`/notifications`) keep history,
  filters and per-item read state (opening the bell no longer marks everything read).
- Triggers (only after the thing is saved): event assigned / published / updated / cancelled / completed
  (participants, with the Creator's name, date and location, plus email); employee photo saved — personal or in
  an event (all Creators, with employee, Employee ID, avatar, event, **View Creation**); AI generation finished;
  official poster saved (its participants); employee poster saved (Creators); employee joined (welcome + Creators).
- New events default to **Published**; drafts stay silent until published, and the event page says so.

## Creator Dashboard & navigation

- **Creator**: Dashboard (`/creator`: ten counts + recent employees, events, photo creations, posters, avatar
  uploads, event activity), Camera Studio, Events Management, Recognition Template Studio, My Creations,
  Employees (search by name/email/Employee ID, profile, edit name & Employee ID, activate/deactivate, creation
  activity, event assignments), Avatar Library, Templates, Notifications, Analytics (+ audit log), Settings.
- **Employee**: My Events, Camera Studio, AI Avatar Finder, Recognition Templates, My Creations, Notifications,
  Edit Profile (display name and own recognition photos only — never the role).

## Camera Studio

Pipeline: camera capture / upload → working canvas (≤ 4096 px, original kept untouched) →
**on-device detection** → effect → one `renderScene()` used for the on-screen preview **and** the
exported JPG/PNG (so the download is exactly what you see; UI and backgrounds never end up in it).

Three ways to apply an avatar or effect (Step 2 of the workflow panel):

1. **Face Filter** — 36 original vector filters (Animal, Accessories, Anime, Superhero, Fun,
   Corporate), library **character heads** (FACE avatars) and **your own filters** ("Add filter":
   transparent PNG/WebP + attach point, kept in this browser). Filters attach to MediaPipe **Face
   Mesh** landmarks (468 points: eyes, brows, nose, lips, face oval, head roll/yaw): glasses on the
   eyes, noses on the nose tip, moustaches above the upper lip, masks fitted to the face oval, ears /
   hats / headbands on the top of the head. Small or group faces are found with the full-range
   face detector and meshed from an enlarged crop. Multiple faces: numbered markers / chips choose who
   gets the filter. **Live camera**: faces are tracked every frame (smoothed) and the filter follows
   head movement and rotation; switching filters never restarts the camera; capturing keeps the filter.
2. **Full-Body Avatar** — MediaPipe **Pose** (33 landmarks + person mask) finds head, shoulders,
   hips and feet (multi-scale search for people who are small in the frame); the avatar's own head
   and neck are found from its artwork, and the avatar is scaled/rotated so its head sits on the
   person's head (full height when the feet are visible, head + shoulder width otherwise).
   *Character overlay* keeps the photo; *Full replacement* removes the person (mask + background
   fill) first; **Keep my face** puts the person's real face (Face Mesh oval) back on the avatar.
3. **Place in scene** — Beside, Behind person (selfie segmentation cut-out), Left, Right, Foreground.

Manual fallback everywhere: drag on the photo, scroll / +/- to resize, arrow keys, the Size /
Rotation / Opacity / Position controls, **Reset alignment**, **Reset composition**, and
**Hold to compare** (original vs final). "Scan Face" outlines the detected faces.

- Models and WASM (Apache-2.0) are copied from `node_modules` to `client/public/vendor` by
  `npm run vendor -w client` (runs before dev/build); nothing is fetched from a CDN and photos never
  leave the device for detection. The engines share one page safely (`lib/mediapipeInit.ts`).
- Uploads: JPG, PNG, WebP up to 10 MB, 200–8000 px; type is checked from file bytes, not the name.
- Front-camera captures are mirrored to match the preview; rear-camera captures are not.
- **Use my profile photo** loads your authorised profile photograph as the Studio photo.

## Profile

- **Edit Profile** (header dropdown and sidebar): photo (upload → drag / zoom / rotate crop → 800×800,
  consent required), display name, phone, company email (password + confirmation link to the new
  address; old email works until confirmed), password, appearance, notification pop-up preferences.
- Employees can't change role, Employee ID, department or designation (server rejects them).
- Creators (Employees → profile) edit name, Employee ID, department, designation and phone, see the
  authorised profile photo, invite, and activate / deactivate accounts.
- Profile photos are `EmployeePhoto` records (consent basis `SELF`), so the same photo is usable
  in recognition posters; colleagues can use it only if the person opts in.

## Scripts

`npm run dev | build | lint | format | typecheck | test | db:migrate | db:seed | creator:provision`

Server tests use their own database (`prisma/test.db`) and storage (`storage-test/`).

## API

| Area                       | Endpoints                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public                     | `GET /api/health`                                                                                                                                                                                                                                             |
| Auth                       | `POST /api/auth/{login,logout,register,verify-email,resend-verification,forgot-password,reset-password,change-password,accept-invite}`, `GET /api/auth/reset-password/:token`, `GET /api/auth/signup-info`, `GET /api/auth/me`, `GET /api/auth/invite/:token` |
| Own account                | `GET/PUT /api/auth/preferences` (appearance + notification pop-ups), `GET/PATCH /api/auth/profile`, `POST/DELETE /api/auth/profile/email-change`, `POST /api/auth/confirm-email`                                                                             |
| Both roles                 | `GET /api/catalog/{categories,avatar-types,avatars,templates}`, `GET /api/assets/*` (private, signed-in)                                                                                                                                                      |
| Both roles (own data only) | `GET/POST /api/creations`, `GET/PATCH/DELETE /api/creations/:id`, `GET /api/creations/:id/image/:kind`                                                                                                                                                        |
| Creator                    | `/api/creator/users`, `/api/creator/library/*`, `/api/creator/templates`, `/api/creator/analytics`, `/api/creator/audit`                                                                                                                                      |

## Status

- [x] Phase 1 — scaffold, schema, seed, catalog API, glass theme shell
- [x] Phase 2 — auth, two-role RBAC, invites, audit log, private storage, Creator console, login page
- [x] Phase 3 — Camera Studio: capture/upload, avatar tray, placements, customize, preview, download
- [x] Phase 4 — composition canvas, behind-person / background cut-out, export (built with Phase 3)
- [x] Branding (SageVatar), sign-in backdrop, post-login flyover, per-user Appearance settings
- [ ] Phase 5 — email via SMTP (verified with a real send)
- [ ] Phase 6 — library polish (placement editor, reordering, bulk upload)
- [x] AR face filters (photo + live), full-body avatars (pose), filter carousel, Cyber Hero
      light/dark redesign with daylight/night city, theme switch, collapsible sidebar
- [x] Employee profile management (photo crop, phone, verified email change, notification prefs)
- [ ] Phase 7 — QA: Playwright E2E, accessibility, mobile
