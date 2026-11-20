import {expect, test, type Page} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

const account = (id: number, name: string) => ({
  id,
  name,
  kind: "bank",
  kind_display: "Banco",
  balance: 1000,
  opening_balance: 0,
  color: "#245",
  active: true,
  bank_link: null,
});

const bankRow = (id: number, accountId: number, accountName: string, kind: "income" | "expense", date: string, description: string) => ({
  id,
  bank_account: {id: accountId + 10, display_name: accountName, account: account(accountId, accountName)},
  booking_date: date,
  description,
  amount: 24.5,
  kind,
  currency: "EUR",
  category: null,
  suggested_category: null,
  prediction: null,
  possible_duplicate: false,
  possible_transfer: true,
  fee_transaction_id: null,
  status: "pending",
});

async function installTransferFixtures(page: Page, {applyFirstTransferBeforeFailure = false, includeFee = false} = {}) {
  const outgoing = bankRow(41, 1, "Cuenta origen", "expense", "2026-07-10", "Traspaso enviado");
  const incoming = bankRow(42, 2, "Cuenta destino", "income", "2026-07-11", "Traspaso recibido");
  if (includeFee) outgoing.amount = 25.5;
  const feeAmount = outgoing.amount - incoming.amount;
  let linked = false;
  let transferRequests = 0;
  let appliedTransfers = 0;
  await page.route("**/api/bank-review/41/transfer-options/", (route) => route.fulfill({json: {ok: true, candidates: [{
    candidate_type: "bank_row",
    candidate_id: "42",
    source: "bank",
    outgoing: {bank_transaction_id: 41, transaction_id: null, account: {id: 1, name: "Cuenta origen"}, booking_date: outgoing.booking_date, description: outgoing.description, amount: outgoing.amount},
    incoming: {bank_transaction_id: 42, transaction_id: null, account: {id: 2, name: "Cuenta destino"}, booking_date: incoming.booking_date, description: incoming.description, amount: incoming.amount},
    transfer_amount: incoming.amount,
    fee_amount: feeAmount,
    requires_fee_confirmation: feeAmount > 0,
    days_apart: 1,
  }]}}));
  await page.route("**/api/bank-review/41/transfer/", async (route) => {
    transferRequests += 1;
    expect(route.request().postDataJSON()).toEqual({candidate_type: "bank_row", candidate_id: "42", confirm_fee: feeAmount > 0});
    if (applyFirstTransferBeforeFailure && transferRequests === 1) {
      linked = true;
      appliedTransfers += 1;
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Respuesta perdida después de contabilizar."})});
      return;
    }
    if (!linked) {
      linked = true;
      appliedTransfers += 1;
    }
    await route.fulfill({json: {ok: true, removed: [41, 42], message: "Traspaso bancario enlazado."}});
  });
  await page.route("**/api/bank-review/", async (route) => {
    await route.fulfill({json: {ok: true, rows: linked ? [] : [outgoing, incoming], unlinked_transfers: [], categories: [], refund_candidates: []}});
  });
  return {
    setLinked: (value: boolean) => {linked = value;},
    get transferRequests() { return transferRequests; },
    get appliedTransfers() { return appliedTransfers; },
  };
}

test("M08 reintenta una respuesta perdida sin duplicar y reabre el par bancario @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const fixtures = await installTransferFixtures(page, {applyFirstTransferBeforeFailure: true, includeFee: true});
  await openApp(page, "/?tab=review");

  const origin = page.locator('[data-review-item="bank:41"]');
  await expect(origin).toContainText("Traspaso enviado");
  await origin.getByRole("button", {name: "Vincular traspaso"}).click();
  const panel = page.locator("#bank-transfer-link-panel-41");
  await expect(panel.getByRole("heading", {name: "Enlazar traspaso"})).toBeVisible();
  await panel.getByRole("combobox", {name: "Contrapartida"}).selectOption("bank_row:42");
  await panel.getByRole("checkbox", {name: /Confirmo que 1,00/}).check();

  await panel.getByRole("button", {name: "Confirmar traspaso y comisión"}).click();
  await expect(panel.getByRole("alert")).toContainText("No se pudo enlazar el traspaso");
  await expect(origin).toBeVisible();

  await panel.getByRole("button", {name: "Confirmar traspaso y comisión"}).click();
  await expect(page.locator('[data-review-item="bank:41"]')).toHaveCount(0);
  expect(fixtures.transferRequests).toBe(2);
  expect(fixtures.appliedTransfers).toBe(1);

  let transactionListed = true;
  await page.route("**/api/transactions/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/reopen/")) {
      transactionListed = false;
      fixtures.setLinked(false);
      await route.fulfill({json: {ok: true, removed_type: "transaction", removed: [91001, 91002, 91003], source: "bank", target: 41, message: "Movimiento reabierto para revisión."}});
      return;
    }
    if (request.method() !== "GET" || !url.pathname.endsWith("/api/transactions/")) {
      await route.continue();
      return;
    }
    const response = await route.fetch({url: new URL("/api/transactions/?page=1", url.origin).toString()});
    const payload = await response.json() as {results: Array<Record<string, unknown>>; [key: string]: unknown};
    const template = payload.results[0];
    if (!template) throw new Error("La fixture de Traspasos necesita al menos un movimiento base.");
    const sourceAccount = account(1, "Cuenta origen");
    const targetAccount = account(2, "Cuenta destino");
    const movements = [
      {...template, id: 91001, kind: "transfer_out", kind_display: "Traspaso de salida", amount: 24.5, signed_amount: -24.5, date: "2026-07-10", description: "Traspaso enviado", account: sourceAccount, source: "enable_banking", source_display: "Enable Banking", is_transfer: true, can_reopen: true},
      {...template, id: 91002, kind: "transfer_in", kind_display: "Traspaso de entrada", amount: 24.5, signed_amount: 24.5, date: "2026-07-11", description: "Traspaso recibido", account: targetAccount, source: "enable_banking", source_display: "Enable Banking", is_transfer: true, can_reopen: true},
      {...template, id: 91003, kind: "expense", kind_display: "Gasto", amount: 1, signed_amount: -1, date: "2026-07-10", description: "Comisión de traspaso M08 E2E", account: sourceAccount, source: "enable_banking", source_display: "Enable Banking", is_transfer: false, can_reopen: true},
    ];
    await route.fulfill({response, json: {...payload, count: transactionListed ? movements.length : 0, results: transactionListed ? movements : []}});
  });

  await openApp(page, "/?tab=transactions&q=Comisi%C3%B3n%20de%20traspaso%20M08%20E2E");
  const feeRow = page.locator(".ui-statement-ledger__row").filter({hasText: "Comisión de traspaso M08 E2E"});
  await expect(feeRow).toBeVisible();
  await feeRow.getByRole("button", {name: /^Acciones para/}).click();
  const reopen = feeRow.getByRole("button", {name: "Reabrir Comisión de traspaso M08 E2E"});
  const reopenRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/transactions/91003/reopen/" && request.method() === "POST");
  await reopen.click();
  await reopenRequest;
  await expect(feeRow).toHaveCount(0);

  await openApp(page, "/?tab=review");
  await expect(page.locator('[data-review-item="bank:41"]')).toContainText("Traspaso enviado");
  await expect(page.locator('[data-review-item="bank:42"]')).toContainText("Traspaso recibido");
  assertNoPageErrors();
});

for (const viewport of [
  {name: "escritorio", width: 1440, height: 1000},
  {name: "móvil", width: 390, height: 844},
]) {
  test(`M08 preview enlaza dos orígenes bancarios ${viewport.name}${viewport.name === "escritorio" ? " @chromium-only" : " @webkit-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await installTransferFixtures(page);
    await openApp(page, "/?tab=review");

    const origin = page.locator('[data-review-item="bank:41"]');
    await expect(origin).toContainText("Traspaso enviado");
    await origin.getByRole("button", {name: "Vincular traspaso"}).click();
    const panel = page.locator("#bank-transfer-link-panel-41");
    await expect(panel.getByRole("heading", {name: "Enlazar traspaso"})).toBeVisible();
    await expect(panel).toContainText("Cuenta origen");
    await expect(panel).toContainText("Cuenta destino");
    await panel.getByRole("button", {name: "Confirmar traspaso"}).click();

    await expect(page.locator('[data-review-item="bank:41"]')).toHaveCount(0);
    await expect(page.locator('[data-review-item="bank:42"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    assertNoPageErrors();
  });
}
