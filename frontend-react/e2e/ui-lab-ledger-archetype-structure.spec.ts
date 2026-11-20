import {expect, test} from "playwright/test";
import {openLedger} from "./ui-lab-helpers";

for (const width of [393, 1280]) {
  test(`UI Lab y el arquetipo estable conservan la estructura a ${width}px`, {tag: ["@critical", "@full"]}, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await openLedger(page, `archetype-structure-${width}`);
    const archetype = page.locator("[data-ledger-archetype]");
    await expect(archetype).toBeVisible();
    expect(await archetype.locator(":scope > [data-ledger-slot]").evaluateAll((slots) => slots.map((slot) => slot.getAttribute("data-ledger-slot")))).toEqual(["header", "selection", "filter", "results"]);
    expect(await archetype.locator(":scope > [data-ledger-slot]").evaluateAll((slots) => slots.map((slot) => getComputedStyle(slot).display))).toEqual(["block", "contents", "block", "block"]);
    await expect(archetype.locator(".panel")).toHaveCount(0);
    await expect(archetype.locator("[data-ledger-slot=results] .ui-statement-ledger")).toBeVisible();
    const geometry = await archetype.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const ledger = element.querySelector<HTMLElement>(".ui-statement-ledger")!.getBoundingClientRect();
      return {left: bounds.left, right: bounds.right, width: innerWidth, pageWidth: document.documentElement.scrollWidth, ledgerLeft: ledger.left, ledgerRight: ledger.right};
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.ledgerLeft).toBeGreaterThanOrEqual(geometry.left);
    expect(geometry.ledgerRight).toBeLessThanOrEqual(geometry.right);
  });
}
