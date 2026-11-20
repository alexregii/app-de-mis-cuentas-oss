import {readFileSync} from "node:fs";
import {expect, test, type Page} from "playwright/test";
import {installPageErrorGuard, openApp, replaceControlledInput, resetE2eDatabase} from "./helpers";
import type {MonthStatisticsPayload, StatisticsPayload} from "../src/features/statistics/types";

test.beforeEach(async ({}, testInfo) => resetE2eDatabase(testInfo.project.name));

const statisticsScreenshotFixture = JSON.parse(readFileSync(new URL("./fixtures/statistics-screenshot-2026-11-03.json", import.meta.url), "utf8")) as StatisticsPayload;
const emptyStatisticsFixture: StatisticsPayload = {
  ...statisticsScreenshotFixture,
  summary: {income: 0, net_expense: 0, refunds_applied: 0, analytical_result: 0, savings_rate: null},
  activity_status: "unknown",
  comparison: {...statisticsScreenshotFixture.comparison, previous_activity_status: "unknown", is_comparable: false},
  monthly_series: [],
  categories: [],
};

const reportTable = (page: Page) => page.getByRole("table", {name: "Datos de evolución mensual"});
const categoryTable = (page: Page) => page.getByRole("table", {name: "Distribución del periodo por familias principales"});
const monthSelector = (page: Page) => page.getByLabel("Mes para profundizar");
const monthlyTableDisclosure = (page: Page) => page.locator(".stats-month-table-trigger");

const waitForStableStatisticsLayout = async (page: Page) => {
  await expect(page.locator(".chart-engine-loading")).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(() => new Promise<void>((resolve) => {
    let previous = "";
    let stableFrames = 0;
    const sample = () => {
      const current = JSON.stringify([".stats-trend-panel .chart-block", ".stats-trend-panel .stats-month-picker-row"].map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? [rect.x, rect.y, rect.width, rect.height] : null;
      }));
      stableFrames = current === previous ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 3) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
};

const selectMonthWithStatus = async (page: Page, status: "recorded" | "unknown") => {
  const options = monthSelector(page).locator("option");
  for (let index = 1; index < await options.count(); index += 1) {
    const option = options.nth(index);
    const label = await option.innerText();
    const matches = status === "unknown" ? label.includes("· ?") : !label.includes("· ?");
    if (!matches) continue;
    const value = await option.getAttribute("value");
    if (!value) continue;
    await monthSelector(page).selectOption(value);
    return value;
  }
  throw new Error(`El informe no ofrece ningún mes con estado ${status}.`);
};

const selectOldestAvailableMonth = async (page: Page) => {
  const options = monthSelector(page).locator("option");
  const option = options.nth((await options.count()) - 1);
  const value = await option.getAttribute("value");
  if (!value) throw new Error("El informe no ofrece ningún mes seleccionable.");
  await monthSelector(page).selectOption(value);
  return value;
};

const todayInMadrid = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const waitForStatistics = async (page: Page) => {
  await expect(page.getByRole("heading", {name: "Resultado del periodo"})).toBeVisible();
  await expect(monthSelector(page)).toBeVisible();
  await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
};

async function expectStatisticsCharts(page: Page) {
  const engine = await page.locator(".stats-view").getAttribute("data-chart-engine");
  if (engine === "ag-charts") {
    await expect(page.locator(".ag-chart-shell canvas").first()).toBeVisible();
    await expect(page.locator(".ag-donut-shell canvas").first()).toBeVisible();
  } else {
    await expect(page.locator(".uplot-chart-shell canvas").first()).toBeVisible();
    await expect(page.locator(".donut-svg .donut-segment")).toHaveCount(3);
  }
  return engine;
}

test("separa colores de serie y categorías y conserva el enlace de distribución @chromium-only", async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);

  await test.step("los colores distinguen las tres series y las familias", async () => {
    const seriesColors = await page.locator(".chart-legend-inline .legend-chip.income, .chart-legend-inline .legend-chip.expense, .chart-legend-inline .legend-chip.result").evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).color),
    );
    expect(new Set(seriesColors).size).toBe(3);

    const firstCategory = page.locator(".stats-category-quick-links li").first();
    await expect(firstCategory).toBeVisible();
    const categoryColors = await page.locator(".stats-category-quick-links li i").evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).backgroundColor),
    );
    expect(new Set(categoryColors).size).toBeGreaterThan(1);
    await expect(page.locator(".stats-money-map")).toHaveCount(0);
  });

  await test.step("la distribución conserva un único enlace y su geometría móvil", async () => {
    const categories = page.locator(".stats-category-panel");
    await expect(categories).toBeVisible();
    await expect(categories.getByRole("heading", {name: "Distribución por categorías principales"})).toBeVisible();
    const categoryLink = categories.locator(".stats-category-quick-links a").first();
    await expect(categoryLink).toBeVisible();
    await expect(categoryLink).toHaveAttribute("href", /tab=transactions/);
    await expect(page.locator(".stats-money-map")).toHaveCount(0);

    await page.setViewportSize({width: 390, height: 844});
    await expect(categories).toBeVisible();
    const documentWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    expect(documentWidth).toBeLessThanOrEqual(390);
  });
});

test("la shell anuncia datos estadísticos guardados al perder conexión @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);

  await page.context().setOffline(true);
  const offlineStatus = page.getByRole("status", {name: /Sin conexión/}).first();
  await expect(offlineStatus).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("miscuentas:offline-cache", {
    detail: {path: "/api/statistics/?period=12", cachedAt: "2026-09-30T12:00:00.000Z"},
  })));
  await expect(offlineStatus).toHaveAttribute("aria-label", /Mostrando datos guardados del/);
  await expect(page.locator(".stats-connectivity-status").filter({hasText: "Sin conexión."})).toHaveCount(0);
  assertNoPageErrors();
});

test("cierra un mes desde Estadísticas y deja el checklist consultable en móvil @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);

  const closeStateResponse = page.waitForResponse((response) => response.url().includes("/api/monthly-closes/?") && response.ok());
  await selectOldestAvailableMonth(page);
  await closeStateResponse;
  const panel = page.locator(".monthly-close-panel");
  await expect(panel.getByRole("heading", {name: /Cierre del mes/})).toBeVisible();
  await expect(panel.getByRole("heading", {name: "Cuentas y conciliación"})).toBeVisible();
  await expect(panel.getByRole("heading", {name: /Incidencias materiales/})).toBeVisible();

  const reasons = panel.locator(".monthly-close-issue textarea");
  for (let index = 0; index < await reasons.count(); index += 1) {
    await reasons.nth(index).fill("Revisado y declarado para el cierre de prueba local.");
  }
  const closeButton = panel.getByRole("button", {name: "Revisar y cerrar mes"});
  await expect(closeButton).toBeEnabled();
  await closeButton.click();
  const confirm = page.getByRole("dialog", {name: /Confirmar cierre/});
  await expect(confirm).toBeVisible();
  const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/monthly-closes/"));
  await confirm.getByRole("button", {name: "Cerrar mes"}).click();
  expect((await createResponse).status()).toBe(201);
  await expect(panel.getByText("Cierre guardado: versión 1.")).toBeVisible();
  await expect(panel.locator(".monthly-close-verification")).toContainText("Fuentes actuales");
  await panel.getByText(/Consultar historial/).click();
  const savedVersion = panel.locator(".monthly-close-version-detail");
  await savedVersion.locator(":scope > summary").click();
  await expect(savedVersion).toContainText("Cuentas incluidas en la versión");
  await expect(savedVersion).toContainText("Abrir movimientos del mes");

  await page.setViewportSize({width: 390, height: 844});
  await panel.scrollIntoViewIfNeeded();
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  assertNoPageErrors();
});

test("la selección mensual conserva la geometría del gráfico y el selector @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);
  await expect(page.locator(".stats-trend-panel .chart-block")).toBeVisible();

  const geometry = async () => page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`No se encontró ${selector}.`);
      const rect = element.getBoundingClientRect();
      return {x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height)};
    };
    return {
      chart: box(".stats-trend-panel .chart-block"),
      selector: box(".stats-trend-panel .stats-month-picker-row"),
      summary: document.querySelector<HTMLElement>(".stats-month-summary")?.getBoundingClientRect().y ?? null,
    };
  });
  await waitForStableStatisticsLayout(page);
  const stableBefore = await geometry();
  await selectMonthWithStatus(page, "recorded");
  await expect(page.getByRole("heading", {name: /Detalle mensual/})).toBeVisible();
  await expect(page.locator(".stats-month-summary")).toBeVisible();
  await expect(page.locator(".stats-category-panel")).toBeVisible();

  await waitForStableStatisticsLayout(page);
  const after = await geometry();
  expect(after.chart).toEqual(stableBefore.chart);
  expect(after.selector).toEqual(stableBefore.selector);
  expect(after.summary).not.toBeNull();
  expect(after.summary!).toBeGreaterThan(after.selector.y + after.selector.height);
  assertNoPageErrors();
});

test("el disclosure de filtros conserva foco y scroll con movimiento reducido @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);

  const trigger = page.locator(".stats-edit-scope");
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const triggerBefore = await trigger.boundingBox();
  await trigger.click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#statistics-filters")).toBeVisible();
  const editorBox = await page.locator("#statistics-filters").boundingBox();
  const headerBox = await page.locator(".stats-page-header").boundingBox();
  expect(editorBox!.y).toBeLessThanOrEqual(headerBox!.y + headerBox!.height + 40);
  expect((await trigger.boundingBox())!.y).toBeCloseTo(triggerBefore!.y, 0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await trigger.click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#statistics-filters")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  assertNoPageErrors();
});

test("Estadísticas conserva el informe visible, foco y geometría mientras aplica un filtro @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);
  await expect(page.locator(".stats-trend-panel .chart-block")).toBeVisible();

  let releaseReport!: () => void;
  const allowReport = new Promise<void>((resolve) => {releaseReport = resolve;});
  await page.route("**/api/statistics/?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("basis") !== "all") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await allowReport;
    await route.fulfill({response});
  });

  const trigger = page.locator(".stats-edit-scope");
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.locator("#statistics-filters")).toBeVisible();
  await page.evaluate(async () => {
    const panel = document.querySelector<HTMLElement>("#statistics-filters");
    if (!panel) throw new Error("No se encontró el panel de filtros.");
    let previous = panel.getBoundingClientRect().height;
    let stableFrames = 0;
    for (let frame = 0; frame < 60 && stableFrames < 3; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = panel.getBoundingClientRect().height;
      stableFrames = Math.abs(current - previous) < 0.5 ? stableFrames + 1 : 0;
      previous = current;
    }
  });
  const allCategories = page.getByRole("button", {name: "Todas las categorías"});
  await allCategories.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const oldSummary = await page.getByRole("region", {name: "Resultado del periodo"}).innerText();
  const chartBefore = await page.locator(".stats-trend-panel .chart-block").boundingBox();
  const selectorBefore = await monthSelector(page).boundingBox();
  const request = page.waitForRequest((candidate) => (
    candidate.url().includes("/api/statistics/?")
    && new URL(candidate.url()).searchParams.get("basis") === "all"
  ));

  try {
    await allCategories.press("Enter");
    await request;
    await expect(page.locator('.stats-view[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole("status").filter({hasText: "Actualizando el informe…"})).toHaveCount(1);
    expect(await page.getByRole("region", {name: "Resultado del periodo"}).innerText()).toBe(oldSummary);
    await expect(page.locator(".stats-trend-panel .chart-block")).toBeVisible();
    await expect(page.locator(".stats-category-panel")).toBeVisible();
    await expect(allCategories).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    const chartPending = await page.locator(".stats-trend-panel .chart-block").boundingBox();
    const selectorPending = await monthSelector(page).boundingBox();
    expect(chartPending).toEqual(chartBefore);
    expect(selectorPending).toEqual(selectorBefore);

    releaseReport();
    await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
    await expect(page.getByText("Todas las categorías", {exact: true}).first()).toBeVisible();
    await expect(allCategories).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    assertNoPageErrors();
  } finally {
    releaseReport();
  }
});

test("Estadísticas conserva el informe y su punto de lectura si falla el refresh @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);
  const oldSummary = await page.getByRole("region", {name: "Resultado del periodo"}).innerText();
  await page.route("**/api/statistics/?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("basis") === "all") {
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Informe no disponible."})});
      return;
    }
    await route.continue();
  });

  const trigger = page.locator(".stats-edit-scope");
  await trigger.click();
  const allCategories = page.getByRole("button", {name: "Todas las categorías"});
  await allCategories.focus();
  await page.evaluate(() => window.scrollTo(0, Math.min(180, document.documentElement.scrollHeight - innerHeight)));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const request = page.waitForRequest((candidate) => (
    candidate.url().includes("/api/statistics/?")
    && new URL(candidate.url()).searchParams.get("basis") === "all"
  ));
  await allCategories.press("Enter");
  await request;

  await expect(page.getByRole("alert")).toContainText("Se mantienen los datos anteriores.");
  await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
  expect(await page.getByRole("region", {name: "Resultado del periodo"}).innerText()).toBe(oldSummary);
  await expect(page.locator(".stats-trend-panel .chart-block")).toBeVisible();
  await expect(page.locator(".stats-category-panel")).toBeVisible();
  await expect(allCategories).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  assertNoPageErrors();
});

test("la gráfica mensual abre un mes exacto con la interacción de su motor", {tag: "@app-critical"}, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);
  const engine = await expectStatisticsCharts(page);
  const detailResponse = page.waitForResponse((response) => /\/api\/statistics\/\d{4}\/\d{1,2}\//.test(response.url()) && response.ok());
  if (engine === "ag-charts") {
    const chart = page.locator('.ag-chart-shell [role=img][tabindex="0"]').first();
    await chart.focus();
    await expect(chart).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
  } else {
    const chart = page.locator('.uplot-chart-shell .u-over[role="img"][tabindex="0"]').first();
    await chart.focus();
    await expect(chart).toBeFocused();
    await chart.press("ArrowRight");
    await expect(page.locator(".chart-inspector").first()).toBeVisible();
    await chart.press("Enter");
  }
  const monthResponse = await detailResponse;
  const monthPayload = await monthResponse.json() as MonthStatisticsPayload;
  expect(monthPayload.scope.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(monthPayload.scope.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  if (engine === "uplot") await expect(page.locator('.uplot-chart-shell .u-over[role="img"][tabindex="0"]').first()).toBeFocused();
  await expect(monthSelector(page)).not.toHaveValue("");
  await expect(page.locator(".chart-inspector").first()).toBeVisible();
  await expect(page.getByRole("heading", {name: /Detalle mensual/})).toBeVisible();
  await expect(page.locator(".stats-selected-month dl")).toHaveCount(0);
  if (engine === "ag-charts") {
    const movementsLink = page.getByRole("link", {name: "Ver movimientos de este intervalo"});
    await expect(movementsLink).toHaveAttribute("href", /statistics_attribution=report/);
    const movementRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());
      return requestUrl.pathname === "/api/transactions/"
        && requestUrl.searchParams.get("statistics_attribution") === "report";
    });
    await movementsLink.click();
    const requestedMovements = new URL((await movementRequest).url()).searchParams;
    expect(requestedMovements.get("date_from")).toBe(monthPayload.scope.date_from);
    expect(requestedMovements.get("date_to")).toBe(monthPayload.scope.date_to);
    await expect(page.getByText("Detalle exacto del informe estadístico")).toBeVisible();
    await expect(page.getByLabel("Resumen atribuido de los movimientos filtrados")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Filtros fijados por Estadísticas"})).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  }
  assertNoPageErrors();
});

test("las categorías conservan colores únicos y el drill-down semántico", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);
  const engine = await expectStatisticsCharts(page);
  const donutShell = page.locator(engine === "ag-charts" ? ".ag-donut-shell" : ".donut-svg").first();
  const donutBox = await donutShell.boundingBox();
  if (!donutBox) throw new Error("El donut no expone geometría.");
  const urlBeforeHoleClick = page.url();
  await page.mouse.click(donutBox.x + donutBox.width / 2, donutBox.y + donutBox.height / 2);
  await expect(page).toHaveURL(urlBeforeHoleClick);
  const familyLinks = page.getByRole("navigation", {name: "Abrir movimientos por familia principal"}).getByRole("link");
  await expect(familyLinks.first()).toBeVisible();
  if (engine === "uplot") {
    const donutLinks = page.locator(".donut-svg .donut-segment-link");
    await expect(donutLinks).toHaveCount(3);
    expect(await donutLinks.first().getAttribute("href")).toBe(await familyLinks.first().getAttribute("href"));
  }
  const colors = await familyLinks.locator("i").evaluateAll((markers) => markers.map((marker) => getComputedStyle(marker).backgroundColor));
  expect(new Set(colors).size).toBe(colors.length);
  await page.getByText("Importes exactos y subcategorías", {exact: true}).first().click();
  await expect(categoryTable(page)).toBeVisible();

  const familyLink = familyLinks.first();
  const href = await familyLink.getAttribute("href");
  expect(href).toContain("category_family=");
  expect(href).toContain("statistics_attribution=purchase");
  const filteredRequest = page.waitForRequest((request) => {
    const requestUrl = new URL(request.url());
    return requestUrl.pathname === "/api/transactions/"
      && Boolean(requestUrl.searchParams.get("category_family"))
      && requestUrl.searchParams.get("statistics_attribution") === "purchase";
  });
  await familyLink.focus();
  await expect(familyLink).toBeFocused();
  await page.keyboard.press("Enter");
  const requestParams = new URL((await filteredRequest).url()).searchParams;
  await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get("category_family")).toBeTruthy();
  expect(params.get("statistics_attribution")).toBe("purchase");
  expect(requestParams.get("category_family")).toBe(params.get("category_family"));
  expect(requestParams.get("statistics_attribution")).toBe("purchase");
  expect(requestParams.get("date_from")).toBeTruthy();
  expect(requestParams.get("date_to")).toBeTruthy();
  await expect(page.getByText("Detalle estadístico por compra")).toBeVisible();
  assertNoPageErrors();
});

test("la matriz de categorías conserva su lectura y navegación en desktop y móvil @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, "/?tab=statistics");
  await waitForStatistics(page);

  const advancedAnalysis = page.locator(".stats-advanced-analysis");
  const advancedSummary = advancedAnalysis.locator(":scope > summary");
  await advancedSummary.focus();
  await page.keyboard.press("Enter");
  await expect(advancedAnalysis).toHaveAttribute("open", "");
  const matrix = page.getByRole("table", {name: "Gasto neto de cada familia por mes"});
  await expect(matrix).toBeVisible();
  const matrixRegion = page.getByRole("region", {name: "Matriz de gasto por familia y mes"});
  const reportResponse = await page.request.get("/api/statistics/?period=12&basis=analytics");
  const payload = await reportResponse.json() as StatisticsPayload;
  const expectedMatrix = payload.analysis!.category_matrix;
  await expect(matrixRegion.locator("thead th:not(:first-child)")).toHaveCount(expectedMatrix.months.length);
  await expect(matrixRegion.locator("tbody td")).toHaveCount(expectedMatrix.rows.reduce((count, row) => count + row.values.length, 0));
  const matrixLinks = await matrixRegion.locator("tbody td a").evaluateAll(links => links.map(link => link.getAttribute("href")).sort());
  expect(matrixLinks).toEqual(expectedMatrix.rows.flatMap(row => row.values.filter(value => value.net_expense > 0).map(value => value.movements_url)).sort());

  const positiveCell = matrix.getByRole("link").first();
  await expect(positiveCell).toBeVisible();
  await expect(positiveCell).toHaveAttribute("href", /statistics_attribution=purchase/);
  await expect(positiveCell).toHaveAccessibleName(/€.*Ver movimientos de .+ en .+/);
  const positiveHref = new URL(await positiveCell.getAttribute("href") || "", page.url());
  expect(positiveHref.searchParams.get("category_family")).toBeTruthy();
  expect(positiveHref.searchParams.get("date_from")).toBeTruthy();
  expect(positiveHref.searchParams.get("date_to")).toBeTruthy();

  await page.setViewportSize({width: 840, height: 900});
  const matrixScroll = page.locator(".stats-matrix-scroll");
  await expect(matrixScroll).toBeVisible();
  const scrollMetrics = await matrixScroll.evaluate((element) => ({clientWidth: element.clientWidth, scrollWidth: element.scrollWidth}));
  expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth);
  const matrixDocumentWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(matrixDocumentWidth).toBeLessThanOrEqual(840);
  const scrollBox = await matrixScroll.boundingBox();
  const familyCellBox = await matrix.locator("tbody th").first().boundingBox();
  if (!scrollBox || !familyCellBox) throw new Error("La matriz no expone geometría para comprobar su columna inicial.");
  expect(familyCellBox.x).toBeGreaterThanOrEqual(scrollBox.x);
  expect(familyCellBox.x + familyCellBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 1);

  await page.setViewportSize({width: 390, height: 844});
  const familySelector = page.getByRole("combobox", {name: "Familia para explorar"});
  await expect(familySelector).toBeVisible();
  const selectorHeight = await familySelector.evaluate((element) => element.getBoundingClientRect().height);
  expect(selectorHeight).toBeGreaterThanOrEqual(44);

  const documentWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(documentWidth).toBeLessThanOrEqual(390);

  const mobileMatrix = page.locator(".stats-matrix-mobile-explorer");
  const monthlyLink = mobileMatrix.getByRole("link").first();
  await expect(monthlyLink).toBeVisible();
  await expect(monthlyLink).toHaveAccessibleName(/€.*Ver movimientos de .+ en .+/);

  const selectedFamily = await familySelector.inputValue();
  const familyOptions = familySelector.locator("option");
  const firstFamilyValue = await familyOptions.first().getAttribute("value");
  const alternativeFamily = familyOptions.nth(firstFamilyValue === selectedFamily ? 1 : 0);
  await expect(alternativeFamily).toBeAttached();
  const alternativeValue = await alternativeFamily.getAttribute("value");
  const alternativeName = await alternativeFamily.textContent();
  if (!alternativeValue) throw new Error("La matriz móvil no ofrece una segunda familia seleccionable.");
  await familySelector.selectOption(alternativeValue);
  await expect(familySelector).toHaveValue(alternativeValue);
  await expect(mobileMatrix.getByText("Total del periodo")).toBeVisible();
  await expect(mobileMatrix.locator(".stats-matrix-family-total > span")).toHaveText(alternativeName || "");
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true] as const) {
    test(`G12-G1 Estadísticas ${viewport.label} aplica rango personalizado conservando foco ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let releaseCustom!: () => void;
      let markCustomStarted!: () => void;
      const customGate = new Promise<void>((resolve) => {releaseCustom = resolve;});
      const customStarted = new Promise<void>((resolve) => {markCustomStarted = resolve;});
      let customRequests = 0;
      await page.route("**/api/statistics/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname !== "/api/statistics/" || url.searchParams.get("period") !== "custom") return route.fallback();
        customRequests += 1;
        markCustomStarted();
        await customGate;
        await route.fulfill({response: await route.fetch()});
      });

      try {
        await openApp(page, "/?tab=statistics");
        await waitForStatistics(page);
        await page.getByRole("button", {name: "Cambiar informe"}).click();
        await page.getByRole("button", {name: "Personalizado"}).click();
        await replaceControlledInput(page.getByLabel("Desde"), "2026-01-01");
        await replaceControlledInput(page.getByLabel("Hasta"), todayInMadrid());
        const apply = page.locator(".stats-custom-range-row button[type=submit]");
        await expect(apply).toHaveAccessibleName("Aplicar rango");
        await apply.scrollIntoViewIfNeeded();
        await apply.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const applyTop = (await apply.boundingBox())?.y;
        const summaryPanel = page.locator(".stats-summary-panel");
        const previousSummary = await summaryPanel.innerText();
        await apply.press("Enter");
        await customStarted;

        await expect(apply).toHaveAttribute("aria-disabled", "true");
        await expect(apply).toHaveAttribute("aria-busy", "true");
        expect(await apply.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(apply).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect((await apply.boundingBox())?.y).toBeCloseTo(applyTop!, 0);
        expect(await summaryPanel.innerText()).toBe(previousSummary);
        await apply.evaluate((button) => (button as HTMLButtonElement).form?.requestSubmit(button as HTMLButtonElement));
        expect(customRequests).toBe(1);

        releaseCustom();
        await expect(apply).toHaveAccessibleName("Aplicar rango");
        await expect(apply).toBeFocused();
        await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
        await expect(summaryPanel).toBeVisible();
        expect(customRequests).toBe(1);
        assertNoPageErrors();
      } finally {
        releaseCustom();
      }
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  test(`el detalle mensual vacío conserva selector y scroll en ${viewport.label} @webkit-only`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.emulateMedia({reducedMotion: "reduce"});
    await openApp(page, "/?tab=statistics");
    await waitForStatistics(page);
    await waitForStableStatisticsLayout(page);

    const selector = monthSelector(page);
    await selector.scrollIntoViewIfNeeded();
    await selector.focus();
    const selectorDocumentTop = await selector.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    const scrollLimit = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await page.evaluate((target) => window.scrollTo(0, target), Math.min(Math.max(0, selectorDocumentTop - 140), scrollLimit));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const selectorTopBefore = (await selector.boundingBox())?.y;
    expect(scrollBefore).toBeGreaterThan(0);
    expect(selectorTopBefore).not.toBeUndefined();

    const selectedMonth = await selectMonthWithStatus(page, "unknown");
    const detailPanel = page.locator(".stats-month-detail-panel");
    await expect(selector).toHaveValue(selectedMonth);
    await expect(detailPanel.getByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.")).toBeVisible();
    await expect(detailPanel.locator("canvas")).toHaveCount(0);
    await expect(detailPanel.getByRole("table", {name: "Datos diarios del mes seleccionado"})).toHaveCount(0);
    await expect(selector).toBeFocused();
    await waitForStableStatisticsLayout(page);
    // WebKit may adjust document scroll as the summary below the focused control appears;
    // the user-visible invariant is that the focused selector stays at the same viewport position.
    expect((await selector.boundingBox())?.y).toBeCloseTo(selectorTopBefore!, 0);
    assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  test(`el informe conserva foco y scroll cuando el resultado pasa a vacío en ${viewport.label} @webkit-only`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.emulateMedia({reducedMotion: "reduce"});
    let releaseEmptyReport!: () => void;
    let markEmptyReportStarted!: () => void;
    const emptyReportGate = new Promise<void>((resolve) => {releaseEmptyReport = resolve;});
    const emptyReportStarted = new Promise<void>((resolve) => {markEmptyReportStarted = resolve;});
    await page.route("**/api/statistics/?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("basis") !== "all") return route.continue();
      markEmptyReportStarted();
      await emptyReportGate;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(emptyStatisticsFixture)});
    });

    try {
      await openApp(page, "/?tab=statistics");
      await waitForStatistics(page);
      await expect(page.locator(".stats-trend-panel .chart-block")).toBeVisible();
      const trigger = page.locator(".stats-edit-scope");
      await trigger.focus();
      await trigger.press("Enter");
      const allCategories = page.getByRole("button", {name: "Todas las categorías"});
      await expect(allCategories).toBeVisible();
      await allCategories.scrollIntoViewIfNeeded();
      await allCategories.focus();
      await page.evaluate(() => window.scrollTo(0, Math.min(120, document.documentElement.scrollHeight - innerHeight)));
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const filterTopBefore = (await allCategories.boundingBox())?.y;
      const previousSummary = await page.getByRole("region", {name: "Resultado del periodo"}).innerText();
      expect(scrollBefore).toBeGreaterThan(0);
      expect(filterTopBefore).not.toBeUndefined();

      await allCategories.press("Enter");
      await emptyReportStarted;
      await expect(page.locator('.stats-view[aria-busy="true"]')).toBeVisible();
      await expect(page.locator(".stats-trend-panel .chart-block")).toBeVisible();
      expect(await page.getByRole("region", {name: "Resultado del periodo"}).innerText()).toBe(previousSummary);
      await expect(allCategories).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      releaseEmptyReport();
      await expect(page.getByText("No hay movimientos reportables en este periodo y la cobertura no está acreditada. El gasto es desconocido, no cero demostrado. Amplía el rango, cambia la base o registra movimientos para generar la evolución.")).toBeVisible();
      await expect(page.locator(".stats-trend-panel")).toHaveCount(0);
      await expect(page.locator(".stats-category-panel")).toHaveCount(0);
      const emptySummary = page.getByRole("region", {name: "Resultado del periodo"});
      await expect(emptySummary).toContainText("Desconocido");
      await expect(emptySummary).not.toContainText("0,00 €");
      await expect(allCategories).toBeFocused();
      const scrollAfter = await page.evaluate(() => window.scrollY);
      const filterTopAfter = (await allCategories.boundingBox())?.y;
      expect(scrollAfter).toBe(scrollBefore);
      expect(Math.abs(filterTopAfter! - filterTopBefore!)).toBeLessThanOrEqual(1.5);
      assertNoPageErrors();
    } finally {
      releaseEmptyReport();
    }
  });
}

test("un error inicial ofrece reintento y recupera el informe @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  let failStatistics = true;
  await page.route("**/api/statistics/?**", async (route) => {
    if (failStatistics) {
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Fallo E2E controlado"})});
      return;
    }
    await route.continue();
  });

  await openApp(page, "/?tab=statistics");
  await expect(page.getByRole("alert")).toHaveText("Fallo E2E controlado");
  failStatistics = false;
  const recovered = page.waitForResponse((response) => response.url().includes("/api/statistics/?") && response.ok());
  await page.getByRole("button", {name: "Reintentar"}).click();
  await recovered;
  await waitForStatistics(page);
  assertNoPageErrors();
});

for (const viewport of [320, 390, 768, 1280]) {
  const browserTag = viewport === 320 || viewport === 768 ? "@webkit-only" : "@chromium-only";
  test(`no desborda y mantiene objetivos táctiles a ${viewport}px ${browserTag}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport, height: 900});
    await openApp(page, "/?tab=statistics");
    await waitForStatistics(page);
    const categoryNavigation = page.getByRole("navigation", {name: "Abrir movimientos por familia principal"});
    await expect(categoryNavigation.getByRole("link").first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const visibleControls = [...document.querySelectorAll<HTMLElement>("#main-content button, #main-content a[href], #main-content input, #main-content select, #main-content summary")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        });
      // Donut anchors have a nonrectangular SVG stroke hit area; the adjacent list is the full-size touch target.
      const rectangularControls = visibleControls.filter((element) => !element.closest(".donut-svg"));
      const shortCategoryLinks = [...document.querySelectorAll<HTMLElement>(".stats-category-quick-links a")]
        .filter((element) => element.getClientRects().length > 0 && element.getBoundingClientRect().height < 43.5)
        .map((element) => element.textContent?.trim() || element.getAttribute("aria-label") || "category link");
      const monthlyTable = document.querySelector<HTMLElement>(".monthly-series-table table");
      const tableAncestors = [];
      for (let element = monthlyTable?.parentElement; element && tableAncestors.length < 10; element = element.parentElement) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        tableAncestors.push({
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().replace(/\s+/g, ".")}` : ""}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          minWidth: style.minWidth,
          overflowX: style.overflowX,
          display: style.display,
        });
      }
      return {
        documentWidth: Math.max(root.scrollWidth, body.scrollWidth),
        viewportWidth: root.clientWidth,
        shortControls: rectangularControls.filter((element) => element.getBoundingClientRect().height < 43.5).map((element) => element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName),
        shortCategoryLinks,
        overflowing: [...document.body.querySelectorAll<HTMLElement>("*")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.right > root.clientWidth + 1 || rect.left < -1;
          })
          .slice(0, 12)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().replace(/\s+/g, ".")}` : ""}`,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            };
          }),
        tableAncestors,
        categoryTop: document.querySelector<HTMLElement>(".stats-category-panel")?.offsetTop ?? null,
        summaryTop: document.querySelector<HTMLElement>(".stats-summary-panel")?.offsetTop ?? null,
        filtersVisible: Boolean(document.querySelector<HTMLElement>(".stats-filter-panel")?.getClientRects().length),
      };
    });
    expect(geometry.documentWidth, JSON.stringify({overflowing: geometry.overflowing, tableAncestors: geometry.tableAncestors}, null, 2)).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.shortControls).toEqual([]);
    expect(geometry.shortCategoryLinks).toEqual([]);
    if (viewport <= 390) {
      expect(geometry.categoryTop).not.toBeNull();
      expect(geometry.summaryTop).not.toBeNull();
      expect(geometry.summaryTop!).toBeLessThan(900);
      expect(geometry.filtersVisible).toBe(false);
      expect(geometry.categoryTop!).toBeGreaterThan(geometry.summaryTop!);
      await expect(page.getByRole("button", {name: "Cambiar informe"})).toBeVisible();
      await page.getByRole("button", {name: "Cambiar informe"}).click();
      await expect(page.getByText("A medida", {exact: true})).toBeVisible();
      await expect(monthlyTableDisclosure(page)).toBeVisible();
    }
    assertNoPageErrors();
  });
}

for (const viewport of [
  {width: 320, height: 844},
  {width: 1280, height: 900},
]) {
  test(`captura la pantalla estadística completa a ${viewport.width}px`, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime("2026-11-03T12:00:00+01:00");
    await page.route(/\/api\/statistics\/\?period=12&basis=analytics$/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statisticsScreenshotFixture),
    }));
    await openApp(page, "/?tab=statistics");
    await waitForStatistics(page);
    await expect(page.locator(".stats-month-detail-panel")).toHaveCount(0);
    const previousLabels = page.locator(".stats-previous-label");
    await expect(previousLabels).toHaveCount(3);
    for (const label of await previousLabels.all()) {
      if (viewport.width <= 832) await expect(label).toBeHidden();
      else await expect(label).toBeVisible();
    }
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".stats-category-panel")).toBeVisible();
    await expect(page.locator(".stats-money-map")).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const chartEngine = await page.locator(".stats-view").getAttribute("data-chart-engine");
    if (chartEngine === "ag-charts") {
      const chartCanvasPixels = await page.locator(".ag-chart-shell canvas, .ag-donut-shell canvas").evaluateAll((canvases) => canvases.map((canvas) => {
        const element = canvas as HTMLCanvasElement;
        const context = element.getContext("2d");
        if (!context || !element.width || !element.height) return 0;
        const data = context.getImageData(0, 0, element.width, element.height).data;
        let painted = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index] > 0) painted += 1;
        return painted;
      }));
      expect(chartCanvasPixels, "AG Charts debe pintar la serie y el donut.").toHaveLength(2);
      expect(chartCanvasPixels.every((painted) => painted > 0), JSON.stringify(chartCanvasPixels)).toBe(true);
    } else {
      const lineChartPainted = await page.locator(".uplot-chart-shell canvas").evaluate((canvas) => {
        const element = canvas as HTMLCanvasElement;
        const context = element.getContext("2d");
        if (!context || !element.width || !element.height) return 0;
        const data = context.getImageData(0, 0, element.width, element.height).data;
        let painted = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index] > 0) painted += 1;
        return painted;
      });
      expect(lineChartPainted, "UPlot debe pintar la serie mensual.").toBeGreaterThan(0);
      const renderedShares = await page.locator(".donut-svg").evaluate(async (source) => {
        const clone = source.cloneNode(true) as SVGSVGElement;
        clone.setAttribute("width", "480");
        clone.setAttribute("height", "480");
        const sourceShapes = source.querySelectorAll("circle, path");
        const clonedShapes = clone.querySelectorAll("circle, path");
        sourceShapes.forEach((shape, index) => {
          const style = getComputedStyle(shape);
          const target = clonedShapes[index] as SVGGeometryElement;
          if (shape.classList.contains("donut-track")) target.style.opacity = "0";
          target.style.strokeWidth = style.strokeWidth;
          target.style.fill = style.fill;
          target.style.stroke = style.stroke;
          target.style.vectorEffect = style.vectorEffect;
        });
        const blobUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type: "image/svg+xml"}));
        try {
          const image = new Image();
          image.src = blobUrl;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 480;
          canvas.height = 480;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No se pudo crear el canvas de validación del donut.");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const segmentColors = [...source.querySelectorAll<SVGGeometryElement>(".donut-segment")].map((segment) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = getComputedStyle(segment).stroke;
            context.fillRect(0, 0, 1, 1);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            return [pixel[0], pixel[1], pixel[2]] as const;
          });
          const counts = segmentColors.map(() => 0);
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 96) continue;
            let nearest = -1;
            let distance = Number.POSITIVE_INFINITY;
            segmentColors.forEach(([red, green, blue], colorIndex) => {
              const candidate = Math.hypot(pixels[index] - red, pixels[index + 1] - green, pixels[index + 2] - blue);
              if (candidate < distance) {
                distance = candidate;
                nearest = colorIndex;
              }
            });
            if (distance < 72 && nearest >= 0) counts[nearest] += 1;
          }
          const total = counts.reduce((sum, count) => sum + count, 0);
          return counts.map((count) => total ? count / total : 0);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      });
      const categories = statisticsScreenshotFixture.categories.filter((category) => category.net_expense > 0);
      const totalExpense = categories.reduce((sum, category) => sum + category.net_expense, 0);
      expect(renderedShares).toHaveLength(categories.length);
      for (const [index, category] of categories.entries()) {
        const share = (category.net_expense / totalExpense) * 100;
        const expectedVisibleShare = Math.max(share - Math.min(0.8, share / 3), 0);
        const totalVisibleShare = categories.reduce((sum, item) => {
          const itemShare = (item.net_expense / totalExpense) * 100;
          return sum + Math.max(itemShare - Math.min(0.8, itemShare / 3), 0);
        }, 0);
        expect(Math.abs(renderedShares[index] - expectedVisibleShare / totalVisibleShare), `Píxeles visibles del donut para ${category.family_name}`).toBeLessThanOrEqual(0.03);
      }
    }
    await expect(page).toHaveScreenshot(`statistics-full-${viewport.width}-${testInfo.project.name}.png`, {
      fullPage: true,
      // Full-page Geist rasterization varies slightly between Chromium processes;
      // geometry, copy, colors and the whole report still remain under snapshot control.
      maxDiffPixelRatio: 0.015,
    });
    assertNoPageErrors();
  });
}
