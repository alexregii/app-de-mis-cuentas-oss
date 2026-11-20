import {expect, test, type Locator, type Page} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

const uniqueMonthPair = () => {
  const index = Math.floor(Date.now() / 1000) % (7_990 * 12);
  const sourceYear = 2000 + Math.floor(index / 12);
  const sourceMonthNumber = index % 12 + 1;
  const targetYear = sourceMonthNumber === 12 ? sourceYear + 1 : sourceYear;
  const targetMonthNumber = sourceMonthNumber === 12 ? 1 : sourceMonthNumber + 1;
  return {
    source: `${sourceYear}-${String(sourceMonthNumber).padStart(2, "0")}`,
    target: `${targetYear}-${String(targetMonthNumber).padStart(2, "0")}`,
  };
};

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

async function createBudget(page: Page, month: string, categoryId: number, limit: string) {
  const {origin, headers} = await apiContext(page);
  const response = await page.request.post(`${origin}/api/budgets/`, {
    headers,
    data: {month, category: String(categoryId), limit},
  });
  expect(response.status()).toBe(201);
  return (await response.json()).budget.id as number;
}

async function getBudgetLimit(page: Page, month: string, categoryId: number): Promise<number | null> {
  const {origin} = await apiContext(page);
  const response = await page.request.get(`${origin}/api/planning/?month=${month}`);
  const payload = await response.json();
  return payload.budgets.find((budget: {category: {id: number}}) => budget.category.id === categoryId)?.limit ?? null;
}

async function openCopyPanel(page: Page) {
  const trigger = page.locator("#planning-budget-copy-trigger");
  await expect(trigger).toHaveAccessibleName("Copiar de otro mes");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return page.getByLabel("Copiar presupuestos de otro mes");
}

async function expectCopyPanelGeometry(page: Page, panel: Locator) {
  const geometry = await panel.evaluate((element) => ({
    panelOverflow: element.scrollWidth - element.clientWidth,
    pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
    buttonHeights: [...element.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => button.getBoundingClientRect().height),
    rowHeights: [...element.querySelectorAll<HTMLElement>(".budget-copy-item")]
      .map((row) => row.getBoundingClientRect().height),
  }));
  expect(geometry.panelOverflow).toBeLessThanOrEqual(1);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  expect(geometry.buttonHeights.every((height) => height >= 44)).toBe(true);
  expect(geometry.rowHeights.every((height) => height >= 44)).toBe(true);
}

test("M15 la vista previa muestra nuevos, existentes e inactivos sin escribir y copia solo el valor seleccionado por defecto", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const {source: sourceMonth, target: targetMonth} = uniqueMonthPair();
  await page.setViewportSize({width: 390, height: 900});
  await openApp(page, `/?tab=planning&plan_month=${targetMonth}`);
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const suffix = Date.now();
  for (let index = 0; index < 14; index += 1) {
    const category = await createExpenseCategory(page, `M15 base ${suffix} ${String(index + 1).padStart(2, "0")}`);
    await createBudget(page, targetMonth, category, "10.00");
  }
  await page.reload();
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const composer = page.getByRole("region", {name: "Añadir elementos al seguimiento"});
  await composer.getByRole("button", {name: "Expandir nuevo presupuesto"}).click();
  const draftCategory = composer.locator('select[name="category"]');
  const draftCategoryId = Number(await draftCategory.locator("option").nth(1).getAttribute("value"));
  const draftBudgetBefore = await getBudgetLimit(page, targetMonth, draftCategoryId);
  await composer.getByLabel("Límite", {exact: true}).fill("42.75");
  await draftCategory.selectOption(String(draftCategoryId));

  const newCategory = await createExpenseCategory(page, `ZZZ Nueva M15 ${suffix}`);
  const existingCategory = await createExpenseCategory(page, `Existente M15 ${suffix}`);
  const inactiveCategory = await createExpenseCategory(page, `Archivada M15 ${suffix}`);
  await createBudget(page, sourceMonth, newCategory, "125.00");
  await createBudget(page, sourceMonth, existingCategory, "300.00");
  await createBudget(page, sourceMonth, inactiveCategory, "40.00");
  const existingBudgetId = await createBudget(page, targetMonth, existingCategory, "275.00");
  const {origin, headers} = await apiContext(page);
  const deactivate = await page.request.patch(`${origin}/api/categories/${inactiveCategory}/`, {headers, data: {active: false}});
  expect(deactivate.status()).toBe(200);

  const panel = await openCopyPanel(page);
  await expect(page.locator("#planning-budgets .budget-row").last()).not.toBeInViewport();
  await panel.getByLabel("Mes de origen").fill(sourceMonth);
  await panel.getByRole("button", {name: "Ver vista previa"}).click();
  await expect(panel.getByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.")).toBeVisible();
  expect(page.url()).not.toMatch(/125\.00|300\.00|40\.00|preview_token/);
  await expectCopyPanelGeometry(page, panel);

  const newToggle = panel.getByRole("checkbox", {name: `Copiar presupuesto de ZZZ Nueva M15 ${suffix}`});
  const existingToggle = panel.getByRole("checkbox", {name: `Sobrescribir presupuesto de Existente M15 ${suffix}`});
  const inactiveToggle = panel.getByRole("checkbox", {name: `Copiar presupuesto de Archivada M15 ${suffix}`});
  await expect(newToggle).toBeChecked();
  await expect(existingToggle).not.toBeChecked();
  await expect(inactiveToggle).toBeDisabled();
  expect(await getBudgetLimit(page, targetMonth, newCategory)).toBeNull();
  expect(await getBudgetLimit(page, targetMonth, existingCategory)).toBe(275);

  await panel.getByRole("button", {name: "Copiar 1 presupuesto"}).click();
  await expect(page.locator("#planning-budget-copy-panel")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Copiar de otro mes", exact: true})).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("status").filter({hasText: "Copia completada: 1 presupuesto nuevo."})).toBeVisible();
  const copiedLimit = await getBudgetLimit(page, targetMonth, newCategory);
  expect(copiedLimit).toBe(125);
  expect(await getBudgetLimit(page, targetMonth, existingCategory)).toBe(275);
  expect(await getBudgetLimit(page, targetMonth, inactiveCategory)).toBeNull();
  await expect(composer.getByLabel("Límite", {exact: true})).toHaveValue("42.75");
  await expect(draftCategory).toHaveValue(String(draftCategoryId));
  expect(await getBudgetLimit(page, targetMonth, draftCategoryId)).toBe(draftBudgetBefore);
  await expect(page.locator(`.budget-row#planning-budget-${existingBudgetId}`)).toBeVisible();
  const copiedRow = page.locator(".budget-row").filter({hasText: `ZZZ Nueva M15 ${suffix}`}).first();
  await expect(copiedRow).toBeFocused();
  await expect(copiedRow).toBeInViewport();
  assertNoPageErrors();
});

test("M15 el overwrite existente requiere selección expresa y respeta la privacidad", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const {source: sourceMonth, target: targetMonth} = uniqueMonthPair();
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, `/?tab=planning&plan_month=${targetMonth}`);
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const categoryName = `Existente M15 ${Date.now()}`;
  const categoryId = await createExpenseCategory(page, categoryName);
  await createBudget(page, sourceMonth, categoryId, "245.50");
  await createBudget(page, targetMonth, categoryId, "175.25");
  await page.getByRole("button", {name: "Ocultar importes", exact: true}).click();

  const panel = await openCopyPanel(page);
  await panel.getByLabel("Mes de origen").fill(sourceMonth);
  await panel.getByRole("button", {name: "Ver vista previa"}).click();
  await expect(panel.getByText("Vista previa: 0 presupuestos nuevos, 1 presupuesto existente y 0 categorías inactivas.")).toBeVisible();
  await expectCopyPanelGeometry(page, panel);
  const overwrite = panel.getByRole("checkbox", {name: `Sobrescribir presupuesto de ${categoryName}`});
  await expect(overwrite).not.toBeChecked();
  await expect(panel.getByRole("button", {name: "Selecciona presupuestos"})).toHaveAttribute("aria-disabled", "true");
  await expect(panel.locator(".budget-copy-item-copy small").first()).toContainText("•••• €");
  expect(await getBudgetLimit(page, targetMonth, categoryId)).toBe(175.25);

  await overwrite.check();
  await panel.getByRole("button", {name: "Copiar 1 presupuesto"}).click();
  await expect(page.locator("#planning-budget-copy-panel")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Copiar de otro mes", exact: true})).toHaveAttribute("aria-expanded", "false");
  expect(await getBudgetLimit(page, targetMonth, categoryId)).toBe(245.5);
  await expect(page.getByRole("button", {name: "Mostrar importes", exact: true})).toBeVisible();
  assertNoPageErrors();
});

test("M15 una vista previa obsoleta no aplica parcialmente y permite regenerarla @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const {source: sourceMonth, target: targetMonth} = uniqueMonthPair();
  await page.setViewportSize({width: 1280, height: 900});
  await openApp(page, `/?tab=planning&plan_month=${targetMonth}`);
  await expect(page.locator('.planning-view[aria-busy="false"]')).toBeVisible();

  const suffix = Date.now();
  const newCategory = await createExpenseCategory(page, `Nueva conflicto M15 ${suffix}`);
  const existingCategory = await createExpenseCategory(page, `Existente conflicto M15 ${suffix}`);
  await createBudget(page, sourceMonth, newCategory, "80.00");
  const existingBudgetId = await createBudget(page, sourceMonth, existingCategory, "160.00");
  const targetBudgetId = await createBudget(page, targetMonth, existingCategory, "90.00");

  const panel = await openCopyPanel(page);
  await panel.getByLabel("Mes de origen").fill(sourceMonth);
  await panel.getByRole("button", {name: "Ver vista previa"}).click();
  await expect(panel.getByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 0 categorías inactivas.")).toBeVisible();
  await expectCopyPanelGeometry(page, panel);
  await panel.getByRole("checkbox", {name: `Sobrescribir presupuesto de Existente conflicto M15 ${suffix}`}).check();
  const {origin, headers} = await apiContext(page);
  const concurrentChange = await page.request.patch(`${origin}/api/budgets/${targetBudgetId}/`, {headers, data: {limit: "95.00"}});
  expect(concurrentChange.status()).toBe(200);

  await panel.getByRole("button", {name: "Copiar 2 presupuestos"}).click();
  await expect(panel.getByRole("alert")).toContainText("Genera una nueva vista previa");
  await expect(panel.getByLabel("Mes de origen")).toBeFocused();
  await expect(page.getByRole("button", {name: "Cerrar copia", exact: true})).toHaveAttribute("aria-expanded", "true");
  expect(await getBudgetLimit(page, targetMonth, newCategory)).toBeNull();
  expect(await getBudgetLimit(page, targetMonth, existingCategory)).toBe(95);
  expect(await getBudgetLimit(page, sourceMonth, existingCategory)).toBe(160);
  expect(existingBudgetId).toBeGreaterThan(0);

  await panel.getByRole("button", {name: "Ver vista previa"}).click();
  await expect(panel.getByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 0 categorías inactivas.")).toBeVisible();
  assertNoPageErrors();
});
