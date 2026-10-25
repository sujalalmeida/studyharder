# Studyharder

A lightweight study recorder for MacBooks. Set one intention, start a focus session, and keep a time-lapse of the work you put in. Camera frames stay in your browser; no audio or camera uploads.

[Open the private site](https://studyharder-focus-studio.foamyeel16.chatgpt.site/)

## Run locally

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173 in Safari or Chrome. HTTPS or localhost is required for camera access. The website is plain HTML, CSS, and JavaScript: no build step or runtime packages.

## Deploy to Cloudflare

This repository includes `wrangler.jsonc` for a static-assets Cloudflare Worker. It serves only `dist/` and explicitly enables the production `workers.dev` URL and preview URLs. The `.openai/hosting.json` file is used by Sites; Cloudflare does not read it as its deployment configuration.

For an existing Cloudflare application connected to GitHub, use:

- Repository root directory: `/` (the root of this repository).
- Production branch: `main`.
- Build command: `npm run build`.
- Deploy command: `npm run deploy` (or `npx wrangler deploy`).
- Worker name: `studyharder`. If your existing Worker has a different name, change `name` in `wrangler.jsonc` to match it before deploying, or use `npm run deploy -- --name YOUR_EXISTING_WORKER`.

`dist/` is already checked in. The build command validates the JavaScript; no framework build or server entry point is needed. Wrangler is a development/deployment dependency only and is not shipped to visitors.

To verify and deploy from your computer:

```sh
npm ci
npm run build
npm run deploy:check
npx wrangler login
npm run deploy
```

If the Cloudflare dashboard says **No URLs enabled**, open the Worker’s **Settings → Domains & Routes** (or **Domains** tab), then enable its **workers.dev** URL. Enable Preview URLs if you want version preview links too. Redeploying this configuration keeps those options enabled. If your account has no `workers.dev` subdomain yet, Cloudflare must first let you choose one in the account’s Workers settings. The actual production address will be shown by Cloudflare after deployment; a successful dry run does not establish a live URL.

If you created a **Cloudflare Pages** project instead, leave the build command blank and use **`dist` as the build output directory**. Pages uses a `pages.dev` address; the Wrangler configuration here targets Workers.

Cloudflare documentation: [workers.dev URLs](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Recording and timeline

- 25-minute, 50-minute, or open-ended sessions, with pause/resume.
- One 1280×720 JPEG frame per second, saved incrementally to IndexedDB together with its session metadata in a single transaction.
- A live capture timeline, frame count, and focus progress.
- Clickable filmstrip snapshots and a frame scrubber with timestamps from the original session.
- Export at 12×, 24×, or 48× speed. Finishing automatically creates a 24× time-lapse. Export can be cancelled and retried.
- MP4 when the browser supports it, with WebM as a fallback. Native browser encoding runs at the output duration; very short clips have a minimum duration of about 1.2 seconds.
- Session history grouped by date, with total focus, session count, and today's focus time.
- Older two-second recordings remain readable and keep their correct playback timing.

## Focus companions

- **Quiet view:** strips away navigation and decorative content while keeping session controls and the thought pad available.
- **Hide self-view:** keeps the camera capturing while hiding your live image. A clear indicator confirms that the camera remains on.
- **Thought parking:** jot down distractions, then return to your task. Thoughts are saved with the current session and can be reviewed in its summary. Thoughts entered before starting are a temporary draft until the session begins.
- **Break timer:** opt for a 5- or 10-minute break after a session. Camera recording is off during breaks; another focus session starts only when you choose.
- **Optional completion chime and tab title reminders.** Preferences stay on this device. While recording, Space pauses/resumes when focus is outside an input or control; Escape leaves quiet view.

A practical routine: choose one small outcome, put your phone out of reach, use quiet view, and park unrelated thoughts instead of acting on them. Take the offered break before the next session.

## Browser storage and capture limits

Keep the recording/export tab visible and the laptop awake. Background throttling or sleep can cause gaps; this website cannot block other websites or guarantee capture while the laptop sleeps. A screen wake lock is requested when supported. Export pauses when the tab is hidden.

Sessions are local to the browser and device. Clearing site data removes them, and private browsing may discard them. Download videos for a durable copy. Interrupted sessions retain frames saved before interruption. Delete old sessions from My sessions to free browser storage. The mirrored live preview does not mirror the exported video.

Firebase is not configured. A future integration can authenticate users and upload finished videos to Firebase Storage, with session metadata in Firestore.

## Verification

Development tools are optional and are not shipped with the website. Tests require Node.js, Python 3, and an installed Google Chrome:

```sh
npm ci
npm run check
npm test
```

The Playwright suite uses a synthetic canvas camera on a separate local origin; it never requests your physical camera. It covers one-second recording, pause/resume, hidden self-view, thoughts, MP4/WebM download, timeline scrubbing, export speed changes, break timers, preferences, responsive layouts, interrupted sessions, older recordings, cancellation, and storage failure.

For a manual synthetic-camera check:

```sh
python3 tests/serve.py
```

Open http://127.0.0.1:4174. Test data stays on that origin. To try your actual camera, use the normal local site instead.
