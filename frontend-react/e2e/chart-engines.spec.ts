import {expect, test, type BrowserContext, type Page} from "playwright/test";
import {installPageErrorGuard} from "./helpers";
import type {StatisticsPayload} from "../src/features/statistics/types";

const U_PLOT_ORIGIN = "http://127.0.0.1:8445";
const AG_CHARTS_ORIGIN = "http://127.0.0.1:8446";

const isAgAsset = (url: string) => /(?:engines\/ag|ag-charts)/i.test(url);
const isUPlotAsset = (url: string) => /(?:engines\/(?:uplot|svg)|uplot)/i.test(url);

async function activateAgMonthlyPoint(page: Page) {
  const chart = page.locator('.ag-chart-shell [role=img][tabindex="0"]').first();
  await chart.focus();
  await expect(chart).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".ag-chart-shell .ag-charts-tooltip").first()).toBeVisible();
  await page.keyboard.press("Enter");
}

async function activateAgCategorySector(page: Page) {
  const shell = page.locator(".ag-donut-shell").first();
  await shell.scrollIntoViewIfNeeded();
  const box = await shell.boundingBox();
  if (!box) throw new Error("AG Charts no expone el donut de categorías.");
  const initialUrl = page.url();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(initialUrl);
  const chart = shell.locator('[role=img][tabindex="0"]').first();
  await chart.focus();
  await expect(chart).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(shell.locator(".ag-charts-tooltip").first()).toBeVisible();
  await page.keyboard.press("Enter");
}

async function inspectEngine(context: BrowserContext, origin: string, engine: "uplot" | "ag-charts") {
  const page = await context.newPage();
  const assertNoPageErrors = installPageErrorGuard(page);
  const scripts: string[] = [];
  const invalidLocaleWarnings: string[] = [];
  page.on("console", (message) => {
    if (engine === "ag-charts" && message.type() === "warning" && /unknown option.*localeText/i.test(message.text())) {
      invalidLocaleWarnings.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });

  await page.goto(`${origin}/?tab=statistics${engine === "ag-charts" ? "&statisticsChartEngine=ag-charts" : ""}`);
  await expect(page.getByRole("heading", {name: "Resultado del periodo"})).toBeVisible();
  await expect(
    page.locator(`.stats-view[data-chart-engine="${engine}"][aria-busy="false"]`),
  ).toBeVisible({timeout: 30_000});
  await expect(page.getByLabel("Mes para profundizar")).toBeVisible({timeout: 30_000});
  await expect(page.getByRole("navigation", {name: "Abrir movimientos por familia principal"})).toBeVisible({timeout: 30_000});
  await page.getByText("Tabla mensual completa", {exact: true}).click();
  await expect(page.getByRole("table", {name: "Datos de evolución mensual"})).toBeVisible({timeout: 30_000});
  if (engine === "ag-charts") {
    await expect(page.locator(".ag-chart-shell canvas").first()).toBeVisible();
    await expect(page.locator(".ag-donut-shell canvas").first()).toBeVisible();
    await expect(page.getByRole("figure", {name: "gráfico, 3 series", exact: true})).toBeVisible();
    await expect(page.getByRole("figure", {name: "gráfico, 1 serie", exact: true})).toBeVisible();
    await activateAgMonthlyPoint(page);
  } else {
    await expect(page.locator(".uplot-chart-shell canvas").first()).toBeVisible();
    await expect(page.locator(".donut-svg").first()).toBeVisible();
    const interactionLayer = page.locator(".uplot-chart-shell .u-over").first();
    const box = await interactionLayer.boundingBox();
    if (!box) throw new Error("uPlot no expone la serie mensual.");
    await interactionLayer.click({position: {x: box.width * 0.55, y: box.height * 0.45}});
  }
  await expect(page.getByLabel("Mes para profundizar")).not.toHaveValue("");
  await expect(page.locator(".chart-inspector").first()).toBeVisible();
  await expect(page.getByRole("heading", {name: /Detalle mensual/})).toBeVisible();
  if (engine === "ag-charts") {
    await activateAgCategorySector(page);
    await expect(page).toHaveURL(/tab=transactions/);
    expect(invalidLocaleWarnings).toEqual([]);
  }
  await page.waitForLoadState("networkidle");
  assertNoPageErrors();
  await page.close();
  return scripts;
}

async function inspectUnknownMonth(context: BrowserContext, origin: string, engine: "uplot" | "ag-charts") {
  const page = await context.newPage();
  const assertNoPageErrors = installPageErrorGuard(page);
  let unknownMonth = "";
  await page.route("**/api/statistics/?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as StatisticsPayload;
    const point = payload.monthly_series.find((item) => item.activity_status === "recorded");
    if (!point) throw new Error("La semilla del informe debe incluir un mes con actividad para probar un mes vacío adyacente.");
    unknownMonth = point.month;
    point.activity_status = "unknown";
    point.income = 0;
    point.net_expense = 0;
    point.refunds_applied = 0;
    point.analytical_result = 0;
    point.savings_rate = null;
    point.expense_change = null;
    point.result_change = null;
    payload.analysis?.category_matrix.months.forEach((month) => {
      if (month.month === point.month) month.activity_status = "unknown";
    });
    payload.comparison.is_comparable = false;
    await route.fulfill({response, json: payload});
  });

  await page.goto(`${origin}/?tab=statistics${engine === "ag-charts" ? "&statisticsChartEngine=ag-charts" : ""}`);
  await expect(page.locator(`.stats-view[data-chart-engine="${engine}"][aria-busy="false"]`)).toBeVisible({timeout: 30_000});
  await expect(page.getByRole("status", {name: "Cobertura estadística"})).toContainText("sin cobertura acreditada");
  expect(unknownMonth).toBeTruthy();
  const unknownMonthLabel = new Intl.DateTimeFormat("es-ES", {month: "long", year: "numeric"}).format(new Date(`${unknownMonth}-01T00:00:00`));
  await page.getByLabel("Mes para profundizar").selectOption(unknownMonth!);
  await expect(page.getByRole("group", {name: `Resumen de ${unknownMonthLabel}`})).toContainText("El gasto es desconocido");
  await expect(page.getByRole("heading", {name: /Detalle mensual/})).toBeVisible();
  await expect(page.getByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.")).toBeVisible();

  await page.getByText("Tabla mensual completa", {exact: true}).click();
  await expect(page.getByRole("table", {name: "Datos de evolución mensual"}).getByRole("row", {name: new RegExp(unknownMonthLabel)})).toContainText("Cobertura no acreditada");
  await page.getByText("Análisis avanzado", {exact: true}).click();
  const matrix = page.getByRole("table", {name: "Gasto neto de cada familia por mes"});
  await expect(matrix.getByText(`Gasto desconocido; cobertura no acreditada en ${unknownMonthLabel}`).first()).toBeVisible();

  if (engine === "ag-charts") await expect(page.locator(".ag-chart-shell canvas").first()).toBeVisible();
  else await expect(page.locator(".uplot-chart-shell canvas").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  assertNoPageErrors();
  await page.close();
}

test("cada puerto carga un único motor y comparte las tablas semánticas", async ({context}) => {
  const uplotScripts = await inspectEngine(context, U_PLOT_ORIGIN, "uplot");
  expect(uplotScripts.some(isUPlotAsset)).toBe(true);
  expect(uplotScripts.some(isAgAsset)).toBe(false);

  const agChartsScripts = await inspectEngine(context, AG_CHARTS_ORIGIN, "ag-charts");
  expect(agChartsScripts.some(isAgAsset)).toBe(true);
  expect(agChartsScripts.some(isUPlotAsset)).toBe(false);
});

test("ambos motores dejan huecos y explican meses sin cobertura acreditada", async ({context}) => {
  await inspectUnknownMonth(context, U_PLOT_ORIGIN, "uplot");
  await inspectUnknownMonth(context, AG_CHARTS_ORIGIN, "ag-charts");
});

test("uPlot dibuja discontinuo el extremo del periodo parcial", async ({context}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const patterns: number[][] = [];
    const setLineDash = CanvasRenderingContext2D.prototype.setLineDash;
    CanvasRenderingContext2D.prototype.setLineDash = function (segments) {
      patterns.push([...segments]);
      return setLineDash.call(this, segments);
    };
    (window as Window & {__chartLineDashPatterns?: number[][]}).__chartLineDashPatterns = patterns;
  });
  await page.route("**/api/statistics/?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as StatisticsPayload;
    if (!payload.monthly_series[0]) throw new Error("La semilla estadística debe contener al menos un mes.");
    payload.monthly_series[0].is_partial = true;
    await route.fulfill({response, json: payload});
  });
  await page.goto(`${U_PLOT_ORIGIN}/?tab=statistics`);
  await expect(page.locator('.stats-view[data-chart-engine="uplot"][aria-busy="false"]')).toBeVisible({timeout: 30_000});
  await expect(page.locator(".chart-partial-description")).toContainText("segmentos discontinuos");
  expect(await page.evaluate(() => (window as Window & {__chartLineDashPatterns?: number[][]}).__chartLineDashPatterns?.some((pattern) => pattern.join(",") === "5,4"))).toBe(true);
  await page.close();
});

test("uPlot carga bajo la CSP de Nginx sin infracciones", async ({context}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective}: ${event.blockedURI}`));
    (window as Window & {__cspViolations?: string[]}).__cspViolations = violations;
  });
  await page.route((url) => url.origin === U_PLOT_ORIGIN && url.pathname === "/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      },
    });
  });
  const documentResponse = await page.goto(`${U_PLOT_ORIGIN}/?tab=statistics`);
  expect(await documentResponse?.headerValue("content-security-policy")).toContain("default-src 'self'");
  await expect(page.locator('.stats-view[data-chart-engine="uplot"][aria-busy="false"]')).toBeVisible({timeout: 30_000});
  await expect(page.locator(".uplot-chart-shell canvas").first()).toBeVisible();
  await expect(page.locator(".donut-svg").first()).toBeVisible();
  expect(await page.evaluate(() => (window as Window & {__cspViolations?: string[]}).__cspViolations)).toEqual([]);
  await page.close();
});
