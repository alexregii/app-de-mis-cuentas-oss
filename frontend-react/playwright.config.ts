import {defineConfig} from "playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(frontendDir, "..");
const e2eDir = path.join(projectDir, ".e2e");
const pythonExecutable = path.join(projectDir, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python" + (process.platform === "win32" ? ".exe" : ""));
const pythonCommand = `"${pythonExecutable}"`;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
const snapshotSet = process.env.E2E_SNAPSHOT_SET;
const authTestMode = process.env.E2E_AUTH_MODE === "1";

function backendServer({databaseFile, apiPort, frontendPort}: {databaseFile: string; apiPort: number; frontendPort: number}) {
  const seedDatabaseFile = databaseFile.replace(/\.sqlite3$/i, ".seed.sqlite3");
  return {
    command: `${pythonCommand} -c "from pathlib import Path; Path('.e2e').mkdir(exist_ok=True)" && ${pythonCommand} manage.py migrate --noinput && ${pythonCommand} manage.py seed_e2e && ${pythonCommand} -c "import os, shutil; shutil.copyfile(os.environ['DATABASE_PATH'], os.environ['E2E_SEED_DATABASE_PATH'])" && ${pythonCommand} manage.py runserver 127.0.0.1:${apiPort} --noreload`,
    cwd: projectDir,
    env: {
      ...process.env,
      E2E_TEST_MODE: "1",
      E2E_AUTH_TEST_MODE: authTestMode ? "1" : "0",
      DJANGO_REQUIRE_AUTH: authTestMode ? "1" : "0",
      DATABASE_PATH: path.join(e2eDir, databaseFile),
      MEDIA_ROOT: path.join(e2eDir, `${authTestMode ? "auth-media" : "media"}-${apiPort}`),
      DJANGO_ALLOWED_HOSTS: "localhost,127.0.0.1",
      DJANGO_CSRF_TRUSTED_ORIGINS: `http://127.0.0.1:${frontendPort}`,
      DJANGO_DEBUG: "1",
      E2E_SEED_DATABASE_PATH: path.join(e2eDir, seedDatabaseFile),
    },
    url: `http://127.0.0.1:${apiPort}/api/auth/session/`,
    reuseExistingServer: false,
    timeout: 60_000,
  };
}

function frontendServer({apiPort, frontendPort}: {apiPort: number; frontendPort: number}) {
  return {
    command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
    cwd: frontendDir,
    env: {
      ...process.env,
      VITE_API_TARGET: `http://127.0.0.1:${apiPort}`,
    },
    url: `http://127.0.0.1:${frontendPort}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  };
}

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [/ui-lab-.*\.spec\.ts/, /chart-engines\.spec\.ts/, ...(authTestMode ? [] : [/auth\.spec\.ts/])],
  fullyParallel: false,
  workers: 1,
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
  snapshotPathTemplate: snapshotSet ? `{testDir}/screenshots/${snapshotSet}/{arg}{ext}` : "{testDir}/screenshots/{arg}{ext}",
  reporter: process.env.CI ? [["line"], ["html", {outputFolder: path.join(e2eDir, "report"), open: "never"}]] : "line",
  use: {
    baseURL: "http://127.0.0.1:15173",
    browserName: "chromium",
    colorScheme: "light",
    locale: "es-ES",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {name: "chromium", grepInvert: /@webkit-only/, use: {browserName: "chromium", baseURL: "http://127.0.0.1:15173", ...(browserChannel ? {channel: browserChannel} : {})}},
    {name: "webkit", grepInvert: /@chromium-only/, use: {browserName: "webkit", baseURL: "http://127.0.0.1:15174"}},
  ],
  webServer: [
    backendServer({databaseFile: authTestMode ? "auth-chromium.sqlite3" : "chromium.sqlite3", apiPort: 18000, frontendPort: 15173}),
    frontendServer({apiPort: 18000, frontendPort: 15173}),
    backendServer({databaseFile: authTestMode ? "auth-webkit.sqlite3" : "webkit.sqlite3", apiPort: 18001, frontendPort: 15174}),
    frontendServer({apiPort: 18001, frontendPort: 15174}),
  ],
});
