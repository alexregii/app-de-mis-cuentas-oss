import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp, replaceControlledInput} from "./helpers";

test("guarda, reabre, renombra y elimina vistas de movimientos sin mutar el ledger @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/?tab=transactions");
  await expect(page.locator(".transactions-page")).toHaveAttribute("data-screen-ready", "true");

  const mutations: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await replaceControlledInput(search, "vista-guardada-e2e-a");
  await page.waitForURL((url) => url.searchParams.get("q") === "vista-guardada-e2e-a");
  const saveButton = page.getByRole("button", {name: "Guardar filtros actuales"});
  await saveButton.scrollIntoViewIfNeeded();
  const scrollBeforeEditor = await page.evaluate(() => window.scrollY);
  await saveButton.click();
  const name = page.getByRole("textbox", {name: "Nombre de la vista"});
  await expect(name).toBeFocused();
  const scrollAtEditor = await page.evaluate(() => window.scrollY);
  expect(scrollAtEditor).toBe(scrollBeforeEditor);
  await name.press("Escape");
  await expect(saveButton).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollAtEditor);

  await saveButton.click();
  await name.fill("Revisión mensual");
  await name.press("Enter");
  const selector = page.getByRole("combobox", {name: "Vistas guardadas"});
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("miscuentas.session.transactions.saved-views.v1") || "null"));
  expect(saved.version).toBe(1);
  expect(saved.views[0].filters.query).toBe("vista-guardada-e2e-a");
  expect(JSON.stringify(saved)).not.toMatch(/"amount"|"results"|"summary"|"total"/i);
  const savedId = saved.views[0].id as string;
  await expect(selector).toHaveValue(savedId);
  await page.reload();
  await expect(page.locator(".transactions-page")).toHaveAttribute("data-screen-ready", "true");
  await expect(selector.locator(`option[value="${savedId}"]`)).toHaveText("Revisión mensual");
  await selector.selectOption(savedId);

  await replaceControlledInput(search, "vista-guardada-e2e-b");
  await page.waitForURL((url) => url.searchParams.get("q") === "vista-guardada-e2e-b");
  const restoredQuery = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/transactions/" && response.request().method() === "GET" && url.searchParams.get("q") === "vista-guardada-e2e-a";
  });
  await page.getByRole("button", {name: "Abrir vista"}).click();
  await page.waitForURL((url) => url.searchParams.get("q") === "vista-guardada-e2e-a");
  const restoredResponse = await restoredQuery;
  expect(new URL(restoredResponse.url()).searchParams.get("q")).toBe("vista-guardada-e2e-a");
  await expect(search).toHaveValue("vista-guardada-e2e-a");

  await page.goBack();
  await expect(search).toHaveValue("vista-guardada-e2e-b");
  await page.goForward();
  await expect(search).toHaveValue("vista-guardada-e2e-a");

  await page.getByRole("button", {name: "Renombrar"}).click();
  const rename = page.getByRole("textbox", {name: "Nombre de la vista"});
  await rename.fill("Cierre de mes");
  await rename.press("Enter");
  await expect(selector.locator("option:checked")).toHaveText("Cierre de mes");

  await page.getByRole("button", {name: "Eliminar vista"}).click();
  await expect(selector).toHaveValue("");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("miscuentas.session.transactions.saved-views.v1") || "{\"views\":[]}"))).toMatchObject({views: []});
  expect(mutations).toEqual([]);
  assertNoPageErrors();
});

test("abrir una vista sin filtros limpia el estado anterior y reinicia la página @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=transactions&q=filtro-inicial&page=3");
  await expect(page.locator(".transactions-page")).toHaveAttribute("data-screen-ready", "true");
  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await expect(search).toHaveValue("filtro-inicial");
  await page.getByRole("button", {name: "Limpiar", exact: true}).click();
  await expect(search).toHaveValue("");

  await page.getByRole("button", {name: "Guardar filtros actuales"}).click();
  const name = page.getByRole("textbox", {name: "Nombre de la vista"});
  await name.fill("Todos los movimientos");
  await name.press("Enter");
  await replaceControlledInput(search, "filtro-nuevo");
  await page.waitForURL((url) => url.searchParams.get("q") === "filtro-nuevo");

  const resetRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/transactions/" && response.request().method() === "GET" && !url.searchParams.has("q") && url.searchParams.get("page") === "1";
  });
  await page.getByRole("button", {name: "Abrir vista"}).click();
  await resetRequest;
  await expect(search).toHaveValue("");
  await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get("q"))).toBeNull();
  await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get("page"))).toBe("1");
  await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get("analytics"))).toBe("all");
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.goBack();
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get("q"))).toBe("filtro-nuevo");
    await expect(search).toHaveValue("filtro-nuevo");
    await page.goForward();
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get("q"))).toBeNull();
    await expect(search).toHaveValue("");
  }
  assertNoPageErrors();
});
