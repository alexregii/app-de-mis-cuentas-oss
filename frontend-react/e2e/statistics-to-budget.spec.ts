import {expect, test, type Page} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

const MONTH = "2026-01";

async function apiContext(page: Page) {
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrftoken")?.value;
  expect(csrf).toBeTruthy();
  return {origin, headers: {"X-CSRFToken": csrf!}};
}

async function createExpenseCategory(page: Page, name: string) {
  const {origin, headers} = await apiContext(page);
  const response = await page.request.post(`${origin}/api/categories/`, {
    headers,
    data: {name, kind: "expense", parent: "", color: "#3478f6", icon: "", active: true, exclude_from_analytics: false},
  });
  expect(response.status()).toBe(201);
  return (await response.json()).category.id as number;
}

async function createExpense(page: Page, accountId: number, categoryId: number, date: string, amount: string, description: string) {
  const {origin, headers} = await apiContext(page);
  const response = await page.request.post(`${origin}/api/transactions/`, {
    headers,
    data: {kind: "expense", account: String(accountId), category: String(categoryId), date, amount, description},
  });
  expect(response.status()).toBe(201);
}

async function createSpike(page: Page, suffix: string, month = MONTH) {
  await openApp(page);
  const {origin} = await apiContext(page);
  const bootstrap = await page.request.get(`${origin}/api/bootstrap/`).then((response) => response.json());
  const accountId = bootstrap.accounts.find((account: {active: boolean}) => account.active)?.id as number | undefined;
  expect(accountId).toBeTruthy();

  const categoryName = `Pico M16 ${suffix}`;
  const categoryId = await createExpenseCategory(page, categoryName);
  const [year, monthNumber] = month.split("-").map(Number);
  const day = month === MONTH ? "10" : String(Math.min(10, new Date().getDate())).padStart(2, "0");
  const historyMonths = month === MONTH
    ? ["2025-07", "2025-08", "2025-10"]
    : [-3, -2, -1].map((offset) => {
      const date = new Date(year, monthNumber - 1 + offset, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  for (const historyMonth of historyMonths) {
    await createExpense(page, accountId!, categoryId, `${historyMonth}-${day}`, "100.00", `${categoryName} histórico ${historyMonth}`);
  }
  await createExpense(page, accountId!, categoryId, `${month}-${day}`, "200.00", `${categoryName} pico actual`);

  const lastDay = new Date(year, monthNumber, 0).getDate();
  const dateTo = month === MONTH ? `${month}-${lastDay}` : `${month}-${day}`;
  const report = await page.request.get(`${origin}/api/statistics/${year}/${monthNumber}/?basis=analytics&date_from=${month}-01&date_to=${dateTo}`);
  expect(report.status()).toBe(200);
  const monthData = await report.json();
  expect(monthData.insights.spikes.items.some((item: {family_id: number | null}) => item.family_id === categoryId)).toBe(true);
  return {categoryId, categoryName, month};
}

async function openSpike(page: Page, categoryName: string, month = MONTH) {
  await openApp(page, `/?tab=statistics&period=12&basis=analytics&month=${month}`);
  await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
  const action = page.getByRole("button", {name: `Preparar presupuesto de ${categoryName}`, exact: true});
  await expect(action).toBeVisible();
  return action;
}

function trackBudgetWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const {pathname} = new URL(request.url());
    if (["POST", "PATCH", "DELETE"].includes(request.method()) && /^\/api\/budgets\/(?:\d+\/)?$/.test(pathname)) {
      writes.push(`${request.method()} ${pathname}`);
    }
  });
  return writes;
}

function budgetForm(page: Page) {
  return page.getByRole("region", {name: "Añadir elementos al seguimiento"}).locator("form.entry-form").first();
}

test("M16 un pico abre el presupuesto del mes y categoría exactos; solo guardar escribe @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  const spike = await createSpike(page, String(Date.now()));
  const budgetWrites = trackBudgetWrites(page);
  const action = await openSpike(page, spike.categoryName);
  const actionBox = await action.boundingBox();
  expect(actionBox?.width).toBeGreaterThanOrEqual(44);
  expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  expect((actionBox?.x ?? 0) + (actionBox?.width ?? 0)).toBeLessThanOrEqual(391);

  await action.click();
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  const route = new URL(page.url());
  expect(route.searchParams.get("tab")).toBe("planning");
  expect(route.searchParams.get("plan_month")).toBe(spike.month);
  expect(route.searchParams.get("budget_category")).toBe(String(spike.categoryId));
  expect(route.search).not.toMatch(/amount|limit|200\.00|100\.00|Pico%20M16/i);

  const form = budgetForm(page);
  await expect(form.locator('input[name="month"]')).toHaveValue(spike.month);
  await expect(form.locator('select[name="category"]')).toHaveValue(String(spike.categoryId));
  await expect(form.locator('input[name="limit"]')).toHaveValue("");
  await expect(page.getByRole("status").filter({hasText: "No se ha guardado"})).toBeVisible();
  expect(budgetWrites).toEqual([]);

  await form.locator('input[name="limit"]').fill("245.50");
  expect(new URL(page.url()).search).not.toContain("245.50");
  expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain("245.50");
  const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/budgets/");
  await form.getByRole("button", {name: "Guardar presupuesto"}).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(budgetWrites).toHaveLength(1);
  await expect.poll(() => new URL(page.url()).searchParams.has("budget_category")).toBe(false);
  const saved = await page.request.get(`${new URL(page.url()).origin}/api/planning/?month=${spike.month}`).then((result) => result.json());
  expect(saved.budgets.find((item: {category: {id: number}}) => item.category.id === spike.categoryId)?.limit).toBe(245.5);
  assertNoPageErrors();
});

test("M16 conserva un borrador de Plan al volver desde Statistics y recorrer atrás/adelante @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  const spike = await createSpike(page, String(Date.now()));
  const draftCategoryId = await createExpenseCategory(page, `Borrador M16 ${Date.now()}`);
  const budgetWrites = trackBudgetWrites(page);
  await openApp(page, `/?tab=planning&plan_month=${spike.month}`);
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const composer = page.getByRole("region", {name: "Añadir elementos al seguimiento"});
  await composer.getByRole("button", {name: "Expandir nuevo presupuesto"}).click();
  const form = budgetForm(page);
  await form.locator('input[name="month"]').fill(spike.month);
  await form.locator('input[name="limit"]').fill("333.33");
  await form.locator('select[name="category"]').selectOption(String(draftCategoryId));

  await page.getByRole("button", {name: /Estad/}).click();
  await expect(page).toHaveURL(/tab=statistics/);
  await page.getByLabel("Mes para profundizar").selectOption(spike.month);
  const prepare = page.getByRole("button", {name: `Preparar presupuesto de ${spike.categoryName}`, exact: true});
  await expect(prepare).toBeVisible();
  await prepare.click();
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();
  await expect(form.locator('input[name="month"]')).toHaveValue(spike.month);
  await expect(form.locator('select[name="category"]')).toHaveValue(String(draftCategoryId));
  await expect(form.locator('input[name="limit"]')).toHaveValue("333.33");
  await expect(page.getByRole("status").filter({hasText: "Se conservó el borrador"})).toBeVisible();
  expect(new URL(page.url()).search).not.toContain("333.33");
  expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain("333.33");
  expect(budgetWrites).toEqual([]);

  await page.goBack();
  await expect(page).toHaveURL(/tab=statistics/);
  await page.goForward();
  await expect(page).toHaveURL(/tab=planning/);
  await expect(form.locator('input[name="limit"]')).toHaveValue("333.33");
  await expect(form.locator('select[name="category"]')).toHaveValue(String(draftCategoryId));
  expect(budgetWrites).toEqual([]);
  assertNoPageErrors();
});
