"use strict";
const CAPTURE_INTERVAL_MS = 1000;
const DEFAULT_PLAYBACK_FPS = 24;
const $ = (id) => document.getElementById(id);
let db,
  stream,
  session = null,
  paused = false,
  elapsed = 0,
  lastTick = 0,
  ticker,
  captureBusy = false,
  pendingCapture = Promise.resolve(),
  wakeLock,
  selectedSession,
  exporting = false,
  outputURL,
  thumbnailURLs = [],
  cameraRequest;
const canvas = document.createElement("canvas");
canvas.width = 1280;
canvas.height = 720;
const ctx = canvas.getContext("2d", { alpha: false });
const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const notify = (message) => {
  $("notice").textContent = message;
  $("notice").hidden = !message;
};
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("studyharder", 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      d.createObjectStore("sessions", { keyPath: "id" });
      const frames = d.createObjectStore("frames", {
        keyPath: ["sessionId", "index"],
      });
      frames.createIndex("sessionId", "sessionId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transaction(store, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let value;
    const request = operation(tx.objectStore(store));
    if (request)
      request.onsuccess = () => {
        value = request.result;
      };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Storage was interrupted."));
  });
}
const saveSession = (s) =>
  transaction("sessions", "readwrite", (store) => store.put({ ...s }));
const getSessions = () =>
  transaction("sessions", "readonly", (store) => store.getAll());
const getFrame = (id, index) =>
  transaction("frames", "readonly", (store) => store.get([id, index]));
async function enableCamera() {
  if (stream?.active) return true;
  if (cameraRequest) return cameraRequest;
  cameraRequest = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS or localhost. Open the secure website in Safari or Chrome.",
        );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      });
      $("preview").srcObject = stream;
      await $("preview").play();
      $("preview").style.display = "block";
      $("placeholder").hidden = true;
      $("cameraStatus").innerHTML = "<i></i> CAMERA READY";
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (session)
          finishSession(
            "Camera disconnected. Your captured frames were saved.",
          );
        else resetCamera();
      });
      notify("");
      return true;
    } catch (e) {
      notify(
        e.name === "NotAllowedError"
          ? "Camera access was declined. Allow camera access in your browser’s site settings, then try again."
          : e.name === "NotFoundError"
            ? "No camera found. Connect a camera, then try again."
            : `Couldn’t open the camera. ${e.message}`,
      );
      return false;
    } finally {
      cameraRequest = null;
    }
  })();
  return cameraRequest;
}
function resetCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("preview").srcObject = null;
  $("preview").style.display = "none";
  $("placeholder").hidden = false;
  $("cameraStatus").innerHTML = "<i></i> CAMERA OFF";
  $("cameraStatus").classList.remove("recording");
}
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
}
function drawCamera() {
  const v = $("preview");
  const w = v.videoWidth,
    h = v.videoHeight;
  if (!w || !h) return false;
  const scale = Math.max(canvas.width / w, canvas.height / h);
  ctx.drawImage(
    v,
    (canvas.width - w * scale) / 2,
    (canvas.height - h * scale) / 2,
    w * scale,
    h * scale,
  );
  return true;
}
function capture() {
  if (!session || paused || captureBusy) return pendingCapture;
  captureBusy = true;
  const current = session;
  pendingCapture = (async () => {
    try {
      if (!drawCamera()) return;
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.72),
      );
      if (!blob) throw new Error("Could not capture a frame.");
      await transaction("frames", "readwrite", (store) =>
        store.put({
          sessionId: current.id,
          index: current.frames,
          at: elapsed,
          blob,
        }),
      );
      current.frames++;
      current.elapsed = elapsed;
      await saveSession(current);
      updateCaptureTimeline();
    } catch (e) {
      notify(
        "Recording stopped because a frame could not be saved. Your existing frames are kept. Download or delete older sessions to free browser storage.",
      );
      if (session) {
        setTimeout(() => finishSession(), 0);
      }
    } finally {
      captureBusy = false;
    }
  })();
  return pendingCapture;
}
function updateTimer() {
  const duration = Number($("duration").value) * 60;
  const value = session ? (duration ? duration - elapsed : elapsed) : duration;
  updateCaptureTimeline();
  $("timer").textContent = duration || session ? formatTime(value) : "00:00";
  $("timerRing").style.setProperty(
    "--progress",
    `${duration ? Math.min(100, (elapsed / duration) * 100) : 0}%`,
  );
}
function lockSettings(locked) {
  $("sessionsNav").disabled = locked;
  $("intention").disabled = locked;
  document
    .querySelectorAll("[data-minutes]")
    .forEach((b) => (b.disabled = locked));
}
async function startSession() {
  if (session) return;
  $("start").disabled = true;
  try {
    if (!db)
      throw new Error(
        "Browser storage is unavailable. Enable storage for this site and reload.",
      );
    if (!(await enableCamera())) return;
    session = {
      id: crypto.randomUUID(),
      title: $("intention").value.trim() || "A little more focused",
      created: Date.now(),
      elapsed: 0,
      frames: 0,
      frameIntervalMs: CAPTURE_INTERVAL_MS,
      playbackFps: DEFAULT_PLAYBACK_FPS,
      status: "recording",
    };
    await saveSession(session);
    elapsed = 0;
    paused = false;
    lastTick = performance.now();
    lockSettings(true);
    $("start").hidden = true;
    $("recordingControls").hidden = false;
    $("timerLabel").textContent = "YOU’RE SHOWING UP";
    $("startNote").textContent = "Stay here. You’re doing the work.";
    $("cameraStatus").innerHTML = "<i></i> RECORDING";
    $("cameraStatus").classList.add("recording");
    $("cameraCaption").textContent = "ONE FRAME EVERY SECOND";
    await requestWakeLock();
    await capture();
    let lastCapture = performance.now();
    ticker = setInterval(() => {
      const now = performance.now();
      if (!paused) {
        elapsed += (now - lastTick) / 1000;
        updateTimer();
        if (now - lastCapture >= CAPTURE_INTERVAL_MS) {
          capture();
          lastCapture = now;
        }
        const target = Number($("duration").value) * 60;
        if (target && elapsed >= target) finishSession();
      }
      lastTick = now;
    }, 250);
    notify(
      "Keep this tab visible and your laptop awake for consistent capture. No audio is recorded.",
    );
  } catch (e) {
    session = null;
    notify(e.message);
  } finally {
    $("start").disabled = false;
  }
}
function togglePause() {
  if (!session) return;
  paused = !paused;
  lastTick = performance.now();
  $("pause").textContent = paused ? "▶ Resume" : "Ⅱ Pause";
  $("timerLabel").textContent = paused ? "TAKE A BREATH" : "YOU’RE SHOWING UP";
  $("cameraStatus").innerHTML = paused ? "<i></i> PAUSED" : "<i></i> RECORDING";
  $("cameraStatus").classList.toggle("recording", !paused);
}
let finishing = false;
async function finishSession(message) {
  if (!session || finishing) return;
  finishing = true;
  clearInterval(ticker);
  $("finish").disabled = true;
  try {
    await pendingCapture;
    const done = session;
    done.elapsed = elapsed;
    done.status = "complete";
    await saveSession(done);
    session = null;
    paused = false;
    await wakeLock?.release();
    resetCamera();
    lockSettings(false);
    $("start").hidden = false;
    $("recordingControls").hidden = true;
    $("pause").textContent = "Ⅱ Pause";
    $("timerLabel").textContent = "A FRESH START";
    $("startNote").textContent = "Your only job? Be here.";
    elapsed = 0;
    updateTimer();
    notify(
      message ||
        "Session saved on this device. Your progress is yours to keep.",
    );
    await renderLibrary();
    await openResult(done);
    if (done.frames) exportVideo();
  } catch (e) {
    notify(`Couldn’t finish saving. ${e.message} Try finishing again.`);
  } finally {
    finishing = false;
    $("finish").disabled = false;
  }
}
async function renderLibrary() {
  if (!db) return;
  const sessions = (await getSessions()).sort((a, b) => b.created - a.created);
  $("count").textContent = sessions.length;
  $("totalSessions").textContent = sessions.length;
  $("totalFocus").textContent = compactDuration(
    sessions.reduce((sum, s) => sum + s.elapsed, 0),
  );
  $("todayFocus").textContent = compactDuration(
    sessions
      .filter(
        (s) => new Date(s.created).toDateString() === new Date().toDateString(),
      )
      .reduce((sum, s) => sum + s.elapsed, 0),
  );
  thumbnailURLs.forEach(URL.revokeObjectURL);
  thumbnailURLs = [];
  const grid = $("sessionGrid");
  grid.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML =
      '<h2>Your story starts with one session.</h2><p>Settle in. Your saved time-lapses will live here.</p><button class="outline">Go to focus studio ↗</button>';
    empty.querySelector("button").onclick = () => showView("studio");
    grid.append(empty);
    return;
  }
  let previousDay;
  for (const s of sessions) {
    const day = new Date(s.created).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    if (day !== previousDay) {
      const heading = document.createElement("h2");
      heading.className = "session-day";
      heading.textContent = day;
      grid.append(heading);
      previousDay = day;
    }
    const card = document.createElement("article");
    card.className = "session-card";
    const img = document.createElement("img");
    img.alt = "First frame of your study session";
    const first = await getFrame(s.id, 0);
    if (first) {
      img.src = URL.createObjectURL(first.blob);
      thumbnailURLs.push(img.src);
    }
    const content = document.createElement("div");
    content.className = "session-content";
    const title = document.createElement("h3");
    title.textContent = s.title;
    const info = document.createElement("p");
    info.textContent = `${new Date(s.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${formatTime(s.elapsed)} focused · ${s.frames} frames${s.status === "recording" ? " · recovered" : ""}`;
    const actions = document.createElement("div");
    actions.className = "session-actions";
    const view = document.createElement("button");
    view.className = "outline";
    view.textContent = "View time-lapse ↗";
    view.onclick = () => openResult(s);
    const remove = document.createElement("button");
    remove.className = "outline";
    remove.textContent = "Delete";
    remove.onclick = async () => {
      if (!confirm("Delete this session and all its frames from this browser?"))
        return;
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["sessions", "frames"], "readwrite");
          tx.objectStore("sessions").delete(s.id);
          const cursor = tx
            .objectStore("frames")
            .index("sessionId")
            .openCursor(IDBKeyRange.only(s.id));
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (c) {
              c.delete();
              c.continue();
            }
          };
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        await renderLibrary();
      } catch (e) {
        notify(`Could not delete this session: ${e.message}`);
      }
    };
    actions.append(view, remove);
    content.append(title, info, actions);
    card.append(img, content);
    grid.append(card);
  }
}
function showView(view) {
  if (exporting || (session && view === "library")) return;
  $("studio").hidden = view !== "studio";
  $("library").hidden = view !== "library";
  $("studioNav").classList.toggle("active", view === "studio");
  $("sessionsNav").classList.toggle("active", view === "library");
  if (view === "library") renderLibrary();
}
let resultURLs = [];
let seekVersion = 0;
let resultVersion = 0;
const sessionInterval = (s) => s.frameIntervalMs || 2000;
const sessionFPS = (s) => s.playbackFps || 12;
const compactDuration = (seconds) =>
  seconds < 60 ? `${Math.floor(seconds)}s` : `${Math.floor(seconds / 60)}m`;

function updateCaptureTimeline() {
  const target = Number($("duration").value) * 60;
  $("captureCount").textContent =
    `${session?.frames || 0} frames · 1 frame / sec`;
  $("captureElapsed").textContent = session
    ? `${formatTime(elapsed)} focused`
    : "Ready for your first frame";
  $("captureTarget").textContent = target
    ? `${target / 60} min`
    : "Your own pace";
  $("captureProgress").style.width =
    `${target ? Math.min(100, (elapsed / target) * 100) : Math.min(100, ((session?.frames || 0) / 60) * 100)}%`;
}
function updateClipInfo() {
  const s = selectedSession;
  const seconds = Math.max(1.2, s.frames / sessionFPS(s));
  $("clipLength").textContent = `≈ ${Math.ceil(seconds)}s video`;
  $("resultInfo").textContent =
    `${formatTime(s.elapsed)} of focus · ${s.frames} frames · ${Number($("exportSpeed").value)}× playback`;
}
async function seekResult(index) {
  const version = ++seekVersion;
  const s = selectedSession;
  index = Math.max(0, Math.min(s.frames - 1, Number(index)));
  if (!s.frames) return;
  const frame = await getFrame(s.id, index);
  if (!frame || version !== seekVersion) return;
  const at = frame.at ?? (index * sessionInterval(s)) / 1000;
  $("frameScrubber").value = index;
  $("framePosition").textContent = `Frame ${index + 1} of ${s.frames}`;
  $("frameTime").textContent = formatTime(at);
  $("frameScrubber").setAttribute(
    "aria-valuetext",
    `${formatTime(at)} of focus, frame ${index + 1}`,
  );
  if (outputURL) {
    $("resultVideo").pause();
    $("resultVideo").currentTime = Math.min(
      index / sessionFPS(s),
      $("resultVideo").duration || Infinity,
    );
  } else {
    const image = await createImageBitmap(frame.blob);
    if (version === seekVersion)
      $("framePreview").getContext("2d").drawImage(image, 0, 0);
    image.close();
  }
}
function clearOutput() {
  const video = $("resultVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.hidden = true;
  $("framePreview").hidden = false;
  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = null;
  $("download").hidden = true;
  $("makeVideo").hidden = false;
}
async function openResult(s) {
  const version = ++resultVersion;
  selectedSession = { ...s, playbackFps: 24000 / sessionInterval(s) };
  $("exportSpeed").value = "24";
  $("resultTitle").textContent = s.title;
  updateClipInfo();
  $("exportStatus").textContent = s.frames
    ? "Explore your frames, then create a video to download."
    : "No frames captured. Try another session with the camera enabled.";
  $("makeVideo").disabled = !s.frames;
  $("exportSpeed").disabled = !s.frames;
  $("exportProgress").hidden = true;
  $("frameScrubber").max = Math.max(0, s.frames - 1);
  $("frameScrubber").value = 0;
  $("frameScrubber").disabled = !s.frames;
  $("timelineEnd").textContent = formatTime(s.elapsed);
  $("framePosition").textContent = `Frame ${s.frames ? 1 : 0} of ${s.frames}`;
  $("frameTime").textContent = "00:00";
  clearOutput();
  $("framePreview").getContext("2d").clearRect(0, 0, 1280, 720);
  resultURLs.forEach(URL.revokeObjectURL);
  resultURLs = [];
  $("filmstrip").replaceChildren();
  if (!$("result").open) $("result").showModal();
  if (s.frames) await seekResult(0);
  const count = Math.min(8, s.frames);
  for (let i = 0; i < count; i++) {
    const index =
      count === 1 ? 0 : Math.round((i * (s.frames - 1)) / (count - 1));
    const frame = await getFrame(s.id, index);
    if (version !== resultVersion) return;
    if (!frame) continue;
    const url = URL.createObjectURL(frame.blob);
    resultURLs.push(url);
    const button = document.createElement("button");
    const at = formatTime(frame.at ?? (index * sessionInterval(s)) / 1000);
    button.setAttribute("aria-label", `Jump to ${at}, frame ${index + 1}`);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    const time = document.createElement("span");
    time.textContent = at;
    button.append(img, time);
    button.onclick = () => seekResult(index);
    $("filmstrip").append(button);
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function exportVideo() {
  if (exporting || !selectedSession?.frames) return;
  const s = selectedSession;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    $("exportStatus").textContent =
      "Video export is unavailable in this browser. Use a current version of Safari or Chrome.";
    return;
  }
  const mime = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) {
    $("exportStatus").textContent =
      "This browser has no compatible video encoder. Try Safari or Chrome.";
    return;
  }
  exporting = true;
  $("makeVideo").disabled = true;
  $("closeResult").disabled = true;
  $("exportSpeed").disabled = true;
  $("frameScrubber").disabled = true;
  $("filmstrip").inert = true;
  $("exportProgress").hidden = false;
  $("exportProgress").value = 0;
  let outStream, recorder;
  try {
    await requestWakeLock();
    const out = document.createElement("canvas");
    out.width = 1280;
    out.height = 720;
    const context = out.getContext("2d", { alpha: false });
    const first = await getFrame(s.id, 0);
    const firstImage = await createImageBitmap(first.blob);
    context.drawImage(firstImage, 0, 0);
    firstImage.close();
    outStream = out.captureStream(s.playbackFps || 12);
    recorder = new MediaRecorder(outStream, {
      mimeType: mime,
      videoBitsPerSecond: 3500000,
    });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = resolve;
      recorder.onerror = (e) =>
        reject(e.error || new Error("Video encoding failed."));
    });
    recorder.start(1000);
    const encodeStarted = performance.now();
    for (let i = 0; i < s.frames; i++) {
      if (document.hidden && recorder.state === "recording") recorder.pause();
      while (document.hidden) {
        $("exportStatus").textContent =
          "Export paused. Return to this tab to continue.";
        await wait(300);
      }
      if (recorder.state === "paused") recorder.resume();
      const f = await getFrame(s.id, i);
      if (!f) throw new Error("A saved frame is missing.");
      const image = await createImageBitmap(f.blob);
      context.drawImage(image, 0, 0);
      image.close();
      $("exportProgress").value = (i + 1) / s.frames;
      $("exportStatus").textContent =
        `Creating your time-lapse… ${Math.round(((i + 1) / s.frames) * 100)}%`;
      await wait(1000 / (s.playbackFps || 12));
    }
    while (performance.now() - encodeStarted < 1200) {
      context.drawImage(out, 0, 0);
      await wait(1000 / (s.playbackFps || 12));
    }
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (!blob.size) throw new Error("The encoder produced an empty video.");
    if (outputURL) URL.revokeObjectURL(outputURL);
    outputURL = URL.createObjectURL(blob);
    $("resultVideo").src = outputURL;
    $("resultVideo").hidden = false;
    $("framePreview").hidden = true;
    $("download").href = outputURL;
    $("download").download =
      `studyharder-${new Date(s.created).toISOString().slice(0, 10)}.${mime.includes("mp4") ? "mp4" : "webm"}`;
    $("download").hidden = false;
    $("makeVideo").hidden = true;
    $("exportStatus").textContent =
      `Your time-lapse is ready. ${(blob.size / 1024 / 1024).toFixed(1)} MB · Save it to keep a copy outside this browser.`;
  } catch (e) {
    $("exportStatus").textContent =
      `Couldn’t export: ${e.message} Your frames are still saved; you can try again.`;
    if (recorder?.state === "recording") recorder.stop();
  } finally {
    outStream?.getTracks().forEach((t) => t.stop());
    await wakeLock?.release();
    exporting = false;
    $("makeVideo").disabled = false;
    $("closeResult").disabled = false;
    $("exportSpeed").disabled = false;
    $("frameScrubber").disabled = false;
    $("filmstrip").inert = false;
  }
}
$("frameScrubber").oninput = (e) => seekResult(e.target.value);
$("exportSpeed").onchange = () => {
  if (exporting) return;
  selectedSession.playbackFps =
    (Number($("exportSpeed").value) * 1000) / sessionInterval(selectedSession);
  clearOutput();
  $("exportProgress").hidden = true;
  $("exportStatus").textContent =
    "Speed updated. Create your new time-lapse when ready.";
  updateClipInfo();
  seekResult($("frameScrubber").value);
};
$("resultVideo").addEventListener("timeupdate", () => {
  if (!outputURL || !selectedSession?.frames) return;
  const index = Math.min(
    selectedSession.frames - 1,
    Math.floor($("resultVideo").currentTime * sessionFPS(selectedSession)),
  );
  $("frameScrubber").value = index;
  $("framePosition").textContent =
    `Frame ${index + 1} of ${selectedSession.frames}`;
});
$("enableCamera").onclick = enableCamera;
$("start").onclick = startSession;
$("pause").onclick = togglePause;
$("finish").onclick = () => finishSession();
$("studioNav").onclick = () => showView("studio");
$("sessionsNav").onclick = () => showView("library");
$("newSession").onclick = () => showView("studio");
$("makeVideo").onclick = exportVideo;
$("closeResult").onclick = () => {
  $("resultVideo").pause();
  $("result").close();
};
$("result").addEventListener("cancel", (e) => {
  if (exporting) e.preventDefault();
});
$("result").addEventListener("close", () => $("resultVideo").pause());
$("mirror").onclick = () => {
  const enabled = $("mirror").getAttribute("aria-pressed") !== "true";
  $("mirror").setAttribute("aria-pressed", String(enabled));
  $("preview").style.transform = enabled ? "scaleX(-1)" : "none";
};
document.querySelectorAll("[data-minutes]").forEach(
  (button) =>
    (button.onclick = () => {
      if (session) return;
      document
        .querySelectorAll("[data-minutes]")
        .forEach((b) => b.classList.remove("selected"));
      button.classList.add("selected");
      $("duration").value = button.dataset.minutes;
      elapsed = 0;
      updateTimer();
    }),
);
document.addEventListener("visibilitychange", () => {
  if (session) {
    if (document.hidden)
      notify(
        "This tab is hidden. Capture may slow down; return here to keep your time-lapse consistent.",
      );
    else {
      requestWakeLock();
      notify("Welcome back. Keep this tab visible for consistent capture.");
    }
  }
});
window.addEventListener("beforeunload", (e) => {
  if (session || exporting) {
    e.preventDefault();
    e.returnValue = "";
  }
});
(async () => {
  try {
    db = await openDB();
    await renderLibrary();
    const recovered = (await getSessions()).filter(
      (s) => s.status === "recording",
    );
    if (recovered.length)
      notify(
        "An earlier session was interrupted. Its saved frames are available in My sessions.",
      );
  } catch {
    notify(
      "Local browser storage is unavailable. Enable site storage or leave private browsing before recording.",
    );
    $("start").disabled = true;
  }
})();
