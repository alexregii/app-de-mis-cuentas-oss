import {expect, test, type Locator, type Page} from "playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs";

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/evidence/r2-c4-1");
let openSequence = 0;

async function openReview(page: Page, width: number) {
  await page.setViewportSize({width, height: 900});
  await page.goto(`/ui-lab.html?e2e=review-c4-1-evidence-${width}-${++openSequence}#review-archetype`);
  const review = page.getByRole("region", {name: "Escenario de Revisión"});
  await expect(review).toBeVisible();
  return review;
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    const details = document.querySelector<HTMLDetailsElement>(".ui-review-archetype__lab-controls");
    if (details) details.open = false;
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.mouse.move(1, 1);
}

async function save(locator: Locator, filename: string) {
  await locator.screenshot({path: path.join(evidenceDir, filename), animations: "disabled"});
}

async function saveViewport(page: Page, filename: string) {
  await page.screenshot({path: path.join(evidenceDir, filename), animations: "disabled"});
}

async function editField(card: Locator, buttonName: string, label: string, value: string) {
  await card.getByRole("button", {name: buttonName}).click();
  const input = card.getByLabel(label);
  await input.fill(value);
  await input.press("Enter");
}

async function makeSelection(review: Locator) {
  await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
  for (const id of ["review-new-prepared", "review-batch-a"]) {
    await review.locator(`[data-review-item="${id}"]`).getByRole("checkbox").check();
  }
}

async function makeChangedMultiField(review: Locator) {
  const card = review.locator('[data-review-item="review-modified-prepared"]');
  await editField(card, "Concepto: Compra semanal", "Concepto", "Compra semanal confirmada");
  await editField(card, "Fecha: 03/09/2026", "Fecha", "2026-09-04");
  await expect(card.locator(".ui-review-inline__change")).toHaveCount(3);
  return card;
}

test("genera la evidencia visual R2-C4.1 sin sobrescribir R2-C4", {tag: "@evidence", timeout: 120_000}, async ({page}) => {
  fs.mkdirSync(evidenceDir, {recursive: true});

  let review = await openReview(page, 1280);
  await settle(page);
  await save(review, "desktop-1280-normal.png");

  review = await openReview(page, 1280);
  await save(review.locator('[data-review-item="review-new-prepared"]'), "desktop-1280-footer.png");

  review = await openReview(page, 1280);
  await save(review.locator('[data-review-item="review-blocked"]'), "desktop-1280-blocked.png");

  review = await openReview(page, 1280);
  await makeSelection(review);
  await settle(page);
  await save(review, "desktop-1280-selection.png");

  review = await openReview(page, 1280);
  await save(review.locator('[data-review-item="review-modified-prepared"]'), "desktop-1280-changed-simple.png");

  review = await openReview(page, 1280);
  const changedMulti = await makeChangedMultiField(review);
  await settle(page);
  await save(changedMulti, "desktop-1280-changed-multi.png");
  const changedFocus = changedMulti.locator('[data-review-inline-field="account"] .ui-review-inline__value');
  await changedFocus.focus();
  await save(changedMulti, "desktop-1280-changed-focus.png");
  await changedFocus.blur();

  review = await openReview(page, 1280);
  const desktopDetails = review.locator('[data-review-item="review-new-prepared"]');
  await desktopDetails.getByRole("button", {name: "Más detalles"}).click();
  await page.waitForTimeout(320);
  await settle(page);
  await save(desktopDetails, "desktop-1280-details-open.png");

  review = await openReview(page, 390);
  await settle(page);
  await save(review, "mobile-390-normal.png");

  review = await openReview(page, 390);
  await save(review.locator('[data-review-item="review-blocked"]'), "mobile-390-blocked.png");

  review = await openReview(page, 320);
  await save(review.locator('[data-review-item="review-blocked"]'), "mobile-320-blocked.png");

  review = await openReview(page, 390);
  await makeSelection(review);
  await settle(page);
  await saveViewport(page, "mobile-390-selection.png");

  review = await openReview(page, 390);
  await makeSelection(review);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(32);
  await saveViewport(page, "mobile-390-selection-scrolled.png");

  review = await openReview(page, 320);
  await makeSelection(review);
  await settle(page);
  await saveViewport(page, "mobile-320-selection.png");

  review = await openReview(page, 390);
  await save(review.locator('[data-review-item="review-new-prepared"]'), "mobile-390-footer.png");

  review = await openReview(page, 390);
  const mobileChanged = await makeChangedMultiField(review);
  await settle(page);
  await save(mobileChanged, "mobile-390-changed.png");

  review = await openReview(page, 390);
  const mobileDetails = review.locator('[data-review-item="review-new-prepared"]');
  await mobileDetails.getByRole("button", {name: "Más detalles"}).click();
  await page.waitForTimeout(320);
  await settle(page);
  await save(mobileDetails, "mobile-390-details-open.png");

  review = await openReview(page, 390);
  await save(review.locator('[data-review-item="review-refund-dependent"]'), "mobile-390-refund-dependency.png");
});
