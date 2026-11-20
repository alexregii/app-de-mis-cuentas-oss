import {defineConfig} from "playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(frontendDir, "..");
const e2eDir = path.join(projectDir, ".e2e");
const databasePath = path.join(e2eDir, "playwright-charts.sqlite3");
const pythonExecutable = path.join(projectDir, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python" + (process.platform === "win32" ? ".exe" : ""));
const pythonCommand = `"${pythonExecutable}"`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "chart-engines.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {timeout: 10_000},
  outputDir: path.join(e2eDir, "chart-results"),
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:15174",
    browserName: "chromium",
    colorScheme: "light",
    locale: "es-ES",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${pythonCommand} -c "from pathlib import Path; Path('.e2e').mkdir(exist_ok=True)" && ${pythonCommand} manage.py migrate --noinput && ${pythonCommand} manage.py seed_e2e && ${pythonCommand} manage.py runserver 127.0.0.1:18002 --noreload`,
      cwd: projectDir,
      env: {
        ...process.env,
        E2E_TEST_MODE: "1",
        DATABASE_PATH: databasePath,
        MEDIA_ROOT: path.join(e2eDir, "charts-media"),
        DJANGO_ALLOWED_HOSTS: "localhost,127.0.0.1",
        DJANGO_CSRF_TRUSTED_ORIGINS: "http://127.0.0.1:15174,http://127.0.0.1:8445,http://127.0.0.1:8446",
        DJANGO_DEBUG: "1",
      },
      url: "http://127.0.0.1:18002/api/bootstrap/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run preview -- --host 127.0.0.1 --port 15174 --strictPort",
      cwd: frontendDir,
      env: {...process.env, VITE_API_TARGET: "http://127.0.0.1:18002"},
      url: "http://127.0.0.1:15174/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run preview -- --host 127.0.0.1 --port 8445 --strictPort",
      cwd: frontendDir,
      env: {...process.env, VITE_API_TARGET: "http://127.0.0.1:18002"},
      url: "http://127.0.0.1:8445/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run preview -- --host 127.0.0.1 --port 8446 --strictPort",
      cwd: frontendDir,
      env: {...process.env, VITE_API_TARGET: "http://127.0.0.1:18002"},
      url: "http://127.0.0.1:8446/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
