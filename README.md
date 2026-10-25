# Studyharder

A lightweight, buildless focus studio. No framework, server database, camera upload, or audio recording.

## Run locally

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173 in Safari or Chrome. Camera access requires localhost or HTTPS.

## How it works

- 25-minute, 50-minute, and open-ended focus sessions with pause/resume.
- Captures a 1280×720 JPEG frame every two seconds and saves it directly to IndexedDB.
- Finishing creates a 12 fps time-lapse (approximately 24× speed) with browser-native canvas capture and MediaRecorder. Short videos have a minimum encoding duration of 1.2 seconds.
- MP4 is preferred when supported; otherwise exports WebM. Encoding runs in real time at the output duration. Frames remain available if encoding fails.
- Session library supports export again and deletion. No Firebase configuration needed.
- Interrupted sessions retain frames saved before interruption. Browser site-data clearing removes sessions; download videos to keep durable copies.
- Keep the recording/export tab visible and the laptop awake. Background tab throttling and laptop sleep can cause gaps. The app requests a screen wake lock when supported.
- The mirrored live preview does not mirror the exported video.

## Verification

`node --check dist/app.js`

`python3 tests/serve.py` serves the app at http://127.0.0.1:4174 with a synthetic canvas camera. This separate origin does not request the real camera. Use it to exercise Start Focus, pause/resume, Finish, export, and session recovery after reload. Test harness files are not deployed.

## Future Firebase integration

This version stores camera frames locally and makes no video upload requests. A future integration can upload finished video blobs to Firebase Storage and session metadata to Firestore after authentication. Firebase is intentionally not configured in this version.
