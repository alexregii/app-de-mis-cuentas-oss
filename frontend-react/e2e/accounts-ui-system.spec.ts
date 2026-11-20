import {expect, test} from "playwright/test";
import {focusMotionPairwiseStates, installPageErrorGuard, openApp} from "./helpers";

const accountFocusViewports = [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}] as const;

function assignedBrowser(viewport: {width: number}, reducedMotion: boolean) {
  return (viewport.width <= 480) !== reducedMotion ? "@chromium-only" : "@webkit-only";
}

async function stableControlGeometry(page: import("playwright/test").Page) {
  return page.locator("#main-content").evaluate((main) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const controls = [...main.querySelectorAll<HTMLElement>(".ui-button, .ui-icon-button, .ui-text-button, .ui-input, .ui-select")].filter(visible);
    return {
      heights: controls.map((control) => control.getBoundingClientRect().height),
      legacyControls: main.querySelectorAll(".button, .icon-button, .text-button").length,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

async function scrollTrajectory(page: import("playwright/test").Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const probe = window as Window & {accountRevealScroll?: number[]; accountRevealFinished?: Promise<void>};
    const positions: number[] = [];
    probe.accountRevealScroll = positions;
    probe.accountRevealFinished = new Promise<void>((resolve) => {
      let frames = 0;
      const sample = () => {
        positions.push(window.scrollY);
        if (frames++ < 59) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
  });
  await action();
  await page.evaluate(async () => await (window as Window & {accountRevealFinished?: Promise<void>}).accountRevealFinished);
  return page.evaluate(() => (window as Window & {accountRevealScroll?: number[]}).accountRevealScroll || []);
}

function expectRevealScrollMotion(positions: number[], reducedMotion: boolean) {
  const minimum = Math.min(...positions);
  const maximum = Math.max(...positions);
  const intermediate = positions.filter((position) => position > minimum + 1 && position < maximum - 1);
  if (reducedMotion) expect(intermediate).toHaveLength(0);
  else if (maximum - minimum > 2) expect(intermediate.length).toBeGreaterThan(0);
}

test("Cuentas consume controles estables en móvil y desktop @chromium-only", {tag: "@app-critical"}, async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);

  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({width, height: 900});
    await openApp(page, "/?tab=accounts");
    await expect(page.getByRole("heading", {name: "Cuentas", exact: true})).toBeVisible();
    await expect(page.locator('#main-content [aria-busy="true"]')).toHaveCount(0);

    const geometry = await stableControlGeometry(page);
    expect(geometry.legacyControls).toBe(0);
    expect(geometry.heights.length).toBeGreaterThan(0);
    expect(geometry.heights.every((height) => height >= 44)).toBe(true);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    if (width <= 390) {
      const accountPanel = page.locator(".accounts-management-grid .collapsible-panel");
      await expect(accountPanel.locator(".section-header .collapsed-summary")).toContainText("2 cuentas · 2 activas");
      await expect(accountPanel.locator(":scope > .collapsed-summary")).toHaveCount(0);
      await page.screenshot({path: testInfo.outputPath(`accounts-collapsed-${width}.png`), fullPage: false});
      await page.emulateMedia({reducedMotion: "reduce"});
      await page.getByRole("button", {name: "Añadir cuenta"}).click();
      await expect(accountPanel.locator(".section-header .collapsed-summary")).toHaveCount(0);
      await expect(page.getByLabel("Nombre")).toHaveClass(/ui-input/);
      await expect(page.getByLabel("Tipo")).toHaveClass(/ui-select/);
      await expect(page.getByLabel("Saldo inicial")).toHaveClass(/ui-input/);
      const formGeometry = await stableControlGeometry(page);
      expect(formGeometry.heights.every((height) => height >= 44)).toBe(true);
      expect(formGeometry.documentWidth).toBeLessThanOrEqual(width);
      await page.screenshot({path: testInfo.outputPath(`accounts-form-${width}.png`), fullPage: false});
      await accountPanel.getByRole("button", {name: "Comprimir nueva cuenta"}).click();
      await expect(accountPanel.locator(".section-header .collapsed-summary")).toContainText("2 cuentas · 2 activas");
    }
  }

  assertNoPageErrors();
});

for (const {viewport, input, reducedMotion} of focusMotionPairwiseStates(accountFocusViewports)) {
    test(`Añadir cuenta traslada el foco al formulario en ${viewport.label} (${input}, ${reducedMotion ? "movimiento reducido" : "movimiento normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
        await openApp(page, "/?tab=accounts");
        const addAccount = page.getByRole("button", {name: "Añadir cuenta"});
        await addAccount.scrollIntoViewIfNeeded();
        await addAccount.focus();
        const openingScroll = await scrollTrajectory(page, async () => {
          if (input === "teclado") await addAccount.press("Enter");
          else await addAccount.click();
        });
        const nameInput = page.getByLabel("Nombre");
        await expect(addAccount).toHaveAttribute("aria-expanded", "true");
        await expect(addAccount).toHaveAttribute("aria-controls", "accounts-manual-form");
        await expect(nameInput).toBeFocused();
        await expect(nameInput).toBeInViewport();
        expectRevealScrollMotion(openingScroll, reducedMotion);

        const collapse = page.getByRole("button", {name: "Comprimir nueva cuenta"});
        await collapse.focus();
        await collapse.press("Enter");
        await expect(page.getByRole("button", {name: "Expandir nueva cuenta"})).toBeFocused();
        await expect(addAccount).toHaveAttribute("aria-expanded", "false");

        const accountCard = page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).first();
        await accountCard.scrollIntoViewIfNeeded();
        await accountCard.getByRole("button", {name: "Acciones de Cuenta diaria E2E"}).click();
        await accountCard.getByRole("button", {name: "Editar", exact: true}).click();
        await expect(nameInput).toHaveValue("Cuenta diaria E2E");
        await expect(nameInput).toBeFocused();
        await expect(nameInput).toBeInViewport();
        const collapseEdit = page.getByRole("button", {name: "Comprimir editar cuenta"});
        await collapseEdit.focus();
        await collapseEdit.press("Enter");
        await expect(page.getByRole("button", {name: "Expandir nueva cuenta"})).toBeFocused();
        assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true]) {
    test(`Sincronización bancaria conserva foco y ancla en ${viewport.label} (${reducedMotion ? "movimiento reducido" : "movimiento normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let serverSyncStatus = "idle";
      let bootstrapPayload: Promise<Record<string, unknown>> | null = null;
      await page.route("**/api/bootstrap/", async (route) => {
        bootstrapPayload ||= route.fetch().then((response) => response.json() as Promise<Record<string, unknown>>);
        const payload = JSON.parse(JSON.stringify(await bootstrapPayload)) as {connections: Array<Record<string, unknown>>};
        payload.connections = [{
          id: 444,
          bank_name: "Banco Estable E2E",
          bank_country: "ES",
          status: "connected",
          status_display: "Conectado",
          sync_status: serverSyncStatus,
          sync_status_display: serverSyncStatus === "syncing" ? "Sincronizando" : "Sincronizado",
          sync_started_at: "",
          sync_started_at_display: "",
          last_synced_at: "",
          last_synced_at_display: "Nunca",
          last_error: "",
          authorized_until: "",
          accounts: [],
        }];
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(payload)});
      });

      let requestCount = 0;
      let releaseFailure!: () => void;
      let reachFailure!: () => void;
      let releaseSuccess!: () => void;
      let reachSuccess!: () => void;
      const failureReached = new Promise<void>((resolve) => {reachFailure = resolve;});
      const failureReleased = new Promise<void>((resolve) => {releaseFailure = resolve;});
      const successReached = new Promise<void>((resolve) => {reachSuccess = resolve;});
      const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
      await page.route("**/api/bank-connections/444/sync/", async (route) => {
        requestCount += 1;
        if (requestCount === 1) {
          reachFailure();
          await failureReleased;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo sincronizar el banco."})});
          return;
        }
        reachSuccess();
        await successReleased;
        serverSyncStatus = "syncing";
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true})});
      });

      await openApp(page, "/?tab=accounts");
      const row = page.locator(".connection-row").filter({hasText: "Banco Estable E2E"});
      const sync = page.getByRole("button", {name: "Sincronizar Banco Estable E2E"});
      await sync.scrollIntoViewIfNeeded();
      await sync.focus();
      const initialTop = await sync.evaluate((element) => element.getBoundingClientRect().top);
      await sync.press("Enter");
      await failureReached;
      await expect(sync).toBeFocused();
      await expect(sync).toHaveAttribute("aria-busy", "true");
      await expect(sync).toHaveAttribute("aria-disabled", "true");
      expect(await sync.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(false);
      await sync.evaluate((element) => element.dispatchEvent(new MouseEvent("click", {bubbles: true})));
      expect(requestCount).toBe(1);
      releaseFailure();

      const alert = row.getByRole("alert");
      await expect(alert).toContainText("No se pudo sincronizar el banco.");
      await expect(sync).toBeFocused();
      await expect(sync).not.toHaveAttribute("aria-busy", "true");
      const errorTop = await sync.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(errorTop - initialTop)).toBeLessThan(1.5);

      await sync.press("Enter");
      await successReached;
      expect(requestCount).toBe(2);
      await expect(sync).toHaveAttribute("aria-busy", "true");
      await expect(alert).toHaveCount(0);
      releaseSuccess();

      await expect(page.getByRole("status").filter({hasText: "Sincronización solicitada."})).toBeVisible();
      await expect(row.getByRole("status")).toHaveText("Sincronizando…");
      await expect(sync).toHaveAttribute("aria-busy", "true");
      await expect(sync).toBeFocused();
      await sync.evaluate((element) => element.dispatchEvent(new MouseEvent("click", {bubbles: true})));
      expect(requestCount).toBe(2);
      assertNoPageErrors();
    });
  }
}

for (const {viewport, input, reducedMotion} of focusMotionPairwiseStates(accountFocusViewports)) {
    test(`Desconectar banco conserva el diálogo y permite reintentar en ${viewport.label} (${input}, ${reducedMotion ? "movimiento reducido" : "movimiento normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
        let connectionPresent = true;
        let bootstrapPayload: Promise<Record<string, unknown>> | null = null;
        await page.route("**/api/bootstrap/", async (route) => {
          bootstrapPayload ||= route.fetch().then((response) => response.json() as Promise<Record<string, unknown>>);
          const payload = JSON.parse(JSON.stringify(await bootstrapPayload)) as {connections: Array<Record<string, unknown>>};
          payload.connections = connectionPresent ? [{
            id: 444,
            bank_name: "Banco Estable E2E",
            bank_country: "ES",
            status: "connected",
            status_display: "Conectado",
            sync_status: "idle",
            sync_status_display: "Sincronizado",
            sync_started_at: "",
            sync_started_at_display: "",
            last_synced_at: "",
            last_synced_at_display: "Nunca",
            last_error: "",
            authorized_until: "",
            accounts: [],
          }] : [];
          await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(payload)});
        });

        let requestCount = 0;
        let releaseFailure!: () => void;
        let reachFailure!: () => void;
        let releaseSuccess!: () => void;
        let reachSuccess!: () => void;
        const failureReached = new Promise<void>((resolve) => {reachFailure = resolve;});
        const failureReleased = new Promise<void>((resolve) => {releaseFailure = resolve;});
        const successReached = new Promise<void>((resolve) => {reachSuccess = resolve;});
        const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
        await page.route("**/api/bank-connections/444/disconnect/", async (route) => {
          requestCount += 1;
          if (requestCount === 1) {
            reachFailure();
            await failureReleased;
            await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo confirmar la revocación remota. El estado local no ha cambiado; puedes volver a intentarlo."})});
            return;
          }
          reachSuccess();
          await successReleased;
          connectionPresent = false;
          await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true})});
        });

        await openApp(page, "/?tab=accounts");
        const row = page.locator(".connection-row").filter({hasText: "Banco Estable E2E"});
        await row.getByRole("button", {name: "Desconectar Banco Estable E2E"}).click();
        const dialog = page.getByRole("dialog", {name: "¿Desconectar Banco Estable E2E?"});
        const confirm = dialog.locator(".confirm-dialog-actions .ui-button--danger");
        await expect(confirm).toBeVisible();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const panelTopBefore = await page.locator("#bank-connections").evaluate((element) => element.getBoundingClientRect().top);
        if (input === "teclado") await confirm.press("Enter");
        else await confirm.click();
        await failureReached;
        await expect(confirm).toHaveAttribute("aria-busy", "true");
        await expect(confirm).toHaveAttribute("aria-disabled", "true");
        expect(await confirm.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(false);
        await confirm.evaluate((element) => element.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(requestCount).toBe(1);
        releaseFailure();

        const alert = dialog.getByRole("alert");
        await expect(alert).toContainText("No se pudo confirmar la revocación remota. El estado local no ha cambiado; puedes volver a intentarlo.");
        await expect(dialog).toBeVisible();
        await expect(confirm).toBeFocused();
        await expect(confirm).not.toHaveAttribute("aria-busy", "true");
        await expect(confirm).toBeInViewport();
        await expect(row).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

        if (input === "teclado") await confirm.press("Enter");
        else await confirm.click();
        await successReached;
        expect(requestCount).toBe(2);
        await expect(confirm).toHaveAttribute("aria-busy", "true");
        await expect(alert).toHaveCount(0);
        releaseSuccess();

        await expect(dialog).not.toBeVisible();
        await expect(row).toHaveCount(0);
        await expect(page.locator("#main-content:focus, #main-content :focus")).toBeVisible();
        await expect(page.locator("#bank-connections").getByRole("status")).toHaveText("Conexión bancaria desconectada.");
        const finalMetrics = await page.evaluate(() => ({scrollY: window.scrollY, panelTop: document.getElementById("bank-connections")?.getBoundingClientRect().top}));
        expect(finalMetrics.scrollY, JSON.stringify({scrollBefore, panelTopBefore, finalMetrics})).toBe(scrollBefore);
        expect(finalMetrics.panelTop).toBeCloseTo(panelTopBefore, 1);
        assertNoPageErrors();
  });
}

for (const {viewport, input, reducedMotion} of focusMotionPairwiseStates(accountFocusViewports)) {
    test(`Autorización bancaria conserva foco y permite reintentar en ${viewport.label} (${input}, ${reducedMotion ? "movimiento reducido" : "movimiento normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
        await page.route("**/api/bootstrap/", async (route) => {
          const response = await route.fetch();
          const payload = await response.json() as {review: {has_banking_configured: boolean}};
          payload.review.has_banking_configured = true;
          await route.fulfill({response, body: JSON.stringify(payload)});
        });

        let directoryRequests = 0;
        let authorizationRequests = 0;
        let releaseDirectoryFailure!: () => void;
        let reachDirectoryFailure!: () => void;
        let releaseDirectorySuccess!: () => void;
        let reachDirectorySuccess!: () => void;
        let releaseAuthorizationFailure!: () => void;
        let reachAuthorizationFailure!: () => void;
        let releaseAuthorizationSuccess!: () => void;
        let reachAuthorizationSuccess!: () => void;
        const directoryFailureReached = new Promise<void>((resolve) => {reachDirectoryFailure = resolve;});
        const directoryFailureReleased = new Promise<void>((resolve) => {releaseDirectoryFailure = resolve;});
        const directorySuccessReached = new Promise<void>((resolve) => {reachDirectorySuccess = resolve;});
        const directorySuccessReleased = new Promise<void>((resolve) => {releaseDirectorySuccess = resolve;});
        const authorizationFailureReached = new Promise<void>((resolve) => {reachAuthorizationFailure = resolve;});
        const authorizationFailureReleased = new Promise<void>((resolve) => {releaseAuthorizationFailure = resolve;});
        const authorizationSuccessReached = new Promise<void>((resolve) => {reachAuthorizationSuccess = resolve;});
        const authorizationSuccessReleased = new Promise<void>((resolve) => {releaseAuthorizationSuccess = resolve;});
        await page.route("**/api/bank-connect/", async (route) => {
          if (route.request().method() === "GET") {
            directoryRequests += 1;
            if (directoryRequests === 1) {
              reachDirectoryFailure();
              await directoryFailureReleased;
              await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo cargar el directorio bancario."})});
              return;
            }
            reachDirectorySuccess();
            await directorySuccessReleased;
            await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, configured: true, country: "ES", banks: [{name: "Banco Estable E2E", country: "ES"}]})});
            return;
          }
          authorizationRequests += 1;
          const input = route.request().postDataJSON() as {return_to: string};
          expect(input.return_to).toBe(`${new URL(page.url()).origin}/?tab=accounts`);
          if (authorizationRequests === 1) {
            reachAuthorizationFailure();
            await authorizationFailureReleased;
            await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo autorizar con el banco."})});
            return;
          }
          reachAuthorizationSuccess();
          await authorizationSuccessReleased;
          await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, url: "https://bank.example.test/authorize?state=e2e"})});
        });
        await page.route("https://bank.example.test/**", (route) => route.fulfill({status: 200, contentType: "text/html", body: "<title>Bank authorization</title>"}));

        await openApp(page, "/?tab=accounts");
        const panel = page.locator("#bank-connections");
        const disclosure = panel.getByRole("button", {name: /Nueva banca|Comprimir/});
        await disclosure.focus();
        if (input === "teclado") await disclosure.press("Enter");
        else await disclosure.click();
        await directoryFailureReached;
        await expect(disclosure).toBeFocused();
        await expect(panel.locator('[aria-busy="true"]')).toBeVisible();
        const directoryScroll = await page.evaluate(() => window.scrollY);
        releaseDirectoryFailure();

        await expect(panel.getByRole("alert")).toContainText("No se pudo cargar el directorio bancario.");
        const retryDirectory = panel.getByRole("button", {name: /Reintentar carga de bancos|Cargando bancos/});
        await expect(retryDirectory).toBeVisible();
        await expect(disclosure).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(directoryScroll);
        if (input === "teclado") {
          await retryDirectory.focus();
          await retryDirectory.press("Enter");
        } else await retryDirectory.click();
        await directorySuccessReached;
        await expect(retryDirectory).toHaveAttribute("aria-busy", "true");
        await expect(retryDirectory).toHaveAttribute("aria-disabled", "true");
        expect(await retryDirectory.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(false);
        await expect(retryDirectory).toBeFocused();
        releaseDirectorySuccess();
        const bankSelect = panel.locator("select.ui-select");
        await expect(bankSelect).toHaveValue("Banco Estable E2E");
        await expect(bankSelect).toBeFocused();

        const submit = panel.getByRole("button", {name: /Autorizar con mi banco|Redirigiendo/});
        await submit.focus();
        const submitTop = (await submit.boundingBox())?.y;
        const submitScroll = await page.evaluate(() => window.scrollY);
        if (input === "teclado") await submit.press("Enter");
        else await submit.click();
        await authorizationFailureReached;
        await expect(submit).toHaveAttribute("aria-busy", "true");
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        expect(await submit.evaluate((element: HTMLButtonElement) => element.disabled)).toBe(false);
        const form = submit.locator("xpath=ancestor::form");
        await form.evaluate((element) => element.requestSubmit(element.querySelector("button[type=submit]") as HTMLButtonElement));
        expect(authorizationRequests).toBe(1);
        await expect(submit).toBeFocused();
        releaseAuthorizationFailure();

        await expect(form.getByRole("alert")).toContainText("No se pudo autorizar con el banco.");
        await expect(bankSelect).toHaveValue("Banco Estable E2E");
        await expect(submit).toBeFocused();
        await expect(submit).not.toHaveAttribute("aria-busy", "true");
        expect(await page.evaluate(() => window.scrollY)).toBe(submitScroll);
        expect((await submit.boundingBox())?.y).toBeCloseTo(submitTop!, 0);

        if (input === "teclado") await submit.press("Enter");
        else await submit.click();
        await authorizationSuccessReached;
        expect(authorizationRequests).toBe(2);
        await expect(submit).toHaveAttribute("aria-busy", "true");
        releaseAuthorizationSuccess();
        await page.waitForURL("https://bank.example.test/authorize?state=e2e");
        await expect(page).toHaveTitle("Bank authorization");
        assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true]) {
    test(`Alta de cuenta conserva foco y borrador en ${viewport.label} (${reducedMotion ? "movimiento reducido" : "movimiento normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let accountTemplate: Record<string, unknown> | null = null;
      let createdAccount: Record<string, unknown> | null = null;
      await page.route("**/api/bootstrap/", async (route) => {
        const response = await route.fetch();
        const payload = await response.json() as {accounts: Array<Record<string, unknown>>};
        accountTemplate ||= payload.accounts[0] || null;
        if (createdAccount) payload.accounts = [...payload.accounts.filter((account) => account.id !== createdAccount?.id), createdAccount];
        await route.fulfill({response, body: JSON.stringify(payload)});
      });

      let requestCount = 0;
      let releaseFailure!: () => void;
      let reachFailure!: () => void;
      let releaseSuccess!: () => void;
      let reachSuccess!: () => void;
      const failureReached = new Promise<void>((resolve) => {reachFailure = resolve;});
      const failureReleased = new Promise<void>((resolve) => {releaseFailure = resolve;});
      const successReached = new Promise<void>((resolve) => {reachSuccess = resolve;});
      const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
      await page.route("**/api/accounts/", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        requestCount += 1;
        if (requestCount === 1) {
          reachFailure();
          await failureReleased;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo crear la cuenta."})});
          return;
        }
        const input = route.request().postDataJSON() as Record<string, unknown>;
        if (!accountTemplate) throw new Error("Falta la plantilla de cuenta de la fixture.");
        const openingBalance = Number(input.opening_balance) || 0;
        createdAccount = {
          ...accountTemplate,
          id: 999999,
          name: input.name,
          kind: input.kind,
          kind_display: input.kind === "savings" ? "Cuenta de ahorro" : "Cuenta corriente",
          opening_balance: openingBalance,
          balance: openingBalance,
          color: input.color,
          active: input.active,
          bank_link: null,
        };
        reachSuccess();
        await successReleased;
        await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, account: createdAccount})});
      });

      await openApp(page, "/?tab=accounts");
      await page.getByRole("button", {name: "Añadir cuenta"}).click();
      const nameInput = page.getByLabel("Nombre");
      await nameInput.fill("Cuenta temporal de estabilidad");
      const submit = page.getByRole("button", {name: "Guardar cuenta"});
      const accountCountBefore = await page.locator(".account-card").count();
      await submit.evaluate((element) => element.scrollIntoView({block: "center", behavior: "auto"}));
      await submit.focus();
      await submit.press("Enter");
      await failureReached;
      let submitTopDuringFailure = 0;
      try {
        await expect(submit).toBeFocused();
        await expect(submit).not.toHaveAttribute("disabled");
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        await expect(submit).toHaveAttribute("aria-busy", "true");
        await expect(nameInput).toHaveAttribute("readonly", "");
        submitTopDuringFailure = await submit.evaluate((element) => element.getBoundingClientRect().top);
        const pendingBox = await submit.boundingBox();
        if (!pendingBox) throw new Error("El botón Guardar cuenta no está visible durante el envío.");
        await page.mouse.click(pendingBox.x + pendingBox.width / 2, pendingBox.y + pendingBox.height / 2);
        expect(requestCount).toBe(1);
      } finally {
        releaseFailure();
      }

      await expect(page.getByRole("alert")).toContainText("No se pudo crear la cuenta.");
      await expect(nameInput).toHaveValue("Cuenta temporal de estabilidad");
      await expect(nameInput).not.toHaveAttribute("readonly");
      await expect(page.locator(".account-card")).toHaveCount(accountCountBefore);
      await expect(submit).toBeFocused();
      await expect(submit).not.toHaveAttribute("aria-disabled");
      const submitTopAfterError = await submit.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(submitTopAfterError - submitTopDuringFailure)).toBeLessThanOrEqual(5);

      await submit.press("Enter");
      await successReached;
      let submitTopDuringRetry = 0;
      try {
        await expect(submit).toBeFocused();
        await expect(submit).toHaveAttribute("aria-busy", "true");
        expect(requestCount).toBe(2);
        submitTopDuringRetry = await submit.evaluate((element) => element.getBoundingClientRect().top);
        await page.evaluate((name) => {
          const probe = window as Window & {accountEntryOpacities?: number[]; accountEntryFinished?: Promise<void>};
          const opacities: number[] = [];
          probe.accountEntryOpacities = opacities;
          probe.accountEntryFinished = new Promise<void>((resolve) => {
            let frames = 0;
            const sample = () => {
              const card = [...document.querySelectorAll<HTMLElement>(".account-card-layout")].find((element) => element.textContent?.includes(name));
              if (card) {
                opacities.push(Number.parseFloat(getComputedStyle(card).opacity));
                if (frames++ >= 30) {
                  resolve();
                  return;
                }
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
        }, "Cuenta temporal de estabilidad");
      } finally {
        releaseSuccess();
      }

      const newAccount = page.locator(".account-card").filter({hasText: "Cuenta temporal de estabilidad"});
      await expect(newAccount).toBeVisible();
      await expect(page.locator(".account-card")).toHaveCount(accountCountBefore + 1);
      await expect(page.getByText("Cuenta creada.", {exact: true})).toBeVisible();
      await expect(page.getByLabel("Nombre")).toHaveValue("");
      await expect(submit).toBeFocused();
      const submitTopAfterSuccess = await submit.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(submitTopAfterSuccess - submitTopDuringRetry)).toBeLessThanOrEqual(3);
      await page.evaluate(async () => await (window as Window & {accountEntryFinished?: Promise<void>}).accountEntryFinished);
      const opacities = await page.evaluate(() => (window as Window & {accountEntryOpacities?: number[]}).accountEntryOpacities || []);
      expect(opacities).toHaveLength(31);
      const intermediateOpacities = opacities.filter((opacity) => opacity > 0.01 && opacity < 0.99);
      if (reducedMotion) expect(intermediateOpacities).toHaveLength(0);
      else expect(intermediateOpacities.length).toBeGreaterThan(0);
      assertNoPageErrors();
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true]) {
    test(`Edición de cuenta conserva foco y borrador en ${viewport.label} (${reducedMotion ? "movimiento reducido" : "movimiento normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let accountTemplate: Record<string, unknown> | null = null;
      let updatedAccount: Record<string, unknown> | null = null;
      await page.route("**/api/bootstrap/", async (route) => {
        const response = await route.fetch();
        const payload = await response.json() as {accounts: Array<Record<string, unknown>>};
        accountTemplate ||= payload.accounts.find((account) => account.name === "Cuenta diaria E2E") || payload.accounts[0] || null;
        if (updatedAccount) payload.accounts = payload.accounts.map((account) => account.id === updatedAccount?.id ? updatedAccount : account);
        await route.fulfill({response, body: JSON.stringify(payload)});
      });

      let requestCount = 0;
      let releaseFailure!: () => void;
      let reachFailure!: () => void;
      let releaseSuccess!: () => void;
      let reachSuccess!: () => void;
      const failureReached = new Promise<void>((resolve) => {reachFailure = resolve;});
      const failureReleased = new Promise<void>((resolve) => {releaseFailure = resolve;});
      const successReached = new Promise<void>((resolve) => {reachSuccess = resolve;});
      const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
      await page.route("**/api/accounts/**", async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        requestCount += 1;
        if (requestCount === 1) {
          reachFailure();
          await failureReleased;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo actualizar la cuenta."})});
          return;
        }
        const input = route.request().postDataJSON() as Record<string, unknown>;
        if (!accountTemplate) throw new Error("Falta la plantilla de cuenta de la fixture.");
        updatedAccount = {...accountTemplate, ...input};
        reachSuccess();
        await successReleased;
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, account: updatedAccount})});
      });

      await openApp(page, "/?tab=accounts");
      const accountCard = page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).first();
      await accountCard.getByRole("button", {name: "Acciones de Cuenta diaria E2E"}).click();
      await accountCard.getByRole("button", {name: "Editar", exact: true}).click();
      const nameInput = page.getByLabel("Nombre");
      await expect(nameInput).toHaveValue("Cuenta diaria E2E");
      await nameInput.fill("Cuenta diaria E2E editada");
      const submit = page.getByRole("button", {name: "Guardar cuenta"});
      await submit.evaluate((element) => element.scrollIntoView({block: "center", behavior: "auto"}));
      await submit.focus();
      await submit.click();
      await failureReached;
      let submitTopDuringFailure = 0;
      try {
        await expect(submit).toBeFocused();
        await expect(submit).not.toHaveAttribute("disabled");
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        await expect(submit).toHaveAttribute("aria-busy", "true");
        await expect(nameInput).toHaveAttribute("readonly", "");
        submitTopDuringFailure = await submit.evaluate((element) => element.getBoundingClientRect().top);
        const pendingBox = await submit.boundingBox();
        if (!pendingBox) throw new Error("El botón Guardar cuenta no está visible durante la edición.");
        await page.mouse.click(pendingBox.x + pendingBox.width / 2, pendingBox.y + pendingBox.height / 2);
        expect(requestCount).toBe(1);
      } finally {
        releaseFailure();
      }

      await expect(page.getByRole("alert")).toContainText("No se pudo actualizar la cuenta.");
      await expect(nameInput).toHaveValue("Cuenta diaria E2E editada");
      await expect(nameInput).not.toHaveAttribute("readonly");
      await expect(accountCard).toContainText("Cuenta diaria E2E");
      await expect(accountCard).not.toContainText("Cuenta diaria E2E editada");
      await expect(submit).toBeFocused();
      const submitTopAfterError = await submit.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(submitTopAfterError - submitTopDuringFailure)).toBeLessThanOrEqual(5);

      await submit.click();
      await successReached;
      let submitTopDuringRetry = 0;
      try {
        await expect(submit).toBeFocused();
        await expect(submit).toHaveAttribute("aria-busy", "true");
        expect(requestCount).toBe(2);
        submitTopDuringRetry = await submit.evaluate((element) => element.getBoundingClientRect().top);
      } finally {
        releaseSuccess();
      }

      await expect(page.locator(".account-card").filter({hasText: "Cuenta diaria E2E editada"}).first()).toBeVisible();
      await expect(page.getByText("Cuenta actualizada.", {exact: true})).toBeVisible();
      await expect(nameInput).toHaveValue("");
      await expect(submit).toBeFocused();
      const submitTopAfterSuccess = await submit.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(submitTopAfterSuccess - submitTopDuringRetry)).toBeLessThanOrEqual(3);
      assertNoPageErrors();
    });
  }
}

test("Detalle de cuenta conserva su workbench y usa acciones estables @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1024, height: 900});
  await openApp(page, "/?tab=accounts");

  await page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).first().getByRole("button", {name: "Abrir detalle"}).click();
  await expect(page.locator(".account-detail-header h1")).toBeVisible();
  await expect(page.getByText("No disponible con procedencia verificable.")).toBeVisible();
  const accountName = (await page.locator(".account-detail-header h1").textContent())?.trim();
  await expect(page.getByRole("button", {name: "Volver a cuentas"})).toHaveClass(/ui-text-button/);
  await expect(page.getByRole("button", {name: "Ver movimientos"})).toHaveClass(/ui-button--primary/);

  await page.getByText("Más acciones", {exact: true}).click();
  await expect(page.getByLabel("Acciones de la cuenta").getByRole("link", {name: "Exportar"})).toHaveClass(/ui-overflow-menu__item/);
  expect((await stableControlGeometry(page)).legacyControls).toBe(0);
  await page.getByRole("button", {name: "Editar", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Cuentas", exact: true})).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue(accountName || "");
  await expect(page.getByLabel("Nombre")).toBeFocused();
  assertNoPageErrors();
});

test("los diagnósticos de conciliación abren las colas bancarias y CSV correctas @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.route("**/api/accounts/1/", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const payload = await response.json() as {latest_reconciliation: Record<string, unknown> | null};
    payload.latest_reconciliation = {
      id: 901,
      date: "2026-07-16",
      statement_balance: 1000,
      ledger_balance: 990,
      difference: 10,
      status: "difference",
      status_display: "Con diferencia",
      created_at: "2026-07-16T10:00:00+02:00",
      current_ledger_balance: 990,
      ledger_change: 0,
      stale: false,
      diagnosis: {pending_bank: 2, pending_imports: 3, possible_duplicates: 1},
    };
    await route.fulfill({response, json: payload});
  });

  const openAccountDetail = async () => {
    await page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).getByRole("button", {name: "Abrir detalle"}).click();
    await expect(page.getByRole("heading", {name: "Cuenta diaria E2E"})).toBeVisible();
  };
  const returnToAccount = async () => {
    await openApp(page, "/?tab=accounts");
  };

  await openApp(page, "/?tab=accounts");
  await openAccountDetail();
  await page.getByRole("button", {name: "Revisar movimientos bancarios pendientes (2)"}).click();
  await expect(page).toHaveURL(/tab=review/);
  await expect(page).toHaveURL(/focus=bank-review/);
  await expect(page.locator("#review-bank-workspace")).toBeFocused();
  await expect(page.getByText("Compra bancaria con señal E2E")).toBeVisible();

  await returnToAccount();
  await openAccountDetail();
  await page.getByRole("button", {name: "Revisar importaciones pendientes (3)"}).click();
  await expect(page).toHaveURL(/tab=review/);
  await expect(page).toHaveURL(/focus=csv-review/);
  await expect(page.locator("#review-csv-workspace")).toBeFocused();
  await expect(page.getByRole("button", {name: "Comprimir CSV"})).toBeVisible();
  await expect(page.getByText("Compra CSV duplicada E2E")).toBeVisible();

  await returnToAccount();
  await openAccountDetail();
  await page.getByRole("button", {name: "Revisar posibles duplicados (1)"}).click();
  await expect(page).toHaveURL(/tab=review/);
  await expect(page).toHaveURL(/focus=review-attention/);
  await expect(page.locator("#review-workspace")).toBeFocused();
  await expect(page.getByRole("button", {name: "Necesitan atención"})).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Compra bancaria con señal E2E")).toBeVisible();
  await expect(page.getByText("Compra CSV duplicada E2E")).toBeVisible();
  assertNoPageErrors();
});

test("el detalle conserva estructura, borrador, foco y scroll durante el refresh bancario @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 700});

  const gates = [0, 1].map(() => {
    let release!: () => void;
    let start!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { start = resolve; });
    return {release, start, released, started};
  });
  let detailReads = 0;
  await openApp(page, "/?tab=accounts");
  await page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).getByRole("button", {name: "Abrir detalle"}).click();
  await expect(page.getByRole("heading", {name: "Cuenta diaria E2E"})).toBeVisible();
  await expect(page.getByText("No disponible con procedencia verificable.")).toBeVisible();

  await page.route("**/api/accounts/1/", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    detailReads += 1;
    const gate = gates[detailReads - 1];
    gate.start();
    await gate.released;
    if (detailReads === 1) {
      const response = await route.fetch();
      const payload = await response.json() as {account: {balance: number}};
      payload.account.balance = 7777.77;
      return route.fulfill({response, json: payload});
    }
    return route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Fallo de refresco simulado."})});
  });
  await page.route("**/api/bank-connections/1/sync/", (route) => route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true})}));

  const draft = page.getByLabel("Saldo según el extracto");
  await draft.fill("1000");
  const trigger = page.locator(".account-detail-more-actions .ui-overflow-menu__trigger");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await trigger.click();
    await page.getByRole("button", {name: "Sincronizar", exact: true}).focus();
    await page.evaluate(() => window.scrollTo(0, 140));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Enter");
    await gates[attempt].started;

    await expect(page.locator(".account-detail")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("heading", {name: "Cuenta diaria E2E"})).toBeVisible();
    await expect(draft).toHaveValue("1000");
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    gates[attempt].release();
    if (attempt === 0) {
      await expect(page.locator(".account-detail")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator(".account-detail .accounts-summary")).toContainText("7777,77");
    } else {
      await expect(page.getByRole("alert")).toContainText(/Fallo de refresco simulado.*Se mantienen los datos anteriores/);
      await expect(page.getByRole("heading", {name: "Cuenta diaria E2E"})).toBeVisible();
    }
    await expect(draft).toHaveValue("1000");
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  }

  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true] as const) {
    test(`G12-H1 Cuentas conciliación conserva foco ${viewport.label} ${reducedMotion ? "reduced-motion" : "motion"} ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      let releaseSave!: () => void;
      let markSaveStarted!: () => void;
      const saveGate = new Promise<void>((resolve) => {releaseSave = resolve;});
      const saveStarted = new Promise<void>((resolve) => {markSaveStarted = resolve;});
      let saveRequests = 0;
      await openApp(page, "/?tab=accounts");
      await page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).getByRole("button", {name: "Abrir detalle"}).click();
      await expect(page.getByRole("heading", {name: "Cuenta diaria E2E"})).toBeVisible();
      await expect(page.getByText("Introduce el saldo de un extracto para registrar una comprobación reproducible.")).toBeVisible();
      await page.route("**/api/accounts/1/reconciliations/", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        saveRequests += 1;
        markSaveStarted();
        await saveGate;
        await route.fulfill({json: {ok: true, snapshot: {id: 93, date: "2026-07-16", statement_balance: 1000, ledger_balance: 990, difference: 10, status: "difference", status_display: "Con diferencia", created_at: "2026-07-16T10:00:00+02:00"}}});
      });
      const form = page.locator(".account-detail-reconciliation-form");
      await form.getByLabel("Fecha del extracto").fill("2026-07-16");
      await form.getByLabel("Saldo según el extracto").fill("1000");
      const submit = form.locator("button[type=submit]");
      await page.evaluate(() => window.scrollTo(0, 140));
      await submit.scrollIntoViewIfNeeded();
      await submit.focus();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const submitTop = (await submit.boundingBox())?.y;
      const startResultMotionSamples = () => page.evaluate(() => {
        const auditWindow = window as typeof window & {__accountResultHeights?: Array<{height: number; connected: boolean}>};
        auditWindow.__accountResultHeights = [];
        const begin = (element: HTMLElement) => {
          let frame = 0;
          const sample = () => {
            auditWindow.__accountResultHeights!.push({height: element.getBoundingClientRect().height, connected: element.isConnected});
            frame += 1;
            if (frame < 24) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        };
        const result = document.querySelector<HTMLElement>(".account-detail-reconciliation-result");
        if (result?.parentElement) begin(result.parentElement);
        else {
          const observer = new MutationObserver(() => {
            const mounted = document.querySelector<HTMLElement>(".account-detail-reconciliation-result");
            if (!mounted?.parentElement) return;
            observer.disconnect();
            begin(mounted.parentElement);
          });
          observer.observe(document.body, {childList: true, subtree: true});
        }
      });

      try {
        await submit.press("Enter");
        await saveStarted;
        await expect(submit).toHaveAttribute("aria-disabled", "true");
        await expect(submit).toHaveAttribute("aria-busy", "true");
        expect(await submit.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(submit).toBeFocused();
        await expect(page.getByLabel("Saldo según el extracto")).toHaveValue("1000");
        await expect(page.getByRole("heading", {name: "Cuenta diaria E2E"})).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect((await submit.boundingBox())?.y).toBeCloseTo(submitTop!, 0);
        await form.evaluate((element) => element.requestSubmit(element.querySelector("button[type=submit]") as HTMLButtonElement));
        expect(saveRequests).toBe(1);

        await startResultMotionSamples();
        releaseSave();
        await expect(page.getByText("Hay una diferencia pendiente de revisar.")).toBeVisible();
        await page.waitForFunction(() => (window as typeof window & {__accountResultHeights?: unknown[]}).__accountResultHeights?.length === 24);
        const heights = await page.evaluate(() => (window as typeof window & {__accountResultHeights?: Array<{height: number; connected: boolean}>}).__accountResultHeights || []);
        const resultHeights = heights.filter((sample) => sample.connected).map((sample) => sample.height);
        const heightRange = resultHeights.length ? Math.max(...resultHeights) - Math.min(...resultHeights) : 0;
        if (reducedMotion) expect(heightRange).toBeLessThan(1);
        else expect(heightRange).toBeGreaterThan(10);
        await expect(submit).toHaveAccessibleName("Comprobar saldo");
        await expect(submit).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect((await submit.boundingBox())?.y).toBeCloseTo(submitTop!, 0);
        assertNoPageErrors();
      } finally {
        releaseSave();
      }
    });
  }
}

test("las tarjetas mantienen abrir detalle y agrupan el resto en un menú accesible @webkit-only", {tag: "@app-critical"}, async ({page}, testInfo) => {
  const assertNoPageErrors = installPageErrorGuard(page);

  for (const width of [320, 393, 768, 1280]) {
    await page.setViewportSize({width, height: 844});
    await openApp(page, "/?tab=accounts");
    const card = page.locator(".account-card").first();
    const detail = card.getByRole("button", {name: "Abrir detalle"});
    const menu = card.getByRole("button", {name: /^Acciones de /});
    await expect(detail).toBeVisible();
    await expect(menu).toBeVisible();

    const triggerBounds = await menu.boundingBox();
    expect(triggerBounds?.height).toBeGreaterThanOrEqual(44);
    await menu.click();
    const menuLabel = await menu.getAttribute("aria-label");
    const actions = card.getByRole("group", {name: menuLabel!});
    await expect(actions.getByRole("button", {name: "Editar", exact: true})).toBeVisible();
    await expect(actions.getByRole("button", {name: "Eliminar", exact: true})).toBeVisible();
    const actionsBounds = await actions.boundingBox();
    expect(actionsBounds!.y + actionsBounds!.height).toBeLessThanOrEqual(triggerBounds!.y + 1);
    const documentBounds = await page.evaluate(() => ({width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), viewport: document.documentElement.clientWidth}));
    expect(documentBounds.width).toBeLessThanOrEqual(documentBounds.viewport);
    if (width === 393) await page.screenshot({path: testInfo.outputPath("accounts-overflow-menu-mobile.png"), fullPage: false});
    if (width === 1280) await page.screenshot({path: testInfo.outputPath("accounts-overflow-menu-desktop.png"), fullPage: false});
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  }

  assertNoPageErrors();
});

test("la confirmación de eliminar cuenta devuelve el foco al menú y conserva el scroll @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=accounts");

  const card = page.locator(".account-card").filter({hasText: "Cuenta diaria E2E"}).first();
  const menu = card.getByRole("button", {name: "Acciones de Cuenta diaria E2E"});
  await menu.scrollIntoViewIfNeeded();
  await menu.focus();
  await menu.press("Enter");
  const deleteAction = card.getByRole("button", {name: "Eliminar", exact: true});
  await deleteAction.focus();
  const keyboardScroll = await page.evaluate(() => window.scrollY);
  await deleteAction.press("Enter");
  const dialog = page.getByRole("dialog", {name: "¿Eliminar la cuenta “Cuenta diaria E2E”?"});
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(keyboardScroll);

  await menu.click();
  await card.getByRole("button", {name: "Eliminar", exact: true}).click();
  await expect(dialog).toBeVisible();
  const pointerScroll = await page.evaluate(() => window.scrollY);
  await dialog.getByRole("button", {name: "Cancelar"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(pointerScroll);
  assertNoPageErrors();
});

test("eliminar una cuenta mueve el foco a la tarjeta vecina sin sacar su lectura de vista @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 700});
  await openApp(page, "/?tab=accounts");

  await page.getByRole("button", {name: "Añadir cuenta"}).click();
  await page.getByLabel("Nombre").fill("Z - Temporal estabilidad E2E");
  await page.getByRole("button", {name: "Guardar cuenta"}).click();
  const temporaryCard = page.locator(".account-card").filter({hasText: "Z - Temporal estabilidad E2E"});
  await expect(temporaryCard).toBeVisible();

  const cards = page.locator(".account-card");
  const cardIndex = await cards.evaluateAll((elements, name) => elements.findIndex((element) => element.textContent?.includes(name)), "Z - Temporal estabilidad E2E");
  const cardCount = await cards.count();
  const neighbor = cards.nth(cardIndex < cardCount - 1 ? cardIndex + 1 : cardIndex - 1);
  const neighborAction = neighbor.getByRole("button", {name: "Abrir detalle"});
  await temporaryCard.scrollIntoViewIfNeeded();
  const neighborBoxBefore = await neighborAction.boundingBox();
  const scrollBeforeDelete = await page.evaluate(() => window.scrollY);
  const menu = temporaryCard.getByRole("button", {name: "Acciones de Z - Temporal estabilidad E2E"});
  await menu.click();
  await temporaryCard.getByRole("button", {name: "Eliminar", exact: true}).click();
  await page.getByRole("dialog", {name: "¿Eliminar la cuenta “Z - Temporal estabilidad E2E”?"}).getByRole("button", {name: "Eliminar cuenta"}).click();

  await expect(temporaryCard).toHaveCount(0);
  await expect(neighborAction).toBeFocused();
  const neighborBoxAfter = await neighborAction.boundingBox();
  const scrollAfterDelete = await page.evaluate(() => window.scrollY);
  expect(neighborBoxBefore).not.toBeNull();
  expect(neighborBoxAfter).not.toBeNull();
  expect(neighborBoxAfter!.y + scrollAfterDelete).toBeCloseTo(neighborBoxBefore!.y + scrollBeforeDelete, 0);
  expect(neighborBoxAfter!.y).toBeGreaterThanOrEqual(0);
  expect(neighborBoxAfter!.y + neighborBoxAfter!.height).toBeLessThanOrEqual(700);
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  test(`eliminar la última cuenta conserva la lectura del estado vacío en ${viewport.label} ${viewport.width <= 480 ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.emulateMedia({reducedMotion: "reduce"});
    let accountId = 0;
    let accountName = "";
    let deleted = false;
    await page.route("**/api/bootstrap/", async (route) => {
      const response = await route.fetch();
      const payload = await response.json() as Record<string, unknown>;
      const sourceAccounts = payload.accounts as Array<Record<string, unknown>>;
      const account = sourceAccounts.find((candidate) => candidate.name === "Cuenta diaria E2E") || sourceAccounts[0];
      if (!account) throw new Error("La fixture de Cuentas necesita al menos una cuenta.");
      accountId = Number(account.id);
      accountName = String(account.name);
      const accounts = deleted ? [] : [account];
      payload.accounts = accounts;
      if (payload.dashboard && typeof payload.dashboard === "object") {
        payload.dashboard = {...payload.dashboard as Record<string, unknown>, account_balances: accounts};
      }
      await route.fulfill({response, json: payload});
    });
    await page.route("**/api/accounts/**", async (route) => {
      if (route.request().method() !== "DELETE" || new URL(route.request().url()).pathname !== `/api/accounts/${accountId}/`) return route.continue();
      deleted = true;
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, message: "Cuenta eliminada."})});
    });

    await openApp(page, "/?tab=accounts");
    const main = page.locator("#main-content");
    const card = main.locator(".account-card").filter({hasText: accountName});
    await expect(card).toHaveCount(1);
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, Math.min(100, document.documentElement.scrollHeight - innerHeight)));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const emptyMessage = main.getByText("Aún no hay cuentas activas.", {exact: true});
    const menu = card.getByRole("button", {name: `Acciones de ${accountName}`});
    await menu.click();
    await card.getByRole("button", {name: "Eliminar", exact: true}).click();
    await page.getByRole("dialog", {name: `¿Eliminar la cuenta “${accountName}”?`}).getByRole("button", {name: "Eliminar cuenta"}).click();

    await expect(card).toHaveCount(0);
    await expect(emptyMessage).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const addAccount = main.getByRole("button", {name: "Añadir cuenta"});
    const focusedElement = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element ? {tag: element.tagName, id: element.id, role: element.getAttribute("role"), label: element.getAttribute("aria-label"), text: element.textContent?.trim().slice(0, 48)} : null;
    });
    await expect(addAccount, `Active element after removing the last account: ${JSON.stringify(focusedElement)}`).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await expect(page.getByText("Cuenta eliminada.", {exact: true})).toBeVisible();
    assertNoPageErrors();
  });
}
