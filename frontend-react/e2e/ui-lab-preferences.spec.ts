import {expect, test} from "playwright/test";

const viewports = [320, 393, 768, 1280] as const;

test.describe("global preferences archetype", {tag: "@critical"}, () => {
  test.use({hasTouch: true});

  for (const width of viewports) {
    test(`states and geometry / ${width}`, async ({page}, testInfo) => {
      await page.setViewportSize({width, height: 900});
      await page.goto(`/ui-lab.html?e2e=global-preferences-${width}#global-preferences`);
      const archetype = page.getByLabel("Arquetipo de preferencias globales");
      await expect(page.getByRole("heading", {name: "Global preferences"})).toBeVisible();
      await expect(archetype).toHaveAttribute("data-theme", "mineral");

      const geometry = await archetype.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        targets: [...element.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect();
          return {width: rect.width, height: rect.height};
        }),
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      for (const target of geometry.targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }

      const basalt = archetype.getByRole("button", {name: "Basalt"});
      await basalt.tap();
      await expect(archetype).toHaveAttribute("data-theme", "basalt");
      await expect(basalt).toHaveAttribute("aria-pressed", "true");

      const hide = archetype.getByRole("button", {name: "Ocultar"});
      await hide.tap();
      await expect(archetype.getByText("••••••", {exact: true})).toBeVisible();
      await expect(hide).toHaveAttribute("aria-pressed", "true");

      await page.getByText("Herramientas de prueba de preferencias").click();
      const persistence = page.getByLabel("Estado de persistencia");
      await persistence.selectOption("error");
      await expect(page.getByRole("alert")).toContainText("El cambio se mantiene durante esta sesión");
      await persistence.selectOption("legacy");
      await expect(page.getByRole("status")).toContainText("configuración anterior");
      await persistence.selectOption("corrupt");
      await expect(page.getByRole("status")).toContainText("valores seguros");
      await persistence.selectOption("restored");
      await expect(page.getByRole("status")).toContainText("restauradas al recargar");

      const disable = page.getByLabel("Deshabilitar preferencias");
      await disable.check();
      await expect(basalt).toBeDisabled();
      await expect(hide).toBeDisabled();
      await disable.uncheck();

      const mineral = archetype.getByRole("button", {name: "Mineral"});
      await mineral.focus();
      await page.keyboard.press("Space");
      await expect(mineral).toHaveAttribute("aria-pressed", "true");
      await expect(mineral).toBeFocused();
      expect(await mineral.evaluate((button) => Number.parseFloat(getComputedStyle(button).outlineWidth))).toBeGreaterThanOrEqual(2);

      if (width === 393 || width === 1280) {
        await page.screenshot({path: testInfo.outputPath(`global-preferences-${width}.png`), fullPage: false});
      }
    });
  }

  test("honors reduced motion", {tag: "@reduced-motion"}, async ({page}) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.setViewportSize({width: 393, height: 900});
    await page.goto("/ui-lab.html?e2e=global-preferences-reduced-motion#global-preferences");
    const duration = await page.getByRole("button", {name: "Basalt"}).evaluate((button) => Number.parseFloat(getComputedStyle(button).transitionDuration));
    expect(duration).toBeLessThanOrEqual(0.01);
  });
});
