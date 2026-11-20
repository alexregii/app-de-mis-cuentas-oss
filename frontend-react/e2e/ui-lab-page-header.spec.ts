import {expect, test} from "playwright/test";

const scenarios = [
  {theme: "mineral", width: 320},
  {theme: "mineral", width: 393},
  {theme: "basalt", width: 768},
] as const;

test.describe("stable page header", {tag: "@critical"}, () => {
  test.use({hasTouch: true});

  for (const scenario of scenarios) {
    test(`${scenario.theme} / ${scenario.width}`, async ({page}, testInfo) => {
      await page.setViewportSize({width: scenario.width, height: 900});
      await page.goto(`/ui-lab.html?e2e=page-header-${scenario.theme}-${scenario.width}#page-header`);
      await page.getByLabel("Tema del experimento").selectOption(scenario.theme);
      await expect(page.getByRole("heading", {name: "Page header"})).toBeVisible();

      const geometry = await page.locator(".ui-page-header").evaluateAll((headers) => ({
        headers: headers.map((header) => {
          const rect = header.getBoundingClientRect();
          const title = header.querySelector("h1");
          const style = title ? getComputedStyle(title) : null;
          return {left: rect.left, right: rect.right, titleSize: style ? Number.parseFloat(style.fontSize) : 0};
        }),
        pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        viewportWidth: document.documentElement.clientWidth,
      }));

      expect(geometry.headers).toHaveLength(3);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(new Set(geometry.headers.map((header) => header.titleSize)).size).toBe(1);
      expect(geometry.headers.every((header) => header.titleSize >= 23 && header.titleSize <= 31)).toBe(true);

      const add = page.getByRole("button", {name: "Añadir"});
      expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      if (scenario.width === 393 || scenario.width === 768) {
        await page.screenshot({path: testInfo.outputPath(`page-header-${scenario.width}.png`), fullPage: false});
      }
    });
  }
});
