import {expect, test, type Locator, type Page} from "playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs";

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/evidence/r2-c4");

async function openReview(page: Page, width: number) {
  await page.setViewportSize({width, height: 900});
  await page.goto(`/ui-lab.html?e2e=review-c4-evidence-${width}#review-archetype`);
  const review = page.getByRole("region", {name: "Escenario de Revisión"});
  await review.waitFor({state: "visible"});
  return review;
}

async function closeLabAndBlur(page: Page) {
  await page.evaluate(() => {
    const details = document.querySelector<HTMLDetailsElement>(".ui-review-archetype__lab-controls");
    if (details) details.open = false;
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function save(locator: Locator, filename: string, animations: "disabled" | "allow" = "disabled") {
  await locator.screenshot({path: path.join(evidenceDir, filename), animations});
}

async function chooseState(review: Locator, page: Page, state: string) {
  await review.getByText("Probar estados del arquetipo").click();
  await review.getByRole("combobox", {name: "Estado de página"}).selectOption(state);
  await closeLabAndBlur(page);
}

test("genera la evidencia visual R2-C4 con fixtures sintéticos y Lab cerrado", {tag: "@evidence", timeout: 120_000}, async ({page}) => {
  fs.mkdirSync(evidenceDir, {recursive: true});

  let review = await openReview(page, 1280);
  await closeLabAndBlur(page);
  await page.screenshot({path: path.join(evidenceDir, "desktop-1280-normal.png"), fullPage: true, animations: "disabled"});
  await chooseState(review, page, "many");
  await page.screenshot({path: path.join(evidenceDir, "desktop-1280-many.png"), fullPage: true, animations: "disabled"});

  review = await openReview(page, 1280);
  await closeLabAndBlur(page);
  await save(review.locator('[data-review-item="review-blocked"]'), "desktop-1280-blocked.png");

  review = await openReview(page, 390);
  await closeLabAndBlur(page);
  await save(review, "mobile-390-normal.png");
  await save(review.locator('[data-review-item="review-new-prepared"]'), "mobile-390-prepared-footer.png");
  await save(review.locator('[data-review-item="review-refund-dependent"]'), "mobile-390-refund-dependency.png");

  const blocked = review.locator('[data-review-item="review-blocked"]');
  await expect(blocked.locator("[data-review-blocking-summary]")).toContainText("Hay 3 problemas que impiden incorporar");
  await save(blocked, "mobile-390-blocked.png");
  await save(blocked, "mobile-390-amount-error.png");

  const selectorCard = review.locator('[data-review-item="review-new-prepared"]');
  await selectorCard.getByRole("button", {name: "Cuenta: Santander"}).click();
  await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-review-item="review-new-prepared"]');
    if (card) window.scrollTo(0, Math.max(0, card.getBoundingClientRect().top + window.scrollY - 80));
  });
  await page.screenshot({path: path.join(evidenceDir, "mobile-390-selector-open.png"), animations: "disabled"});
  await selectorCard.getByRole("combobox", {name: "Cuenta"}).press("Escape");

  const exitingCard = review.locator('[data-review-item="review-prepared-pending"]');
  await exitingCard.getByRole("button", {name: "Incorporar"}).click();
  await expect(exitingCard).toHaveAttribute("data-review-exiting", "true");
  await page.screenshot({path: path.join(evidenceDir, "mobile-390-exit.png"), fullPage: false, animations: "allow"});

  for (const [state, filename] of [["loading", "mobile-390-loading.png"], ["error", "mobile-390-error.png"], ["empty", "mobile-390-empty.png"]] as const) {
    review = await openReview(page, 390);
    await chooseState(review, page, state);
    await save(review, filename);
  }
});
