const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.js",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "python3 tests/serve.py",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
  },
});
