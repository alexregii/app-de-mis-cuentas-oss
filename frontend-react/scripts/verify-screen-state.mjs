import assert from "node:assert/strict";
import {chromium} from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:15177";
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1365, height: 900}, locale: "es-ES", serviceWorkers: "block"});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(`${baseUrl}/`, {waitUntil: "domcontentloaded"});
  await page.getByRole("heading", {name: "Resumen", exact: true}).waitFor({state: "visible"});
  await page.waitForFunction(() => {
    const cache = document.querySelector(".database-screen-cache");
    const has = (tab, selector, attribute, expected = "true") => cache
      ?.querySelector(`[data-cached-tab="${tab}"] ${selector}`)
      ?.getAttribute(attribute) === expected;
    return has("transactions", "[data-screen-ready]", "data-screen-ready")
      && has("review", ".view-stack", "data-review-bank-ready")
      && has("review", ".view-stack", "data-review-imports-ready")
      && has("review", ".view-stack", "data-review-rows-ready")
      && has("statistics", ".stats-view", "aria-busy", "false")
      && Boolean(cache.querySelector('[data-cached-tab="statistics"] canvas'));
  }, null, {timeout: 30_000});
  for (const tab of ["transactions", "review", "statistics"]) {
    const inactive = page.locator(`[data-cached-tab="${tab}"]`);
    assert.equal(await inactive.getAttribute("aria-hidden"), "true", `La pestaña precargada ${tab} no se expone mientras está inactiva.`);
    assert.equal(await inactive.evaluate((element) => element.inert), true, `La pestaña precargada ${tab} no admite foco ni interacción mientras está inactiva.`);
  }

  const navigation = page.getByRole("navigation", {name: "Navegación principal de escritorio"});
  const go = async (label) => navigation.getByRole("button", {name: label, exact: true}).click();

  await go("Movimientos");
  const query = page.locator('[data-cached-tab="transactions"] input[aria-label="Búsqueda"]');
  const initialResultLabel = await page.locator('[data-cached-tab="transactions"] h1').locator("xpath=following-sibling::*[1]").innerText().catch(() => "");
  await query.fill("__state_roundtrip_no_match__");
  await page.getByText("No hay movimientos para mostrar.", {exact: true}).waitFor({state: "visible"});
  await go("Revisión");
  await go("Movimientos");
  assert.equal(await query.inputValue(), "__state_roundtrip_no_match__", "La búsqueda de Movimientos se conserva al cambiar de pestaña.");

  await query.fill("");
  if (initialResultLabel) await page.locator('[data-cached-tab="transactions"] h1').locator("xpath=following-sibling::*[1]").getByText(initialResultLabel).waitFor({state: "visible"});

  await go("Revisión");
  const batchButton = page.locator('[data-cached-tab="review"] .review-csv-workspace .batch-select-button').first();
  if (await batchButton.count()) {
    await batchButton.click();
    await page.locator('[data-cached-tab="review"] .review-csv-workspace .csv-detail-motion').waitFor({state: "visible"});
    await go("Movimientos");
    await go("Revisión");
    await page.locator('[data-cached-tab="review"] .review-csv-workspace .csv-detail-motion').waitFor({state: "visible"});
  }

  await go("Estadísticas");
  await page.getByRole("button", {name: "Cambiar informe"}).click();
  const periodRequest = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/statistics/"
    && new URL(response.url()).searchParams.get("period") === "3");
  await page.getByRole("button", {name: "3 meses", exact: true}).click();
  await periodRequest;
  await page.locator('[data-cached-tab="statistics"] .stats-view[aria-busy="false"]').waitFor({state: "visible"});
  await go("Movimientos");
  await go("Estadísticas");
  assert.match(new URL(page.url()).search, /(?:\?|&)period=3(?:&|$)/, "El periodo estadístico queda en la ruta al volver a la pestaña.");
  assert.equal(await page.locator('[data-cached-tab="statistics"] [aria-label="Periodo"] [aria-pressed="true"]').getAttribute("aria-label"), "3 meses");
  await page.goBack();
  await page.getByRole("heading", {name: "Movimientos", exact: true}).waitFor({state: "visible"});
  await page.goForward();
  await page.getByRole("heading", {name: "Estadísticas", exact: true}).waitFor({state: "visible"});
  assert.equal(await page.locator('[data-cached-tab="statistics"] [aria-label="Periodo"] [aria-pressed="true"]').getAttribute("aria-label"), "3 meses", "El historial restaura el periodo estadístico elegido.");

  if (errors.length) throw new Error(errors.join(" | "));
  console.log(JSON.stringify({
    ok: true,
    preserved: ["search filter across tabs", "CSV expanded batch across tabs", "statistics period and URL across tabs and browser history"],
    pageErrors: 0,
  }));
} finally {
  await context.close();
  await browser.close();
}
