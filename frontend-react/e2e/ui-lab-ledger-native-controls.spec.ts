import {expect, test} from "playwright/test";
import {expectOverlayControlsContained, openLedger} from "./ui-lab-helpers";

const nativeScenarios = [
  {theme: "mineral", width: 320, controls: ["month", "range", "selects"], tags: ["@critical"]},
  {theme: "mineral", width: 768, controls: ["range"], tags: ["@critical"]},
  {theme: "basalt", width: 393, controls: ["month", "range", "selects"], tags: ["@full"]},
];

test.describe("controles nativos de Periodo en touch", {tag: "@native"}, () => {
  test.use({hasTouch: true});

  for (const scenario of nativeScenarios) {
    for (const control of scenario.controls) {
      test(`${scenario.theme} / ${scenario.width} / ${control}`, {tag: scenario.tags}, async ({page,}, testInfo) => {
        await page.setViewportSize({width: scenario.width, height: 900});
        await openLedger(page, `native-${scenario.theme}-${scenario.width}-${control}`);
        await page.getByLabel("Tema del experimento").selectOption(scenario.theme);
        expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);
        if (control === "selects") {
          await page.getByRole("button", {name: "Filtros", exact: true}).tap();
        } else {
          await page.getByRole("button", {name: /Periodo:/}).tap();
          if (control === "month") {
            await page.getByLabel("Mes", {exact: true}).fill("2026-09");
            await expect(page.getByLabel("Mes", {exact: true})).toHaveValue("2026-09");
          } else {
            await page.getByRole("button", {name: "Rango personalizado", exact: true}).tap();
            await page.getByLabel("Desde", {exact: true}).fill("2026-09-01");
            await page.getByLabel("Hasta", {exact: true}).fill("2026-09-30");
            await expect(page.getByLabel("Desde", {exact: true})).toHaveValue("2026-09-01");
            await expect(page.getByLabel("Hasta", {exact: true})).toHaveValue("2026-09-30");
            const dates = await page.locator(".ui-ledger-filter-strip__range input").evaluateAll((inputs) => inputs.map((input) => {
              const rect = input.getBoundingClientRect();
              return {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right};
            }));
            if (scenario.width >= 768) {
              expect(Math.abs(dates[0].top - dates[1].top)).toBeLessThanOrEqual(1);
              expect(dates[0].right).toBeLessThan(dates[1].left);
            } else {
              expect(dates[0].bottom).toBeLessThan(dates[1].top);
            }
          }
        }
        await expectOverlayControlsContained(page);
        if ([393, 768].includes(scenario.width)) await page.screenshot({path: testInfo.outputPath(`${control}.png`), fullPage: false});
      });
    }
  }
});
