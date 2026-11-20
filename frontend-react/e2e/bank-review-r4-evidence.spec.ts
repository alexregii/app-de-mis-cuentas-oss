import {expect, test} from "playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs";
import {openApp} from "./helpers";

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/evidence/r4-bank-migration");

test("genera evidencia Bank de R4 con datos E2E sintéticos", {tag: "@evidence", timeout: 60_000}, async ({page}, testInfo) => {
  fs.mkdirSync(evidenceDir, {recursive: true});
  const browser = testInfo.project.name;

  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=review");
  const bank = page.getByRole("region", {name: "Cola bancaria"});
  await expect(bank.locator('[data-review-item^="bank:"]')).toHaveCount(2);
  await bank.screenshot({path: path.join(evidenceDir, `desktop-1280-bank-normal-${browser}.png`), animations: "disabled"});
  await bank.locator('[data-review-item="bank:1"]').screenshot({path: path.join(evidenceDir, `desktop-1280-bank-attention-${browser}.png`), animations: "disabled"});

  await page.setViewportSize({width: 390, height: 900});
  await openApp(page, "/?tab=review");
  await expect(bank.locator('[data-review-item^="bank:"]')).toHaveCount(2);
  await bank.screenshot({path: path.join(evidenceDir, `mobile-390-bank-normal-${browser}.png`), animations: "disabled"});
  await bank.locator('[data-review-item="bank:1"]').screenshot({path: path.join(evidenceDir, `mobile-390-bank-attention-${browser}.png`), animations: "disabled"});
});
