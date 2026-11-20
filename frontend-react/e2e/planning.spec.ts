import {readFileSync} from "node:fs";
import {expect, test, type Locator, type Page} from "playwright/test";
import {installPageErrorGuard, openApp, resetE2eDatabase} from "./helpers";
const planningFixture = JSON.parse(readFileSync(new URL("./fixtures/planning-2026-09-08.json", import.meta.url), "utf8"));

test.beforeEach(async ({}, testInfo) => resetE2eDatabase(testInfo.project.name));

async function openSavingsGoal(page: Page) {
  const panel = page.locator(".planning-savings-goal");
  await panel.getByRole("button", {name: "Expandir objetivo de ahorro", exact: true}).click();
  await expect(panel.getByLabel("Porcentaje")).toBeVisible();
}

function addIsoDays(value: string, days: number) {
  const result = new Date(`${value}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function liquidityFlow(sourceId: number, accountId: number, date: string, kind: "income" | "expense", state: "confirmed" | "forecast", amount: number, description: string) {
  return {
    source_id: sourceId,
    account_id: accountId,
    date,
    kind,
    state,
    amount,
    signed_amount: kind === "expense" ? -amount : amount,
    description,
    origin: state === "confirmed" ? "manual" : "recurring",
    transfer_group: "",
  };
}

function liquidityPayload(accountId: number, dateFrom: string, dateTo: string) {
  const account = planningFixture.accounts.find((item: {id: number}) => item.id === accountId) ?? planningFixture.accounts[0];
  const salary = liquidityFlow(9, accountId, dateFrom, "income", "forecast", 80, "Nómina pendiente");
  const rent = liquidityFlow(10, accountId, dateFrom, "expense", "forecast", 20, "Alquiler previsto");
  const subscription = liquidityFlow(11, accountId, dateFrom, "expense", "forecast", 10, "Suscripción prevista");
  const purchase = liquidityFlow(21, accountId, addIsoDays(dateFrom, 1), "expense", "confirmed", 200, "Factura médica");
  const dailySeries = [];
  let running = 100;
  let minimumBalance = running;
  let minimumDate = dateFrom;
  let firstDeficitDate: string | null = running < 0 ? dateFrom : null;
  for (let date = dateFrom; date <= dateTo; date = addIsoDays(date, 1)) {
    const confirmed = date === purchase.date ? [purchase] : [];
    const forecast = date === dateFrom ? [salary, rent, subscription] : [];
    const confirmedNet = confirmed.reduce((total, item) => total + item.signed_amount, 0);
    const forecastNet = forecast.reduce((total, item) => total + item.signed_amount, 0);
    const opening = running;
    const closing = opening + confirmedNet + forecastNet;
    const day = {
      date,
      opening_balance: opening,
      closing_balance: closing,
      confirmed_net_cashflow: confirmedNet,
      forecast_net_cashflow: forecastNet,
      confirmed_income: 0,
      confirmed_expense: confirmed.reduce((total, item) => total + item.amount, 0),
      confirmed_transfer_net: 0,
      forecast_income: forecast.filter((item) => item.kind === "income").reduce((total, item) => total + item.amount, 0),
      forecast_expense: forecast.filter((item) => item.kind === "expense").reduce((total, item) => total + item.amount, 0),
      forecast_transfer_net: 0,
      cashflows: [...confirmed, ...forecast],
    };
    dailySeries.push(day);
    if (closing < minimumBalance) {
      minimumBalance = closing;
      minimumDate = date;
    }
    if (firstDeficitDate === null && closing < 0) firstDeficitDate = date;
    running = closing;
  }
  const accountResult = {
    account_id: accountId,
    name: account.name,
    status: "known",
    starting_balance: 100,
    provenance: {kind: "bank_booked_balance", cut_date: addIsoDays(dateFrom, -1), observed_at: "2026-09-08T10:00:00Z", balance_type: "CLBD", currency: "EUR"},
    unknown_reasons: [],
    starting_adjustments: [],
    minimum_balance: minimumBalance,
    minimum_date: minimumDate,
    first_deficit_date: firstDeficitDate,
    daily_series: dailySeries,
  };
  return {
    date_from: dateFrom,
    date_to: dateTo,
    currency: "EUR",
    status: "known",
    accounts: [accountResult],
    starting_balance: 100,
    daily_series: dailySeries.map((day) => ({...day, accounts: [{account_id: accountId, status: "known", balance: day.closing_balance}]})),
    minimum_balance: minimumBalance,
    minimum_date: minimumDate,
    first_deficit_date: firstDeficitDate,
    assumptions: ["Los saldos son cierres diarios."],
  };
}

test.beforeEach(async ({page}) => {
  await page.clock.install({time: "2026-09-08T12:00:00+02:00"});
  await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(planningFixture),
  }));
  await page.route("**/api/planning/liquidity/**", (route) => {
    const url = new URL(route.request().url());
    const accountId = Number(url.searchParams.get("account"));
    const dateFrom = url.searchParams.get("date_from") || "2026-09-08";
    const dateTo = url.searchParams.get("date_to") || "2026-10-07";
    return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(liquidityPayload(accountId, dateFrom, dateTo))});
  });
});

test("Plan conserva la geometría, previsión y teclado en anchos clave de la app @webkit-only", async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, "/?tab=planning");
  await expect(page.getByRole("heading", {name: "Plan", exact: true})).toBeVisible();
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    const geometry = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>(".planning-view");
      const margin = document.querySelector<HTMLElement>(".planning-margin-panel");
      const decisions = document.querySelector<HTMLElement>(".planning-decisions-section");
      const composers = document.querySelector<HTMLElement>(".planning-composers");
      const controls = [...document.querySelectorAll<HTMLElement>(".planning-view button, .planning-view input, .planning-view select, .planning-view textarea")]
        .filter((item) => item.getClientRects().length && getComputedStyle(item).visibility !== "hidden")
        .map((item) => item.getBoundingClientRect().height);
      return {
        overflow: view ? view.scrollWidth - view.clientWidth : -1,
        hierarchy: Boolean(margin && decisions && composers && margin.offsetTop < decisions.offsetTop && decisions.offsetTop < composers.offsetTop),
        controls,
        legacyControls: view?.querySelectorAll(".button, .icon-button, .text-button").length ?? -1,
      };
    });
    expect(geometry.overflow, `overflow at ${width}px`).toBe(0);
    expect(geometry.hierarchy, `section order at ${width}px`).toBe(true);
    expect(geometry.controls.every((height) => height >= 44), `touch target at ${width}px`).toBe(true);
    expect(geometry.legacyControls).toBe(0);

    const calendar = page.getByRole("heading", {name: "Calendario financiero", exact: true});
    if (await calendar.count()) {
      await expect(calendar).toBeVisible();
      await expect(page.locator(".planning-calendar-month")).toBeVisible();
    }
    if (width === 320 || width === 1280) {
      await expect(calendar).toBeVisible();
      await expect(page.locator(".planning-calendar-month")).toBeVisible();
      await expect(page).toHaveScreenshot(`planning-full-${width}-${testInfo.project.name}.png`, {
        fullPage: true,
        // Narrow full-page captures vary in text antialiasing between Chromium
        // processes; keep the visual fixture strict enough to catch layout drift.
        maxDiffPixelRatio: 0.03,
      });
    }
  }

  const panel = page.locator(".planning-liquidity-panel");
  await panel.getByRole("button", {name: "Calcular previsión"}).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({width, height: 900});
    await expect(panel.getByText(/Primer déficit:/)).toContainText("9 de septiembre de 2026");
    await expect(panel.getByText("Alquiler previsto")).toBeVisible();
    await expect(panel.locator(".planning-liquidity-causes").getByText("Factura médica")).toBeVisible();
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      controls: [...document.querySelectorAll<HTMLElement>(".planning-liquidity-panel input, .planning-liquidity-panel select, .planning-liquidity-panel button")]
        .filter((item) => item.getClientRects().length)
        .map((item) => item.getBoundingClientRect().height),
    }));
    expect(geometry.overflow, `liquidity overflow at ${width}px`).toBe(0);
    expect(geometry.controls.every((height) => height >= 44), `liquidity touch target at ${width}px`).toBe(true);

    if (width === 320) {
      const firstDay = panel.locator(".planning-liquidity-table-wrap tbody tr button").first();
      await panel.getByText(/Ver cierres diarios/).click();
      await firstDay.click();
      await expect(page).toHaveURL(/liquidity_day=2026-09-08/);
      const date = panel.locator(".planning-liquidity-table-wrap tr").filter({hasText: "Déficit"}).getByRole("button");
      await date.focus();
      await date.press("Enter");
      await expect(date).toHaveAttribute("aria-pressed", "true");
      await expect(panel.getByRole("heading", {name: /Detalle del 9 de septiembre de 2026/i})).toBeVisible();
      await expect(page).toHaveURL(/liquidity_day=2026-09-09/);
      await panel.screenshot({path: testInfo.outputPath(`planning-liquidity-${width}.png`)});
    }
  }

  assertNoPageErrors();
});

test("Plan conserva sus capturas completas en móvil y escritorio @chromium-only", async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, "/?tab=planning");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  for (const width of [320, 1280]) {
    await page.setViewportSize({width, height: 900});
    await expect(page.getByRole("heading", {name: "Plan", exact: true})).toBeVisible();
    await expect(page.locator(".planning-margin-panel")).toBeVisible();
    await expect(page).toHaveScreenshot(`planning-full-${width}-${testInfo.project.name}.png`, {fullPage: true, maxDiffPixelRatio: 0.03});
  }
  assertNoPageErrors();
});

test("Plan conserva escenario y detalle en URL y enlaza a la regla sin filtrar datos sensibles @chromium-only", async ({page}) => {
  const rule = {
    id: 10,
    name: "Alquiler previsto",
    kind: "expense",
    amount: 20,
    account: planningFixture.accounts.find((item: {id: number}) => item.id === 2),
    category: planningFixture.categories.find((item: {kind: string}) => item.kind === "expense"),
    frequency: "monthly",
    frequency_display: "Mensual",
    day_of_month: 8,
    start_date: "2026-09-08",
    end_date: "",
    notes: "",
    active: true,
    lifecycle: "active",
    affects_selected_month: true,
  };
  await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({...planningFixture, rules: [rule]}),
  }));
  let liquidityRequests = 0;
  let documentRequests = 0;
  page.on("request", (request) => {if (request.resourceType() === "document") documentRequests += 1;});
  page.on("request", (request) => {if (new URL(request.url()).pathname === "/api/planning/liquidity/") liquidityRequests += 1;});
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => window.localStorage.setItem("app.preferences.v1", JSON.stringify({version: 1, theme: "basalt", privacyMode: true})));
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/?tab=planning");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await expect(page.locator(".app-frame")).toHaveAttribute("data-theme", "basalt");
  await expect(page.locator(".app-frame")).toHaveClass(/is-privacy-mode/);
  const initialDocumentRequests = documentRequests;
  const panel = page.locator(".planning-liquidity-panel");
  expect(liquidityRequests).toBe(0);

  await panel.getByRole("button", {name: "Calcular previsión"}).click();
  await expect(panel.getByText(/Primer déficit:/)).toContainText("9 de septiembre de 2026");
  await expect.poll(() => liquidityRequests).toBe(1);
  await expect(panel.locator(".money").filter({hasText: "•••• €"}).first()).toBeVisible();

  await page.getByRole("button", {name: "Añadir al plan", exact: true}).click();
  const chooseBudget = page.getByRole("button", {name: "Presupuesto", exact: true});
  await expect(chooseBudget).toBeFocused();
  await chooseBudget.click();
  await expect(page.getByLabel("Mes", {exact: true})).toBeFocused();
  const budgetDraft = page.locator(".planning-composers .collapsible-panel.open form");
  const budgetLimit = budgetDraft.locator('input[name="limit"]');
  await budgetLimit.fill("300");
  await budgetDraft.locator('select[name="category"]').selectOption("3");

  await panel.getByLabel("Cuenta de liquidez").selectOption("2");
  await panel.getByLabel("Desde").fill("2026-09-10");
  await panel.getByLabel("Hasta").fill("2026-10-09");
  await panel.getByLabel("Escenario de liquidez").selectOption("conservador");
  await panel.getByRole("button", {name: "Actualizar previsión"}).click();
  await expect.poll(() => liquidityRequests).toBe(2);
  await expect(page).toHaveURL(/liquidity_account=2/);
  await expect(page).toHaveURL(/liquidity_from=2026-09-10/);
  await expect(page).toHaveURL(/liquidity_to=2026-10-09/);
  await expect(page).toHaveURL(/liquidity_scenario=conservador/);
  await expect(panel.getByText(/Primer déficit:/)).toContainText("11 de septiembre de 2026");
  await expect(panel.getByText("El escenario conservador excluye ingresos previstos y mantiene los gastos previstos.")).toBeVisible();
  await expect(panel.locator(".planning-liquidity-causes li")).toHaveCount(3);

  const transactionLink = panel.getByRole("link", {name: "Ver movimientos"}).first();
  const transactionHref = await transactionLink.getAttribute("href");
  expect(transactionHref).toContain("date_from=2026-09-11");
  expect(transactionHref).toContain("account=2");
  expect(transactionHref).not.toContain("Factura");
  expect(transactionHref).not.toContain("200");

  const recurringLink = panel.getByRole("link", {name: "Ver recurrente"}).first();
  const recurringHref = await recurringLink.getAttribute("href");
  expect(recurringHref).toContain("#planning-recurring-10");
  expect(recurringHref).not.toContain("Alquiler");
  await recurringLink.click();
  await expect(page).toHaveURL(/liquidity_scenario=conservador/);
  await expect(page.locator("#planning-recurring-10")).toBeFocused();
  await expect.poll(() => documentRequests).toBe(initialDocumentRequests);
  await expect(budgetLimit).toHaveValue("300");
});

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "escritorio", width: 1440, height: 900}]) {
  test(`Plan conserva objetivo, foco y posición al separar escritura y refresco en ${viewport.label} @webkit-only`, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});

    let marginReads = 0;
    let goalWrites = 0;
    let failNextMarginRefresh = false;
    let submittedGoal: Record<string, unknown> = {};
    let persistedGoal = {...planningFixture.goal};
    await page.route(/\/api\/planning\/\?month=/, async (route) => {
      if (failNextMarginRefresh) {
        failNextMarginRefresh = false;
        marginReads += 1;
        await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo actualizar el margen."})});
        return;
      }
      if (goalWrites > 0) marginReads += 1;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({...planningFixture, goal: persistedGoal})});
    });
    await page.route("**/api/settings/savings-goal/", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      goalWrites += 1;
      submittedGoal = route.request().postDataJSON() as Record<string, unknown>;
      if (goalWrites === 1) {
        await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "Objetivo de prueba rechazado."})});
        return;
      }
      persistedGoal = {...persistedGoal, ...submittedGoal};
      failNextMarginRefresh = true;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, goal: {...planningFixture.goal, ...submittedGoal}})});
    });

    await openApp(page, "/?tab=planning");
    const goal = page.locator(".planning-savings-goal");
    await openSavingsGoal(page);
    const percentage = goal.getByLabel("Porcentaje");
    const save = goal.getByRole("button", {name: "Guardar objetivo"});
    await expect(goal).toBeVisible();
    await percentage.fill("25");
    await save.scrollIntoViewIfNeeded();
    await save.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await save.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Objetivo de prueba rechazado.");
    await expect(percentage).toHaveValue("25");
    await expect(save).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(goalWrites).toBe(1);

    await save.press("Enter");
    await expect(page.getByText("Objetivo guardado; margen pendiente de actualizar.")).toBeVisible();
    await expect(percentage).toBeDisabled();
    const retryMargin = goal.getByRole("button", {name: "Reintentar actualización del margen"});
    await expect(retryMargin).toBeVisible();
    await expect(retryMargin).toBeFocused();
    await expect.poll(() => marginReads).toBe(1);
    expect(submittedGoal).toMatchObject({percentage: "25"});
    expect(goalWrites).toBe(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    await retryMargin.click();
    await expect(page.getByText("Objetivo guardado y margen actualizado.")).toBeVisible();
    await expect(goal).toHaveClass(/closed/);
    await expect(goal).toContainText("Activo · 25 %");
    await expect(page.getByRole("button", {name: "Expandir objetivo de ahorro"})).toBeFocused();
    await expect.poll(() => marginReads).toBe(2);
    expect(goalWrites).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({path: testInfo.outputPath(`planning-savings-goal-${viewport.width}.png`), fullPage: true});
    assertNoPageErrors();
  });
}

test("M20 prepara una reserva anual desde un gasto recurrente y adapta su cuota en móvil @webkit-only", async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const fixture = structuredClone(planningFixture);
  const annualRule = {
    id: 42,
    name: "Seguro de vivienda",
    kind: "expense",
    amount: 900,
    account: {id: 1, name: "Cuenta de gastos"},
    category: {id: 2, name: "Seguros", display_name: "Seguros", active: true, kind: "expense"},
    frequency: "yearly",
    frequency_display: "Anual",
    day_of_month: 8,
    start_date: "2026-06-08",
    end_date: "",
    notes: "",
    active: true,
    lifecycle: "active",
    affects_selected_month: false,
  };
  const secondAnnualRule = {...annualRule, id: 43, name: "Seguro médico"};
  fixture.rules = [...fixture.rules, annualRule, secondAnnualRule];
  fixture.savings_objectives.items = [];
  const prepared = {
    id: 92,
    name: annualRule.name,
    target_amount: 900,
    target_date: "2027-06-08",
    priority: 2,
    assigned_amount: 0,
    remaining_amount: 900,
    archived: false,
    achieved: false,
    revision: 0,
    recurring_rule_id: annualRule.id,
    annual_reserve: {
      rule_id: annualRule.id,
      rule_name: annualRule.name,
      status: "active",
      due_date: "2027-06-08",
      months_remaining: 8,
      remaining_amount: 900,
      monthly_amount: 112.5,
    },
  };
  const preparedSecond = {...prepared, id: 93, name: secondAnnualRule.name, recurring_rule_id: secondAnnualRule.id, annual_reserve: {...prepared.annual_reserve, rule_id: secondAnnualRule.id, rule_name: secondAnnualRule.name}};
  let completeSecondPost: (() => void) | null = null;
  let markSecondPostSeen: (() => void) | null = null;
  const secondPostSeen = new Promise<void>((resolve) => {markSecondPostSeen = resolve;});
  await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fixture),
  }));
  await page.route("**/api/planning/savings-objectives/", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON() as {recurring_rule_id: number; idempotency_key: string};
    expect([annualRule.id, secondAnnualRule.id]).toContain(payload.recurring_rule_id);
    expect(payload.idempotency_key).toMatch(/[0-9a-f-]{36}/);
    const created = payload.recurring_rule_id === annualRule.id ? prepared : preparedSecond;
    if (payload.recurring_rule_id === secondAnnualRule.id) {
      await new Promise<void>((resolve) => {completeSecondPost = resolve; markSecondPostSeen?.();});
    }
    fixture.savings_objectives.items = [...fixture.savings_objectives.items, created];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ok: true, created: true, objective: created, summary: fixture.savings_objectives.summary}),
    });
  });
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/?tab=planning");
  const panel = page.locator(".planning-savings-objectives");
  await expect(panel).toBeVisible();
  const prepareButton = panel.getByRole("button", {name: "Preparar reserva anual", exact: true}).first();
  await prepareButton.focus();
  await prepareButton.press("Enter");
  const row = panel.locator(".planning-objective-row").filter({hasText: "Seguro de vivienda"});
  await expect(row).toContainText("Ahorro sugerido");
  await expect(row).toContainText("112,50");
  await panel.screenshot({path: testInfo.outputPath("m20-reserve-mobile.png")});
  await expect(page.getByRole("status")).toContainText("Reserva anual preparada");
  const assignedInput = row.getByLabel("Importe asignado");
  await expect(assignedInput).toBeFocused();

  const secondButton = panel.getByRole("button", {name: "Preparar reserva anual", exact: true});
  await secondButton.focus();
  await secondButton.press("Enter");
  await secondPostSeen;
  const genericGoalSummary = panel.locator("#planning-objective-create > summary");
  await genericGoalSummary.focus();
  completeSecondPost?.();
  const secondRow = panel.locator(".planning-objective-row").filter({hasText: "Seguro médico"});
  await expect(secondRow).toBeVisible();
  await expect(genericGoalSummary).toBeFocused();
  for (const width of [320, 390, 393, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      controls: [...document.querySelectorAll<HTMLElement>(".planning-savings-objectives button, .planning-savings-objectives input, .planning-savings-objectives select")]
        .filter((item) => item.getClientRects().length)
        .map((item) => item.getBoundingClientRect().height),
    }));
    expect(geometry.overflow).toBe(0);
    expect(geometry.controls.every((height) => height >= 44)).toBe(true);
  }
  assertNoPageErrors();
});

test("M19 conserva geometría móvil, teclado y privacidad en metas por propósito @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const fixture = structuredClone(planningFixture);
  fixture.savings_objectives.items = [{
    id: 91,
    name: "Fondo de emergencia familiar",
    target_amount: 9500,
    target_date: "2027-12-01",
    priority: 1,
    assigned_amount: 1250,
    remaining_amount: 8250,
    archived: false,
    achieved: false,
    revision: 0,
  }];
  fixture.savings_objectives.summary = {
    ledger_balance: 5000,
    eligible_balance: 5000,
    assigned_total: 1250,
    free_to_assign: 3750,
    overallocated: false,
    overallocated_by: 0,
    confirmation_token: "fixture-confirmation-token",
  };
  await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fixture),
  }));
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/?tab=planning");
  const panel = page.locator(".planning-savings-objectives");
  const row = panel.locator(".planning-objective-row");
  await expect(row.getByRole("heading", {name: "Fondo de emergencia familiar"})).toBeVisible();

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    const geometry = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>(".planning-view")!;
      const panel = document.querySelector<HTMLElement>(".planning-savings-objectives")!;
      const row = document.querySelector<HTMLElement>(".planning-objective-row")!;
      const panelRect = panel.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        width: window.innerWidth,
        viewWidth: view.getBoundingClientRect().width,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        rowLeft: rowRect.left,
        rowRight: rowRect.right,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1);
    expect(geometry.panelLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.panelRight).toBeLessThanOrEqual(width + 1);
    expect(geometry.rowLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.rowRight).toBeLessThanOrEqual(width + 1);
  }

  await page.setViewportSize({width: 390, height: 844});
  const createDetails = panel.locator("details.planning-objective-create");
  const summary = createDetails.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(createDetails.getByLabel("Propósito")).toBeVisible();
  await page.getByRole("button", {name: "Ocultar importes"}).click();
  await expect(row.locator(".planning-objective-facts .money").first()).toHaveText("•••• €");
  await expect.poll(() => row.locator("input.money-input").evaluate((input) => getComputedStyle(input).getPropertyValue("-webkit-text-security"))).toBe("disc");
  assertNoPageErrors();
});

for (const scenario of [
  {name: "la carga vigente conserva la copia offline si falla la revalidación", status: 200, failDeleteLoad: false, failRevalidation: true},
] as const) {
    test(`el margen pendiente respeta una operación posterior del mismo mes cuando ${scenario.name} @chromium-only`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    const beforeDelete = structuredClone(planningFixture);
    const afterDelete = structuredClone(planningFixture);
    const staleMargin = structuredClone(planningFixture);
    const category = beforeDelete.categories.find((item) => item.id === 3)!;
    const budget = {id: 42, month: beforeDelete.period.month, category, limit: 300};
    beforeDelete.budgets = [budget];
    beforeDelete.budget_progress = [{id: 42, category, limit: 300, spent: 20, remaining: 280, percent: 6.7, actual_percent: 6.7, projected_percent: 8, pace: "normal"}];
    afterDelete.goal.percentage = 25;
    afterDelete.margin.available = 4321.09;
    staleMargin.goal.percentage = 25;
    staleMargin.budgets = [budget];
    staleMargin.budget_progress = beforeDelete.budget_progress;
    staleMargin.margin.available = 1234.56;
    let goalWrites = 0;
    let budgetDeletes = 0;
    let readsAfterDelete = 0;
    let marginReadStarted!: () => void;
    let releaseMarginRead!: () => void;
    const marginReadGate = new Promise<void>((resolve) => {releaseMarginRead = resolve;});
    const marginStarted = new Promise<void>((resolve) => {marginReadStarted = resolve;});
    let heldMarginRead = false;

    await page.route(/\/api\/planning\/\?month=/, async (route) => {
      if (goalWrites && !budgetDeletes && !heldMarginRead) {
        heldMarginRead = true;
        marginReadStarted();
        await marginReadGate;
        if (scenario.status !== 200) {
          await route.fulfill({status: scenario.status, contentType: "application/json", body: JSON.stringify({error: "GET de margen antiguo fallido."})});
        } else {
          await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(staleMargin)});
        }
        return;
      }
      if (budgetDeletes) {
        readsAfterDelete += 1;
        if ((scenario.failDeleteLoad && readsAfterDelete === 1)
          || (scenario.failRevalidation && readsAfterDelete === 2)) {
          await route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "No se pudo revalidar el plan."})});
          return;
        }
      }
      const plan = budgetDeletes ? afterDelete : beforeDelete;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(plan)});
    });
    await page.route("**/api/settings/savings-goal/", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      goalWrites += 1;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, goal: afterDelete.goal})});
    });
    await page.route("**/api/budgets/42/", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      budgetDeletes += 1;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Presupuesto eliminado."})});
    });

    try {
      await openApp(page, "/?tab=planning");
      await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
      await expect(page.getByRole("button", {name: "Eliminar presupuesto Comida E2E"})).toBeVisible();
      const goal = page.locator(".planning-savings-goal");
      await openSavingsGoal(page);
      await page.getByLabel("Porcentaje").fill("25");
      await page.getByRole("button", {name: "Guardar objetivo"}).press("Enter");
      await marginStarted;

      await page.getByRole("button", {name: "Eliminar presupuesto Comida E2E"}).press("Enter");
      const dialog = page.getByRole("dialog", {name: /Eliminar el presupuesto de Comida E2E/});
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", {name: "Eliminar presupuesto", exact: true}).press("Enter");
      await expect.poll(() => budgetDeletes).toBe(1);
      await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
      if (!scenario.failDeleteLoad) await expect(page.getByText("Presupuesto eliminado.", {exact: true})).toBeVisible();
      await expect(page.locator("#planning-budget-42")).toHaveCount(scenario.failDeleteLoad ? 1 : 0);
      if (!scenario.failDeleteLoad) await expect(page.locator(".planning-margin-lead strong")).toContainText("4321,09");

      releaseMarginRead();
      const percentage = goal.getByLabel("Porcentaje");
      const shouldRemainPending = scenario.failRevalidation && scenario.failDeleteLoad;
      if (shouldRemainPending) {
        await expect(percentage).toBeDisabled();
        const retryMargin = page.getByRole("button", {name: "Reintentar actualización del margen"});
        await expect(retryMargin).toBeVisible();
        await expect(page.getByText("Objetivo guardado y margen actualizado.", {exact: true})).toHaveCount(0);
        await retryMargin.click();
      }
      await expect(page.getByText("Objetivo guardado y margen actualizado.", {exact: true})).toBeVisible();
      await expect(page.getByText("No se pudo revalidar el plan. Se mantienen los últimos datos cargados.", {exact: true})).toHaveCount(0);
      await expect(page.locator("#planning-budget-42")).toHaveCount(0);
      await expect(page.locator(".planning-margin-lead strong")).toContainText("4321,09");
      await expect(goal).toHaveClass(/closed/);
      await expect(goal).toContainText("Activo · 25 %");
      if (scenario.failRevalidation && !scenario.failDeleteLoad) {
        const cachedPlan = await page.evaluate((month) => {
          const raw = window.localStorage.getItem(`miscuentas.api./api/planning/?month=${month}`);
          return raw ? (JSON.parse(raw) as {payload: {budgets: unknown[]; margin: {available: number}}}).payload : null;
        }, beforeDelete.period.month);
        expect(cachedPlan?.budgets).toEqual([]);
        expect(cachedPlan?.margin.available).toBe(4321.09);
      }
      expect(goalWrites).toBe(1);
      expect(budgetDeletes).toBe(1);
      assertNoPageErrors();
    } finally {
      releaseMarginRead();
    }
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 700}]) {
  test(`la confirmación de presupuesto retiene foco mientras espera en ${viewport.label} @chromium-only`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    const planningWithBudget = structuredClone(planningFixture);
    const category = planningWithBudget.categories.find((candidate) => candidate.id === 3)!;
    planningWithBudget.budgets = [{id: 42, month: planningWithBudget.period.month, category, limit: 300}];
    planningWithBudget.budget_progress = [{
      id: 42,
      category,
      limit: 300,
      spent: 20,
      remaining: 280,
      percent: 6.7,
      actual_percent: 6.7,
      projected_percent: 8,
      pace: "normal",
    }];
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planningWithBudget),
    }));

    let releaseDelete!: () => void;
    let markDeleteStarted!: () => void;
    const deleteGate = new Promise<void>((resolve) => {releaseDelete = resolve;});
    const deleteStarted = new Promise<void>((resolve) => {markDeleteStarted = resolve;});
    await page.route("**/api/budgets/42/", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      markDeleteStarted();
      await deleteGate;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Presupuesto eliminado."})});
    });

    try {
      await openApp(page, "/?tab=planning");
      const deleteBudget = page.getByRole("button", {name: "Eliminar presupuesto Comida E2E"});
      await deleteBudget.scrollIntoViewIfNeeded();
      await deleteBudget.focus();
      const deleteBudgetTop = (await deleteBudget.boundingBox())?.y;
      expect(deleteBudgetTop).not.toBeUndefined();
      await deleteBudget.press("Enter");
      const dialog = page.getByRole("dialog", {name: /Eliminar el presupuesto de Comida E2E/});
      await expect(dialog).toBeVisible();
      const cancel = dialog.getByRole("button", {name: "Cancelar"});
      const confirm = dialog.locator(".confirm-dialog-actions .ui-button--danger");
      await expect(cancel).toBeFocused();
      await cancel.press("Tab");
      await expect(confirm).toBeFocused();
      await expect(confirm).toHaveAccessibleName("Eliminar presupuesto");
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await confirm.press("Enter");
      await deleteStarted;
      await expect(confirm).toHaveAccessibleName("Aplicando…");
      await expect(confirm).toHaveAttribute("aria-disabled", "true");
      await expect(confirm).toHaveAttribute("aria-busy", "true");
      expect(await confirm.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
      await expect(confirm).toBeFocused();
      await expect(cancel).toBeDisabled();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      releaseDelete();
      await expect(dialog).toHaveCount(0);
      await expect(deleteBudget).toBeFocused();
      await expect(page.getByRole("status").filter({hasText: "Presupuesto eliminado."})).toBeVisible();
      await expect.poll(async () => Math.abs((await deleteBudget.boundingBox())!.y - deleteBudgetTop!)).toBeLessThanOrEqual(0.5);
      assertNoPageErrors();
    } finally {
      releaseDelete();
    }
  });
}

for (const {viewport, reducedMotion, kind} of [
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: false, kind: "budget"},
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: true, kind: "occurrence"},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: true, kind: "budget"},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: false, kind: "occurrence"},
] as const) {
    test(`G12-J4 Plan mantiene foco al eliminar la última ${kind} en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});

      let currentPlanning = structuredClone(planningFixture);
      const account = currentPlanning.accounts.find((item: {id: number}) => item.id === 1);
      const category = currentPlanning.categories.find((item: {id: number}) => item.id === 3);
      const budget = {id: 42, month: currentPlanning.period.month, category, limit: 300};
      const progress = {
        id: 42,
        category,
        limit: 300,
        spent: 20,
        remaining: 280,
        percent: 6.7,
        actual_percent: 6.7,
        projected_percent: 8,
        pace: "normal",
      };
      const supportRule = {
        id: 77,
        name: "Recurrente pausado E2E",
        kind: "expense",
        amount: 50,
        account,
        category,
        frequency: "monthly",
        frequency_display: "Mensual",
        day_of_month: 12,
        start_date: "2026-09-08",
        end_date: "",
        notes: "",
        active: false,
        lifecycle: "paused",
        affects_selected_month: false,
      };
      currentPlanning.budgets = [budget];
      currentPlanning.budget_progress = [progress];
      currentPlanning.rules = [supportRule];
      currentPlanning.occurrences = [{
        id: 9031,
        amount: 125,
        due_date: "2026-09-15",
        status: "pending",
        status_display: "Pendiente",
        rule: {...supportRule, id: 78, name: "Suscripción E2E", active: true, lifecycle: "active"},
      }];
      await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPlanning),
      }));

      const attempts = {budget: 0, occurrence: 0};
      const heldRequest = () => {
        let release!: () => void;
        let markStarted!: () => void;
        const gate = new Promise<void>((resolve) => {release = resolve;});
        const started = new Promise<void>((resolve) => {markStarted = resolve;});
        return {gate, started, release, markStarted};
      };
      const budgetFailure = heldRequest();
      const occurrenceFailure = heldRequest();
      let budgetFailureReleased = false;
      let occurrenceFailureReleased = false;

      await page.route("**/api/budgets/42/", async (route) => {
        if (route.request().method() !== "DELETE") {
          await route.continue();
          return;
        }
        attempts.budget += 1;
        if (attempts.budget === 1) {
          budgetFailure.markStarted();
          await budgetFailure.gate;
          await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "No se pudo eliminar el presupuesto de prueba."})});
          return;
        }
        currentPlanning.budgets = [];
        currentPlanning.budget_progress = [];
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Presupuesto eliminado."})});
      });
      await page.route("**/api/occurrences/9031/skip/", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        attempts.occurrence += 1;
        if (attempts.occurrence === 1) {
          occurrenceFailure.markStarted();
          await occurrenceFailure.gate;
          await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "No se pudo omitir la previsión de prueba."})});
          return;
        }
        currentPlanning.occurrences = [];
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Previsión omitida."})});
      });

      const startEmptyStateProbe = async (id: string) => page.evaluate((emptyId) => {
        const samples: number[] = [];
        const probeWindow = window as Window & {__planningEmptyHeightProbe?: {id: string; samples: number[]}};
        const probe = {id: emptyId, samples};
        probeWindow.__planningEmptyHeightProbe = probe;
        let transitionStartedAt: number | null = null;
        const sample = () => {
          const empty = document.getElementById(emptyId);
          if (empty) samples.push(empty.getBoundingClientRect().height);
          if (transitionStartedAt !== null && performance.now() - transitionStartedAt < 1_000) requestAnimationFrame(sample);
        };
        const start = (empty: HTMLElement) => {
          if (transitionStartedAt !== null) return;
          transitionStartedAt = performance.now();
          samples.push(empty.getBoundingClientRect().height);
          observer.disconnect();
          requestAnimationFrame(sample);
        };
        const observer = new MutationObserver(() => {
          const empty = document.getElementById(emptyId);
          if (empty) start(empty);
        });
        observer.observe(document.body, {childList: true, subtree: true});
        const existing = document.getElementById(emptyId);
        if (existing) start(existing);
      }, id);
      const measureEmptyState = async (id: string) => page.evaluate((emptyId) => {
        const empty = document.getElementById(emptyId);
        const height = empty?.getBoundingClientRect().height ?? 0;
        const style = empty ? getComputedStyle(empty) : null;
        const borderHeight = style ? Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth) : 0;
        const probe = (window as Window & {__planningEmptyHeightProbe?: {id: string; samples: number[]}}).__planningEmptyHeightProbe;
        const intermediate = probe?.id === emptyId ? probe.samples.filter((sample) => sample > 1 && sample < height - borderHeight - 1) : [];
        return {
          height,
          sampleCount: probe?.id === emptyId ? probe.samples.length : 0,
          intermediateRange: intermediate.length ? Math.max(...intermediate) - Math.min(...intermediate) : 0,
        };
      }, id);

      const removeLastRow = async (kind: "budget" | "occurrence") => {
        const isBudget = kind === "budget";
        const opener = isBudget
          ? page.getByRole("button", {name: "Eliminar presupuesto Comida E2E"})
          : page.locator("#planning-occurrences").getByRole("button", {name: "Omitir", exact: true});
        const dialogName = isBudget
          ? /Eliminar el presupuesto de Comida E2E/
          : /Omitir la previsión “Suscripción E2E”/;
        const confirmName = isBudget ? "Eliminar presupuesto" : "Omitir previsión";
        const failure = isBudget ? budgetFailure : occurrenceFailure;
        await opener.scrollIntoViewIfNeeded();
        await opener.focus();
        const panelId = isBudget ? "planning-budgets" : "planning-occurrences";
        const panelHeading = page.locator(`#${panelId}`).getByRole("heading");
        const panelHeadingTop = (await panelHeading.boundingBox())?.y ?? 0;
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await opener.press("Enter");
        const dialog = page.getByRole("dialog", {name: dialogName});
        await expect(dialog).toBeVisible();
        const cancel = dialog.getByRole("button", {name: "Cancelar"});
        const confirm = dialog.locator(".confirm-dialog-actions .ui-button--danger");
        await expect(cancel).toBeFocused();
        await cancel.press("Tab");
        await expect(confirm).toBeFocused();
        await confirm.press("Enter");
        await failure.started;
        await expect(confirm).toHaveAccessibleName("Aplicando…");
        await expect(confirm).toHaveAttribute("aria-disabled", "true");
        await expect(confirm).toHaveAttribute("aria-busy", "true");
        expect(await confirm.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(confirm).toBeFocused();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await confirm.press("Enter");
        await expect.poll(() => attempts[kind]).toBe(1);
        if (isBudget) budgetFailureReleased = true;
        else occurrenceFailureReleased = true;
        failure.release();

        const errorText = isBudget ? "No se pudo eliminar el presupuesto de prueba." : "No se pudo omitir la previsión de prueba.";
        await expect(page.getByRole("alert").filter({hasText: errorText})).toBeVisible();
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(opener).toBeVisible();

        await startEmptyStateProbe(isBudget ? "planning-budgets-empty" : "planning-occurrences-empty");
        await opener.press("Enter");
        const retryDialog = page.getByRole("dialog", {name: dialogName});
        await expect(retryDialog).toBeVisible();
        const retryConfirm = retryDialog.getByRole("button", {name: confirmName});
        const moveFocusAfterDialogClose = isBudget && viewport.label === "móvil" && !reducedMotion;
        if (moveFocusAfterDialogClose) await page.evaluate(() => {
          const observer = new MutationObserver((records) => {
            const dialogWasRemoved = records.some((record) => Array.from(record.removedNodes).some((node) =>
              node instanceof Element && (node.matches('[role="dialog"][aria-modal="true"]') || node.querySelector('[role="dialog"][aria-modal="true"]'))));
            if (!dialogWasRemoved) return;
            observer.disconnect();
            window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".planning-month-control input")?.focus({preventScroll: true}));
          });
          observer.observe(document.body, {childList: true, subtree: true});
        });
        await retryConfirm.press("Enter");
        await expect.poll(() => attempts[kind]).toBe(2);
        const emptyStateId = isBudget ? "planning-budgets-empty" : "planning-occurrences-empty";
        const emptyState = page.locator(`#${emptyStateId}`);
        await expect(emptyState).toBeVisible();
        await expect(retryDialog).toHaveCount(0);
        await expect(page.getByRole("status")).toContainText(isBudget ? "Presupuesto eliminado." : "Previsión omitida.");
        await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

        // Empty states have no action button; focus moves to the next surviving row action.
        const focusTarget = isBudget
          ? page.locator("#planning-occurrences").getByRole("button", {name: "Omitir", exact: true}).first()
          : page.locator("#planning-recurring-rules").getByRole("button", {name: "Editar", exact: true}).first();
        if (moveFocusAfterDialogClose) {
          const monthSelector = page.getByLabel("Mes del plan");
          await expect(monthSelector).toBeFocused();
          await expect(focusTarget).not.toBeFocused();
        } else {
          await expect(focusTarget).toBeFocused();
          await expect(focusTarget).toBeInViewport();
        }
        if (!moveFocusAfterDialogClose) expect(Math.abs(((await panelHeading.boundingBox())?.y ?? 0) - panelHeadingTop)).toBeLessThan(1);
        await expect.poll(() => emptyState.evaluate((empty) => {
          const style = getComputedStyle(empty);
          const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
          return Math.abs(empty.getBoundingClientRect().height - empty.scrollHeight - borderHeight);
        })).toBeLessThan(1);
        const motion = await measureEmptyState(emptyStateId);
        expect(motion.height).toBeGreaterThan(10);
        expect(motion.sampleCount).toBeGreaterThan(1);
        if (reducedMotion) expect(motion.intermediateRange).toBeLessThan(1);
        else expect(motion.intermediateRange, `Observed ${motion.sampleCount} heights`).toBeGreaterThan(1);
      };

      try {
        await openApp(page, "/?tab=planning");
        await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
        await removeLastRow(kind);
        assertNoPageErrors();
      } finally {
        if (!budgetFailureReleased) budgetFailure.release();
        if (!occurrenceFailureReleased) occurrenceFailure.release();
      }
    });
}

for (const {viewport, reducedMotion, kind} of [
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: false, kind: "budget"},
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: true, kind: "recurring"},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: true, kind: "budget"},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: false, kind: "recurring"},
] as const) {
    test(`G12-J2 Plan conserva el ${kind} y el viewport al guardar en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});

      let currentPlanning = structuredClone(planningFixture);
      await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPlanning),
      }));

      const attempts = {budget: 0, recurring: 0};
      const heldRequest = () => {
        let release!: () => void;
        let markStarted!: () => void;
        const gate = new Promise<void>((resolve) => {release = resolve;});
        const started = new Promise<void>((resolve) => {markStarted = resolve;});
        return {gate, started, release, markStarted};
      };
      const budgetFailure = heldRequest();
      const recurringFailure = heldRequest();
      let budgetFailureReleased = false;
      let recurringFailureReleased = false;
      const resultIds = {budget: 910, recurring: 911};

      await page.route("**/api/budgets/", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        attempts.budget += 1;
        if (attempts.budget === 1) {
          budgetFailure.markStarted();
          await budgetFailure.gate;
          await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "No se pudo guardar el presupuesto de prueba."})});
          return;
        }
        const input = route.request().postDataJSON() as Record<string, unknown>;
        const category = currentPlanning.categories.find((item: {id: number}) => item.id === Number(input.category));
        const budget = {id: resultIds.budget, month: String(input.month), category, limit: Number(input.limit)};
        currentPlanning.budgets = [...currentPlanning.budgets, budget];
        currentPlanning.budget_progress = [...currentPlanning.budget_progress, {
          id: resultIds.budget,
          category,
          limit: Number(input.limit),
          spent: 0,
          remaining: Number(input.limit),
          percent: 0,
          actual_percent: 0,
          projected_percent: 0,
          pace: "normal",
        }];
        await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, budget})});
      });

      await page.route("**/api/recurring-rules/", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        attempts.recurring += 1;
        if (attempts.recurring === 1) {
          recurringFailure.markStarted();
          await recurringFailure.gate;
          await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "No se pudo guardar el recurrente de prueba."})});
          return;
        }
        const input = route.request().postDataJSON() as Record<string, unknown>;
        const account = currentPlanning.accounts.find((item: {id: number}) => item.id === Number(input.account));
        const category = currentPlanning.categories.find((item: {id: number}) => item.id === Number(input.category));
        const rule = {
          id: resultIds.recurring,
          name: String(input.name),
          kind: String(input.kind),
          amount: Number(input.amount),
          account,
          category,
          frequency: String(input.frequency),
          frequency_display: input.frequency === "yearly" ? "Anual" : "Mensual",
          day_of_month: Number(input.day_of_month),
          start_date: String(input.start_date),
          end_date: String(input.end_date || ""),
          notes: String(input.notes || ""),
          active: true,
          lifecycle: "active",
          affects_selected_month: true,
        };
        currentPlanning.rules = [...currentPlanning.rules, rule];
        await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, rule})});
      });

      const startResultHeightProbe = async (resultId: number) => page.evaluate((id) => {
        const resultSelector = `#planning-${id === 910 ? "budget" : "recurring"}-${id}`;
        const probe = {resultSelector, samples: [] as number[]};
        const probeWindow = window as Window & {__planningResultHeightProbe?: typeof probe};
        probeWindow.__planningResultHeightProbe = probe;
        const startedAt = performance.now();
        const sample = () => {
          const row = document.querySelector<HTMLElement>(resultSelector);
          if (row) {
            probe.samples.push(row.getBoundingClientRect().height);
          }
          if (performance.now() - startedAt < 1800) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, resultId);
      const measureResultHeight = async (resultId: number) => page.evaluate((id) => {
        const kind = id === 910 ? "budget" : "recurring";
        const row = document.getElementById(`planning-${kind}-${id}`);
        const height = row?.getBoundingClientRect().height ?? 0;
        const probeWindow = window as Window & {__planningResultHeightProbe?: {resultSelector: string; samples: number[]}};
        const probe = probeWindow.__planningResultHeightProbe;
        const intermediate = probe?.resultSelector === `#planning-${kind}-${id}`
          ? probe.samples.filter((sample) => sample > 1 && sample < height - 1)
          : [];
        return {height, intermediateRange: intermediate.length ? Math.max(...intermediate) - Math.min(...intermediate) : 0};
      }, resultId);

      const runComposer = async (kind: "budget" | "recurring") => {
        if (kind === "budget") {
          await page.getByRole("button", {name: "Expandir nuevo presupuesto", exact: true}).click();
          const form = page.locator(".planning-composers .collapsible-panel.open form");
          const limit = form.locator('input[name="limit"]');
          await limit.fill("300");
          await expect(limit).toHaveValue("300");
          await form.locator('select[name="category"]').selectOption("3");
          await expect(limit).toHaveValue("300");
        } else {
          await page.getByRole("button", {name: "Expandir nuevo recurrente", exact: true}).click();
          const form = page.locator(".planning-composers .collapsible-panel.open form");
          await form.locator('input[name="name"]').fill("Internet mensual E2E");
          await form.locator('input[name="amount"]').fill("42");
          await form.locator('select[name="account"]').selectOption("1");
          await form.locator('select[name="category"]').selectOption("3");
          await form.locator('input[name="day_of_month"]').fill("8");
          await form.locator('input[name="start_date"]').fill("2026-09-08");
        }
        const form = page.locator(".planning-composers .collapsible-panel.open form");
        const submit = form.getByRole("button", {name: kind === "budget" ? /Guardar presupuesto|Guardando…/ : /Guardar recurrente|Guardando…/});
        await submit.scrollIntoViewIfNeeded();
        await submit.focus();
        await expect(submit).toBeInViewport({ratio: 0.98});
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await submit.press("Enter");
        const gate = kind === "budget" ? budgetFailure : recurringFailure;
        await gate.started;
        await expect(submit).toBeFocused();
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        await expect(submit).toHaveAttribute("aria-busy", "true");
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await submit.press("Enter");
        await expect.poll(() => attempts[kind]).toBe(1);

        if (kind === "budget") budgetFailureReleased = true;
        else recurringFailureReleased = true;
        gate.release();
        await expect(page.getByRole("alert").filter({hasText: `No se pudo guardar el ${kind === "budget" ? "presupuesto" : "recurrente"} de prueba.`})).toBeVisible();
        await expect(submit).toBeFocused();
        if (kind === "budget") {
          await expect(form.locator('input[name="limit"]')).toHaveValue("300");
          await expect(form.locator('select[name="category"]')).toHaveValue("3");
        } else {
          await expect(form.locator('input[name="name"]')).toHaveValue("Internet mensual E2E");
          await expect(form.locator('input[name="amount"]')).toHaveValue("42");
        }

        const resultId = resultIds[kind];
        const resultSelector = `#planning-${kind}-${resultId}`;
        await startResultHeightProbe(resultId);
        await submit.press("Enter");
        await expect.poll(() => attempts[kind]).toBe(2);
        const successMessage = kind === "budget" ? "Presupuesto guardado." : "Recurrente guardado.";
        await expect(page.getByRole("status")).toContainText(successMessage);
        const disclosure = page.getByRole("button", {name: `Expandir nuevo ${kind === "budget" ? "presupuesto" : "recurrente"}`});
        const savedResult = page.locator(resultSelector);
        await expect(savedResult).toBeVisible();
        const trackingHeading = page.getByRole("heading", {name: "Seguimiento", exact: true});
        const nearbyAction = kind === "budget"
          ? page.locator("#planning-budgets .section-header .ui-button")
          : page.locator("#planning-occurrences .planning-empty .ui-button");
        let focusTarget: Locator | null = null;
        let focusTargetShouldBeVisible = true;
        const focusIsOnResult = await savedResult.evaluate((row) => document.activeElement === row);
        const focusIsOnTracking = await trackingHeading.evaluate((heading) => document.activeElement === heading);
        const focusIsOnNearbyAction = await nearbyAction.count() ? await nearbyAction.evaluate((action) => document.activeElement === action) : false;
        if (focusIsOnResult) focusTarget = savedResult;
        else if (focusIsOnTracking) focusTarget = trackingHeading;
        else if (focusIsOnNearbyAction) focusTarget = nearbyAction;
        else if (await disclosure.evaluate((button) => document.activeElement === button)) {
          focusTarget = disclosure;
          focusTargetShouldBeVisible = false;
        }
        expect(focusTarget).not.toBeNull();
        await expect(focusTarget as Locator).toBeFocused();
        if (focusTargetShouldBeVisible) await expect(focusTarget as Locator).toBeInViewport();
        const scrollYBeforeFinalLayout = await page.evaluate(() => window.scrollY);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect.poll(() => page.locator(resultSelector).evaluate((row) => {
          const style = getComputedStyle(row);
          const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
          return Math.abs(row.getBoundingClientRect().height - row.scrollHeight - borderHeight);
        })).toBeLessThan(1);

        const motion = await measureResultHeight(resultId);
        expect(motion.height).toBeGreaterThan(10);
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBeforeFinalLayout);
        if (reducedMotion) expect(motion.intermediateRange).toBeLessThan(1);
        else expect(motion.intermediateRange).toBeGreaterThan(10);
      };

      try {
        await openApp(page, "/?tab=planning");
        await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
        await runComposer(kind);
        assertNoPageErrors();
      } finally {
        if (!budgetFailureReleased) budgetFailure.release();
        if (!recurringFailureReleased) recurringFailure.release();
      }
    });
}

test("el detalle de un día vacío conserva foco y scroll con movimiento reducido en móvil y escritorio @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=planning");
  for (const viewport of [{width: 390, height: 700}, {width: 1280, height: 480}]) {
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    const day = page.locator(".planning-calendar-day:not(.outside-month):not(.has-amounts)").last();
    await expect(day).toBeVisible();
    await day.scrollIntoViewIfNeeded();
    await day.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const dayTopBefore = (await day.boundingBox())?.y;
    expect(dayTopBefore).not.toBeUndefined();

    await page.keyboard.press("Enter");
    await expect(day).toHaveAttribute("aria-expanded", "true");
    await expect(day).toBeFocused();
    await expect(page.getByText("No hay movimientos registrados para este día.")).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await day.boundingBox())?.y).toBeCloseTo(dayTopBefore!, 0);

    const close = page.locator(".planning-calendar-detail").getByRole("button", {name: "Cerrar detalle", exact: true});
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(day).toHaveAttribute("aria-expanded", "false");
    await expect(day).toBeFocused();
    await expect(page.locator(".planning-calendar-detail")).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await day.boundingBox())?.y).toBeCloseTo(dayTopBefore!, 0);
    assertNoPageErrors();
  }
});

test("Plan aplica el mes del historial sin remount ni perder el borrador, foco o scroll @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const augustPlan = structuredClone(planningFixture);
  augustPlan.period.month = "2026-08";
  augustPlan.period.start = "2026-08-01";
  augustPlan.period.end = "2026-08-31";
  augustPlan.metrics.start = "2026-08-01";
  augustPlan.metrics.end = "2026-08-31";
  let releaseAugust!: () => void;
  const allowAugust = new Promise<void>((resolve) => {releaseAugust = resolve;});
  await page.route(/\/api\/planning\/\?month=2026-08(?:&|$)/, async (route) => {
    await allowAugust;
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(augustPlan)});
  });
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=planning");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  await page.getByRole("button", {name: "Expandir nuevo presupuesto", exact: true}).click();
  const limit = page.getByLabel("Límite");
  await limit.fill("240");
  await limit.focus();
  const previousPlan = await page.locator(".planning-margin-panel").innerText();
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const augustRequest = page.waitForRequest((request) => request.url().includes("/api/planning/?month=2026-08"));
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("plan_month", "2026-08");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  try {
    await augustRequest;
    const month = page.getByLabel("Mes del plan");
    await expect(month).toHaveValue("2026-08");
    await expect(page.locator('.planning-view[aria-busy="true"]')).toBeVisible();
    await expect(limit).toHaveValue("240");
    await expect(limit).toBeFocused();
    expect(await page.locator(".planning-margin-panel").innerText()).toBe(previousPlan);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    releaseAugust();
    await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
    await expect(month).toHaveValue("2026-08");
    await expect(limit).toHaveValue("240");
    await expect(limit).toBeFocused();

    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get("plan_month")).toBeNull();
    await expect(month).toHaveValue("2026-09");
    await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
    await expect(limit).toHaveValue("240");
    await expect(limit).toBeFocused();

    await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.get("plan_month")).toBe("2026-08");
    await expect(month).toHaveValue("2026-08");
    await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
    await expect(limit).toHaveValue("240");
    await expect(limit).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    assertNoPageErrors();
  } finally {
    releaseAugust();
  }
});

test("Plan conserva datos actuales y cerrados ante fallos de refresh mensual @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const augustPlan = structuredClone(planningFixture);
  augustPlan.period = {...augustPlan.period, start: "2026-08-01", end: "2026-08-31", month: "2026-08", status: "past", partial: false};
  let augustRequests = 0;
  await page.route(/\/api\/planning\/?\?month=2026-08/, (route) => {
    augustRequests += 1;
    return augustRequests === 1
      ? route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Plan de agosto no disponible."})})
      : route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(augustPlan)});
  });
  await page.route(/\/api\/planning\/?\?month=2026-07/, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({error: "Plan de julio no disponible."}),
  }));
  await page.setViewportSize({width: 390, height: 700});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/?tab=planning");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const month = page.getByLabel("Mes del plan");

  await page.getByRole("button", {name: "Añadir al plan"}).click();
  await page.getByRole("button", {name: "Presupuesto", exact: true}).click();
  const limit = page.getByLabel("Límite");
  await limit.fill("240");
  const previousPlan = await page.locator(".planning-margin-panel").innerText();
  await month.focus();
  await page.evaluate(() => window.scrollTo(0, Math.min(120, document.documentElement.scrollHeight - innerHeight)));
  const currentScrollBefore = await page.evaluate(() => window.scrollY);
  const firstAugustRequest = page.waitForRequest((request) => request.url().includes("/api/planning/?month=2026-08"));
  await month.fill("2026-08");
  await firstAugustRequest;

  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Se mantienen los últimos datos cargados.");
  await expect(month).toHaveValue("2026-08");
  await expect(page.locator(".planning-period-note").first()).toContainText("septiembre de 2026");
  await expect(limit).toHaveValue("240");
  expect(await page.locator(".planning-margin-panel").innerText()).toBe(previousPlan);
  await expect(month).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(currentScrollBefore);

  await month.fill("2026-09");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await expect(month).toHaveValue("2026-09");
  await page.setViewportSize({width: 320, height: 700});
  const secondAugustRequest = page.waitForRequest((request) => request.url().includes("/api/planning/?month=2026-08"));
  await month.fill("2026-08");
  await secondAugustRequest;
  expect(augustRequests).toBe(2);
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await expect(month).toHaveValue("2026-08");
  const note = page.locator(".planning-period-note").first();
  await expect(note).toHaveText("Periodo cerrado");
  const noteHeightBefore = await note.evaluate((element) => element.getBoundingClientRect().height);
  await month.focus();
  await page.evaluate(() => window.scrollTo(0, Math.min(120, document.documentElement.scrollHeight - innerHeight)));
  const closedScrollBefore = await page.evaluate(() => window.scrollY);
  const julyRequest = page.waitForRequest((request) => request.url().includes("/api/planning/?month=2026-07"));
  await month.fill("2026-07");
  await julyRequest;

  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Se mantienen los últimos datos cargados.");
  await expect(month).toHaveValue("2026-07");
  await expect(note).toHaveText("Datos de agosto de 2026 · cerrado");
  expect(await note.evaluate((element) => element.getBoundingClientRect().height)).toBe(noteHeightBefore);
  await expect(month).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(closedScrollBefore);
  assertNoPageErrors();
});

test("omitir una previsión devuelve el foco y el scroll por teclado y puntero @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const fixture = structuredClone(planningFixture);
  fixture.occurrences = [{
    id: 9031,
    amount: 125,
    due_date: "2026-09-15",
    rule: {
      name: "Previsión de foco E2E",
      kind: "expense",
      account: {id: 1, name: "Cuenta diaria E2E"},
      category: {id: 4, display_name: "Vivienda E2E"},
    },
  }];
  await page.route(/\/api\/planning\/?\?month=/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fixture),
  }));
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=planning");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const skip = page.getByRole("button", {name: "Omitir", exact: true});
  await skip.scrollIntoViewIfNeeded();
  await skip.focus();
  const keyboardScroll = await page.evaluate(() => window.scrollY);
  await skip.press("Enter");
  const dialog = page.getByRole("dialog", {name: "¿Omitir la previsión “Previsión de foco E2E”?"});
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(skip).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(keyboardScroll);

  await skip.click();
  await expect(dialog).toBeVisible();
  const pointerScroll = await page.evaluate(() => window.scrollY);
  await dialog.getByRole("button", {name: "Cancelar"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(skip).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(pointerScroll);
  assertNoPageErrors();
});

test("Plan oculta importes de lectura y protege inputs monetarios en privacidad @webkit-only", async ({page}) => {
  await page.setViewportSize({width: 390, height: 900});
  await openApp(page, "/?tab=planning");
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await page.getByRole("button", {name: "Ocultar importes"}).click();
  await expect(page.locator(".app-frame")).toHaveClass(/privacy-mode/);
  const visibleMoney = await page.locator(".planning-view .money").evaluateAll((items) => items
    .map((item) => item.textContent?.replace(/\s+/g, " ").trim() || "")
    .filter((value) => /\d[\d.,]*\s*€/.test(value)));
  expect(visibleMoney).toEqual([]);
  const unmarkedMoney = await page.locator(".planning-view").evaluate((view) => {
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    const leaks: string[] = [];
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent?.replace(/\s+/g, " ").trim() || "";
      const parent = node.parentElement;
      if (/\d[\d.,]*\s*€/.test(value) && parent && !parent.closest(".money")) leaks.push(value);
      node = walker.nextNode();
    }
    return leaks;
  });
  expect(unmarkedMoney).toEqual([]);
  await page.getByRole("button", {name: "Añadir al plan"}).click();
  await page.getByRole("button", {name: "Presupuesto", exact: true}).click();
  await expect(page.getByLabel("Límite")).toHaveCSS("-webkit-text-security", "disc");
});

for (const {viewport, reducedMotion, chromiumOnly = false} of [
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: false},
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: true, chromiumOnly: true},
] as const) {
  test(`G12-J1 Plan conserva el borrador y el foco al guardar una regla sugerida en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"}${chromiumOnly ? " @chromium-only" : " @webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});

      let currentPlanning = structuredClone(planningFixture);
      await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPlanning),
      }));

      let createAttempts = 0;
      let subscriptionReviewPosts = 0;
      let releaseFirstAttempt!: () => void;
      let markFirstAttemptStarted!: () => void;
      let firstAttemptReleased = false;
      const firstAttemptGate = new Promise<void>((resolve) => {releaseFirstAttempt = resolve;});
      const firstAttemptStarted = new Promise<void>((resolve) => {markFirstAttemptStarted = resolve;});
      await page.route("**/api/category-rules/", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        createAttempts += 1;
        if (createAttempts === 1) {
          markFirstAttemptStarted();
          await firstAttemptGate;
          await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({detail: "No se pudo crear la regla."})});
          return;
        }
        await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, rule: {id: 91}})});
      });
      await page.route("**/api/subscription-reviews/", async (route) => {
        if (route.request().method() === "POST") subscriptionReviewPosts += 1;
        await route.continue();
      });

      try {
        await openApp(page, "/?tab=planning");
        const initiatingCandidate = page.locator(".planning-candidate").filter({hasText: "Alquiler mensual E2E"});
        const rulesButton = initiatingCandidate.locator(".planning-candidate-automation > summary");
        await expect(rulesButton).toBeVisible();
        const rulesBox = await rulesButton.boundingBox();
        const candidateBox = await initiatingCandidate.boundingBox();
        expect(rulesBox).not.toBeNull();
        expect(candidateBox).not.toBeNull();
        expect(rulesBox!.x).toBeGreaterThanOrEqual(candidateBox!.x);
        expect(rulesBox!.x + rulesBox!.width).toBeLessThanOrEqual(candidateBox!.x + candidateBox!.width + 1);
        expect(rulesBox!.y).toBeGreaterThanOrEqual(candidateBox!.y);
        expect(rulesBox!.y + rulesBox!.height).toBeLessThanOrEqual(candidateBox!.y + candidateBox!.height + 1);
        if (viewport.width >= 1024) {
          const mainActionsBox = await initiatingCandidate.locator(".planning-candidate-main-actions").boundingBox();
          expect(mainActionsBox).not.toBeNull();
          expect(rulesBox!.width).toBeGreaterThanOrEqual(208);
          expect(rulesBox!.height).toBeGreaterThanOrEqual(44);
          expect(rulesBox!.x).toBeGreaterThanOrEqual(mainActionsBox!.x + mainActionsBox!.width - 1);
          const sharedRowOverlap = Math.min(rulesBox!.y + rulesBox!.height, mainActionsBox!.y + mainActionsBox!.height)
            - Math.max(rulesBox!.y, mainActionsBox!.y);
          expect(sharedRowOverlap).toBeGreaterThan(0);
        }
        await rulesButton.click();
        const createCategory = initiatingCandidate.locator('button[data-candidate-action="category"]');
        await expect(createCategory).toBeVisible();
        await createCategory.focus();
        await createCategory.press("Enter");
        await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
        await expect(page.getByRole("status").filter({hasText: "Sugerencia preparada. Revisa descripción, categoría y condiciones antes de guardar."})).toBeVisible();
        const ruleForm = page.locator("form.entry-form").filter({has: page.getByLabel("Texto a reconocer")});
        const saveRule = ruleForm.locator('button[type="submit"]');
        await expect(saveRule).toBeVisible();
        await saveRule.focus();
        await saveRule.press("Enter");
        await firstAttemptStarted;
        await expect(saveRule).toBeFocused();
        await expect(saveRule).toHaveAttribute("aria-disabled", "true");
        await expect(saveRule).toHaveAttribute("aria-busy", "true");

        await saveRule.press("Enter");
        await expect.poll(() => createAttempts).toBe(1);
        firstAttemptReleased = true;
        releaseFirstAttempt();
        await expect(page.getByRole("alert").first()).toBeVisible();
        await expect(saveRule).toBeFocused();
        await expect(page.getByLabel("Texto a reconocer")).toHaveValue("Alquiler mensual E2E");

        await saveRule.press("Enter");
        await expect.poll(() => createAttempts).toBe(2);
        await expect(page.getByRole("status").filter({hasText: "Regla de categoría creada."})).toBeVisible();
        expect(subscriptionReviewPosts).toBe(0);
        assertNoPageErrors();
      } finally {
        if (!firstAttemptReleased) releaseFirstAttempt();
      }
  });
}

for (const {viewport, reducedMotion, chromiumOnly = false} of [
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: false},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: true, chromiumOnly: true},
] as const) {
  test(`G12-J3 Plan conserva foco al pausar un recurrente en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"}${chromiumOnly ? " @chromium-only" : " @webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});

      let currentPlanning = structuredClone(planningFixture);
      const rule = {
        id: 53,
        name: "Internet mensual E2E",
        kind: "expense",
        amount: 42,
        account: currentPlanning.accounts.find((item: {id: number}) => item.id === 1),
        category: currentPlanning.categories.find((item: {id: number}) => item.id === 3),
        frequency: "monthly",
        frequency_display: "Mensual",
        day_of_month: 8,
        start_date: "2026-09-08",
        end_date: "",
        notes: "",
        active: true,
        lifecycle: "active",
        affects_selected_month: true,
      };
      currentPlanning.rules = [rule];
      await page.route(/\/api\/planning\/\?month=/, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentPlanning),
      }));

      let attempts = 0;
      let releaseFirstAttempt!: () => void;
      let markFirstAttemptStarted!: () => void;
      let failureReleased = false;
      const firstAttemptGate = new Promise<void>((resolve) => {releaseFirstAttempt = resolve;});
      const firstAttemptStarted = new Promise<void>((resolve) => {markFirstAttemptStarted = resolve;});
      await page.route("**/api/recurring-rules/53/", async (route) => {
        if (route.request().method() !== "PATCH") {
          await route.continue();
          return;
        }
        attempts += 1;
        if (attempts === 1) {
          markFirstAttemptStarted();
          await firstAttemptGate;
          await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "No se pudo pausar el recurrente de prueba."})});
          return;
        }
        const input = route.request().postDataJSON() as {active: boolean};
        const updatedRule = {...rule, active: input.active, lifecycle: input.active ? "active" : "paused"};
        currentPlanning.rules = [updatedRule];
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, rule: updatedRule})});
      });

      await openApp(page, "/?tab=planning");
      await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
      const activeRow = page.locator("#planning-recurring-53");
      const toggle = activeRow.locator("[data-rule-lifecycle-toggle]");
      const trackingHeading = page.getByRole("heading", {name: "Seguimiento", exact: true});
      await toggle.scrollIntoViewIfNeeded();
      await toggle.focus();
      await expect(toggle).toBeInViewport({ratio: 0.98});
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const rowTopBefore = (await activeRow.boundingBox())?.y ?? 0;
      await toggle.press("Enter");
      try {
        await firstAttemptStarted;
        const pendingToggle = activeRow.locator("[data-rule-lifecycle-toggle]");
        await expect(pendingToggle).toHaveAttribute("aria-disabled", "true");
        await expect(pendingToggle).toHaveAttribute("aria-busy", "true");
        await expect(activeRow).toHaveAttribute("aria-busy", "true");
        expect(await pendingToggle.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(pendingToggle).toBeFocused();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await pendingToggle.press("Enter");
        await expect.poll(() => attempts).toBe(1);

        failureReleased = true;
        releaseFirstAttempt();
        await expect(page.getByRole("alert").filter({hasText: "No se pudo pausar el recurrente de prueba."})).toBeVisible();
        await expect(activeRow).toBeVisible();
        await expect(activeRow.locator(".status-chip")).toHaveText("Activo");
        await expect(activeRow.locator("[data-rule-lifecycle-toggle]")).toBeFocused();
        expect(Math.abs(((await activeRow.boundingBox())?.y ?? 0) - rowTopBefore)).toBeLessThan(1);

        const probe = await page.evaluate(() => {
          const samples: number[] = [];
          const probeWindow = window as Window & {__ruleMotionSamples?: number[]};
          probeWindow.__ruleMotionSamples = samples;
          const start = performance.now();
          const sample = () => {
            const row = document.getElementById("planning-recurring-53");
            samples.push(row?.getBoundingClientRect().height ?? 0);
            if (performance.now() - start < 1400) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          return true;
        });
        expect(probe).toBe(true);
        await activeRow.locator("[data-rule-lifecycle-toggle]").press("Enter");
        await expect.poll(() => attempts).toBe(2);
        await expect(page.getByRole("status")).toContainText("Recurrente pausado.");

        const pausedRow = page.locator("#planning-recurring-53");
        await expect(pausedRow.locator(".status-chip")).toHaveText("Pausado");
        const reactivatedToggle = pausedRow.locator("[data-rule-lifecycle-toggle]");
        await expect(reactivatedToggle).not.toHaveAttribute("aria-disabled", "true");
        await expect.poll(async () => page.evaluate(() => {
          const row = document.getElementById("planning-recurring-53");
          return row ? Math.abs(row.getBoundingClientRect().height - row.scrollHeight - 2) : Number.POSITIVE_INFINITY;
        })).toBeLessThan(3);
        const focusOnToggle = await reactivatedToggle.evaluate((button) => document.activeElement === button);
        const focusOnTracking = await trackingHeading.evaluate((heading) => document.activeElement === heading);
        expect(focusOnToggle || focusOnTracking).toBe(true);
        const focusTarget = focusOnToggle ? reactivatedToggle : trackingHeading;
        await expect(focusTarget).toBeFocused();
        await expect(focusTarget).toBeInViewport();
        await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

        const motion = await page.evaluate(() => {
          const row = document.getElementById("planning-recurring-53");
          const height = row?.getBoundingClientRect().height ?? 0;
          const samples = (window as Window & {__ruleMotionSamples?: number[]}).__ruleMotionSamples ?? [];
          const intermediate = samples.filter((sample) => sample > 1 && sample < height - 1);
          return {height, intermediateRange: intermediate.length ? Math.max(...intermediate) - Math.min(...intermediate) : 0};
        });
        if (reducedMotion) expect(motion.intermediateRange).toBeLessThan(1);
        else expect(motion.intermediateRange).toBeGreaterThan(10);
        assertNoPageErrors();
      } finally {
        if (!failureReleased) releaseFirstAttempt();
      }
  });
}
