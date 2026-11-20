import {expect, test, type Page} from "playwright/test";
import {installPageErrorGuard, openApp, resetE2eDatabase} from "./helpers";

type TestBankRow = Record<string, any>;
type TestBankPayload = {rows: TestBankRow[]; categories: TestBankRow[]; [key: string]: any};
type BulkRequest = {action: string; rows: number[]; categories?: Record<string, string>};
type BulkResponse = {status: number; body: Record<string, unknown>};

async function mockBankGroupApi(page: Page, makeRows: (payload: TestBankPayload) => TestBankRow[], respond: (request: BulkRequest) => BulkResponse = (request) => ({
  status: 200,
  body: {ok: true, message: `${request.rows.length} movimientos procesados.`, removed: request.rows, failed: []},
})) {
  let payload: TestBankPayload;
  let rows: TestBankRow[];
  let initialize: Promise<void> | null = null;
  const removedIds = new Set<number>();
  const bulkRequests: BulkRequest[] = [];
  await page.route("**/api/bank-review/", async (route) => {
    if (!initialize) initialize = route.fetch().then(async (response) => {
      payload = await response.json() as TestBankPayload;
      rows = makeRows(payload);
    });
    await initialize;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({...payload!, rows: rows!.filter((row) => !removedIds.has(row.id))}),
    });
  });
  await page.route("**/api/bank-review/bulk/", async (route) => {
    const request = route.request().postDataJSON() as BulkRequest;
    bulkRequests.push(request);
    const result = respond(request);
    for (const id of (result.body.removed as number[] | undefined) ?? []) removedIds.add(id);
    await route.fulfill({
      status: result.status,
      contentType: "application/json",
      body: JSON.stringify(result.body),
    });
  });
  return {bulkRequests, removedIds};
}

function groupedRuleRows(payload: TestBankPayload, count: number, startId = 10000) {
  const template = payload.rows.find((row) => row.id === 2);
  expect(template).toBeTruthy();
  const category = template!.category ?? template!.suggested_category;
  const accountId = template!.bank_account.account.id as number;
  return Array.from({length: count}, (_, index) => ({
    ...template,
    id: startId + index,
    description: `Compra agrupada ${String(index + 1).padStart(2, "0")}`,
    category,
    suggested_category: category,
    category_rule_matches: [{id: 700, description: "Compra agrupada", kind: template!.kind, category, priority: 1, match_mode: "starts_with", account_id: accountId, amount_min: null, amount_max: null}],
    possible_duplicate: false,
    possible_transfer: false,
    fee_transaction_id: null,
    prediction: null,
    status: "pending",
  }));
}

test.beforeEach(async ({}, testInfo) => {
  resetE2eDatabase(testInfo.project.name);
});

test("M14 filtro Preparados: el preview no incluye filas ocultas con categoría pendiente @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const mock = await mockBankGroupApi(page, (payload) => groupedRuleRows(payload, 4, 14000).map((row, index) =>
    index < 2 ? row : {...row, category: null, suggested_category: null},
  ));

  await openApp(page, "/?tab=review");
  await page.getByRole("button", {name: "Preparados", exact: true}).click();
  const bank = page.getByRole("region", {name: "Cola bancaria"});
  await expect(bank.locator('[data-review-item^="bank:"]')).toHaveCount(2);
  await bank.getByRole("button", {name: /Revisar grupo/}).click();
  const preview = bank.getByRole("region", {name: "Vista previa de regla Compra agrupada"});
  await expect(preview.locator(".review-rule-groups__rows > li")).toHaveCount(2);
  await expect(preview.getByText("#14000")).toBeVisible();
  await expect(preview.getByText("#14001")).toBeVisible();
  await expect(preview.getByText(/#14002|#14003/)).toHaveCount(0);

  const response = page.waitForResponse((item) => item.url().includes("/api/bank-review/bulk/") && item.ok());
  await preview.getByRole("button", {name: "Incorporar 2 filas", exact: true}).click();
  await response;
  expect(mock.bulkRequests[0]?.rows).toEqual([14000, 14001]);
  assertNoPageErrors();
});

test("M14 conflictos aplica solo filas compatibles y deja el resultado parcial en la cola @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const mock = await mockBankGroupApi(page, (payload) => {
    const template = payload.rows.find((row) => row.id === 2);
    expect(template).toBeTruthy();
    const food = template!.category ?? template!.suggested_category;
    const home = payload.categories.find((category) => category.display_name === "Vivienda E2E");
    expect(food).toBeTruthy();
    expect(home).toBeTruthy();
    const accountId = template!.bank_account.account.id as number;
    const ruleFood = {id: 700, description: "Compra agrupada", kind: template!.kind, category: food, priority: 1, match_mode: "starts_with", account_id: accountId, amount_min: null, amount_max: null};
    const ruleHome = {id: 701, description: "Compra", kind: template!.kind, category: home!, priority: 2, match_mode: "starts_with", account_id: accountId, amount_min: null, amount_max: null};
    return Array.from({length: 6}, (_, index) => ({
      ...template,
      id: 11000 + index,
      description: `Compra agrupada ${String(index + 1).padStart(2, "0")}`,
      category: food,
      suggested_category: food,
      category_rule_matches: index === 4 ? [ruleFood, ruleHome] : [ruleFood],
      possible_duplicate: index === 5,
      possible_transfer: false,
      fee_transaction_id: null,
      prediction: null,
      status: "pending",
    }));
  }, (request) => {
    const removed = request.rows.slice(0, 2);
    return {status: 200, body: {ok: true, message: "2 movimientos procesados. 1 requieren revisión individual.", removed, failed: request.rows.slice(2)}};
  });

  await openApp(page, "/?tab=review");
  const bank = page.getByRole("region", {name: "Cola bancaria"});
  const overridden = bank.locator('[data-review-item="bank:11003"]');
  await overridden.getByRole("button", {name: "Categoría: Comida E2E"}).click();
  await overridden.getByRole("option", {name: "Vivienda E2E"}).click();
  await expect(overridden.getByRole("button", {name: "Categoría: Vivienda E2E"})).toBeVisible();

  await bank.getByRole("button", {name: /Revisar grupo/}).click();
  const preview = bank.getByRole("region", {name: "Vista previa de regla Compra agrupada"});
  const previewRows = preview.locator(".review-rule-groups__rows > li");
  await expect(previewRows).toHaveCount(3);
  await expect(preview.getByText("#11000")).toBeVisible();
  await expect(preview.getByText("#11001")).toBeVisible();
  await expect(preview.getByText("#11002")).toBeVisible();
  await expect(preview.getByText(/#11003|#11004|#11005/)).toHaveCount(0);
  await expect(mock.bulkRequests).toHaveLength(0);
  await bank.getByText(/3 filas con reglas en conflicto/).click();
  await expect(bank.getByText(/La categoría del borrador difiere de la regla/)).toBeVisible();
  await expect(bank.getByText(/Varias reglas coinciden con categorías distintas/)).toBeVisible();

  const confirm = preview.getByRole("button", {name: "Incorporar 3 filas", exact: true});
  const partialResponse = page.waitForResponse((response) => response.url().includes("/api/bank-review/bulk/") && response.ok());
  await confirm.focus();
  await confirm.press("Enter");
  await partialResponse;
  await expect.poll(() => mock.bulkRequests.length).toBe(1);
  await expect(page.getByText(/2 movimientos procesados\. 1 requieren revisión individual\./)).toBeVisible();
  const bulkPayload = mock.bulkRequests[0];
  expect(bulkPayload?.rows).toEqual([11000, 11001, 11002]);
  expect(new Set(Object.values(bulkPayload?.categories ?? {}))).toEqual(new Set([String(bulkPayload?.categories?.["11000"])]));
  await expect(bank.getByRole("button", {name: /Revisar grupo/})).toHaveCount(0);
  await expect(bank.locator('[data-review-item="bank:11002"]').getByRole("button", {name: "Categoría: Comida E2E"})).toBeVisible();
  await expect(bank.locator('[data-review-item="bank:11003"]').getByRole("button", {name: "Categoría: Vivienda E2E"})).toBeVisible();
  await expect(bank.locator('[data-review-item="bank:11004"]')).toBeVisible();
  await expect(bank.locator('[data-review-item="bank:11005"]')).toBeVisible();
  await expect(bank).toBeFocused();
  assertNoPageErrors();
});
