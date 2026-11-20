import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp, resetE2eDatabase} from "./helpers";

test.beforeEach(async ({}, testInfo) => {
  resetE2eDatabase(testInfo.project.name);
});

test("el menú de reglas en Revisión conserva foco/scroll y abre las rutas de Ajustes @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=review");
  const trigger = page.getByRole("button", {name: "Reglas de categoría"});
  await expect(trigger).toBeVisible();
  const menuPanel = page.locator(".review-page .ui-overflow-menu__panel");
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height: 700});
    const toolbarBounds = await page.locator(".review-controls").boundingBox();
    const selectionControlsBounds = await page.locator(".review-selection-controls").boundingBox();
    const rulesButtonBounds = await trigger.boundingBox();
    expect(toolbarBounds).not.toBeNull();
    expect(selectionControlsBounds).not.toBeNull();
    expect(rulesButtonBounds).not.toBeNull();
    expect(selectionControlsBounds!.x).toBeCloseTo(toolbarBounds!.x, 0);
    expect(selectionControlsBounds!.x + selectionControlsBounds!.width).toBeCloseTo(toolbarBounds!.x + toolbarBounds!.width, 0);
    expect(rulesButtonBounds!.x).toBeCloseTo(selectionControlsBounds!.x, 0);
    await trigger.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await trigger.click();
    await expect(menuPanel).toBeVisible();
    const bounds = await menuPanel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", {name: "Nueva regla"})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  }

  await page.setViewportSize({width: 1280, height: 900});
  const ruleTriggerBounds = await trigger.boundingBox();
  const selectBounds = await page.getByRole("button", {name: "Seleccionar"}).boundingBox();
  expect(ruleTriggerBounds).not.toBeNull();
  expect(selectBounds).not.toBeNull();
  expect(ruleTriggerBounds!.x + ruleTriggerBounds!.width).toBeLessThanOrEqual(selectBounds!.x);
  expect(selectBounds!.x + selectBounds!.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));

  const csv = page.getByRole("region", {name: "Importaciones CSV"});
  await csv.getByRole("button", {name: "Expandir CSV"}).click();
  const pendingRow = csv.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV pendiente E2E"});
  await expect(pendingRow).toBeVisible();
  await page.getByRole("button", {name: "Seleccionar"}).click();
  await pendingRow.getByRole("checkbox", {name: "Seleccionar Compra CSV pendiente E2E"}).check();
  const actionsButton = page.getByRole("button", {name: /^Acciones de selección/});
  const cancelSelectionButton = page.getByRole("button", {name: "Cancelar selección"});
  await expect(actionsButton).toBeVisible();
  await expect(actionsButton).toBeEnabled();
  const actionsBounds = await actionsButton.boundingBox();
  const cancelBounds = await cancelSelectionButton.boundingBox();
  const selectionModeRulesBounds = await trigger.boundingBox();
  expect(actionsBounds).not.toBeNull();
  expect(cancelBounds).not.toBeNull();
  expect(selectionModeRulesBounds).not.toBeNull();
  expect(selectionModeRulesBounds!.x + selectionModeRulesBounds!.width).toBeLessThanOrEqual(actionsBounds!.x);
  expect(actionsBounds!.x + actionsBounds!.width).toBeLessThanOrEqual(cancelBounds!.x);
  for (const bounds of [actionsBounds!, cancelBounds!]) {
    expect(selectionModeRulesBounds!.y).toBeLessThan(bounds.y + bounds.height);
    expect(selectionModeRulesBounds!.y + selectionModeRulesBounds!.height).toBeGreaterThan(bounds.y);
  }
  await trigger.focus();
  await page.keyboard.press("Tab");
  await expect(actionsButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelSelectionButton).toBeFocused();

  await trigger.scrollIntoViewIfNeeded();
  const pageScrollBeforeActions = await page.evaluate(() => window.scrollY);
  const ruleTopBeforeActions = (await trigger.boundingBox())?.y;
  await actionsButton.click();
  await expect(page.getByRole("group", {name: "Acciones de selección"})).toBeVisible();
  await expect(trigger).toBeVisible();
  expect(Math.abs((await trigger.boundingBox())!.y - ruleTopBeforeActions!)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeActions);

  await cancelSelectionButton.focus();
  await cancelSelectionButton.click();

  await page.setViewportSize({width: 390, height: 700});
  await trigger.click();
  await page.getByRole("button", {name: "Nueva regla"}).click();
  await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "settings" && url.searchParams.get("focus") === "new-rule");
  await expect(page.getByRole("textbox", {name: "Texto a reconocer"})).toBeFocused();

  await page.goBack();
  await expect(page.getByRole("heading", {name: "Revisión", exact: true})).toBeVisible();
  await trigger.click();
  await page.getByRole("button", {name: "Gestionar reglas"}).click();
  await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "settings" && url.searchParams.get("focus") === "rules");
  await expect(page.getByRole("button", {name: "Comprimir"})).toBeFocused();
  assertNoPageErrors();
});

test("la revisión bancaria confirma un preparado sin ocultar una señal de traspaso @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, "/?tab=review");
  const bankWorkspace = page.getByRole("region", {name: "Cola bancaria"});
  for (const width of [320, 390, 393, 430, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    await expect(bankWorkspace.locator('[data-review-item^="bank:"]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.setViewportSize({width: 1280, height: 640});

  const signalledCard = page.locator('[data-review-item^="bank:"]').filter({hasText: "Compra bancaria con señal E2E"});
  await expect(signalledCard.getByText("El movimiento podría ser un traspaso")).toBeVisible();
  await expect(signalledCard.locator("[data-review-inline-content]")).toHaveCount(1);
  await expect(signalledCard.getByRole("button", {name: "Vincular traspaso"})).toBeEnabled();
  await expect(signalledCard.getByRole("button", {name: "Incorporar", exact: true})).toHaveCount(0);
  await expect(signalledCard.getByRole("button", {name: "Incorporar igualmente"})).toBeEnabled();
  const maxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
  expect(maxScroll).toBeGreaterThan(0);
  await page.evaluate((top) => window.scrollTo(0, top), Math.min(240, maxScroll));
  const nextCard = page.locator('[data-review-item="bank:2"]');
  const beforeExit = await nextCard.boundingBox();
  await signalledCard.getByRole("button", {name: "Incorporar igualmente"}).click();
  await expect(signalledCard).toHaveAttribute("data-review-exiting", "true");
  await page.waitForTimeout(80);
  const duringExit = await nextCard.boundingBox();
  expect(beforeExit).not.toBeNull();
  expect(duringExit).not.toBeNull();
  expect(duringExit!.y).toBeLessThan(beforeExit!.y);
  await expect(signalledCard).toHaveCount(0);
  await expect.poll(() => nextCard.evaluate((element) => document.activeElement?.closest("[data-review-item]") === element)).toBe(true);

  const card = page.locator('[data-review-item^="bank:"]').filter({hasText: "Compra bancaria confirmable E2E"});
  await expect(card.getByText("Comida E2E")).toBeVisible();
  await card.getByRole("button", {name: "Incorporar"}).click();

  await expect(card).toHaveAttribute("data-review-exiting", "true");
  await expect(card).toHaveCount(0);
  await expect(page.locator("#bank-review-empty")).toBeFocused();
  const review = await page.request.get("/api/bank-review/");
  expect((await review.json()).rows).toHaveLength(0);
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  for (const reducedMotion of [false, true] as const) {
    test(`La acción bancaria conserva el foco pendiente en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @chromium-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let actionId = 0;
      let releaseAction!: () => void;
      let markActionStarted!: () => void;
      const actionGate = new Promise<void>((resolve) => {releaseAction = resolve;});
      const actionStarted = new Promise<void>((resolve) => {markActionStarted = resolve;});
      let actionRequests = 0;
      await page.route(/\/api\/bank-review\/\d+\/force\/$/, async (route) => {
        actionRequests += 1;
        actionId = Number(new URL(route.request().url()).pathname.match(/bank-review\/(\d+)\//)?.[1]);
        if (actionRequests === 1) {
          markActionStarted();
          await actionGate;
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Decisión temporalmente rechazada."})});
          return;
        }
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Movimiento incorporado.", removed: [actionId]})});
      });

      try {
        await openApp(page, "/?tab=review");
        const workspace = page.getByRole("region", {name: "Cola bancaria"});
        const row = workspace.locator('[data-review-item^="bank:"]').filter({hasText: "Compra bancaria con señal E2E"});
        const force = row.getByRole("button", {name: "Incorporar igualmente"});
        await force.scrollIntoViewIfNeeded();
        await force.focus();
        await page.evaluate(() => window.scrollTo(0, Math.max(0, window.scrollY - 80)));
        await expect(force).toBeInViewport();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await force.press("Enter");
        await actionStarted;
        await expect(force).toHaveAttribute("aria-disabled", "true");
        await expect(force).toHaveAttribute("aria-busy", "true");
        expect(await force.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(force).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await force.press("Enter");
        expect(actionRequests).toBe(1);
        await expect(force).toBeFocused();

        releaseAction();
        const actionFeedback = workspace.locator(".bank-review-action-feedback");
        await expect(actionFeedback.getByRole("alert")).toHaveText("No se pudo aplicar la acción bancaria: Decisión temporalmente rechazada.");
        await expect(row).toBeVisible();
        await expect(force).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect(await page.locator(".ui-review-archetype__status").count()).toBe(0);

        await force.press("Enter");
        expect(actionRequests).toBe(2);
        if (!reducedMotion) await expect(row).toHaveAttribute("data-review-exiting", "true");
        await expect(row).toHaveCount(0);
        const nextRow = workspace.locator('[data-review-item^="bank:"]').filter({hasText: "Compra bancaria confirmable E2E"});
        await expect(nextRow).toBeVisible();
        await expect.poll(() => nextRow.evaluate((element) => document.activeElement?.closest("[data-review-item]") === element)).toBe(true);
        expect(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore)).toBeLessThanOrEqual(10);
        await expect(actionFeedback.getByRole("status")).toHaveText("Movimiento bancario importado igualmente.");
        assertNoPageErrors();
      } finally {
        releaseAction();
      }
    });
  }
}

test("la sincronización bancaria conserva cola, foco y scroll durante el refresh @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=review");
  const bankWorkspace = page.getByRole("region", {name: "Cola bancaria"});
  const firstRow = bankWorkspace.locator('[data-review-item^="bank:"]').first();
  await expect(firstRow).toBeVisible();
  const rowBefore = await firstRow.innerText();
  const syncButton = page.locator(".bank-sync-action");
  await syncButton.scrollIntoViewIfNeeded();
  await syncButton.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);

  let releaseRefresh!: () => void;
  const allowRefresh = new Promise<void>((resolve) => {releaseRefresh = resolve;});
  await page.route("**/api/bank-review/", async (route) => {
    const response = await route.fetch();
    await allowRefresh;
    await route.fulfill({response});
  });
  await page.route(/\/api\/bank-connections\/\d+\/sync\/$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ok: true}),
  }));

  const syncRequest = page.waitForRequest((request) => /\/api\/bank-connections\/\d+\/sync\/$/.test(request.url()));
  const refreshRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/bank-review/");
  try {
    await syncButton.press("Enter");
    await syncRequest;
    await refreshRequest;
    await expect(page.locator(".review-sync-bar")).toHaveAttribute("data-review-sync-state", "syncing");
    await expect(firstRow).toBeVisible();
    expect(await firstRow.innerText()).toBe(rowBefore);
    await expect(syncButton).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    releaseRefresh();
    await expect(syncButton).toHaveAccessibleName(/Sincronizar banco/);
    await expect(syncButton).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    assertNoPageErrors();
  } finally {
    releaseRefresh();
  }
});

test("Revisión conserva la cola y anuncia si falla el refresh bancario @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=review");
  const bankWorkspace = page.getByRole("region", {name: "Cola bancaria"});
  const firstRow = bankWorkspace.locator('[data-review-item^="bank:"]').first();
  await expect(firstRow).toBeVisible();
  const rowBefore = await firstRow.innerText();
  const syncButton = page.locator(".bank-sync-action");
  await syncButton.scrollIntoViewIfNeeded();
  await syncButton.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.route("**/api/bank-review/", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({error: "Acceso denegado."}),
  }));
  await page.route(/\/api\/bank-connections\/\d+\/sync\/$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ok: true}),
  }));

  const refreshRequest = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bank-review/" && response.status() === 403);
  await syncButton.press("Enter");
  await refreshRequest;

  await expect(page.getByRole("alert").filter({hasText: "Acceso denegado."})).toBeVisible();
  await expect(firstRow).toBeVisible();
  expect(await firstRow.innerText()).toBe(rowBefore);
  await expect(syncButton).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  assertNoPageErrors();
});

test("la revisión CSV usa el draft preparado, la API actual y el foco compartido @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, "/?tab=review");
  const csvWorkspace = page.getByRole("region", {name: "Importaciones CSV"});
  const disclosure = csvWorkspace.locator("button.disclosure-button");
  for (const width of [320, 390, 393, 430, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    if (await disclosure.getAttribute("aria-expanded") === "true") await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    await expect(page.getByRole("button", {name: "Comprimir CSV"})).toHaveAttribute("aria-expanded", "true");
    await expect(csvWorkspace.locator('[data-review-item^="csv:"]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width >= 1024) {
      const rulesBox = await page.getByRole("button", {name: "Reglas de categoría", exact: true}).boundingBox();
      expect(rulesBox).not.toBeNull();
      expect(rulesBox!.height).toBeGreaterThanOrEqual(44);
    }
  }

  await page.emulateMedia({reducedMotion: "reduce"});
  await page.setViewportSize({width: 390, height: 900});
  await openApp(page, "/?tab=review");
  await page.getByRole("button", {name: "Expandir CSV"}).click();

  const deleteBatch = page.locator(".csv-batch-stack button[aria-label^='Eliminar lote CSV']").first();
  await deleteBatch.focus();
  const keyboardScroll = await page.evaluate(() => window.scrollY);
  await deleteBatch.press("Enter");
  const deleteDialog = page.getByRole("dialog", {name: /Eliminar el lote CSV/});
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toHaveCount(0);
  await expect(deleteBatch).toBeFocused();
  expect(Math.abs(await page.evaluate(() => window.scrollY) - keyboardScroll)).toBeLessThanOrEqual(10);

  await deleteBatch.click();
  await expect(deleteDialog).toBeVisible();
  const pointerScroll = await page.evaluate(() => window.scrollY);
  await deleteDialog.getByRole("button", {name: "Cancelar"}).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(deleteBatch).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(pointerScroll);

  const card = page.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV pendiente E2E"});
  const nextCard = page.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV duplicada E2E"});
  const preparedFilter = page.getByRole("button", {name: "Preparados"});
  await preparedFilter.focus();
  await page.keyboard.press("Tab");
  const rulesTrigger = page.getByRole("button", {name: "Reglas de categoría", exact: true});
  await expect(rulesTrigger).toBeFocused();
  await page.keyboard.press("Tab");
  const selectionTrigger = page.getByRole("button", {name: "Seleccionar"});
  await expect(selectionTrigger).toBeFocused();
  const focusStyle = await selectionTrigger.evaluate((button) => {
    const style = getComputedStyle(button);
    return {outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth)};
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThan(0);
  const motion = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return {duration: Number.parseFloat(style.transitionDuration), property: style.transitionProperty};
  });
  expect(motion.duration).toBeLessThanOrEqual(0.01);
  expect(motion.property).toBe("none");
  await page.emulateMedia({reducedMotion: "no-preference"});
  await expect(card.locator("[data-review-inline-content]")).toHaveCount(1);
  await card.getByRole("button", {name: "Categoría: Sin categoría"}).click();
  const category = card.getByRole("combobox", {name: "Categoría"});
  await category.fill("Comida E2E");
  await category.press("Enter");
  await expect(card.getByRole("button", {name: "Categoría: Comida E2E"})).toBeVisible();
  await card.getByRole("button", {name: "Importar", exact: true}).click();

  await expect(card).toHaveAttribute("data-review-exiting", "true");
  await expect(card).toHaveCount(0);
  await expect(nextCard.getByRole("button", {name: "Importar igualmente"})).toBeEnabled();
  await expect.poll(() => nextCard.evaluate((element) => document.activeElement?.closest("[data-review-item]") === element)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  assertNoPageErrors();
});

for (const width of [390, 1440]) {
  const browserTag = width === 390 ? "@webkit-only" : "@chromium-only";
  test(`Resumen abre la carga CSV en Revisión y separa carga de lectura a ${width}px ${browserTag}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width, height: width < 500 ? 844 : 900});

    const importsResponse = await page.request.get("/api/imports/");
    expect(importsResponse.ok()).toBe(true);
    const baseImports = await importsResponse.json() as {batches: Array<Record<string, unknown>>; [key: string]: unknown};
    const sourceBatch = baseImports.batches[0];
    expect(sourceBatch).toBeTruthy();
    const sourceBatchId = Number(sourceBatch.id);
    const rowsResponse = await page.request.get(`/api/imports/${sourceBatchId}/rows/?page=1&status=pending`);
    expect(rowsResponse.ok()).toBe(true);
    const sourceRows = await rowsResponse.json() as {batch: Record<string, unknown>; results: Array<Record<string, unknown>>; [key: string]: unknown};

    const uploadedBatchId = 990001;
    const uploadedBatch = {...sourceBatch, id: uploadedBatchId, filename: "movimientos-prueba-settings.csv", pending_count: sourceRows.results.length};
    const uploadedRows = {
      ...sourceRows,
      batch: uploadedBatch,
      results: sourceRows.results.map((row) => ({...row, batch_id: uploadedBatchId})),
    };
    let uploadSucceeded = false;
    let uploadRequests = 0;
    let rowReadRequests = 0;
    let confirmationRequests = 0;
    await page.route("**/api/imports/upload/", async (route) => {
      uploadRequests += 1;
      if (uploadRequests === 1) {
        await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "Carga de prueba rechazada."})});
        return;
      }
      uploadSucceeded = true;
      await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, batch: uploadedBatch})});
    });
    await page.route("**/api/imports/", async (route) => {
      const payload = uploadSucceeded ? {...baseImports, batches: [uploadedBatch, ...baseImports.batches]} : baseImports;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(payload)});
    });
    await page.route(`**/api/imports/${uploadedBatchId}/rows/**`, async (route) => {
      rowReadRequests += 1;
      if (rowReadRequests === 1) {
        await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Lectura de prueba no disponible."})});
        return;
      }
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(uploadedRows)});
    });
    await page.route("**/api/imports/*/confirm/", async (route) => {
      confirmationRequests += 1;
      await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "No se esperaba confirmar el lote."})});
    });

    await openApp(page, "/");
    await page.getByRole("button", {name: "Importar CSV", exact: true}).click();
    await expect(page).toHaveURL(/tab=review.*focus=csv-import|focus=csv-import.*tab=review/);
    const csv = page.getByRole("region", {name: "Importaciones CSV"});
    const file = csv.locator('input[type="file"]');
    await expect(file).toBeFocused();
    const testFileName = "movimientos-reintento.csv";
    await file.setInputFiles({name: testFileName, mimeType: "text/csv", buffer: Buffer.from("fecha,descripcion,importe\n2026-10-01,Compra de prueba,12.34\n")});
    const upload = csv.getByRole("button", {name: "Subir CSV"});
    await upload.scrollIntoViewIfNeeded();
    await upload.focus();
    const scrollBeforeUpload = await page.evaluate(() => window.scrollY);
    await upload.press("Enter");
    await expect(csv.locator(".review-csv-upload-error")).toContainText("Carga de prueba rechazada.");
    expect(await file.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe(testFileName);
    await expect(upload).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeUpload);

    await csv.getByRole("button", {name: "Cerrar carga CSV"}).click();
    await expect(file).toBeHidden();
    expect(await file.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe(testFileName);
    await csv.getByRole("button", {name: "Importar CSV", exact: true}).click();
    await expect(file).toBeVisible();
    expect(await file.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe(testFileName);
    await upload.click();
    await expect(csv.locator(".review-csv-upload-success")).toContainText("El lote está pendiente");
    await expect(file).toHaveJSProperty("value", "");
    await expect(file).toBeFocused();
    expect(uploadRequests).toBe(2);
    await csv.getByRole("button", {name: "Revisar lote", exact: true}).click();
    await expect(csv.locator(".review-csv-upload-success [role=alert]")).toContainText("El CSV se guardó, pero no se pudieron cargar sus filas.");
    expect(uploadRequests).toBe(2);
    expect(rowReadRequests).toBe(1);
    await csv.getByRole("button", {name: "Reintentar lectura", exact: true}).click();
    await expect(csv.locator(".batch-card").filter({hasText: "movimientos-prueba-settings.csv"})).toHaveClass(/selected/);
    expect(uploadRequests).toBe(2);
    expect(rowReadRequests).toBe(2);
    expect(confirmationRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  for (const reducedMotion of [false, true] as const) {
    if (!((viewport.label === "móvil" && !reducedMotion) || (viewport.label === "desktop" && reducedMotion))) continue;
    test(`Revisión CSV sin filas pendientes conserva lectura al mostrar las procesadas en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let processedDescription = "";
      let releaseAllRows!: () => void;
      let markAllRowsStarted!: () => void;
      const allRowsGate = new Promise<void>((resolve) => {releaseAllRows = resolve;});
      const allRowsStarted = new Promise<void>((resolve) => {markAllRowsStarted = resolve;});
      await page.route("**/api/imports/", async (route) => {
        const response = await route.fetch({maxRetries: 2});
        const payload = await response.json() as {batches: Array<Record<string, unknown>>; [key: string]: unknown};
        const firstBatch = payload.batches[0];
        if (!firstBatch) throw new Error("La fixture de Revisión necesita un lote CSV.");
        await route.fulfill({response, json: {...payload, batches: [{...firstBatch, pending_count: 0, row_count: 2}]}});
      });
      await page.route("**/api/imports/*/rows/**", async (route) => {
        const response = await route.fetch();
        const url = new URL(route.request().url());
        const payload = await response.json() as {
          results: Array<Record<string, unknown>>;
          batch: Record<string, unknown>;
          [key: string]: unknown;
        };
        if (url.searchParams.get("status") === "pending") {
          await new Promise((resolve) => setTimeout(resolve, 700));
          await route.fulfill({response, json: {...payload, results: [], count: 0, page: 1, num_pages: 1, has_previous: false, has_next: false, batch: {...payload.batch, pending_count: 0, row_count: 2}}});
          return;
        }
        const results = payload.results.slice(0, 2).map((row) => ({...row, status: "skipped", status_display: "Omitido"}));
        if (!results.length) throw new Error("La fixture de Revisión necesita filas procesadas.");
        processedDescription = String(results[0].description);
        markAllRowsStarted();
        await allRowsGate;
        await route.fulfill({response, json: {...payload, results, count: results.length, page: 1, num_pages: 1, has_previous: false, has_next: false, batch: {...payload.batch, pending_count: 0, row_count: results.length}}});
      });

      try {
        await openApp(page, "/?tab=review");
        await page.waitForLoadState("networkidle");
        const csv = page.getByRole("region", {name: "Importaciones CSV"});
        const disclosure = csv.locator("button.disclosure-button");
        await disclosure.scrollIntoViewIfNeeded();
        await disclosure.focus();
        const disclosureTop = (await disclosure.boundingBox())?.y;
        await disclosure.press("Enter");
        await expect(csv.getByText("Este lote no tiene filas pendientes. Puedes consultar todas las filas para ver las ya procesadas.")).toBeVisible();
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await expect(disclosure).toBeFocused();
        await expect.poll(async () => {
          const before = (await disclosure.boundingBox())?.y;
          await page.waitForTimeout(50);
          const after = (await disclosure.boundingBox())?.y;
          return before === undefined || after === undefined ? Number.POSITIVE_INFINITY : Math.abs(after - before);
        }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
        expect(Math.abs((await disclosure.boundingBox())!.y - disclosureTop!)).toBeLessThanOrEqual(10);

        const allRows = csv.getByRole("button", {name: /^Todas \(/});
        await allRows.scrollIntoViewIfNeeded();
        await allRows.focus();
        const allRowsTop = (await allRows.boundingBox())?.y;
        await allRows.press("Enter");
        await allRowsStarted;
        await expect(csv.getByText("Este lote CSV no contiene filas.")).toBeVisible();
        await expect(allRows).toBeFocused();
        await expect.poll(async () => {
          const before = (await allRows.boundingBox())?.y;
          await page.waitForTimeout(50);
          const after = (await allRows.boundingBox())?.y;
          return before === undefined || after === undefined ? Number.POSITIVE_INFINITY : Math.abs(after - before);
        }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
        expect(Math.abs((await allRows.boundingBox())!.y - allRowsTop!)).toBeLessThanOrEqual(10);

        releaseAllRows();
        await expect(csv.getByText(processedDescription, {exact: true})).toBeVisible();
        await expect(csv.getByText("Este lote CSV no contiene filas.")).toHaveCount(0);
        await expect(allRows).toBeFocused();
        expect(Math.abs((await allRows.boundingBox())!.y - allRowsTop!)).toBeLessThanOrEqual(10);
        assertNoPageErrors();
      } finally {
        releaseAllRows();
      }
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  for (const reducedMotion of [false, true] as const) {
    if (!((viewport.label === "móvil" && reducedMotion) || (viewport.label === "desktop" && !reducedMotion))) continue;
    test(`Omitir CSV mantiene foco mientras sale la última fila ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let rowId = 0;
      let rowRemoved = false;
      let importsPayloadPromise: Promise<{batches: Array<Record<string, unknown>>; [key: string]: unknown}> | undefined;
      let rowsPayloadPromise: Promise<{results: Array<Record<string, unknown>>; batch: Record<string, unknown>; [key: string]: unknown}> | undefined;
      let releaseSkip!: () => void;
      let markSkipStarted!: () => void;
      const skipGate = new Promise<void>((resolve) => {releaseSkip = resolve;});
      const skipStarted = new Promise<void>((resolve) => {markSkipStarted = resolve;});
      let skipRequests = 0;

      await page.route("**/api/imports/", async (route) => {
        importsPayloadPromise ||= route.fetch({maxRetries: 2}).then((response) => response.json()) as Promise<{batches: Array<Record<string, unknown>>; [key: string]: unknown}>;
        const payload = await importsPayloadPromise;
        const batch = payload.batches[0];
        if (!batch) throw new Error("La fixture de Revisión necesita un lote CSV pendiente.");
        await route.fulfill({json: {...payload, batches: [{...batch, pending_count: rowRemoved ? 0 : 1, row_count: 1}]}});
      });
      await page.route("**/api/imports/*/rows/**", async (route) => {
        rowsPayloadPromise ||= route.fetch().then((response) => response.json()) as Promise<{results: Array<Record<string, unknown>>; batch: Record<string, unknown>; [key: string]: unknown}>;
        const payload = await rowsPayloadPromise;
        if (rowRemoved) {
          await route.fulfill({json: {...payload, results: [], count: 0, page: 1, num_pages: 1, has_previous: false, has_next: false, batch: {...payload.batch, pending_count: 0, row_count: 1}}});
          return;
        }
        const row = payload.results.find((candidate) => candidate.description === "Compra CSV pendiente E2E") || payload.results[0];
        if (!row) throw new Error("La fixture de Revisión no contiene una fila CSV pendiente.");
        rowId = Number(row.id);
        await route.fulfill({json: {...payload, results: [row], count: 1, page: 1, num_pages: 1, has_previous: false, has_next: false, batch: {...payload.batch, pending_count: 1, row_count: 1}}});
      });
      await page.route("**/api/import-rows/*/skip/", async (route) => {
        skipRequests += 1;
        if (skipRequests === 1) {
          markSkipStarted();
          await skipGate;
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "No se pudo omitir; inténtalo de nuevo."})});
          return;
        }
        rowRemoved = true;
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Fila CSV omitida.", removed: [rowId]})});
      });

      try {
        await openApp(page, "/?tab=review");
        const csv = page.getByRole("region", {name: "Importaciones CSV"});
        await expect(csv).toContainText(/\d+ filas pendientes en lotes CSV/);
        const csvDisclosure = csv.locator("button.disclosure-button");
        await expect(csvDisclosure).toHaveAttribute("aria-expanded", "false");
        await csvDisclosure.click();
        await expect(csvDisclosure).toHaveAttribute("aria-expanded", "true");
        const row = csv.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV pendiente E2E"});
        await expect(row).toBeVisible();
        const skip = row.getByRole("button", {name: "Omitir", exact: true});
        await skip.scrollIntoViewIfNeeded();
        await skip.focus();
        const rowTopBefore = (await row.boundingBox())?.y;
        const detail = csv.locator(".csv-detail-motion");
        const detailTopBefore = (await detail.boundingBox())?.y;
        await page.keyboard.press("Enter");
        await skipStarted;
        await expect(row).toBeVisible();
        await expect(skip).toHaveAttribute("aria-disabled", "true");
        await expect(skip).toHaveAttribute("aria-busy", "true");
        expect(await skip.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(skip).toBeFocused();
        expect(Math.abs((await row.boundingBox())!.y - rowTopBefore!)).toBeLessThanOrEqual(10);
        await page.keyboard.press("Enter");
        expect(skipRequests).toBe(1);
        await expect(skip).toBeFocused();

        releaseSkip();
        const actionFeedback = csv.locator(".csv-review-action-feedback-slot");
        await expect(actionFeedback.getByRole("alert")).toHaveText("No se pudo procesar la fila CSV: No se pudo omitir; inténtalo de nuevo.");
        await expect(row).toBeVisible();
        await expect(skip).toBeFocused();
        expect(Math.abs((await row.boundingBox())!.y - rowTopBefore!)).toBeLessThanOrEqual(10);
        await page.keyboard.press("Enter");
        expect(skipRequests).toBe(2);
        if (!reducedMotion) await expect(row).toHaveAttribute("data-review-exiting", "true");
        await expect(row).toHaveCount(0);
        await expect(actionFeedback.getByRole("status")).toHaveText("Fila CSV omitida.");
        const empty = csv.locator("#csv-review-empty");
        await expect(empty).toBeFocused();
        await expect(empty).toContainText("Este lote no tiene filas pendientes.");
        expect(await detail.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);
        await expect.poll(async () => {
          const detailBounds = await detail.boundingBox();
          return detailBounds ? Math.abs(detailBounds.y - detailTopBefore!) : Number.POSITIVE_INFINITY;
        }, {timeout: 1000}).toBeLessThanOrEqual(10);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        assertNoPageErrors();
      } finally {
        releaseSkip();
      }
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  for (const reducedMotion of [false, true] as const) {
    if (!((viewport.label === "móvil" && !reducedMotion) || (viewport.label === "desktop" && reducedMotion))) continue;
    test(`Omitir CSV seleccionadas conserva el foco pendiente en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let rowId = 0;
      let actionRequests = 0;
      let releaseAction!: () => void;
      let markActionStarted!: () => void;
      const actionGate = new Promise<void>((resolve) => {releaseAction = resolve;});
      const actionStarted = new Promise<void>((resolve) => {markActionStarted = resolve;});
      await page.route("**/api/imports/*/bulk/", async (route) => {
        const input = route.request().postDataJSON() as {rows: number[]};
        rowId = input.rows[0];
        actionRequests += 1;
        if (actionRequests === 1) {
          markActionStarted();
          await actionGate;
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "No se pudo omitir; inténtalo de nuevo."})});
          return;
        }
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Fila CSV omitida.", removed: [rowId], failed: []})});
      });

      try {
        await openApp(page, "/?tab=review");
        const csv = page.getByRole("region", {name: "Importaciones CSV"});
        const pendingBatch = csv.getByRole("button", {name: /^revision-csv-e2e\.csv/});
        await expect(pendingBatch).toBeVisible();
        await pendingBatch.click();
        const row = csv.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV pendiente E2E"});
        await expect(row).toBeVisible();
        await page.getByRole("button", {name: "Seleccionar", exact: true}).click();
        await row.getByRole("checkbox", {name: "Seleccionar Compra CSV pendiente E2E"}).check();
        await page.getByRole("button", {name: /Acciones de selección/}).click();
        const skip = page.getByRole("button", {name: "Omitir seleccionadas", exact: true});
        await skip.scrollIntoViewIfNeeded();
        await skip.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const rowTopBefore = (await row.boundingBox())?.y;
        await skip.press("Enter");
        await actionStarted;
        await expect(skip).toHaveAttribute("aria-disabled", "true");
        await expect(skip).toHaveAttribute("aria-busy", "true");
        expect(await skip.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(skip).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await skip.press("Enter");
        expect(actionRequests).toBe(1);
        await expect(skip).toBeFocused();

        releaseAction();
        const actionFeedback = csv.locator(".csv-review-action-feedback-slot");
        await expect(page.getByText("No se pudo aplicar la acción masiva CSV: No se pudo omitir; inténtalo de nuevo.")).toBeVisible();
        expect(Math.abs((await row.boundingBox())!.y - rowTopBefore!)).toBeLessThanOrEqual(2);
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
        await expect(actionFeedback.getByRole("alert")).toHaveText("No se pudo aplicar la acción masiva CSV: No se pudo omitir; inténtalo de nuevo.");
        await expect(row).toBeVisible();
        await expect(skip).toBeFocused();
        await skip.press("Enter");
        expect(actionRequests).toBe(2);
        if (!reducedMotion) await expect(row).toHaveAttribute("data-review-exiting", "true");
        await expect(row).toHaveCount(0);
        await expect(actionFeedback.getByRole("status")).toHaveText("Fila CSV omitida.");
        const nextRow = csv.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV duplicada E2E"});
        await expect(nextRow).toBeVisible();
        await expect.poll(() => nextRow.evaluate((element) => document.activeElement?.closest("[data-review-item]") === element)).toBe(true);
        assertNoPageErrors();
      } finally {
        releaseAction();
      }
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  for (const reducedMotion of [false, true] as const) {
    if (!((viewport.label === "móvil" && reducedMotion) || (viewport.label === "desktop" && !reducedMotion))) continue;
    test(`Confirmar lote seguro conserva feedback y foco en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let rowId = 0;
      let requests = 0;
      let releaseConfirmation!: () => void;
      let markConfirmationStarted!: () => void;
      const confirmationGate = new Promise<void>((resolve) => {releaseConfirmation = resolve;});
      const confirmationStarted = new Promise<void>((resolve) => {markConfirmationStarted = resolve;});

      await page.route("**/api/imports/*/confirm/", async (route) => {
        requests += 1;
        if (requests === 1) {
          markConfirmationStarted();
          await confirmationGate;
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "El lote no pudo confirmarse; inténtalo de nuevo."})});
          return;
        }
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Lote CSV confirmado.", imported: 1, removed: [rowId]})});
      });

      try {
        await openApp(page, "/?tab=review");
        const csv = page.getByRole("region", {name: "Importaciones CSV"});
        await csv.getByRole("button", {name: "Expandir CSV"}).click();
        const row = csv.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV pendiente E2E"});
        await expect(row).toBeVisible();
        rowId = Number((await row.getAttribute("data-review-item"))!.split(":")[1]);
        const confirm = csv.getByRole("button", {name: "Confirmar lote seguro"});
        await confirm.scrollIntoViewIfNeeded();
        await confirm.focus();
        await expect.poll(async () => {
          const before = (await row.boundingBox())?.y;
          await page.waitForTimeout(50);
          const after = (await row.boundingBox())?.y;
          return before === undefined || after === undefined ? Number.POSITIVE_INFINITY : Math.abs(after - before);
        }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const rowTopBefore = (await row.boundingBox())?.y;
        await confirm.press("Enter");
        await confirmationStarted;
        await expect(confirm).toHaveAttribute("aria-disabled", "true");
        await expect(confirm).toHaveAttribute("aria-busy", "true");
        expect(await confirm.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(confirm).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await confirm.press("Enter");
        expect(requests).toBe(1);

        releaseConfirmation();
        const feedback = csv.locator(".csv-review-action-feedback-slot");
        const errorMessage = "No se pudo confirmar el lote CSV: El lote no pudo confirmarse; inténtalo de nuevo.";
        await expect(page.getByText(errorMessage)).toBeVisible();
        expect(Math.abs((await row.boundingBox())!.y - rowTopBefore!)).toBeLessThanOrEqual(2);
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
        await expect(feedback.getByRole("alert")).toHaveText(errorMessage);
        await expect(confirm).toBeFocused();
        await confirm.press("Enter");
        expect(requests).toBe(2);

        if (!reducedMotion) await expect(row).toHaveAttribute("data-review-exiting", "true");
        await expect(row).toHaveCount(0);
        await expect(feedback.getByRole("status")).toHaveText("Lote CSV confirmado.");
        const nextRow = csv.locator('[data-review-item^="csv:"]').filter({hasText: "Compra CSV duplicada E2E"});
        await expect(nextRow).toBeVisible();
        await expect.poll(() => nextRow.evaluate((element) => document.activeElement?.closest("[data-review-item]") === element)).toBe(true);
        assertNoPageErrors();
      } finally {
        releaseConfirmation();
      }
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  for (const reducedMotion of [false, true] as const) {
    if (!((viewport.label === "móvil" && !reducedMotion) || (viewport.label === "desktop" && reducedMotion))) continue;
    test(`Revisión CSV vacía conserva foco y scroll en ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} @webkit-only`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await page.route("**/api/imports/", async (route) => {
        const response = await route.fetch();
        const imports = await response.json() as {batches: unknown[]; [key: string]: unknown};
        await route.fulfill({response, json: {...imports, batches: []}});
      });
      const bankReviewLoaded = page.waitForResponse((response) => response.url().includes("/api/bank-review/") && response.ok());
      const importsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/imports/") && response.ok());
      await openApp(page, "/?tab=review");
      await Promise.all([bankReviewLoaded, importsLoaded]);
      const csv = page.getByRole("region", {name: "Importaciones CSV"});
      const toggle = csv.locator("button.disclosure-button");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.scrollIntoViewIfNeeded();
      await toggle.evaluate((element) => (element as HTMLButtonElement).focus({preventScroll: true}));
      await expect.poll(async () => {
        const before = (await toggle.boundingBox())?.y;
        await page.waitForTimeout(50);
        const after = (await toggle.boundingBox())?.y;
        return before === undefined || after === undefined ? Number.POSITIVE_INFINITY : Math.abs(after - before);
      }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
      const toggleTopBefore = (await toggle.boundingBox())?.y;
      await toggle.press("Enter");

      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(csv.getByText("No hay lotes CSV en revisión.")).toBeVisible();
      await expect(toggle).toContainText("Comprimir CSV");
      await expect(toggle).toBeFocused();
      await expect(toggle).toBeInViewport();
      await expect.poll(async () => {
        const top = (await toggle.boundingBox())?.y;
        return top === undefined ? Number.POSITIVE_INFINITY : Math.abs(top - toggleTopBefore!);
      }, {timeout: 1000}).toBeLessThanOrEqual(10);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      assertNoPageErrors();
    });
  }
}
