import {expect, test} from "playwright/test";

const scenarios = [
  {theme: "mineral", width: 320},
  {theme: "mineral", width: 393},
  {theme: "basalt", width: 768},
] as const;

test.describe("stable controls", {tag: "@critical"}, () => {
  test.use({hasTouch: true});

  for (const scenario of scenarios) {
    test(`${scenario.theme} / ${scenario.width}`, async ({page}, testInfo) => {
      await page.setViewportSize({width: scenario.width, height: 900});
      await page.goto(`/ui-lab.html?e2e=controls-${scenario.theme}-${scenario.width}#controls`);
      await page.getByLabel("Tema del experimento").selectOption(scenario.theme);
      await expect(page.getByRole("heading", {name: "Controls"})).toBeVisible();

      const geometry = await page.locator(".ui-button, .ui-icon-button, .ui-text-button").evaluateAll((controls) => ({
        heights: controls.map((control) => control.getBoundingClientRect().height),
        pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        viewportWidth: document.documentElement.clientWidth,
      }));

      expect(geometry.heights.length).toBeGreaterThan(0);
      expect(geometry.heights.every((height) => height >= 44)).toBe(true);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

      const loading = page.getByRole("button", {name: "Guardando…"});
      await expect(loading).toBeDisabled();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", {name: "Buscar", exact: true})).toBeVisible();
      await expect(page.getByRole("link", {name: "Enlace como botón"})).toHaveClass(/ui-button--secondary/);
      await expect(page.getByRole("button", {name: "Acción de texto"})).toHaveClass(/ui-text-button/);

      const attention = page.getByRole("button", {name: "Atención"});
      await attention.tap();
      await expect(attention).toHaveAttribute("aria-pressed", "true");

      const fieldHeights = await page.locator(".ui-input, .ui-select").evaluateAll((fields) => fields.map((field) => field.getBoundingClientRect().height));
      expect(fieldHeights.length).toBeGreaterThan(0);
      expect(fieldHeights.every((height) => height >= 44)).toBe(true);
      await expect(page.getByText("Introduce un importe válido.")).toBeVisible();

      if (scenario.width === 393 || scenario.width === 768) {
        await page.screenshot({path: testInfo.outputPath(`controls-${scenario.width}.png`), fullPage: false});
      }
    });
  }
});
