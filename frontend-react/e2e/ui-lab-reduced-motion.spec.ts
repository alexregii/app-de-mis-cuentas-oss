import {expect, test} from "playwright/test";
import {openLedger} from "./ui-lab-helpers";

test.describe("movimiento reducido explícito", {tag: "@reduced-motion"}, () => {
  test.use({hasTouch: true});

  test("desactiva el motion no esencial del ledger", {tag: "@full"}, async ({page}) => {
    await page.setViewportSize({width: 393, height: 900});
    await openLedger(page, "reduced-motion");
    await page.getByLabel("Tema del experimento").selectOption("mineral");
    await page.emulateMedia({reducedMotion: "reduce"});

    const motion = await page.locator(".ui-statement-ledger__row").first().evaluate((row) => {
      const selection = getComputedStyle(row.querySelector<HTMLElement>(".ui-statement-ledger__selection")!);
      const menu = getComputedStyle(row.querySelector<HTMLElement>(".ui-statement-ledger__menu")!);
      return {selectionDuration: Number.parseFloat(selection.transitionDuration), menuDuration: Number.parseFloat(menu.transitionDuration), selectionProperty: selection.transitionProperty, menuProperty: menu.transitionProperty};
    });
    expect(motion.selectionDuration).toBeLessThanOrEqual(0.01);
    expect(motion.menuDuration).toBeLessThanOrEqual(0.01);
    expect(motion.selectionProperty).toBe("none");
    expect(motion.menuProperty).toBe("none");

    await page.getByRole("button", {name: "Seleccionar", exact: true}).tap();
    const summary = page.locator(".ui-selection-toolbar__summary");
    await expect(summary).toBeVisible();
    const summaryMotion = await summary.evaluate((element) => {
      const style = getComputedStyle(element);
      return {duration: Number.parseFloat(style.transitionDuration), property: style.transitionProperty};
    });
    expect(summaryMotion.duration).toBeLessThanOrEqual(0.01);
    expect(summaryMotion.property).toBe("none");
  });
});
