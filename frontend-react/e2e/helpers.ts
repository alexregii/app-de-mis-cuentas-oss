import {expect, type Locator, type Page} from "playwright/test";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const resetE2eDatabase = (projectName: string) => {
  const apiPort = projectName === "chromium" ? 18000 : projectName === "webkit" ? 18001 : null;
  if (!apiPort) throw new Error(`Proyecto E2E no reconocido: ${projectName}`);
  const authTestMode = process.env.E2E_AUTH_MODE === "1" || process.env.E2E_AUTH_TEST_MODE === "1";
  const databasePrefix = authTestMode ? "auth-" : "";
  const databasePath = path.join(projectDir, ".e2e", `${databasePrefix}${projectName}.sqlite3`);
  const seedPath = path.join(projectDir, ".e2e", `${databasePrefix}${projectName}.seed.sqlite3`);
  const pythonDirectory = process.platform === "win32" ? "Scripts" : "bin";
  const pythonExecutable = process.platform === "win32" ? "python.exe" : "python";
  const python = path.join(projectDir, ".venv", pythonDirectory, pythonExecutable);
  try {
    execFileSync(python, [path.join(projectDir, "scripts", "reset_e2e_database.py"), databasePath, seedPath], {
      cwd: projectDir,
      env: {...process.env, E2E_TEST_MODE: "1"},
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ETIMEDOUT") {
      throw new Error(`El reset de la base E2E superó 10 s; posible lock activo: ${databasePath}`);
    }
    throw error;
  }
};

export const installPageErrorGuard = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "La página no debe emitir errores JavaScript").toEqual([]);
};

export const openApp = async (page: Page, path = "/") => {
  await page.goto(path);
  await expect(page.locator(".app-frame")).toBeVisible();
  await expect(page.getByText("Cargando la aplicación…")).toHaveCount(0);
};

export const focusMotionPairwiseStates = <T extends {width: number}>(viewports: readonly T[]) => {
  const mobile = viewports.find(({width}) => width <= 480);
  const desktop = viewports.find(({width}) => width > 480);
  if (!mobile || !desktop) throw new Error("La matriz pairwise requiere un viewport móvil y otro de escritorio.");
  return [
    {viewport: mobile, input: "teclado", reducedMotion: false},
    {viewport: mobile, input: "puntero", reducedMotion: true},
    {viewport: desktop, input: "teclado", reducedMotion: true},
    {viewport: desktop, input: "puntero", reducedMotion: false},
  ] as const;
};

export const waitForAppRefresh = (page: Page) => Promise.all([
  page.waitForResponse((response) => response.url().includes("/api/bootstrap/") && response.ok()),
  page.waitForResponse((response) => response.url().includes("/api/options/") && response.ok()),
]);

export async function replaceControlledInput(input: Locator, value: string) {
  await input.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", {bubbles: true}));
  }, value);
}
