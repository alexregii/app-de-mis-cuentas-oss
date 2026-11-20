import {expect, test, type Page} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

type ActivationState = {
  has_active_account: boolean;
  has_reviewed_movement: boolean;
  pending_review_count: number;
  has_savings_objective: boolean;
  distinct_activity_months: number;
  is_mature: boolean;
  time_to_first_reviewed_movement_seconds: number | null;
};

type BootstrapFixture = {
  activation?: ActivationState;
  accounts: unknown[];
  recent: unknown[];
  review_queue: unknown[];
  dashboard: Record<string, unknown>;
  metrics: Record<string, unknown>;
  review: Record<string, unknown>;
  [key: string]: unknown;
};

async function showActivationState(page: Page, activation: ActivationState, options: {emptyLedger?: boolean} = {}) {
  const {emptyLedger = false} = options;
  const original = await page.request.get("/api/bootstrap/");
  const source = await original.json() as BootstrapFixture;
  const dashboard = source.dashboard || {};
  const payload = emptyLedger ? {
    ...source,
    activation,
    accounts: [],
    recent: [],
    review_queue: [],
    dashboard: {...dashboard, account_balances: [], priority_tasks: [], bank_errors: []},
    metrics: {...source.metrics, total_balance: 0, income: 0, expense: 0, net_savings: 0},
    review: {...source.review, has_pending_review: false, total_pending_count: 0},
  } : {...source, activation};
  const headers: Record<string, string> = {"content-type": "application/json"};
  const csrfCookie = original.headers()["set-cookie"];
  if (csrfCookie) headers["set-cookie"] = csrfCookie;
  await page.route("**/api/bootstrap/", (route) => route.fulfill({
    status: 200,
    headers,
    body: JSON.stringify(payload),
  }));
}

const empty: ActivationState = {
  has_active_account: false,
  has_reviewed_movement: false,
  pending_review_count: 0,
  has_savings_objective: false,
  distinct_activity_months: 0,
  is_mature: false,
  time_to_first_reviewed_movement_seconds: null,
};

test("instalación vacía ofrece una cuenta accesible por teclado", async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await showActivationState(page, empty, {emptyLedger: true});
  await openApp(page, "/");

  const guide = page.locator(".dashboard-activation");
  await expect(guide.getByRole("heading", {name: "Primeros pasos"})).toBeVisible();
  await expect(guide.getByText("0 de 3 pasos completados")).toBeVisible();
  const geometry = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth}));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  await expect(guide.getByRole("button", {name: "Añadir o activar una cuenta"})).toHaveCSS("min-height", "44px");
  await guide.screenshot({path: testInfo.outputPath("activation-mobile.png")});
  await page.screenshot({path: testInfo.outputPath("activation-mobile-page.png")});
  const addAccount = guide.getByRole("button", {name: "Añadir o activar una cuenta"});
  await addAccount.focus();
  await expect(addAccount).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/tab=accounts/);
  await expect(page.getByRole("button", {name: /Añadir cuenta/})).toBeVisible();
  assertNoPageErrors();
});

test("el primer movimiento abre el formulario manual desde el resumen @chromium-only", async ({page}, testInfo) => {
  await showActivationState(page, {...empty, has_active_account: true});
  await openApp(page, "/");
  const guide = page.locator(".dashboard-activation");
  await guide.screenshot({path: testInfo.outputPath("activation-desktop.png")});
  await guide.getByRole("button", {name: "Añadir mi primer movimiento"}).click();

  await expect(page).toHaveURL(/tab=transactions/);
  await expect(page.getByRole("heading", {name: "Añadir ingreso o gasto"})).toBeVisible();
});

test("movimientos pendientes llevan a Review sin marcar el primer movimiento como revisado @chromium-only", async ({page}) => {
  await showActivationState(page, {...empty, has_active_account: true, pending_review_count: 2});
  await openApp(page, "/");

  const guide = page.locator(".dashboard-activation");
  await expect(guide.getByText("2 movimientos pendientes por revisar")).toBeVisible();
  await guide.getByRole("button", {name: "Revisar movimientos"}).click();
  await expect(page).toHaveURL(/tab=review/);
});

test("el primer objetivo abre su formulario, y las instalaciones maduras no reciben guía @chromium-only", async ({page}) => {
  const withMovement = {...empty, has_active_account: true, has_reviewed_movement: true, distinct_activity_months: 1, time_to_first_reviewed_movement_seconds: 12};
  await showActivationState(page, withMovement);
  await openApp(page, "/");
  const guide = page.locator(".dashboard-activation");
  await expect(guide.getByRole("button", {name: "Crear un objetivo de ahorro"})).toBeVisible();
  await guide.getByRole("button", {name: "Crear un objetivo de ahorro"}).click();

  await expect(page).toHaveURL(/tab=planning#planning-objective-create$/);
  const disclosure = page.locator("details.planning-objective-create");
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(disclosure.locator('input[name="name"]')).toBeFocused();

  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveJSProperty("open", false);
  await page.goBack();
  await expect(page.locator(".dashboard-activation")).toBeVisible();
  await page.locator(".dashboard-activation").getByRole("button", {name: "Crear un objetivo de ahorro"}).click();
  await expect(page).toHaveURL(/tab=planning#planning-objective-create$/);
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(disclosure.locator('input[name="name"]')).toBeFocused();

  await page.goto("/");
  await showActivationState(page, {...withMovement, is_mature: true, distinct_activity_months: 3});
  await page.reload();
  await expect(page.getByRole("heading", {name: "Primeros pasos"})).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("sin conexión el estado de error no inventa pasos ni bloquea la recuperación @chromium-only", async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", {configurable: true, value: false}));
  await page.route("**/api/bootstrap/", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({error: "Bootstrap temporalmente no disponible."}),
  }));
  await page.goto("/");

  await expect(page.getByRole("heading", {name: "Sin conexión y sin datos recientes"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Reintentar"})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Primeros pasos"})).toHaveCount(0);
});

test("ocultar la guía usa la preferencia Dashboard persistente @chromium-only", async ({page}) => {
  await showActivationState(page, {...empty, has_active_account: true});
  await openApp(page, "/");
  const savedPreferences = page.waitForResponse((response) =>
    response.url().includes("/api/dashboard/preferences/") && response.request().method() === "PUT" && response.ok(),
  );
  const hideGuide = page.locator(".dashboard-activation").getByRole("button", {name: "Ocultar guía"});
  await hideGuide.focus();
  await page.keyboard.press("Enter");
  await savedPreferences;
  await expect(page.getByRole("button", {name: "Personalizar"})).toBeFocused();
  await expect(page.getByRole("heading", {name: "Primeros pasos"})).toHaveCount(0);
  const saved = await page.request.get("/api/dashboard/preferences/");
  expect((await saved.json()).preferences.hidden_widgets).toContain("activation");
  await page.unroute("**/api/bootstrap/");
  const refreshedBootstrap = page.waitForResponse((response) => response.url().includes("/api/bootstrap/") && response.ok());
  await page.reload();
  await refreshedBootstrap;
  await expect(page.getByRole("heading", {name: "Primeros pasos"})).toHaveCount(0);
});
