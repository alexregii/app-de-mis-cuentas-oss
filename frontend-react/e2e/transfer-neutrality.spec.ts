import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

type BootstrapMetrics = {metrics: {total_balance: number; income: number; expense: number}};
type TransactionList = {count: number; results: Array<{kind: string; signed_amount: number}>};

test("el traspaso crea dos apuntes y no altera saldo total, ingresos ni gastos", {tag: ["@app-critical", "@chromium-only"]}, async ({page, request}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const before = await (await request.get("/api/bootstrap/")).json() as BootstrapMetrics;
  await openApp(page, "/?tab=transactions");

  await page.getByRole("button", {name: "Registrar traspaso"}).click();
  const transferPanel = page.locator(".composer-panel").filter({hasText: "Traspasos"});
  const form = transferPanel.locator("form");
  await form.getByLabel("Origen").selectOption({label: "Cuenta diaria E2E"});
  await form.getByLabel("Destino").selectOption({label: "Ahorro E2E"});
  await form.getByLabel("Importe").fill("125.50");
  await form.getByLabel("Fecha").fill("2025-01-16");
  await form.getByLabel("Concepto").fill("Traspaso neutral E2E");
  const transferResponse = page.waitForResponse((response) => response.url().endsWith("/api/transfers/") && response.request().method() === "POST");
  await form.getByRole("button", {name: "Registrar traspaso"}).click();
  expect((await transferResponse).status()).toBe(201);
  await expect(transferPanel).toHaveCount(0);

  const after = await (await request.get("/api/bootstrap/")).json() as BootstrapMetrics;
  expect(after.metrics.total_balance).toBe(before.metrics.total_balance);
  expect(after.metrics.income).toBe(before.metrics.income);
  expect(after.metrics.expense).toBe(before.metrics.expense);

  const movements = await (await request.get("/api/transactions/?q=Traspaso%20neutral%20E2E"))
    .json() as TransactionList;
  expect(movements.count).toBe(2);
  expect(movements.results.map((item) => item.kind).sort()).toEqual(["transfer_in", "transfer_out"]);
  expect(movements.results.reduce((total, item) => total + item.signed_amount, 0)).toBe(0);
  assertNoPageErrors();
});
