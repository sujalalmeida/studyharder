const { test, expect } = require("@playwright/test");

async function sessions(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("studyharder", 1);
        req.onsuccess = () => {
          const db = req.result;
          const get = db
            .transaction("sessions")
            .objectStore("sessions")
            .getAll();
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
async function start(page) {
  await page.goto("/");
  await page.getByLabel("What are you working on?").fill("Biology chapter 3");
  await page.getByRole("button", { name: "∞ open", exact: true }).click();
  await page.getByRole("button", { name: "Start Focus" }).click();
  await expect(page.locator("#cameraStatus")).toContainText("RECORDING");
}

test("1 fps capture, pause, hidden self-view, thoughts, export, and timeline", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page
    .getByRole("button", { name: "Hide self-view", exact: true })
    .click();
  await expect(page.locator("#selfViewCover")).toBeVisible();
  await page
    .getByLabel("A distracting thought to revisit later")
    .fill("Look up practice questions");
  await page.getByRole("button", { name: "Park it", exact: false }).click();
  await expect(page.locator("#thoughtCount")).toHaveText("1");
  await expect
    .poll(async () => (await sessions(page))[0]?.frames)
    .toBeGreaterThanOrEqual(4);
  await page.getByRole("button", { name: "Pause", exact: false }).click();
  await page.waitForTimeout(300); // Allow an already in-flight frame to finish.
  const paused = (await sessions(page))[0];
  const times = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open("studyharder", 1);
        req.onsuccess = () => {
          const db = req.result;
          const request = db
            .transaction("frames")
            .objectStore("frames")
            .index("sessionId")
            .getAll(id);
          request.onsuccess = () => {
            resolve(request.result.map((f) => f.at));
            db.close();
          };
        };
      }),
    paused.id,
  );
  const averageInterval = (times.at(-1) - times[0]) / (times.length - 1);
  expect(averageInterval).toBeGreaterThan(0.8);
  expect(averageInterval).toBeLessThan(1.3);
  const time = await page.locator("#timer").innerText();
  await page.waitForTimeout(1400);
  expect((await sessions(page))[0].frames).toBe(paused.frames);
  await expect(page.locator("#timer")).toHaveText(time);
  await page.getByRole("button", { name: "Resume", exact: false }).click();
  await expect
    .poll(async () => (await sessions(page))[0].frames)
    .toBeGreaterThan(paused.frames);
  await page
    .getByRole("button", { name: "Finish session", exact: false })
    .click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 20000 });
  const saved = (await sessions(page))[0];
  expect(saved.frameIntervalMs).toBe(1000);
  expect(saved.playbackFps).toBe(24);
  expect(saved.status).toBe("complete");
  expect(saved.thoughts).toEqual(["Look up practice questions"]);
  await expect(page.locator("#filmstrip button")).toHaveCount(
    Math.min(8, saved.frames),
  );
  await expect
    .poll(() => page.locator("#resultVideo").evaluate((v) => v.readyState))
    .toBe(4);
  expect(await page.locator("#resultVideo").evaluate((v) => v.videoWidth)).toBe(
    1280,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const fs = require("node:fs");
  expect(fs.statSync(await download.path()).size).toBeGreaterThan(1000);
  await page.locator("#filmstrip button").last().click();
  await expect(page.locator("#framePosition")).toHaveText(
    `Frame ${saved.frames} of ${saved.frames}`,
  );
  await page.getByLabel("Time-lapse speed").selectOption("48");
  await expect(page.locator("#clipLength")).toContainText("video");
  await expect(page.locator("#framePreview")).toBeVisible();
  await page
    .getByRole("button", { name: "Create time-lapse", exact: true })
    .click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 20000 });
  await page.screenshot({
    path: "test-results/timeline-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Take a 5-minute break", exact: false })
    .click();
  await expect(page.locator("#breakPanel")).toBeVisible();
  await expect(page.locator("#breakTimer")).toContainText("04:");
  await expect(page.locator("#cameraStatus")).toContainText("OFF");
  await page
    .getByRole("button", { name: "Back to focus", exact: true })
    .click();
  await expect(page.locator("#breakPanel")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "My sessions", exact: false }).click();
  await expect(page.locator("#totalSessions")).toHaveText("1");
  await expect(page.locator(".session-card h3")).toHaveText(
    "Biology chapter 3",
  );
  await expect(page.locator(".session-day")).toBeVisible();
  expect(errors).toEqual([]);
});

test("quiet mode, persisted preferences, and responsive layout", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("After focus, offer a break").selectOption("10");
  await page.getByLabel("Tab title reminds me to return").uncheck();
  await page.reload();
  await expect(page.getByLabel("After focus, offer a break")).toHaveValue("10");
  await expect(
    page.getByLabel("Tab title reminds me to return"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Quiet view", exact: false }).click();
  await expect(page.locator("body")).toHaveClass("quiet-mode");
  await expect(page.locator("header")).toBeHidden();
  await page
    .getByRole("button", { name: "Leave quiet view", exact: false })
    .click();
  await expect(page.locator("header")).toBeVisible();
  await page.screenshot({
    path: "test-results/studio-preview.png",
    fullPage: true,
  });
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390)
      await page.screenshot({
        path: "test-results/mobile-preview.png",
        fullPage: true,
      });
  }
});

test("interrupted recording retains frames and source-frame scrubbing works before export", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(async () => (await sessions(page))[0]?.frames)
    .toBeGreaterThanOrEqual(2);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#notice")).toContainText("interrupted");
  await page.getByRole("button", { name: "My sessions", exact: false }).click();
  await page
    .getByRole("button", { name: "View time-lapse", exact: false })
    .click();
  const count = (await sessions(page))[0].frames;
  await page.locator("#filmstrip button").last().click();
  await expect(page.locator("#framePosition")).toHaveText(
    `Frame ${count} of ${count}`,
  );
  await expect(page.locator("#framePreview")).toBeVisible();
  await expect(page.locator("#download")).toBeHidden();
});

test("old two-second sessions remain viewable and export at the correct speed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "seagreen";
    ctx.fillRect(0, 0, 1280, 720);
    const blob = await new Promise((resolve) =>
      c.toBlob(resolve, "image/jpeg"),
    );
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("studyharder", 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["sessions", "frames"], "readwrite");
        tx.objectStore("sessions").put({
          id: "legacy",
          title: "Legacy session",
          created: Date.now(),
          elapsed: 6,
          frames: 3,
          status: "complete",
        });
        for (let i = 0; i < 3; i++)
          tx.objectStore("frames").put({ sessionId: "legacy", index: i, blob });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.getByRole("button", { name: "My sessions", exact: false }).click();
  await page
    .getByRole("button", { name: "View time-lapse", exact: false })
    .click();
  await page.locator("#filmstrip button").last().click();
  await expect(page.locator("#frameTime")).toHaveText("00:04");
  await page
    .getByRole("button", { name: "Create time-lapse", exact: true })
    .click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 20000 });
});

test("export can be cancelled without losing captured frames", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(async () => (await sessions(page))[0]?.frames)
    .toBeGreaterThanOrEqual(2);
  await page
    .getByRole("button", { name: "Finish session", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(page.locator("#exportStatus")).toContainText("Export cancelled");
  await expect(page.locator("#makeVideo")).toBeEnabled();
  expect((await sessions(page))[0].frames).toBeGreaterThanOrEqual(2);
});

test("storage failure stops capture while preserving previously saved frames", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(async () => (await sessions(page))[0]?.frames)
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (
        mode === "readwrite" &&
        Array.from(typeof stores === "string" ? [stores] : stores).includes(
          "frames",
        )
      )
        throw new DOMException("Test quota exceeded", "QuotaExceededError");
      return transaction.call(this, stores, mode, ...rest);
    };
  });
  await expect(page.locator("#notice")).toContainText(
    "browser storage could not save a frame",
  );
  await expect(page.locator("#download")).toBeVisible({ timeout: 20000 });
  const saved = (await sessions(page))[0];
  expect(saved.status).toBe("complete");
  expect(saved.frames).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#cameraStatus")).toHaveText("CAMERA OFF");
});

test("full storage still allows camera shutdown and export when final metadata cannot save", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(async () => (await sessions(page))[0]?.frames)
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (mode === "readwrite")
        throw new DOMException("Test full store", "QuotaExceededError");
      return transaction.call(this, stores, mode, ...rest);
    };
  });
  await expect(page.locator("#notice")).toContainText(
    "could not save the final details",
  );
  await expect(page.locator("#download")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#cameraStatus")).toHaveText("CAMERA OFF");
  expect((await sessions(page))[0].frames).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "My sessions", exact: false }),
  ).toBeEnabled();
});
