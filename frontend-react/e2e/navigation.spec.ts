import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp, replaceControlledInput} from "./helpers";

test("la hoja Más navega en móvil y devuelve el foco al cerrarse", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page);

  const more = page.locator(".bottom-nav").getByRole("button", {name: "Más"});
  await more.click();
  const sheet = page.getByRole("dialog", {name: "Más secciones"});
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", {name: /Ocultar importes|Mostrar importes/})).toHaveCount(0);
  await expect(sheet.locator('a[href="/exportar/excel/"]')).toHaveCount(0);
  await expect(page.locator(".app-header").getByRole("button", {name: /Ocultar importes|Mostrar importes/})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  await sheet.getByRole("button", {name: "Ajustes"}).click();
  await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.searchParams.get("tab") === "settings");
  await page.getByRole("button", {name: /^Datos y recuperación/}).click();
  await expect(page.getByRole("link", {name: "Descargar Excel"})).toHaveAttribute("href", "/exportar/excel/");
  await expect(page.getByRole("link", {name: "Descargar exportación portable"})).toHaveAttribute("href", "/api/recovery/export/");
  await expect(page.locator('a[href="/exportar/excel/"]')).toHaveCount(1);

  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=settings");
  const rail = page.locator(".desktop-rail");
  await expect(rail.getByRole("button", {name: "Ocultar importes"})).toBeVisible();
  await expect(rail.locator('a[href="/exportar/excel/"]')).toHaveCount(0);
  await page.getByRole("button", {name: /^Datos y recuperación/}).click();
  await expect(page.getByRole("link", {name: "Descargar Excel"})).toHaveAttribute("href", "/exportar/excel/");
  assertNoPageErrors();
});

test("el historial del navegador recorre las secciones operativas", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page);
  const navigation = page.getByRole("navigation", {name: "Navegación principal de escritorio"});

  await navigation.getByRole("button", {name: "Movimientos", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Añadir ingreso o gasto"})).toBeHidden();
  await page.goBack();
  await expect(page.getByRole("heading", {name: "Resumen", exact: true})).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Añadir ingreso o gasto"})).toBeHidden();
  assertNoPageErrors();
});

test("el alias de Automatizaciones conserva focus y rule al abrir Ajustes @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await page.route("**/api/category-rules/", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({rules: [{
      id: 27,
      description: "SUPERMERCADO E2E",
      kind: "expense",
      category: {id: 3, name: "comida", display_name: "Comida", kind: "expense"},
      active: true,
      updated_at: "2026-10-06T00:00:00Z",
      priority: 100,
      match_mode: "contains",
      account: null,
      amount_min: null,
      amount_max: null,
      last_tested_at: "",
      last_test_result: {},
      application_count: 0,
    }]})});
  });
  await openApp(page, "/?tab=automations&focus=new-rule&rule=27");
  await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "settings" && url.searchParams.get("focus") === "new-rule" && url.searchParams.get("rule") === "27");
  await expect(page.getByRole("textbox", {name: "Texto a reconocer"})).toBeFocused();
  assertNoPageErrors();
});

test("la confirmación de datos sin conexión devuelve el foco a su disparador", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=settings");
  await page.getByRole("button", {name: /^Datos y recuperación/}).click();
  const trigger = page.getByRole("button", {name: "Borrar datos sin conexión"});
  await trigger.click();
  const dialog = page.getByRole("dialog", {name: "¿Borrar datos sin conexión?"});
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", {name: "Cancelar"}).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  assertNoPageErrors();
});

test("el detalle de cuenta reconcilia un extracto y conserva su salto al ledger @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const bootstrap = await page.request.get("/api/bootstrap/");
  const account = (await bootstrap.json()).accounts.find((item: {name: string}) => item.name === "Cuenta diaria E2E");

  await openApp(page, `/?tab=accounts&account=${account.id}`);
  await expect(page.getByRole("heading", {name: "Cuenta diaria E2E", exact: true})).toBeVisible();
  await expect(page.getByText("Movimientos recientes")).toBeVisible();
  await replaceControlledInput(page.getByLabel("Fecha del extracto"), "2026-07-16");
  await replaceControlledInput(page.getByLabel("Saldo según el extracto"), "0.00");
  await page.getByRole("button", {name: "Comprobar saldo"}).click();
  await expect(page.getByText("Hay una diferencia pendiente de revisar.")).toBeVisible();
  await page.getByRole("button", {name: "Ver movimientos"}).click();
  await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("account") === String(account.id));
  await page.goBack();
  await expect(page.getByRole("heading", {name: "Cuenta diaria E2E", exact: true})).toBeVisible();
  assertNoPageErrors();
});
