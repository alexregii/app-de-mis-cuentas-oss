import {defineConfig} from "playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(frontendDir, "..");
const e2eDir = path.join(projectDir, ".e2e-ui-lab");
const baseURL = process.env.UI_LAB_BASE_URL ?? "http://127.0.0.1:15173";
const requestedWorkers = Number(process.env.UI_LAB_WORKERS ?? 2);
const workers = Number.isInteger(requestedWorkers) && requestedWorkers > 0 ? requestedWorkers : 2;
const isCI = Boolean(process.env.CI);
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /ui-lab-.*\.spec\.ts/,
  fullyParallel: true,
  workers,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
      scale: "css",
    },
  },
  outputDir: path.join(e2eDir, "results"),
  snapshotPathTemplate: "{testDir}/screenshots/{arg}{ext}",
  reporter: process.env.CI ? [["line"], ["html", {outputFolder: path.join(e2eDir, "report"), open: "never"}]] : "line",
  use: {
    baseURL,
    colorScheme: "light",
    locale: "es-ES",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {name: "chromium", use: {browserName: "chromium", ...(browserChannel ? {channel: browserChannel} : {})}},
    {name: "webkit", use: {browserName: "webkit"}},
  ],
  webServer: process.env.UI_LAB_BASE_URL ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 15173",
    cwd: frontendDir,
    env: {...process.env},
    url: "http://127.0.0.1:15173/ui-lab.html",
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
