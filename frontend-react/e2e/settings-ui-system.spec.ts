import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

for (const width of [320, 390, 1024, 1440]) {
  test("Ajustes organiza destinos y conserva accesibilidad a " + width + "px", {tag: ["@app-critical", width === 320 || width === 1024 ? "@chromium-only" : "@webkit-only"]}, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width, height: 900});
    await openApp(page, "/?tab=settings");

    const main = page.locator("#main-content");
    const settings = main.locator(".settings-view");
    const index = settings.locator(".settings-index");
    await expect(main.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
    await expect(index.getByRole("button", {name: /General/})).toBeVisible();
    await expect(index.getByRole("button", {name: /Clasificación/})).toBeVisible();
    await expect(index.getByRole("button", {name: /Importación/})).toBeVisible();
    await expect(index.getByRole("button", {name: /Datos y recuperación/})).toBeVisible();
    await expect(settings.locator('input[type="file"]')).toHaveCount(0);
    await expect(settings.getByLabel("Porcentaje")).toHaveCount(0);

    const rootGeometry = await page.evaluate(() => ({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(rootGeometry.documentWidth).toBeLessThanOrEqual(rootGeometry.viewportWidth);
    if (width === 390 || width === 1440) {
      await page.waitForTimeout(220);
      await page.screenshot({path: testInfo.outputPath("settings-index-" + width + ".png"), fullPage: true});
    }

    await index.getByRole("button", {name: /Clasificación/}).click();
    await expect(page).toHaveURL(/settings_section=classification/);
    await expect(settings.getByRole("heading", {name: "Categorías", exact: true})).toBeVisible();
    const createCategory = settings.getByRole("button", {name: "Nueva categoría", exact: true});
    await expect(createCategory).toBeVisible();
    await expect(settings.getByRole("heading", {name: "Nueva categoría", exact: true})).toHaveCount(0);
    await expect(settings.getByRole("region", {name: "Árbol de categorías"})).toBeVisible();
    await expect(settings.locator(".catalog-tree:visible")).toHaveCount(1);
    await page.goBack();
    await expect(index).toBeVisible();
    await page.goForward();
    await expect(settings.getByRole("heading", {name: "Categorías", exact: true})).toBeVisible();
    const categoryGeometry = await page.evaluate(() => ({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(categoryGeometry.documentWidth).toBeLessThanOrEqual(categoryGeometry.viewportWidth);
    if (width === 390 || width === 1440) {
      await page.waitForTimeout(220);
      await page.screenshot({path: testInfo.outputPath("settings-categories-" + width + ".png"), fullPage: true});
    }

    await createCategory.click();
    const categoryName = settings.getByLabel("Nombre", {exact: true});
    await expect(categoryName).toBeFocused();
    await categoryName.fill("Categoría borrador E2E");
    const categorySearch = settings.getByLabel("Buscar categorías");
    await categorySearch.fill("Vivienda");
    await settings.getByRole("button", {name: "Reglas y sugerencias", exact: true}).click();
    await expect(settings.getByLabel("IA para sugerencias")).toBeVisible();
    await settings.getByRole("button", {name: "Categorías", exact: true}).click();
    await expect(categoryName).toHaveValue("Categoría borrador E2E");
    await expect(categorySearch).toHaveValue("Vivienda");

    await settings.getByRole("button", {name: "Reglas y sugerencias", exact: true}).click();
    await expect(settings.getByLabel("IA para sugerencias")).toBeVisible();
    await expect(settings.getByLabel("Autoaplicar sugerencias de IA")).toBeVisible();
    await expect(settings.getByRole("heading", {name: "Control"})).toHaveCount(0);
    await expect(settings.locator(".automation-control-stats")).toHaveCount(0);
    expect(await settings.locator(".catalog-tree:visible").count()).toBe(0);
    const rulesGeometry = await page.evaluate(() => ({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(rulesGeometry.documentWidth).toBeLessThanOrEqual(rulesGeometry.viewportWidth);
    if (width === 390 || width === 1440) {
      await page.waitForTimeout(220);
      await page.screenshot({path: testInfo.outputPath("settings-rules-" + width + ".png"), fullPage: true});
    }

    const ruleDisclosure = settings.getByRole("button", {name: "Expandir nueva regla"});
    await ruleDisclosure.click();
    const ruleDescription = settings.getByLabel("Texto a reconocer");
    await ruleDescription.fill("Borrador de regla E2E");

    await settings.getByRole("button", {name: "Volver a Ajustes"}).click();
    await expect(settings.locator(".settings-index")).toBeVisible();
    await expect(settings.locator('.settings-index-link[data-settings-index-section="classification"]')).toBeFocused();
    await index.getByRole("button", {name: /Clasificación/}).click();
    await expect(categoryName).toHaveValue("Categoría borrador E2E");
    await expect(categorySearch).toHaveValue("Vivienda");
    await settings.getByRole("button", {name: "Reglas y sugerencias", exact: true}).click();
    await expect(settings.getByLabel("IA para sugerencias")).toBeVisible();
    await ruleDisclosure.click();
    await expect(ruleDescription).toHaveValue("Borrador de regla E2E");

    await settings.getByRole("button", {name: "Volver a Ajustes"}).click();
    await expect(settings.locator(".settings-index")).toBeVisible();

    await settings.locator(".settings-index").getByRole("button", {name: /Importación/}).click();
    await expect(settings.getByRole("button", {name: /perfiles csv/i})).toBeVisible();
    await expect(settings.locator('input[type="file"]')).toHaveCount(0);
    const importsGeometry = await page.evaluate(() => ({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(importsGeometry.documentWidth).toBeLessThanOrEqual(importsGeometry.viewportWidth);
    if (width === 390 || width === 1440) {
      await page.waitForTimeout(220);
      await page.screenshot({path: testInfo.outputPath("settings-import-profiles-" + width + ".png"), fullPage: true});
    }
    const importSection = settings.getByRole("region", {name: "Importación"});
    await importSection.getByRole("button", {name: /Expandir perfiles csv/i}).click();
    const profileName = importSection.getByLabel("Nombre");
    await profileName.fill("Perfil borrador E2E");
    await settings.getByRole("button", {name: "Volver a Ajustes"}).click();
    await settings.locator(".settings-index").getByRole("button", {name: /Importación/}).click();
    await expect(profileName).toHaveValue("Perfil borrador E2E");

    assertNoPageErrors();
  });
}

test("Ajustes legacy de Automatizaciones sin parámetros abre el índice @chromium-only", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/?tab=automations");
  await expect(page).toHaveURL(/tab=settings/);
  await expect(page.locator(".settings-index")).toBeVisible();
  await expect(page.getByRole("button", {name: /Clasificación/})).toBeVisible();
});

test("la preview de desactivación conserva el foco con click de puntero @webkit-only", async ({page}) => {
  await page.setViewportSize({width: 1024, height: 900});
  await openApp(page, "/?tab=settings&settings_section=classification");
  const categoryRow = page.locator('.catalog-row').filter({hasText: "Comida E2E"});
  const menuTrigger = categoryRow.getByRole("button", {name: "Acciones de Comida E2E"});
  await menuTrigger.click();

  let releasePreview!: () => void;
  let announcePreviewStarted!: () => void;
  const previewStarted = new Promise<void>((resolve) => {announcePreviewStarted = resolve;});
  const previewResponse = new Promise<void>((resolve) => {releasePreview = resolve;});
  await page.route("**/api/categories/3/preview-deactivate/", async (route) => {
    announcePreviewStarted();
    await previewResponse;
    await route.fulfill({json: {ok: true, impact: {transactions: 16, budgets: 0, rules: 0, imports: 0}}});
  });

  const deactivate = categoryRow.getByRole("button", {name: "Desactivar", exact: true});
  await deactivate.click();
  await previewStarted;
  const pending = categoryRow.getByRole("button", {name: "Calculando impacto"});
  await expect(pending).toBeFocused();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await expect(pending).toHaveAttribute("aria-disabled", "true");

  releasePreview();
  await expect(categoryRow.getByText("Desactivar «Comida E2E»?")).toBeVisible();
  await expect(menuTrigger).toBeFocused();
  await expect(categoryRow.getByText("16 movimientos · 0 presupuestos · 0 reglas · 0 importaciones")).toBeVisible();
});
