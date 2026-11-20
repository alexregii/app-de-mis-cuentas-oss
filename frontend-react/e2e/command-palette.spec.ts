import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

test("Ctrl+K busca un movimiento y abre su deep link canónico @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=transactions&q=hola+caracola");

  const transactionsSearch = page.getByRole("searchbox");
  await expect(transactionsSearch).toHaveValue("hola caracola");

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {name: "Buscar y ejecutar"});
  await expect(dialog).toBeVisible();
  const search = dialog.getByPlaceholder("Buscar movimientos, cuentas, categorías…");
  await search.fill("supermercado");
  const result = dialog.getByRole("option", {name: /Compra supermercado E2E/}).first();
  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL((url) => (
    url.pathname === "/"
    && url.searchParams.get("tab") === "transactions"
    && url.searchParams.get("q") === "Compra supermercado E2E"
  ));
  await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toBeVisible();
  await expect(transactionsSearch).toHaveValue("Compra supermercado E2E");
  assertNoPageErrors();
});

test("Ctrl+K abre la categoría exacta y atrás/adelante restauran origen, consulta y foco", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const sourceUrl = "/?tab=transactions&kind=expense&month=2026-07";
  const searchTerm = "Comida E2E";
  await openApp(page, sourceUrl);

  const response = await page.request.get(`/api/search/?q=${encodeURIComponent(searchTerm)}`);
  const payload = await response.json();
  const category = payload.groups.find((group: {id: string}) => group.id === "categories")?.items[0];
  expect(category?.id).toMatch(/^category:\d+$/);
  const categoryId = Number(category.id.slice("category:".length));

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {name: "Buscar y ejecutar"});
  const search = dialog.getByPlaceholder("Buscar movimientos, cuentas, categorías…");
  await search.fill(searchTerm);
  const sourceAtSelection = page.url();
  await dialog.getByRole("option", {name: /Comida E2E/}).click();

  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "settings"
    && url.searchParams.get("settings_section") === "classification"
    && url.searchParams.get("category") === String(categoryId)
    && !url.searchParams.has("q"));
  expect(page.url()).not.toContain(searchTerm);
  const row = page.locator(`.catalog-row[data-category-id="${categoryId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "location");
  await expect(row).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL((url) => url.pathname === new URL(sourceAtSelection).pathname
    && url.searchParams.get("tab") === "transactions"
    && url.searchParams.get("kind") === "expense"
    && url.searchParams.get("month") === "2026-07");
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue(searchTerm);
  await expect(search).toBeFocused();

  await page.goForward();
  await expect(page).toHaveURL((url) => url.searchParams.get("category") === String(categoryId));
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  assertNoPageErrors();
});

test("el historial conserva cada búsqueda al encadenar categorías y volver a avanzar @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const sourceUrl = "/?tab=transactions&kind=expense&month=2026-07";
  await openApp(page, sourceUrl);

  const findCategory = async (term: string) => {
    const response = await page.request.get(`/api/search/?q=${encodeURIComponent(term)}`);
    const payload = await response.json();
    const item = payload.groups.find((group: {id: string}) => group.id === "categories")?.items[0] as {id: string; title: string} | undefined;
    expect(item?.id).toMatch(/^category:\d+$/);
    return {id: Number(item!.id.slice("category:".length)), title: item!.title};
  };
  const selectCategory = async (title: string) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", {name: "Buscar y ejecutar"});
    const search = dialog.getByPlaceholder("Buscar movimientos, cuentas, categorías…");
    await search.fill(title);
    const result = dialog.getByRole("option", {name: new RegExp(title)}).first();
    await expect(result).toBeVisible();
    await result.click();
  };

  const categoryB = await findCategory("Comida E2E");
  const categoryC = await findCategory("Vivienda E2E");
  const rowB = page.locator(`.catalog-row[data-category-id="${categoryB.id}"]`);
  const rowC = page.locator(`.catalog-row[data-category-id="${categoryC.id}"]`);

  await selectCategory(categoryB.title);
  await expect(rowB).toBeFocused();
  await selectCategory(categoryC.title);
  await expect(rowC).toBeFocused();
  const dialog = page.getByRole("dialog", {name: "Buscar y ejecutar"});
  const search = dialog.getByPlaceholder("Buscar movimientos, cuentas, categorías…");
  const state = await page.evaluate(() => JSON.stringify(window.history.state));
  expect(state).not.toContain("Comida E2E");
  expect(state).not.toContain("Vivienda E2E");
  expect(page.url()).not.toContain("Comida E2E");
  expect(page.url()).not.toContain("Vivienda E2E");

  await page.goBack();
  await expect(page).toHaveURL((url) => url.searchParams.get("category") === String(categoryB.id));
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue(categoryC.title);
  await expect(search).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "transactions"
    && url.searchParams.get("kind") === "expense"
    && url.searchParams.get("month") === "2026-07");
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue(categoryB.title);
  await expect(search).toBeFocused();

  await page.goForward();
  await expect(page).toHaveURL((url) => url.searchParams.get("category") === String(categoryB.id));
  await expect(dialog).toBeHidden();
  await expect(rowB).toBeFocused();

  await page.goForward();
  await expect(page).toHaveURL((url) => url.searchParams.get("category") === String(categoryC.id));
  await expect(dialog).toBeHidden();
  await expect(rowC).toBeFocused();
  assertNoPageErrors();
});

test("buscar la categoría abierta conserva entradas distintas aunque la URL se repita @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const term = "Comida E2E";
  const response = await page.request.get(`/api/search/?q=${encodeURIComponent(term)}`);
  const payload = await response.json();
  const item = payload.groups.find((group: {id: string}) => group.id === "categories")?.items[0] as {id: string; title: string} | undefined;
  expect(item?.id).toMatch(/^category:\d+$/);
  const categoryId = Number(item!.id.slice("category:".length));
  const categoryUrl = `/?settings_section=classification&category=${categoryId}&tab=settings`;
  const isCategoryUrl = (url: URL) => url.searchParams.get("tab") === "settings"
    && url.searchParams.get("settings_section") === "classification"
    && url.searchParams.get("category") === String(categoryId);
  const row = page.locator(`.catalog-row[data-category-id="${categoryId}"]`);
  await openApp(page, categoryUrl);
  await expect(row).toBeFocused();
  const originalUrl = page.url();

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {name: "Buscar y ejecutar"});
  const search = dialog.getByPlaceholder("Buscar movimientos, cuentas, categorías…");
  await search.fill(term);
  await dialog.getByRole("option", {name: new RegExp(item!.title)}).first().click();
  await expect(page).toHaveURL(isCategoryUrl);
  expect(page.url()).toBe(originalUrl);
  const state = await page.evaluate(() => JSON.stringify(window.history.state));
  expect(state).not.toContain(term);

  await page.goBack();
  await expect(page).toHaveURL(isCategoryUrl);
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue(term);
  await expect(search).toBeFocused();

  await page.goForward();
  await expect(page).toHaveURL(isCategoryUrl);
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  assertNoPageErrors();
});

test("el deep link de categoría inactiva preserva borradores y filtro del catálogo @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const sourceUrl = "/?tab=settings&settings_section=classification";
  const categoryName = `Archivada E2E ${Date.now()}`;
  await openApp(page, sourceUrl);
  const csrfToken = (await page.context().cookies()).find((cookie) => cookie.name === "csrftoken")?.value;
  expect(csrfToken).toBeTruthy();
  const created = await page.request.post(`${new URL(page.url()).origin}/api/categories/`, {
    headers: {"X-CSRFToken": csrfToken!},
    data: {name: categoryName, kind: "expense", parent: "", color: "#777777", icon: "", active: false, exclude_from_analytics: false},
  });
  expect(created.status()).toBe(201);
  const categoryId = (await created.json()).category.id as number;

  const settings = page.locator(".settings-view");
  await settings.getByRole("button", {name: "Nueva categoría", exact: true}).click();
  const draft = settings.getByLabel("Nombre", {exact: true});
  await draft.fill("Borrador pendiente E2E");
  const catalogSearch = settings.getByLabel("Buscar categorías");
  await catalogSearch.fill("Vivienda E2E");

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {name: "Buscar y ejecutar"});
  const search = dialog.getByPlaceholder("Buscar movimientos, cuentas, categorías…");
  await search.fill(categoryName);
  await dialog.getByRole("option", {name: new RegExp(categoryName)}).click();

  await expect(page).toHaveURL((url) => url.searchParams.get("category") === String(categoryId)
    && url.searchParams.get("tab") === "settings"
    && !url.searchParams.has("q"));
  expect(page.url()).not.toContain(categoryName);
  const row = page.locator(`.catalog-row[data-category-id="${categoryId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "location");
  await expect(row).toBeFocused();
  await expect(row).toContainText("Inactiva");
  await expect(draft).toHaveValue("Borrador pendiente E2E");
  await expect(catalogSearch).toHaveValue("Vivienda E2E");

  await page.goBack();
  await expect(page).toHaveURL(sourceUrl);
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue(categoryName);
  await expect(search).toBeFocused();
  await expect(draft).toHaveValue("Borrador pendiente E2E");
  await expect(catalogSearch).toHaveValue("Vivienda E2E");

  await page.goForward();
  await expect(page).toHaveURL((url) => url.searchParams.get("category") === String(categoryId));
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect(draft).toHaveValue("Borrador pendiente E2E");
  assertNoPageErrors();
});

test("un ID de categoría inexistente ofrece una salida accionable @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=settings&settings_section=classification&category=999999");
  await expect(page.getByText("No se encontró esa categoría.")).toBeVisible();
  await page.getByRole("button", {name: "Volver al catálogo"}).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "settings"
    && url.searchParams.get("settings_section") === "classification"
    && !url.searchParams.has("category"));
  await expect(page.getByLabel("Buscar categorías")).toBeVisible();
  assertNoPageErrors();
});
