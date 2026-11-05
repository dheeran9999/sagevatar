# SageVatar — setup guide for a new computer

This guide gets SageVatar running on **your own computer** so you can test the Camera Studio with
**your own webcam**. It takes about 10 minutes (most of it is downloading dependencies).

Everything runs locally: the app, the database (a single SQLite file) and the face/body tracking
(in your browser). Nothing is deployed and no external accounts are needed.

---

## 1. Install the required software

| Software | Version | Download |
| -------- | ------- | -------- |
| **Node.js** | 20.19 or newer (22 LTS recommended) | https://nodejs.org → "LTS" installer |
| **Git** | any recent version | https://git-scm.com/downloads |
| **Browser** | current Chrome, Edge or Firefox | — |

Check the installs in a new terminal (Windows: PowerShell; macOS: Terminal):

```bash
node -v
```

```bash
npm -v
```

```bash
git --version
```

`node -v` must print `v20.19.0` or higher.

## 2. Get access to the private repository and clone it

1. Ask the repository owner to add your GitHub account as a **collaborator** (GitHub → repository →
   Settings → Collaborators). Accept the email invitation.
2. Clone it (GitHub will ask you to sign in the first time — use the browser sign-in or a personal
   access token; your normal GitHub password doesn't work on the command line):

```bash
git clone https://github.com/<OWNER>/<REPOSITORY>.git
```

```bash
cd <REPOSITORY>
```

## 3. Configure environment variables

Copy the example settings file. The defaults work for local testing.

macOS / Linux / Git Bash:

```bash
cp server/.env.example server/.env
```

Windows (PowerShell):

```bash
Copy-Item server\.env.example server\.env
```

Open `server/.env` in a text editor and set **`JWT_SECRET`** to your own random value (any text of
32+ characters; this command prints one):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Optional settings (leave empty for testing):

- `SMTP_*` — real email delivery. Without it, emails (sign-up verification, invites, password
  reset) are **saved to `server/storage/outbox/`** and their links are printed in the terminal.
- `OPENAI_API_KEY` — AI avatar generation. Without it, AI generation shows "not configured";
  avatar search and everything else still work.
- `SEED_*` — the demo login accounts created in the next step (you can change them first).

Never commit `server/.env` — it is git-ignored on purpose.

## 4. Install dependencies

```bash
npm install
```

This installs the frontend and backend (npm workspaces) and generates the database client.
Warnings are normal; it should end without `npm error`.

## 5. Create the database

```bash
npm run db:migrate
```

This creates `server/prisma/dev.db`, applies all migrations and **seeds** demo data: the Creator and
Employee demo accounts from `server/.env`, avatar categories and the starter avatar artwork.
If it asks for a migration name, just press Enter.

To start over later: `npm run db:reset` (deletes the local database and recreates it).

## 6. Start the app

```bash
npm run dev
```

You should see `SageVatar API listening on http://localhost:4000` and Vite's
`Local: http://localhost:5173/`. Keep this terminal open (stop with `Ctrl + C`).

## 7. Open the app

Open **http://localhost:5173** in your browser.

> Use `localhost` exactly. Browsers only allow the camera on `localhost` or HTTPS — an IP address
> like `http://192.168.x.x:5173` will block the camera.

Sign in with a demo account from `server/.env`:

- Employee: `SEED_EMPLOYEE_EMAIL` / `SEED_EMPLOYEE_PASSWORD`
- Creator: `SEED_CREATOR_EMAIL` / `SEED_CREATOR_PASSWORD`

## 8. Allow camera access

1. Go to **Camera Studio** and click **Turn on camera**.
2. The browser asks for permission — click **Allow**.
3. If you clicked Block by mistake: click the camera / lock icon at the left of the address bar →
   set Camera to **Allow** → reload the page.
4. Operating-system permission (first time only):
   - **Windows 10/11:** Settings → Privacy & security → Camera → turn on *Camera access* and
     *Let desktop apps access your camera*.
   - **macOS:** System Settings → Privacy & Security → Camera → enable your browser, then restart it.

## 9. Test the camera features

Work through this checklist and note anything that doesn't behave as described:

| # | Test | Expected result |
| - | ---- | --------------- |
| 1 | **Turn on camera** | Live preview appears, mirrored like a mirror |
| 2 | Pick **Bunny** in the filter carousel under the camera | Ears on top of your head, nose and whiskers on your face — live |
| 3 | Move and tilt your head | The filter stays attached and rotates with you |
| 4 | Switch filters (Glasses → Moustache → Kitty …) | Changes instantly; the camera does not restart |
| 5 | Click **Scan Face** | Your face outline is highlighted briefly |
| 6 | **Switch camera** (button right of the shutter) | Only enabled when you have 2+ cameras; switches between them |
| 7 | **Capture** (round shutter button) | A white flash; the photo stays with the filter applied |
| 8 | **Hold to compare** (top-right of the photo) | Shows the original while held |
| 9 | Customize → Size / Rotation / Opacity, drag the filter | The filter moves/resizes; **Reset alignment** puts it back |
| 10 | **Full-Body Avatar** → pick a Full Body avatar in the gallery | The avatar is fitted over you; try *Keep my face* and *Full replacement* |
| 11 | **Retake** | Back to the live camera |
| 12 | **Preview**, then **Download JPG / PNG** | The downloaded file contains exactly the previewed photo |
| 13 | **Upload photo** (no camera needed) | Same filters work on an uploaded JPG/PNG/WebP up to 10 MB |
| 14 | Block the camera in the browser, then **Try again** | A clear "Camera blocked" message with how to fix it |

## 10. Troubleshooting

| Problem | What to do |
| ------- | ---------- |
| `node` / `npm` not found | Reinstall Node.js LTS, then open a **new** terminal. |
| `npm install` fails with network / proxy errors | Retry; on a corporate network set `npm config set proxy …` / `https-proxy …` as your IT team advises. |
| `Invalid environment configuration … JWT_SECRET` | `server/.env` is missing or `JWT_SECRET` is shorter than 32 characters (step 3). |
| `EADDRINUSE: address already in use :::4000` (or 5173) | Another program uses the port. Close it, or another running copy of SageVatar (`Ctrl + C`). |
| `npm run db:migrate` errors | Make sure you ran `npm install` first. If it says the environment is *non-interactive*, run `npx prisma migrate deploy --schema server/prisma/schema.prisma` and then `npm run db:seed`. To start clean: `npm run db:reset`. |
| Sign-in says the email/password is wrong | Use the `SEED_*` values from **your** `server/.env`; if you changed them after step 5, run `npm run db:seed`. Five wrong attempts lock the account for 15 minutes. |
| "Camera blocked" | Step 8 (site permission **and** operating-system permission). |
| "No camera found" | Connect/enable a webcam and check it in another app (e.g. Windows Camera). |
| "Camera is busy" | Close Teams, Zoom or other tabs/apps using the camera, then **Try again**. |
| "Needs a secure connection" | You opened an IP address — use **http://localhost:5173**. |
| Filters don't appear on your face | Face the camera in good light; the status line under the filters shows "1 face tracked" when it works. The first use downloads nothing but takes a few seconds to start the tracker. |
| Sign-up email never arrives | Expected without SMTP — open the newest file in `server/storage/outbox/` or copy the link printed in the terminal. Sign-up only accepts emails in `SIGNUP_EMAIL_DOMAINS`. |
| Something else | Copy the terminal output and the browser console (F12 → Console) and send them to the project owner. |

## Optional: run with Docker instead of Node

If you have Docker Desktop, after step 3 you can run `docker compose up -d --build` and open
**http://localhost:8080** (camera works on localhost here too). Data is stored in `./docker-data`.
Stop with `docker compose down`.
