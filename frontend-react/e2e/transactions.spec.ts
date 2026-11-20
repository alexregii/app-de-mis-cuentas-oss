import {expect, test, type Locator, type Page} from "playwright/test";
import {installPageErrorGuard, openApp, replaceControlledInput, resetE2eDatabase, waitForAppRefresh} from "./helpers";

test.beforeEach(async ({}, testInfo) => resetE2eDatabase(testInfo.project.name));

const ledgerRows = (page: Page) => page.locator(".ui-statement-ledger__row");

async function togglePrivacyPreservingPageAnchor(page: Page, toggle: Locator, heading: Locator, assertAmounts: (privacyMode: boolean) => Promise<void>) {
  await toggle.focus({preventScroll: true});
  await page.evaluate(() => window.scrollTo(0, Math.min(120, Math.max(0, document.documentElement.scrollHeight - innerHeight))));
  await expect(toggle).toBeFocused();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const headingTopBefore = (await heading.boundingBox())?.y;
  expect(headingTopBefore).not.toBeUndefined();

  for (const privacyMode of [true, false]) {
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", String(privacyMode));
    await expect(toggle).toBeFocused();
    if (privacyMode) await expect(page.locator(".app-frame")).toHaveClass(/is-privacy-mode/);
    else await expect(page.locator(".app-frame")).not.toHaveClass(/is-privacy-mode/);
    await assertAmounts(privacyMode);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await heading.boundingBox())?.y).toBeCloseTo(headingTopBefore!, 0);
    const documentGeometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(documentGeometry.scrollWidth).toBeLessThanOrEqual(documentGeometry.clientWidth + 1);
  }
}

async function openRowActions(row: Locator) {
  await row.getByRole("button", {name: /^Acciones para/}).click();
}

test("crea y edita un movimiento manual @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=transactions");

  await page.getByRole("button", {name: "Añadir movimiento"}).click();
  const manualPanel = page.locator(".composer-panel").first();
  const form = manualPanel.locator("form");
  await form.getByRole("spinbutton", {name: "Importe", exact: true}).pressSequentially("42");
  await form.getByLabel("Fecha").fill("2025-01-15");
  await replaceControlledInput(form.getByLabel("Concepto"), "Movimiento manual E2E creado");
  await form.getByRole("combobox", {name: "Categoría de la partida 1"}).selectOption({label: "Comida E2E"});
  const createRefresh = waitForAppRefresh(page);
  await form.getByRole("button", {name: "Guardar movimiento"}).click();
  await expect(page.getByText("Movimiento creado.")).toBeVisible();
  await createRefresh;

  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await replaceControlledInput(search, "Movimiento manual E2E creado");
  const row = ledgerRows(page).filter({hasText: "Movimiento manual E2E creado"});
  await expect(row).toBeVisible();

  await openRowActions(row);
  await row.getByRole("button", {name: "Editar Movimiento manual E2E creado"}).click();
  const description = form.getByLabel("Concepto");
  await replaceControlledInput(description, "Movimiento manual E2E editado");
  const updateResponse = page.waitForResponse((response) => response.url().includes("/api/transactions/") && response.request().method() === "PATCH");
  const updateRefresh = waitForAppRefresh(page);
  await form.getByRole("button", {name: "Guardar cambios"}).click();
  const updatePayload = await (await updateResponse).json() as {transaction?: {description?: string}};
  expect(updatePayload.transaction?.description).toBe("Movimiento manual E2E editado");
  await expect(page.getByText("Movimiento actualizado.")).toBeVisible();
  await updateRefresh;
  await replaceControlledInput(search, "Movimiento manual E2E editado");
  await expect(ledgerRows(page).filter({hasText: "Movimiento manual E2E editado"})).toBeVisible();
  assertNoPageErrors();
});

test("reabre y reconfirma una compra bancaria repartida conservando sus partidas @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const description = "Compra bancaria confirmable E2E";
  await openApp(page, "/?tab=review");
  const bankId = await page.evaluate(async (name) => {
    const response = await fetch("/api/bank-review/", {cache: "no-store"});
    const payload = await response.json();
    return payload.rows.find((row: {description: string}) => row.description === name)?.id as number | undefined;
  }, description);
  expect(bankId).toBeDefined();
  const reviewRow = page.locator(`[data-review-item="bank:${bankId}"]`);
  await expect(reviewRow).toBeVisible();
  await reviewRow.getByRole("button", {name: "Incorporar"}).click();
  await expect(reviewRow).toHaveCount(0);

  await openApp(page, `/?tab=transactions&q=${encodeURIComponent(description)}`);
  const row = ledgerRows(page).filter({hasText: description});
  await expect(row).toBeVisible();
  const original = await page.evaluate(async (query) => {
    const response = await fetch(`/api/transactions/?q=${encodeURIComponent(query)}`, {cache: "no-store"});
    return response.json();
  }, description);
  expect(original.count).toBe(1);
  const transactionId = original.results[0].id;
  const balanceBeforeReopen = await page.evaluate(async () => (await (await fetch("/api/bootstrap/", {cache: "no-store"})).json()).metrics.total_balance);

  await openRowActions(row);
  await row.getByRole("button", {name: `Distribuir categorías ${description}`}).click();
  const allocationForm = page.locator("form.transaction-allocation-form");
  await allocationForm.getByLabel("Importe de la partida 1").fill("7.50");
  await allocationForm.getByRole("button", {name: "Añadir partida"}).click();
  await allocationForm.getByLabel("Categoría de la partida 2").selectOption({label: "Ocio E2E · Salidas E2E"});
  await allocationForm.getByLabel("Importe de la partida 2").fill("5.00");
  await allocationForm.getByRole("button", {name: "Guardar partidas"}).click();
  await expect(allocationForm).toBeHidden();
  const split = await page.evaluate(async (query) => {
    const response = await fetch(`/api/transactions/?q=${encodeURIComponent(query)}`, {cache: "no-store"});
    return response.json();
  }, description);
  expect(split.count).toBe(1);
  expect(split.results[0].id).toBe(transactionId);
  expect(split.results[0].allocations.map((part: {amount: number}) => part.amount)).toEqual([7.5, 5]);

  await openRowActions(row);
  await row.getByRole("button", {name: `Reabrir ${description}`}).click();
  await expect(row).toHaveCount(0);
  const balanceWhileReopened = await page.evaluate(async () => (await (await fetch("/api/bootstrap/", {cache: "no-store"})).json()).metrics.total_balance);
  expect(balanceWhileReopened).toBeCloseTo(balanceBeforeReopen + 12.5, 2);

  await openApp(page, "/?tab=review");
  const reopened = page.locator(`[data-review-item="bank:${bankId}"]`);
  await reopened.getByRole("button", {name: "Más detalles"}).click();
  await expect(reopened).toContainText("Reparto existente");
  await expect(reopened).toContainText("Comida E2E");
  await expect(reopened).toContainText("Ocio E2E · Salidas E2E");
  await reopened.getByRole("button", {name: /Cerrar detalles/}).click();
  const reconfirm = reopened.getByRole("button", {name: /Reconfirmar reparto/});
  await expect(reconfirm).toBeVisible();
  await expect(reopened).toContainText("Sin categoría");
  await reconfirm.click();
  await expect(reopened).toHaveCount(0);

  const restored = await page.evaluate(async (query) => {
    const response = await fetch(`/api/transactions/?q=${encodeURIComponent(query)}`, {cache: "no-store"});
    return response.json();
  }, description);
  expect(restored.count).toBe(1);
  expect(restored.results[0].id).toBe(transactionId);
  expect(restored.results[0].allocation_revision).toBe(split.results[0].allocation_revision);
  expect(restored.results[0].allocations.map((part: {amount: number}) => part.amount)).toEqual([7.5, 5]);
  const balanceAfterReconfirm = await page.evaluate(async () => (await (await fetch("/api/bootstrap/", {cache: "no-store"})).json()).metrics.total_balance);
  expect(balanceAfterReconfirm).toBe(balanceBeforeReopen);
  assertNoPageErrors();
});

const transferFocusScenarios = [
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: false},
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: true},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: true},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: false},
] as const;
for (const {viewport, reducedMotion} of transferFocusScenarios) {
    test(`el formulario de traspaso conserva el foco pendiente en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let bootstrapPayloadPromise: Promise<{accounts: Array<Record<string, unknown>>; [key: string]: unknown}> | undefined;
      let transferRequests = 0;
      let releaseFirstTransfer!: () => void;
      let markFirstTransferStarted!: () => void;
      const transferGate = new Promise<void>((resolve) => {releaseFirstTransfer = resolve;});
      const firstTransferStarted = new Promise<void>((resolve) => {markFirstTransferStarted = resolve;});
      await page.route("**/api/bootstrap/", async (route) => {
        bootstrapPayloadPromise ||= route.fetch().then((response) => response.json()) as Promise<{accounts: Array<Record<string, unknown>>; [key: string]: unknown}>;
        const payload = structuredClone(await bootstrapPayloadPromise);
        const firstAccount = payload.accounts[0];
        if (!firstAccount) throw new Error("La fixture de Traspasos necesita una cuenta de origen.");
        if (payload.accounts.length < 2) payload.accounts.push({...firstAccount, id: 999, name: "Cuenta destino E2E", kind: "savings", kind_display: "Cuenta de ahorro", bank_link: null});
        await route.fulfill({json: payload});
      });
      await page.route("**/api/transfers/", async (route) => {
        transferRequests += 1;
        if (transferRequests === 1) {
          markFirstTransferStarted();
          await transferGate;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Traspaso temporalmente no disponible."})});
          return;
        }
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, transactions: []})});
      });

      try {
        await openApp(page, "/?tab=transactions");
        await page.getByRole("button", {name: "Registrar traspaso", exact: true}).click();
        const form = page.locator("form").filter({has: page.getByRole("heading", {name: "Traspaso entre cuentas"})});
        const target = form.getByLabel("Destino");
        if (!await target.inputValue()) await target.selectOption({index: 1});
        await form.getByLabel("Importe").fill("42");
        await form.getByLabel("Fecha").fill("2026-09-30");
        await form.getByLabel("Concepto").fill("Traspaso estable E2E");
        const submit = form.locator("button[type=submit]");
        await submit.scrollIntoViewIfNeeded();
        await submit.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const submitTop = (await submit.boundingBox())?.y;
        expect(submitTop).not.toBeUndefined();
        await submit.press("Enter");
        await firstTransferStarted;
        await expect(form).toHaveAttribute("aria-busy", "true");
        await expect(submit).toHaveAccessibleName("Registrando…");
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        await expect(submit).toHaveAttribute("aria-busy", "true");
        expect(await submit.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(submit).toBeFocused();
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(1);
        expect((await submit.boundingBox())?.y).toBeCloseTo(submitTop!, 0);

        releaseFirstTransfer();
        await expect(form.getByRole("alert")).toBeVisible();
        await expect(submit).toHaveAccessibleName("Registrar traspaso");
        await expect(submit).toBeFocused();
        await expect(form.getByLabel("Concepto")).toHaveValue("Traspaso estable E2E");

        await submit.press("Enter");
        await expect(page.getByRole("status").filter({hasText: "Traspaso registrado."})).toBeVisible();
        const reopenedTrigger = page.getByRole("navigation", {name: "Acciones de movimientos"}).getByRole("button", {name: "Registrar traspaso", exact: true});
        await expect(form).toHaveCount(0);
        await expect(reopenedTrigger).toBeFocused();
        assertNoPageErrors();
      } finally {
        releaseFirstTransfer();
      }
    });
}

const movementEditorFocusScenarios = [
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: false},
  {viewport: {label: "móvil", width: 390, height: 700}, reducedMotion: true},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: false},
  {viewport: {label: "desktop", width: 1280, height: 480}, reducedMotion: true},
] as const;
for (const {viewport, reducedMotion} of movementEditorFocusScenarios) {
    test(`el editor de movimiento conserva foco y scroll mientras guarda en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let releaseSave!: () => void;
      let markSaveStarted!: () => void;
      const saveGate = new Promise<void>((resolve) => {releaseSave = resolve;});
      const saveStarted = new Promise<void>((resolve) => {markSaveStarted = resolve;});
      await page.route(/\/api\/transactions\/\d+\/$/, async (route) => {
        if (route.request().method() !== "PATCH") {
          await route.continue();
          return;
        }
        markSaveStarted();
        await saveGate;
        await route.fulfill({status: 403, contentType: "application/json", body: JSON.stringify({error: "No se pudo guardar el movimiento."})});
      });

      try {
        await openApp(page, "/?tab=transactions&q=Movimiento%20manual%20editable%20E2E");
        const row = ledgerRows(page).filter({hasText: "Movimiento manual editable E2E"});
        await expect(row).toBeVisible();
        await openRowActions(row);
        await row.getByRole("button", {name: "Editar Movimiento manual editable E2E"}).click();
        const form = page.locator(".composer-panel").first().locator("form");
        const description = form.getByLabel("Concepto");
        await replaceControlledInput(description, "Movimiento manual pendiente E2E");
        const submit = form.locator("button[type=submit]");
        await submit.scrollIntoViewIfNeeded();
        await submit.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const submitTop = (await submit.boundingBox())?.y;
        await submit.press("Enter");
        await saveStarted;
        await expect(form).toHaveAttribute("aria-busy", "true");
        await expect(submit).toHaveAccessibleName("Guardando…");
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        await expect(submit).toHaveAttribute("aria-busy", "true");
        expect(await submit.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(submit).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect((await submit.boundingBox())?.y).toBeCloseTo(submitTop!, 0);

        releaseSave();
        await expect(form.getByRole("alert")).toBeVisible();
        await expect(submit).toHaveAccessibleName("Guardar cambios");
        await expect(submit).toBeFocused();
        await expect(description).toHaveValue("Movimiento manual pendiente E2E");
        const submitTopAfter = (await submit.boundingBox())?.y;
        expect(submitTopAfter).not.toBeUndefined();
        expect(Math.abs(submitTopAfter! - submitTop!)).toBeLessThan(1);
        assertNoPageErrors();
      } finally {
        releaseSave();
      }
    });
}

test("mantiene filas, scroll y foco mientras llega una nueva búsqueda @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  let releaseRequest!: () => void;
  let markRequestStarted!: () => void;
  const heldRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
  const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
  await page.route("**/api/transactions/**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "sin-resultados-lento-e2e") {
      markRequestStarted();
      await heldRequest;
    }
    await route.continue();
  });

  try {
    await page.setViewportSize({width: 1280, height: 480});
    await openApp(page, "/?tab=transactions&q=Movimiento%20manual%20editable%20E2E");
    const row = page.locator(".ui-statement-ledger__row").filter({hasText: "Movimiento manual editable E2E"});
    await expect(row).toBeVisible();
    const search = page.getByRole("searchbox", {name: "Búsqueda"});
    await search.focus();
    await page.evaluate(() => window.scrollTo(0, Math.min(320, document.documentElement.scrollHeight - innerHeight)));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);

    await replaceControlledInput(search, "sin-resultados-lento-e2e");
    await requestStarted;
    await expect(page.locator(".view-stack")).toHaveAttribute("aria-busy", "true");
    await expect(row).toBeVisible();
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  } finally {
    releaseRequest();
  }

  await expect(page.getByRole("region", {name: "No hay movimientos para mostrar."})).toBeVisible();
  await expect(page.getByRole("searchbox", {name: "Búsqueda"})).toBeFocused();
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  test(`Movimientos conserva lectura y foco si falla una búsqueda sin conexión en ${viewport.label} @webkit-only`, async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: viewport.width, height: viewport.height});
  await openApp(page, "/?tab=transactions&q=Movimiento%20manual%20editable%20E2E");
  const row = ledgerRows(page).first();
  await expect(row).toBeVisible();
  await page.waitForLoadState("networkidle");
  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await search.focus();
  const rowDocumentTop = await row.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 180)), rowDocumentTop);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const headerHeightBefore = await page.locator(".app-header").evaluate((header) => header.getBoundingClientRect().height);
  const rowTopBefore = await row.evaluate((element) => element.getBoundingClientRect().top);
  await row.evaluate((element) => element.setAttribute("data-e2e-identity", "retained"));

  await page.context().setOffline(true);
  await expect(page.getByRole("status", {name: /Sin conexión/})).toBeVisible();
  await page.screenshot({path: testInfo.outputPath("offline-status.png"), fullPage: false});
  expect(await page.locator(".app-header").evaluate((header) => header.getBoundingClientRect().height)).toBe(headerHeightBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(await row.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(rowTopBefore, 0);

  await replaceControlledInput(search, "offline");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".view-stack")).toHaveAttribute("aria-busy", "false");
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-e2e-identity", "retained");
  await expect(search).toBeFocused();
  assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
test(`Movimientos conserva la fila y el ancla si falla una nueva búsqueda en ${viewport.label} @webkit-only`, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: viewport.width, height: viewport.height});
  await page.emulateMedia({reducedMotion: viewport.width === 390 ? "reduce" : "no-preference"});
  await page.route("**/api/transactions/**", (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "fallo-sin-respuesta-e2e") {
      return route.fulfill({status: 403, contentType: "application/json", body: JSON.stringify({error: "Búsqueda no autorizada."})});
    }
    return route.continue();
  });
  await openApp(page, "/?tab=transactions&q=E2E");
  await page.waitForLoadState("networkidle");
  const row = ledgerRows(page).first();
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.setAttribute("data-e2e-identity", "retained"));
  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await search.focus();
  const rowDocumentTop = await row.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const scrollTarget = Math.min(Math.max(0, rowDocumentTop - 180), Math.max(0, maxScroll - 160));
  await page.evaluate((top) => window.scrollTo(0, top), scrollTarget);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(maxScroll - scrollBefore).toBeGreaterThan(100);
  const rowTopBefore = await row.evaluate((element) => element.getBoundingClientRect().top);
  const failedResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("q") === "fallo-sin-respuesta-e2e" && response.status() === 403);
  await replaceControlledInput(search, "fallo-sin-respuesta-e2e");
  await failedResponse;

  await expect(page.getByRole("alert")).toContainText("Se muestran los resultados anteriores.");
  await expect(page.locator(".view-stack")).toHaveAttribute("aria-busy", "false");
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-e2e-identity", "retained");
  await expect(search).toBeFocused();
  expect(await row.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(rowTopBefore, 0);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(24);
  assertNoPageErrors();
});
}

test("reordena resultados sin reemplazar filas y respeta reduced motion @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 480});
  await page.emulateMedia({reducedMotion: "reduce"});
  let initialPayload: {results: Array<Record<string, unknown>>; [key: string]: unknown} | undefined;
  await page.route("**/api/transactions/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("q") === "reorder-e2e" && initialPayload) {
      return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({...initialPayload, results: [...initialPayload.results].reverse()})});
    }
    const response = await route.fetch();
    const payload = await response.json() as {results: Array<Record<string, unknown>>; [key: string]: unknown};
    if (url.searchParams.get("q") === "E2E") initialPayload = payload;
    return route.fulfill({response, json: payload});
  });

  await openApp(page, "/?tab=transactions&q=E2E");
  const rows = page.locator(".ui-statement-ledger__row");
  await expect(rows.first()).toBeVisible();
  const initialIds = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-ledger-item-id")));
  expect(initialIds.length).toBeGreaterThan(1);
  const preservedId = initialIds[0]!;
  await page.locator(`[data-ledger-item-id="${preservedId}"]`).evaluate((row) => row.setAttribute("data-e2e-identity", "preserved"));

  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await search.focus();
  await page.evaluate(() => window.scrollTo(0, Math.min(320, document.documentElement.scrollHeight - innerHeight)));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const reorderRequest = page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "reorder-e2e");
  await replaceControlledInput(search, "reorder-e2e");
  await reorderRequest;

  await expect.poll(() => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-ledger-item-id")))).toEqual([...initialIds].reverse());
  await expect(page.locator(`[data-ledger-item-id="${preservedId}"]`)).toHaveAttribute("data-e2e-identity", "preserved");
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  assertNoPageErrors();
});

test("reabre un movimiento CSV y lo devuelve a revisión @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/?tab=transactions&q=Compra%20CSV%20reabrible%20E2E");
  const row = ledgerRows(page).filter({hasText: "Compra CSV reabrible E2E"});
  await expect(row).toBeVisible();
  await openRowActions(row);
  const reopen = row.getByRole("button", {name: "Reabrir Compra CSV reabrible E2E"});
  const transactionId = await row.getAttribute("data-ledger-item-id");
  let releaseReopenFailure!: () => void;
  let markReopenFailureStarted!: () => void;
  let releaseReopenSuccess!: () => void;
  let markReopenSuccessStarted!: () => void;
  const reopenFailureGate = new Promise<void>((resolve) => {releaseReopenFailure = resolve;});
  const reopenFailureStarted = new Promise<void>((resolve) => {markReopenFailureStarted = resolve;});
  const reopenSuccessGate = new Promise<void>((resolve) => {releaseReopenSuccess = resolve;});
  const reopenSuccessStarted = new Promise<void>((resolve) => {markReopenSuccessStarted = resolve;});
  let reopenRequests = 0;
  await page.route(`**/api/transactions/${transactionId}/reopen/`, async (route) => {
    reopenRequests += 1;
    if (reopenRequests === 1) {
      markReopenFailureStarted();
      await reopenFailureGate;
      await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "No se pudo reabrir; inténtalo de nuevo."})});
      return;
    }
    if (reopenRequests === 2) {
      markReopenSuccessStarted();
      await reopenSuccessGate;
      await route.continue();
      return;
    }
    await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Solicitud de reapertura duplicada."})});
  });
  await reopen.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const rowTopBefore = (await row.boundingBox())?.y;
  try {
    await page.keyboard.press("Enter");
    await reopenFailureStarted;
    await expect(row).toHaveAttribute("aria-busy", "true");
    await expect(reopen).toHaveAttribute("aria-disabled", "true");
    await expect(reopen).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await row.boundingBox())?.y).toBeCloseTo(rowTopBefore!, 0);

    await reopen.press("Enter");
    expect(reopenRequests).toBe(1);
    await expect(reopen).toBeFocused();
    releaseReopenFailure();
    await expect(row.getByRole("alert")).toHaveText("No se pudo reabrir; inténtalo de nuevo.");
    await expect(row).toBeVisible();
    await expect(reopen).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await row.boundingBox())?.y).toBeCloseTo(rowTopBefore!, 0);

    await reopen.press("Enter");
    await reopenSuccessStarted;
    expect(reopenRequests).toBe(2);
    await expect(row).toHaveAttribute("aria-busy", "true");
    await expect(reopen).toBeFocused();
    releaseReopenSuccess();
    await expect(row).toHaveCount(0);
    await expect(page.locator(".view-stack > .sr-status")).toHaveText("Movimiento reabierto para revisión.");
    await expect(page.getByRole("region", {name: "No hay movimientos para mostrar."})).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  } finally {
    releaseReopenFailure();
    releaseReopenSuccess();
  }
  assertNoPageErrors();
});

test("privacidad en Movimientos conserva máscara, foco y scroll entre móvil y escritorio @webkit-only", {tag: "@app-critical"}, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/?tab=transactions&q=Ocio%20directo%20E2E");
  await expect(page.locator(".ui-statement-ledger__row")).toHaveCount(1);
  const heading = page.getByRole("heading", {name: "Movimientos", exact: true}).first();
  const assertTransactionAmounts = async (privacyMode: boolean) => {
    if (privacyMode) {
      await expect(page.getByText(/18,00/)).toHaveCount(0);
      await expect(page.getByLabel(/18,00/)).toHaveCount(0);
      await expect(page.getByLabel("Importe oculto")).toHaveCount(5);
    } else await expect(page.getByLabel(/Importe: -18,00/)).toBeVisible();
  };
  await togglePrivacyPreservingPageAnchor(page, page.locator('.app-header button[aria-pressed]'), heading, assertTransactionAmounts);

  await page.setViewportSize({width: 1280, height: 900});
  await expect(page.locator(".ui-statement-ledger__row")).toHaveCount(1);
  await expect(page.locator(".desktop-rail .rail-actions button[aria-pressed]")).toBeVisible();
  await togglePrivacyPreservingPageAnchor(page, page.locator(".desktop-rail .rail-actions button[aria-pressed]"), heading, assertTransactionAmounts);
  assertNoPageErrors();
});

test("Movimientos consume el arquetipo estable sin Panel y conserva su geometría @chromium-only", {tag: "@app-critical"}, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  for (const width of [393, 1280]) {
    await page.setViewportSize({width, height: 900});
    await openApp(page, "/?tab=transactions");
    const archetype = page.locator("[data-ledger-archetype]");
    await expect(archetype).toBeVisible();
    await expect(archetype.locator(":scope > [data-ledger-slot=header]")).toBeVisible();
    await expect(archetype.locator(":scope > [data-ledger-slot=selection]")).toBeVisible();
    await expect(archetype.locator(":scope > [data-ledger-slot=filter]")).toBeVisible();
    await expect(archetype.locator(":scope > [data-ledger-slot=results]")).toBeVisible();
    expect(await archetype.locator(":scope > [data-ledger-slot]").evaluateAll((slots) => slots.map((slot) => slot.getAttribute("data-ledger-slot")))).toEqual(["header", "selection", "filter", "results"]);
    await expect(archetype.locator(".panel")).toHaveCount(0);
    await expect(archetype.locator("[data-ledger-slot=results] .ui-statement-ledger")).toBeVisible();
    const firstDate = archetype.locator(".ui-statement-ledger__row > time").first();
    await expect(firstDate).toBeVisible();
    await expect(firstDate).toHaveText(/\d{1,2}\/\d{1,2}\/\d{4}/);
    const geometry = await archetype.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const ledger = element.querySelector<HTMLElement>(".ui-statement-ledger")!.getBoundingClientRect();
      return {left: bounds.left, right: bounds.right, width: innerWidth, pageWidth: document.documentElement.scrollWidth, ledgerLeft: ledger.left, ledgerRight: ledger.right};
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.ledgerLeft).toBeGreaterThanOrEqual(geometry.left);
    expect(geometry.ledgerRight).toBeLessThanOrEqual(geometry.right);
  }
  assertNoPageErrors();
});

test("la selección productiva mantiene rango y cancelación @webkit-only", {tag: "@app-critical"}, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=transactions");
  await page.getByRole("button", {name: "Seleccionar", exact: true}).click();
  const checkboxes = page.getByRole("checkbox", {name: /^Seleccionar /});
  const first = checkboxes.nth(0);
  const second = checkboxes.nth(1);
  await first.click();
  await second.click({modifiers: ["Shift"]});
  const selectedSummary = page.getByText(/\d+ seleccionados/);
  await expect(selectedSummary).toBeVisible();
  expect(Number((await selectedSummary.textContent())?.match(/\d+/)?.[0] || 0)).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", {name: "Cancelar selección"}).click();
  await expect(page.getByRole("button", {name: "Seleccionar", exact: true})).toBeVisible();
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
test(`la búsqueda vacía conserva filtro, foco y posición hasta mostrar limpiar en ${viewport.label} @webkit-only`, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: viewport.width, height: viewport.height});
  await openApp(page, "/?tab=transactions&q=E2E");
  await page.waitForLoadState("networkidle");
  await expect(ledgerRows(page).first()).toBeVisible();
  const search = page.getByRole("searchbox", {name: "Búsqueda"});
  await search.focus();
  await page.evaluate(() => window.scrollTo(0, Math.min(120, document.documentElement.scrollHeight - innerHeight)));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const searchTopBefore = (await search.boundingBox())?.y;
  expect(searchTopBefore).not.toBeUndefined();

  await replaceControlledInput(search, "movimiento que no existe E2E");
  await expect(page.getByRole("heading", {name: "No hay movimientos para mostrar."})).toBeVisible();
  await expect(page.getByRole("button", {name: "Limpiar filtros"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Seleccionar", exact: true})).toBeDisabled();
  await expect(search).toHaveValue("movimiento que no existe E2E");
  await expect(search).toBeFocused();
  await expect(page.locator(".view-stack")).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect((await search.boundingBox())?.y).toBeCloseTo(searchTopBefore!, 0);
  assertNoPageErrors();
});
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
test(`la paginación conserva lectura durante la carga y enfoca la página nueva en ${viewport.label} @webkit-only`, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: viewport.width, height: viewport.height});
  await page.emulateMedia({reducedMotion: "reduce"});
  let firstTransaction: Record<string, unknown> | null = null;
  let releaseSecondPage!: () => void;
  let markSecondPageStarted!: () => void;
  const secondPageGate = new Promise<void>((resolve) => {releaseSecondPage = resolve;});
  const secondPageStarted = new Promise<void>((resolve) => {markSecondPageStarted = resolve;});
  await page.route("**/api/transactions/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("q") !== "E2E") return route.continue();
    const response = await route.fetch();
    const payload = await response.json() as {results: Array<Record<string, unknown>>; [key: string]: unknown};
    if (!firstTransaction) firstTransaction = payload.results[0] || null;
    if (!firstTransaction) return route.fulfill({response});
    const pageNumber = Number(url.searchParams.get("page") || 1);
    if (pageNumber === 2) {
      markSecondPageStarted();
      await secondPageGate;
    }
    const results = Array.from({length: 8}, (_, index) => ({
      ...firstTransaction,
      id: 920000 + pageNumber * 100 + index,
      description: `Página ${pageNumber} movimiento ${index + 1}`,
    }));
    await route.fulfill({response, json: {
      ...payload,
      results,
      page: pageNumber,
      count: 16,
      num_pages: 2,
      has_previous: pageNumber > 1,
      has_next: pageNumber < 2,
    }});
  });

  try {
    await openApp(page, "/?tab=transactions&q=E2E");
    await page.waitForLoadState("networkidle");
    const rows = ledgerRows(page);
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText("Página 1 movimiento 1");
    const pagination = page.getByRole("navigation", {name: "Páginas de movimientos"});
    const next = pagination.getByRole("button", {name: "Página siguiente"});
    await next.scrollIntoViewIfNeeded();
    await next.evaluate((element) => (element as HTMLButtonElement).focus({preventScroll: true}));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const nextTopBefore = (await next.boundingBox())?.y;
    expect(scrollBefore).toBeGreaterThan(0);
    expect(nextTopBefore).not.toBeUndefined();

    await next.press("Enter");
    await secondPageStarted;
    await expect(page.locator(".view-stack")).toHaveAttribute("aria-busy", "true");
    await expect(rows.first()).toContainText("Página 1 movimiento 1");
    await expect(next).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await next.boundingBox())?.y).toBeCloseTo(nextTopBefore!, 0);

    releaseSecondPage();
    await expect(rows.first()).toContainText("Página 2 movimiento 1");
    await expect(page.getByRole("button", {name: "Ir a página 2"})).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", {name: "Ir a página 2"})).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(await page.locator(".view-stack")).toHaveAttribute("aria-busy", "false");
    assertNoPageErrors();
  } finally {
    releaseSecondPage();
  }
});
}

test("los adjuntos se abren desde un modal nativo y restauran el foco @webkit-only", {tag: "@app-critical"}, async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await openApp(page, "/?tab=transactions&q=Compra%20con%20adjuntos%20E2E");
  const row = ledgerRows(page).filter({hasText: "Compra con adjuntos E2E"});
  await expect(row).toBeVisible();
  await openRowActions(row);
  const trigger = row.getByRole("button", {name: "Ver adjuntos de Compra con adjuntos E2E"});
  const menuTrigger = row.locator(".ui-statement-ledger__menu > .ui-overflow-menu__trigger");
  await trigger.click();
  const dialog = page.getByRole("dialog", {name: "Adjuntos de Compra con adjuntos E2E"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", {name: "Cerrar adjuntos"})).toBeFocused();
  await expect(dialog.getByRole("link", {name: "ticket-e2e.pdf"})).toHaveAttribute("href", /\/adjuntos\/\d+\//);
  await dialog.getByRole("button", {name: "Cerrar adjuntos"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(menuTrigger).toBeFocused();

  await row.getByRole("button", {name: "Ver adjuntos de Compra con adjuntos E2E"}).click();
  const reopenedDialog = page.getByRole("dialog", {name: "Adjuntos de Compra con adjuntos E2E"});
  await expect(reopenedDialog).toBeVisible();
  await reopenedDialog.press("Escape");
  await expect(reopenedDialog).toHaveCount(0);
  await expect(menuTrigger).toBeFocused();
  assertNoPageErrors();
});

test("Movimientos aplica la categoría elegida y cierra la selección @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  let submittedRows: number[] = [];
  let submittedCategory = 0;
  await page.route("**/api/transactions/bulk-category/", async (route) => {
    const payload = route.request().postDataJSON() as {rows: number[]; category: number};
    submittedRows = payload.rows;
    submittedCategory = payload.category;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ok: true, updated: payload.rows, message: "Movimientos categorizados."}),
    });
  });

  const optionsResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/options/");
  await openApp(page, "/?tab=transactions");
  const optionsPayload = await (await optionsResponsePromise).json() as {categories: Array<{id: number; name: string}>};
  const expectedCategoryId = optionsPayload.categories.find((item) => item.name === "Comida E2E")?.id;
  expect(expectedCategoryId).toBeDefined();
  const first = ledgerRows(page).filter({hasText: "Compra con adjuntos E2E"});
  const second = ledgerRows(page).filter({hasText: "Salida hija E2E"});
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const expectedRowIds = [Number(await first.getAttribute("data-ledger-item-id")), Number(await second.getAttribute("data-ledger-item-id"))];
  await page.getByRole("button", {name: "Seleccionar", exact: true}).click();
  await first.getByRole("checkbox", {name: "Seleccionar Compra con adjuntos E2E"}).check();
  await second.getByRole("checkbox", {name: "Seleccionar Salida hija E2E"}).check();
  await page.getByRole("button", {name: "Categorizar", exact: true}).click();
  const categoryGroup = page.getByRole("group", {name: "Categorizar selección"});
  const category = categoryGroup.getByRole("combobox");
  await category.fill("Comida");
  await categoryGroup.getByRole("option", {name: "Comida E2E", exact: true}).click();
  await categoryGroup.getByRole("button", {name: "Aplicar categoría", exact: true}).click();

  await expect.poll(() => submittedRows.length).toBe(2);
  expect(submittedRows).toEqual(expectedRowIds);
  expect(submittedCategory).toBe(expectedCategoryId);
  const toolbar = page.getByRole("region", {name: "Selección de movimientos"});
  await expect(toolbar.getByRole("status")).toHaveText("2 movimientos recategorizados.");
  await expect(page.getByRole("button", {name: "Seleccionar", exact: true})).toBeFocused();
  await expect(page.getByRole("checkbox", {name: "Seleccionar Compra con adjuntos E2E"})).toHaveCount(0);
  assertNoPageErrors();
});
