import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

const visiblePrimaryLabels = [
  {visible: "Resumen", accessible: "Resumen"},
  {visible: "Movimientos", accessible: "Movimientos"},
  {visible: "Revisión", accessible: "Revisión"},
  {visible: "Estad.", accessible: "Estadísticas"},
] as const;

test("la navegación móvil conserva labels legibles, nombres completos y targets táctiles", async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const nav = page.locator(".bottom-nav");

  for (const width of [320, 390, 448, 449]) {
    await page.setViewportSize({width, height: 844});
    await openApp(page);
    await expect(nav).toBeVisible();
    await page.screenshot({path: testInfo.outputPath(`mobile-navigation-${width}.png`), animations: "disabled"});

    const documentWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    expect(documentWidth, `la vista de ${width}px no debe desbordarse`).toBeLessThanOrEqual(width);

    for (const label of visiblePrimaryLabels) {
      const button = nav.locator("button").filter({hasText: label.visible}).first();
      await expect(button).toBeVisible();
      const metrics = await button.evaluate((element) => {
        const button = element.getBoundingClientRect();
        const label = element.querySelector("span")!;
        const labelRect = label.getBoundingClientRect();
        const style = getComputedStyle(label);
        return {
          buttonWidth: button.width,
          buttonHeight: button.height,
          labelScrollWidth: label.scrollWidth,
          labelClientWidth: label.clientWidth,
          labelLeft: labelRect.left,
          labelRight: labelRect.right,
          buttonLeft: button.left,
          buttonRight: button.right,
          textOverflow: style.textOverflow,
        };
      });
      expect.soft(metrics.buttonWidth, `${label.accessible} a ${width}px`).toBeGreaterThanOrEqual(44);
      expect.soft(metrics.buttonHeight, `${label.accessible} a ${width}px`).toBeGreaterThanOrEqual(44);
      expect.soft(metrics.labelScrollWidth, `${label.accessible} no debe truncarse a ${width}px`).toBeLessThanOrEqual(metrics.labelClientWidth);
      expect.soft(metrics.textOverflow, `${label.accessible} no debe depender de elipsis`).toBe("clip");
      expect.soft(metrics.labelLeft).toBeGreaterThanOrEqual(metrics.buttonLeft);
      expect.soft(metrics.labelRight).toBeLessThanOrEqual(metrics.buttonRight);
      expect.soft(await button.getAttribute("aria-label"), `${label.visible} debe publicar su nombre accesible completo`).toBe(label.accessible);
    }

    for (const button of await nav.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect.soft(box?.width).toBeGreaterThanOrEqual(44);
      expect.soft(box?.height).toBeGreaterThanOrEqual(44);
    }
  }

  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page);
  await page.screenshot({path: testInfo.outputPath("desktop-1280.png"), animations: "disabled"});

  assertNoPageErrors();
});

test("las rutas secundarias tardan dos pulsaciones como máximo y la hoja anuncia la activa @chromium-only", async ({page}) => {
  test.setTimeout(60_000);
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 320, height: 844});
  await openApp(page);

  const nav = page.locator(".bottom-nav");
  const more = nav.getByRole("button", {name: "Más", exact: true});
  const secondarySections = [
    ["Plan", "planning"],
    ["Cuentas", "accounts"],
    ["Ajustes", "settings"],
  ] as const;

  for (const [label, tab] of secondarySections) {
    await more.click();
    const sheet = page.getByRole("dialog", {name: "Más secciones"});
    await expect(sheet).toBeVisible();
    const section = sheet.getByRole("button", {name: label, exact: true});
    await section.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("tab") === tab);

    await more.click();
    const currentSection = sheet.getByRole("button", {name: label, exact: true});
    expect.soft(await currentSection.getAttribute("aria-current"), `${label} debe anunciar la ruta activa`).toBe("page");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    await nav.getByRole("button", {name: "Resumen", exact: true}).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has("tab"));
    await expect(page.locator("#main-content .dashboard-operational-header")).toBeVisible();
  }

  const primarySections = [
    ["Movimientos", "transactions"],
    ["Revisión", "review"],
    ["Estadísticas", "statistics"],
  ] as const;
  for (const [label, tab] of primarySections) {
    await nav.getByRole("button", {name: label, exact: true}).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("tab") === tab);
    await nav.getByRole("button", {name: "Resumen", exact: true}).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has("tab"));
  }

  assertNoPageErrors();
});

test("la navegación respeta Mineral, Basalt y movimiento reducido", async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});

  for (const theme of ["mineral", "basalt"] as const) {
    await openApp(page);
    await page.evaluate((selectedTheme) => {
      localStorage.setItem("app.preferences.v1", JSON.stringify({version: 1, theme: selectedTheme, privacyMode: false}));
    }, theme);

    for (const reducedMotion of [false, true]) {
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await page.reload();
      await expect(page.locator(`.app-frame[data-theme="${theme}"]`)).toBeVisible();
      await expect(page.getByText("Cargando la aplicación…")).toHaveCount(0);
      expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(reducedMotion);

      const nav = page.locator(".bottom-nav");
      const more = nav.getByRole("button", {name: "Más", exact: true});
      await more.click();
      const sheet = page.getByRole("dialog", {name: "Más secciones"});
      await expect(sheet).toBeVisible();
      await page.screenshot({path: testInfo.outputPath(`mobile-navigation-${theme}-${reducedMotion ? "reduced" : "normal"}.png`), animations: "disabled"});
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(more).toBeFocused();
    }
  }

  assertNoPageErrors();
});

test("abrir y cerrar Más conserva el scroll de la página @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page);
  await page.evaluate(() => window.scrollTo(0, 240));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const more = page.locator(".bottom-nav").getByRole("button", {name: "Más", exact: true});
  await more.click();
  const sheet = page.getByRole("dialog", {name: "Más secciones"});
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => document.body.style.top)).toBe(`-${scrollBefore}px`);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await expect(more).toBeFocused();
  assertNoPageErrors();
});
