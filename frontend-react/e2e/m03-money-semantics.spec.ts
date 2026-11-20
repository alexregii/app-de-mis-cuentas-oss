import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

for (const width of [320, 390, 1280]) {
  test(`M03 separa saldo, resultado y margen previsto a ${width}px${width === 320 || width === 390 ? " @webkit-only" : " @chromium-only"}`, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width, height: 900});
    await page.route("**/api/bootstrap/", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.preferences = {...payload.preferences, content_mode: "full", hidden_widgets: []};
      payload.metrics = {...payload.metrics, total_balance: 0, income: 0, expense: 0, net_savings: 0, expected_income: 3000, commitments: 0, savings_goal: 0, safe_to_spend: 3000};
      payload.accounts = payload.accounts.map((account: Record<string, unknown>) => ({...account, balance: 0, opening_balance: 0}));
      payload.dashboard.account_balances = payload.dashboard.account_balances.map((account: Record<string, unknown>) => ({...account, balance: 0}));
      await route.fulfill({response, body: JSON.stringify(payload)});
    });
    await page.route(/\/api\/planning\/\?month=/, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.margin = {expected_income: 3000, confirmed_expense: 0, pending_recurring: 0, savings_goal: 0, available: 3000};
      payload.goal = {...payload.goal, active: false, target: 0};
      payload.projection = {...payload.projection, sufficient: false};
      payload.metrics = {...payload.metrics, total_balance: 0, income: 0, expense: 0, net_savings: 0, expected_income: 3000, commitments: 0, savings_goal: 0, safe_to_spend: 3000};
      await route.fulfill({response, body: JSON.stringify(payload)});
    });

    await openApp(page, "/?tab=dashboard");
    const dashboard = page.getByRole("region", {name: "Estado del mes"});
    await expect(dashboard).toContainText("Saldo registrado");
    await expect(dashboard.locator(".financial-balance > strong")).toContainText("0,00");
    await expect(dashboard).toContainText("Resultado del mes");
    await expect(dashboard.locator(".dashboard-safe-spend-note")).toContainText("Margen mensual previsto");
    await expect(dashboard.locator(".dashboard-safe-spend-note")).toContainText(/3\.?000,00/);
    await expect(dashboard.locator(".dashboard-safe-spend-note")).toContainText("Incluye ingresos recurrentes pendientes; no es saldo.");
    await expect(dashboard).not.toContainText("Gasto seguro");
    await expect(dashboard).not.toContainText("Disponible hasta final de mes");
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width);
    await page.screenshot({path: testInfo.outputPath(`m03-dashboard-${width}.png`), fullPage: true});

    if (width === 390) {
      await page.getByRole("button", {name: "Ocultar importes"}).click();
      await expect(dashboard.locator(".dashboard-safe-spend-note")).toContainText("•••• €");
      await expect(page.locator("body")).not.toContainText(/3\.?000,00/);
      expect(await page.locator('[aria-label*="3000"], [title*="3000"]').count()).toBe(0);
    }

    await dashboard.getByRole("button", {name: "Ver desglose en Plan"}).click();
    await expect(page.getByRole("heading", {name: "Plan", exact: true})).toBeVisible();
    const margin = page.locator(".planning-margin-panel");
    if (width === 390) {
      await expect(margin).toContainText("•••• €");
      await expect(margin).not.toContainText(/3\.?000,00/);
      await page.getByRole("button", {name: "Mostrar importes"}).click();
    }
    await expect(margin).toContainText("Margen mensual previsto");
    await expect(margin).toContainText(/3\.?000,00/);
    await expect(margin).toContainText("Ingresos esperados, incluidos pendientes");
    await expect(margin).toContainText("Gasto confirmado");
    await expect(margin).toContainText("Recurrentes pendientes");
    await expect(margin).toContainText("No equivale al saldo");
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width);
    await page.screenshot({path: testInfo.outputPath(`m03-planning-${width}.png`), fullPage: true});

    await openApp(page, "/?tab=statistics&period=6&basis=all");
    await expect(page.locator(".stats-scope-meta")).toContainText("Todas las categorías");
    const result = page.getByRole("region", {name: "Resultado del periodo"});
    await expect(result).toContainText("Ingresos menos gasto neto");
    await expect(result).toContainText("no equivale al saldo por cuenta");
    await expect(page.locator(".chart-engine-loading")).toHaveCount(0);
    const chartEngine = await page.locator(".stats-view").getAttribute("data-chart-engine");
    if (chartEngine === "ag-charts") {
      await expect(page.locator(".ag-chart-shell canvas").first()).toBeVisible();
      await expect(page.locator(".ag-donut-shell canvas").first()).toBeVisible();
    } else {
      await expect(page.locator(".uplot-chart-shell canvas").first()).toBeVisible();
      await expect(page.locator(".donut-svg .donut-segment").first()).toBeVisible();
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width);
    await page.screenshot({path: testInfo.outputPath(`m03-statistics-${width}.png`), fullPage: true});
    if (width === 390) {
      await page.getByRole("button", {name: "Ocultar importes"}).click();
      await expect(result).not.toContainText(/\d[\d.,]*\s*€/);
      const accessibleCopy = await result.locator("[aria-label], [title]").evaluateAll((elements) =>
        elements.map((element) => `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`).join(" "));
      expect(accessibleCopy).not.toMatch(/\d[\d.,]*\s*€/);
    }

    assertNoPageErrors();
  });
}
