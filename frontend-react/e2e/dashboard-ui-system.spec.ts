import {expect, test} from "playwright/test";
import {focusMotionPairwiseStates, installPageErrorGuard, openApp, resetE2eDatabase} from "./helpers";

function assignedBrowser(viewport: {width: number}, reducedMotion: boolean) {
  return (viewport.width <= 480) !== reducedMotion ? "@chromium-only" : "@webkit-only";
}

async function dashboardGeometry(page: import("playwright/test").Page) {
  return page.locator("#main-content").evaluate((main) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const controls = [...main.querySelectorAll<HTMLElement>(".ui-button, .ui-icon-button, .ui-text-button, .ui-segmented__item")].filter(visible);
    return {
      heights: controls.map((control) => control.getBoundingClientRect().height),
      legacyControls: main.querySelectorAll(".button, .icon-button, .text-button, .action-link, .primary-action").length,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

async function viewportAnchor(element: import("playwright/test").Locator) {
  return element.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    return {fullyVisible: rect.top >= 0 && rect.bottom <= window.innerHeight};
  });
}

function expectFocusTargetVisible(anchor: Awaited<ReturnType<typeof viewportAnchor>>) {
  expect(anchor.fullyVisible).toBe(true);
}

async function disclosureHeights(page: import("playwright/test").Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const probe = window as Window & {dashboardMoreHeights?: number[]; dashboardMoreFinished?: Promise<void>};
    const heights: number[] = [];
    probe.dashboardMoreHeights = heights;
    probe.dashboardMoreFinished = new Promise<void>((resolve) => {
      let frames = 0;
      const sample = () => {
        const content = document.querySelector(".dashboard-more-transition");
        if (content) heights.push(content.getBoundingClientRect().height);
        if (frames++ < 30) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
  });
  await action();
  await page.evaluate(async () => {
    const probe = window as Window & {dashboardMoreFinished?: Promise<void>};
    await probe.dashboardMoreFinished;
  });
  const heights = await page.evaluate(() => (window as Window & {dashboardMoreHeights?: number[]}).dashboardMoreHeights || []);
  return heights;
}

function expectDisclosureMotion(heights: number[], reducedMotion: boolean) {
  const maximum = Math.max(...heights);
  const minimum = Math.min(...heights);
  const intermediate = heights.filter((height) => height > 1 && height < maximum - 1);
  if (reducedMotion) expect(intermediate).toHaveLength(0);
  else {
    expect(maximum - minimum).toBeGreaterThan(2);
    expect(intermediate.length).toBeGreaterThan(0);
  }
}

async function openDashboardMore(page: import("playwright/test").Page) {
  const trigger = page.getByRole("button", {name: "Más información"});
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".dashboard-more-transition")).not.toHaveAttribute("inert");
}

for (const width of [390, 1024]) {
  test(`Resumen consume controles estables a ${width}px ${width <= 480 ? "@chromium-only" : "@webkit-only"}`, {tag: "@app-critical"}, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width, height: 900});
    await openApp(page, "/");
    const main = page.locator("#main-content");
    await expect(main.locator(".dashboard-operational-header")).toBeVisible();
    await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });

    const mode = page.getByRole("group", {name: "Vista del resumen"});
    await expect(mode.getByRole("button", {name: "Completo"})).toHaveClass(/ui-segmented__item/);
    await expect(main.getByRole("button", {name: "Personalizar"})).toHaveClass(/ui-button--secondary/);
    await expect(page.getByRole("button", {name: "Añadir movimiento", exact: true})).toBeVisible();
    await expect(main.locator(".dashboard-add-trigger")).toHaveCount(0);

    const geometry = await dashboardGeometry(page);
    expect(geometry.legacyControls).toBe(0);
    expect(geometry.heights.length).toBeGreaterThan(0);
    expect(Math.min(...geometry.heights)).toBeGreaterThanOrEqual(39.5);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    if (width === 390) {
      await page.screenshot({path: testInfo.outputPath("dashboard-mobile.png"), fullPage: false});
    }

    assertNoPageErrors();
  });
}

test("el dashboard conserva el resumen y el foco mientras se actualiza el bootstrap @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/");

  let releaseBootstrap!: () => void;
  let markRefreshStarted!: () => void;
  const allowRefresh = new Promise<void>((resolve) => {releaseBootstrap = resolve;});
  const refreshStarted = new Promise<void>((resolve) => {markRefreshStarted = resolve;});
  await page.route("**/api/bootstrap/", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json() as {metrics: {total_balance: number}};
    bootstrap.metrics.total_balance += 1;
    markRefreshStarted();
    await allowRefresh;
    await route.fulfill({response, body: JSON.stringify(bootstrap)});
  });

  const main = page.locator("#main-content");
  const reading = page.getByRole("region", {name: "Estado del mes"});
  const readingBefore = await reading.innerText();
  const totalBefore = await main.locator(".financial-balance > strong").innerText();
  const customize = main.getByRole("button", {name: "Personalizar"});
  await customize.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const pullZone = page.locator(".pull-zone");
  const dispatchTouch = (type: string, y: number, ending = false) => pullZone.evaluate((element, state) => {
    const target = element as HTMLElement;
    const touch = {identifier: 1, target, clientX: 28, clientY: state.y};
    const event = new Event(state.type, {bubbles: true, cancelable: true});
    Object.defineProperties(event, {
      touches: {value: state.ending ? [] : [touch]},
      targetTouches: {value: state.ending ? [] : [touch]},
      changedTouches: {value: [touch]},
    });
    target.dispatchEvent(event);
  }, {type, y, ending});

  try {
    await dispatchTouch("touchstart", 12);
    await dispatchTouch("touchmove", 180);
    await expect(page.getByText("Suelta", {exact: true})).toBeVisible();
    await dispatchTouch("touchend", 180, true);
    await refreshStarted;
    await expect(page.getByText("Actualizando", {exact: true})).toBeVisible();
    await expect(page.getByRole("status").filter({hasText: "Actualizando"})).toHaveCount(1);
    expect(await reading.innerText()).toBe(readingBefore);
    await expect(customize).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    releaseBootstrap();
    await expect.poll(() => main.locator(".financial-balance > strong").innerText()).not.toBe(totalBefore);
    await expect(customize).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    assertNoPageErrors();
  } finally {
    releaseBootstrap();
  }
});

test("el dashboard conserva el resumen y anuncia el error de un refresh fallido @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page, "/");
  const reading = page.getByRole("region", {name: "Estado del mes"});
  await expect(reading).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.route("**/api/bootstrap/", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({error: "Acceso denegado."}),
  }));

  const readingBefore = await reading.innerText();
  const customize = page.getByRole("button", {name: "Personalizar"});
  await customize.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const response = page.waitForResponse((candidate) => candidate.url().includes("/api/bootstrap/") && candidate.status() === 403);
  const pullZone = page.locator(".pull-zone");
  const dispatchTouch = (type: string, y: number, ending = false) => pullZone.evaluate((element, state) => {
    const target = element as HTMLElement;
    const touch = {identifier: 1, target, clientX: 28, clientY: state.y};
    const event = new Event(state.type, {bubbles: true, cancelable: true});
    Object.defineProperties(event, {
      touches: {value: state.ending ? [] : [touch]},
      targetTouches: {value: state.ending ? [] : [touch]},
      changedTouches: {value: [touch]},
    });
    target.dispatchEvent(event);
  }, {type, y, ending});

  await dispatchTouch("touchstart", 12);
  await dispatchTouch("touchmove", 180);
  await dispatchTouch("touchend", 180, true);
  await response;

  await expect(page.getByRole("status", {name: /Acceso denegado/})).toBeVisible();
  expect(await reading.innerText()).toBe(readingBefore);
  await expect(customize).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  assertNoPageErrors();
});

for (const reducedMotion of [false, true] as const) {
  test(`pull-to-refresh superpuesto mantiene la geometría móvil${reducedMotion ? " con movimiento reducido" : ""} ${reducedMotion ? "@chromium-only" : "@webkit-only"}`, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    resetE2eDatabase(testInfo.project.name);
    const apiOrigin = testInfo.project.name === "webkit" ? "http://127.0.0.1:18001" : "http://127.0.0.1:18000";
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
    await openApp(page, "/");

    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => {releaseRefresh = resolve;});
    const refreshStarted = new Promise<void>((resolve) => {markRefreshStarted = resolve;});
    await page.route("**/api/bootstrap/", async (route) => {
      // This test covers refresh geometry; proxy behavior has separate coverage.
      const response = await page.request.get(`${apiOrigin}/api/bootstrap/`);
      markRefreshStarted();
      await refreshGate;
      await route.fulfill({status: response.status(), contentType: "application/json", json: await response.json()});
    });

    const main = page.locator("#main-content");
    const heading = main.getByRole("heading", {level: 1}).first();
    const header = page.locator(".app-header");
    const zone = page.locator(".pull-zone");
    const indicator = page.locator(".pull-indicator");
    const waitForStableLayout = async () => {
      await expect.poll(async () => {
        const read = async () => ({heading: (await heading.boundingBox())?.y, zone: await zone.evaluate((element) => element.getBoundingClientRect().height)});
        const before = await read();
        await page.waitForTimeout(50);
        const after = await read();
        if (before.heading === undefined || after.heading === undefined) return Number.POSITIVE_INFINITY;
        return Math.max(Math.abs(after.heading - before.heading), Math.abs(after.zone - before.zone));
      }, {timeout: 3000}).toBeLessThanOrEqual(0.05);
    };
    await main.evaluate((element) => (element as HTMLElement).focus({preventScroll: true}));
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await waitForStableLayout();
    const initial = await page.evaluate(() => ({scrollY: window.scrollY}));
    const headingY = (await heading.boundingBox())!.y;
    const headerBox = (await header.boundingBox())!;
    const headerBottom = headerBox.y + headerBox.height;
    expect(headingY - headerBottom).toBeGreaterThanOrEqual(12);
    expect(headingY - headerBottom).toBeLessThanOrEqual(30);
    const zoneHeight = await zone.evaluate((element) => element.getBoundingClientRect().height);
    await expect(indicator).toHaveAttribute("aria-hidden", "true");
    expect(await indicator.evaluate((element) => getComputedStyle(element).position)).toBe("absolute");

    const dispatchTouch = (type: string, y: number, ending = false) => zone.evaluate((element, state) => {
      const event = new Event(state.type, {bubbles: true, cancelable: true});
      const touch = {identifier: 1, target: element, clientX: 24, clientY: state.y};
      Object.defineProperties(event, {
        touches: {value: state.ending ? [] : [touch]},
        targetTouches: {value: state.ending ? [] : [touch]},
        changedTouches: {value: [touch]},
      });
      element.dispatchEvent(event);
    }, {type, y, ending});

    try {
      await dispatchTouch("touchstart", 12);
      await dispatchTouch("touchmove", 180);
      await expect(indicator).toHaveClass(/ready/);
      await waitForStableLayout();
      expect((await heading.boundingBox())!.y).toBeCloseTo(headingY, 0);
      expect(await zone.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(zoneHeight, 0);
      const readyBox = await indicator.boundingBox();
      const indicatorBottom = readyBox!.y + readyBox!.height;
      expect(indicatorBottom).toBeLessThanOrEqual(headingY + 1);
      const readyTransform = await indicator.locator(".pull-indicator-icon").evaluate((element) => getComputedStyle(element).transform);
      if (reducedMotion) {
        expect(readyTransform).toBe("none");
      } else {
        expect(readyTransform).not.toBe("none");
      }

      await dispatchTouch("touchend", 180, true);
      await refreshStarted;
      await expect(indicator).toHaveClass(/refreshing/);
      await expect(indicator.locator(".pull-indicator-icon")).toHaveClass(/spin/);
      await waitForStableLayout();
      const iconMotion = await indicator.locator(".pull-indicator-icon").evaluate((element) => ({
        transform: getComputedStyle(element).transform,
        animationName: getComputedStyle(element).animationName,
      }));
      if (reducedMotion) {
        expect(iconMotion.transform).toBe("none");
        expect(iconMotion.animationName).toBe("none");
      } else {
        expect(iconMotion.animationName).toBe("spin");
      }
      await expect(main).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(initial.scrollY);
      expect((await heading.boundingBox())!.y).toBeCloseTo(headingY, 0);
      expect(await zone.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(zoneHeight, 0);
    } finally {
      releaseRefresh();
    }
    await expect(indicator).toHaveAttribute("aria-hidden", "true");
    assertNoPageErrors();
  });
}

test("reemplazar el snapshot devuelve el foco al disparador por teclado y puntero @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.route("**/api/bootstrap/", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json() as {preferences: {last_snapshot_month: string}};
    bootstrap.preferences.last_snapshot_month = "2026-09";
    await route.fulfill({response, body: JSON.stringify(bootstrap)});
  });
  await openApp(page, "/");
  await openDashboardMore(page);

  const saveSnapshot = page.getByRole("button", {name: "Guardar cierre"});
  await saveSnapshot.scrollIntoViewIfNeeded();
  await saveSnapshot.focus();
  const keyboardScroll = await page.evaluate(() => window.scrollY);
  await saveSnapshot.press("Enter");
  const dialog = page.getByRole("dialog", {name: "¿Reemplazar el cierre mensual?"});
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(saveSnapshot).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(keyboardScroll);

  await saveSnapshot.click();
  await expect(dialog).toBeVisible();
  const pointerScroll = await page.evaluate(() => window.scrollY);
  await dialog.getByRole("button", {name: "Cancelar"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(saveSnapshot).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(pointerScroll);
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true]) {
    test(`Guardar snapshot conserva foco, lectura y reintento en ${viewport.label} (movimiento ${reducedMotion ? "reducido" : "normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await page.route("**/api/bootstrap/", async (route) => {
        const response = await route.fetch();
        const bootstrap = await response.json() as {preferences: {last_snapshot_month: string}};
        bootstrap.preferences.last_snapshot_month = "";
        await route.fulfill({response, body: JSON.stringify(bootstrap)});
      });

      let postCount = 0;
      let releaseFirstPost!: () => void;
      let reachedFirstPost!: () => void;
      let releaseSuccess!: () => void;
      let reachedSuccess!: () => void;
      const firstPostReached = new Promise<void>((resolve) => {reachedFirstPost = resolve;});
      const firstPostReleased = new Promise<void>((resolve) => {releaseFirstPost = resolve;});
      const successReached = new Promise<void>((resolve) => {reachedSuccess = resolve;});
      const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
      await page.route("**/api/dashboard/snapshot/", async (route) => {
        postCount += 1;
        if (postCount === 1) {
          reachedFirstPost();
          await firstPostReleased;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo guardar el cierre."})});
          return;
        }
        reachedSuccess();
        await successReleased;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ok: true, replaced: false, snapshot: {
            month: "2026-09",
            captured_at: "2026-09-24T00:00:00Z",
            payload: {metrics: {total_balance: 1234, income: 4567, expense: 3333}},
          }}),
        });
      });

      await openApp(page, "/");
      await openDashboardMore(page);
      const saveSnapshot = page.locator(".snapshot-widget .ui-button");
      await saveSnapshot.scrollIntoViewIfNeeded();
      await saveSnapshot.focus();
      const buttonTopBefore = await saveSnapshot.evaluate((element) => element.getBoundingClientRect().top);
      await saveSnapshot.press("Enter");
      await firstPostReached;
      await expect(saveSnapshot).toBeFocused();
      await expect(saveSnapshot).not.toHaveAttribute("disabled");
      await expect(saveSnapshot).toHaveAttribute("aria-disabled", "true");
      await expect(saveSnapshot).toHaveAttribute("aria-busy", "true");
      const pendingButtonBox = await saveSnapshot.boundingBox();
      if (!pendingButtonBox) throw new Error("El botón de guardado desapareció durante la petición.");
      await page.mouse.click(pendingButtonBox.x + pendingButtonBox.width / 2, pendingButtonBox.y + pendingButtonBox.height / 2);
      expect(postCount).toBe(1);
      releaseFirstPost();

      await expect(page.getByRole("alert")).toContainText("No se pudo guardar el cierre.");
      await expect(saveSnapshot).toBeFocused();
      await expect(saveSnapshot).not.toHaveAttribute("aria-disabled");
      const buttonTopAfterError = await saveSnapshot.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(buttonTopAfterError - buttonTopBefore)).toBeLessThan(1);

      await saveSnapshot.press("Enter");
      await successReached;
      await expect(saveSnapshot).toBeFocused();
      await expect(saveSnapshot).toHaveAttribute("aria-busy", "true");
      expect(postCount).toBe(2);
      await page.evaluate(() => {
        const probe = window as Window & {snapshotPreviewHeights?: number[]; snapshotPreviewFinished?: Promise<void>};
        const heights: number[] = [];
        probe.snapshotPreviewHeights = heights;
        probe.snapshotPreviewFinished = new Promise<void>((resolve) => {
          let frames = 0;
          const sample = () => {
            const preview = document.querySelector(".snapshot-preview");
            if (preview) heights.push(preview.getBoundingClientRect().height);
            if (frames++ < 30) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
      });
      releaseSuccess();

      const preview = page.locator(".snapshot-preview");
      await expect(preview).toBeVisible();
      await expect(preview).toContainText("Saldo");
      await expect(saveSnapshot).toBeFocused();
      await expect(saveSnapshot).toHaveText("Cierre guardado.");
      await page.evaluate(async () => {
        const probe = window as Window & {snapshotPreviewFinished?: Promise<void>};
        await probe.snapshotPreviewFinished;
      });
      const previewHeights = await page.evaluate(() => (window as Window & {snapshotPreviewHeights?: number[]}).snapshotPreviewHeights || []);
      expect(previewHeights.length).toBeGreaterThan(20);
      const heightRange = Math.max(...previewHeights) - Math.min(...previewHeights);
      if (reducedMotion) expect(heightRange).toBeLessThan(1);
      else expect(heightRange).toBeGreaterThan(2);
      const closeSnapshot = preview.getByRole("button", {name: "Cerrar snapshot"});
      await closeSnapshot.focus();
      await closeSnapshot.press("Enter");
      await expect(preview).toHaveCount(0);
      await expect(saveSnapshot).toBeFocused();
      await expect(page.getByRole("button", {name: "Ver cierre"})).toBeVisible();
      expectFocusTargetVisible(await viewportAnchor(saveSnapshot));
      assertNoPageErrors();
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  test(`cerrar snapshot restaura el foco visible en ${viewport.label} con teclado y puntero ${viewport.width <= 480 ? "@webkit-only" : "@chromium-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.route("**/api/bootstrap/", async (route) => {
      const response = await route.fetch();
      const bootstrap = await response.json() as {preferences: {last_snapshot_month: string}};
      bootstrap.preferences.last_snapshot_month = "2026-09";
      await route.fulfill({response, body: JSON.stringify(bootstrap)});
    });
    await page.route("**/api/dashboard/snapshot/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({snapshot: {
        month: "2026-09",
        captured_at: "2026-09-24T00:00:00Z",
        payload: {metrics: {total_balance: 1234, income: 4567, expense: 3333}},
      }}),
    }));

    await openApp(page, "/");
    await openDashboardMore(page);
    const viewSnapshot = page.getByRole("button", {name: "Ver cierre"});
    const closeSnapshot = page.getByRole("button", {name: "Cerrar snapshot"});
    await viewSnapshot.scrollIntoViewIfNeeded();
    await viewSnapshot.focus();
    await viewSnapshot.press("Enter");
    await expect(closeSnapshot).toBeVisible();
    await closeSnapshot.focus();
    await closeSnapshot.press("Enter");
    await expect(page.locator(".snapshot-preview")).toHaveCount(0);
    await expect(viewSnapshot).toBeFocused();
    expectFocusTargetVisible(await viewportAnchor(viewSnapshot));

    await viewSnapshot.click();
    await expect(closeSnapshot).toBeVisible();
    await closeSnapshot.focus();
    await closeSnapshot.click();
    await expect(page.locator(".snapshot-preview")).toHaveCount(0);
    await expect(viewSnapshot).toBeFocused();
    expectFocusTargetVisible(await viewportAnchor(viewSnapshot));
    await expect(page.getByText("Guardado para 2026-09.")).toBeVisible();
    assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  for (const reducedMotion of [false, true]) {
    test(`Ver cierre conserva foco y lectura en ${viewport.label} (movimiento ${reducedMotion ? "reducido" : "normal"}) ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await page.route("**/api/bootstrap/", async (route) => {
        const response = await route.fetch();
        const bootstrap = await response.json() as {preferences: {last_snapshot_month: string}};
        bootstrap.preferences.last_snapshot_month = "2026-09";
        await route.fulfill({response, body: JSON.stringify(bootstrap)});
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
      await page.route("**/api/dashboard/snapshot/**", async (route) => {
        requestCount += 1;
        if (requestCount === 1) {
          reachFailure();
          await failureReleased;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo cargar el cierre."})});
          return;
        }
        reachSuccess();
        await successReleased;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({snapshot: {
            month: "2026-09",
            captured_at: "2026-09-24T00:00:00Z",
            payload: {metrics: {total_balance: 1234, income: 4567, expense: 3333}},
          }}),
        });
      });

      await openApp(page, "/");
      await openDashboardMore(page);
      const viewSnapshot = page.getByRole("button", {name: "Ver cierre"});
      await viewSnapshot.scrollIntoViewIfNeeded();
      await viewSnapshot.focus();
      const buttonTopBefore = await viewSnapshot.evaluate((element) => element.getBoundingClientRect().top);
      await viewSnapshot.press("Enter");
      await failureReached;
      await expect(viewSnapshot).toBeFocused();
      await expect(viewSnapshot).not.toHaveAttribute("disabled");
      await expect(viewSnapshot).toHaveAttribute("aria-disabled", "true");
      await expect(viewSnapshot).toHaveAttribute("aria-busy", "true");
      const pendingBox = await viewSnapshot.boundingBox();
      if (!pendingBox) throw new Error("El botón Ver cierre desapareció durante la petición.");
      await page.mouse.click(pendingBox.x + pendingBox.width / 2, pendingBox.y + pendingBox.height / 2);
      expect(requestCount).toBe(1);
      releaseFailure();

      await expect(page.getByRole("alert")).toContainText("No se pudo cargar el cierre.");
      await expect(viewSnapshot).toBeFocused();
      await expect(viewSnapshot).not.toHaveAttribute("aria-disabled");
      await expect(page.locator(".snapshot-preview")).toHaveCount(0);
      const buttonTopAfterError = await viewSnapshot.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(buttonTopAfterError - buttonTopBefore)).toBeLessThan(1);

      await viewSnapshot.press("Enter");
      await successReached;
      await expect(viewSnapshot).toBeFocused();
      await expect(viewSnapshot).toHaveAttribute("aria-busy", "true");
      expect(requestCount).toBe(2);
      await page.evaluate(() => {
        const probe = window as Window & {snapshotPreviewHeights?: number[]; snapshotPreviewFinished?: Promise<void>};
        const heights: number[] = [];
        probe.snapshotPreviewHeights = heights;
        probe.snapshotPreviewFinished = new Promise<void>((resolve) => {
          let frames = 0;
          const sample = () => {
            const preview = document.querySelector(".snapshot-preview");
            if (preview) heights.push(preview.getBoundingClientRect().height);
            if (frames++ < 30) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
      });
      releaseSuccess();

      const preview = page.locator(".snapshot-preview");
      await expect(preview).toBeVisible();
      await expect(preview).toContainText("Saldo");
      await expect(viewSnapshot).toBeFocused();
      await expect(page.getByRole("alert")).toHaveCount(0);
      const buttonTopAfterSuccess = await viewSnapshot.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(buttonTopAfterSuccess - buttonTopBefore)).toBeLessThan(1);
      await page.evaluate(async () => {
        const probe = window as Window & {snapshotPreviewFinished?: Promise<void>};
        await probe.snapshotPreviewFinished;
      });
      const previewHeights = await page.evaluate(() => (window as Window & {snapshotPreviewHeights?: number[]}).snapshotPreviewHeights || []);
      expect(previewHeights.length).toBeGreaterThan(20);
      const heightRange = Math.max(...previewHeights) - Math.min(...previewHeights);
      if (reducedMotion) expect(heightRange).toBeLessThan(1);
      else expect(heightRange).toBeGreaterThan(2);
      await expect(page.getByText("Guardado para 2026-09.")).toBeVisible();
      assertNoPageErrors();
    });
  }
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  test(`Ver cierre conserva el preview anterior si falla la recarga en ${viewport.label} ${viewport.width <= 480 ? "@webkit-only" : "@chromium-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.route("**/api/bootstrap/", async (route) => {
      const response = await route.fetch();
      const bootstrap = await response.json() as {preferences: {last_snapshot_month: string}};
      bootstrap.preferences.last_snapshot_month = "2026-09";
      await route.fulfill({response, body: JSON.stringify(bootstrap)});
    });
    let requestCount = 0;
    let releaseRefresh!: () => void;
    let reachRefresh!: () => void;
    const refreshReached = new Promise<void>((resolve) => {reachRefresh = resolve;});
    const refreshReleased = new Promise<void>((resolve) => {releaseRefresh = resolve;});
    await page.route("**/api/dashboard/snapshot/**", async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({snapshot: {
          month: "2026-09",
          captured_at: "2026-09-24T00:00:00Z",
          payload: {metrics: {total_balance: 1234, income: 4567, expense: 3333}},
        }})});
        return;
      }
      reachRefresh();
      await refreshReleased;
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo cargar el cierre."})});
    });

    await openApp(page, "/");
    await openDashboardMore(page);
    const viewSnapshot = page.getByRole("button", {name: "Ver cierre"});
    await viewSnapshot.scrollIntoViewIfNeeded();
    await viewSnapshot.focus();
    await viewSnapshot.press("Enter");
    const preview = page.locator(".snapshot-preview");
    await expect(preview).toContainText("Saldo");
    const previousPreview = await preview.evaluate((element) => element.textContent);
    const buttonTopBefore = await viewSnapshot.evaluate((element) => element.getBoundingClientRect().top);

    await viewSnapshot.press("Enter");
    await refreshReached;
    await expect(viewSnapshot).toBeFocused();
    await expect(viewSnapshot).toHaveAttribute("aria-busy", "true");
    expect(await preview.evaluate((element) => element.textContent)).toBe(previousPreview);
    expect(requestCount).toBe(2);
    releaseRefresh();
    await expect(page.getByRole("alert")).toContainText("No se pudo cargar el cierre.");
    await expect(viewSnapshot).toBeFocused();
    expect(await preview.evaluate((element) => element.textContent)).toBe(previousPreview);
    await expect(page.getByText("Guardado para 2026-09.")).toBeVisible();
    const buttonTopAfterError = await viewSnapshot.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(buttonTopAfterError - buttonTopBefore)).toBeLessThan(1);
    assertNoPageErrors();
  });
}

for (const {viewport, input, reducedMotion} of focusMotionPairwiseStates([
  {label: "móvil", width: 390, height: 844},
  {label: "desktop", width: 1280, height: 900},
] as const)) {
  // DX-48 keeps all four pairwise rows in each engine; the open debt covers triples only.
  test(`Dashboard Más información conserva foco con ${input} en ${viewport.label} (movimiento ${reducedMotion ? "reducido" : "normal"})`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
        await openApp(page, "/");
        const trigger = page.getByRole("button", {name: "Más información"});
        await trigger.scrollIntoViewIfNeeded();
        await trigger.focus();
        const triggerTopBefore = await trigger.evaluate((element) => element.getBoundingClientRect().top);
        const toggle = async () => {
          if (input === "teclado") await trigger.press("Enter");
          else await trigger.click();
        };

        const openingHeights = await disclosureHeights(page, toggle);
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(trigger).toBeFocused();
        const region = page.getByRole("region", {name: "Más información"});
        await expect(region).toBeVisible();
        const content = page.locator(".dashboard-more-transition");
        await expect(content).not.toHaveAttribute("inert");
        const triggerTopAfterOpen = await trigger.evaluate((element) => element.getBoundingClientRect().top);
        expect(Math.abs(triggerTopAfterOpen - triggerTopBefore)).toBeLessThan(1);
        expectDisclosureMotion(openingHeights, reducedMotion);

        const closingHeights = await disclosureHeights(page, toggle);
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(trigger).toBeFocused();
        await expect(region).toHaveCount(0);
        await expect(content).toHaveCount(1);
        await expect(content).toHaveAttribute("aria-hidden", "true");
        await expect(content).toHaveAttribute("inert", "");
        await expect(content).toBeHidden();
        expectFocusTargetVisible(await viewportAnchor(trigger));
        expectDisclosureMotion(closingHeights, reducedMotion);
        assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 844}, {label: "desktop", width: 1280, height: 900}]) {
  test(`Dashboard mantiene el estado adicional al cerrar y reabrir en ${viewport.label} ${viewport.width <= 480 ? "@webkit-only" : "@chromium-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.route("**/api/bootstrap/", async (route) => {
      const response = await route.fetch();
      const bootstrap = await response.json() as {preferences: {last_snapshot_month: string}};
      bootstrap.preferences.last_snapshot_month = "2026-09";
      await route.fulfill({response, body: JSON.stringify(bootstrap)});
    });
    await page.route("**/api/dashboard/snapshot/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({snapshot: {
        month: "2026-09",
        captured_at: "2026-09-24T00:00:00Z",
        payload: {metrics: {total_balance: 1234, income: 4567, expense: 3333}},
      }}),
    }));

    await openApp(page, "/");
    await openDashboardMore(page);
    const viewSnapshot = page.getByRole("button", {name: "Ver cierre"});
    await viewSnapshot.click();
    const preview = page.locator(".snapshot-preview");
    await expect(preview).toBeVisible();
    const savedPreview = await preview.evaluate((element) => element.textContent);
    const trigger = page.getByRole("button", {name: "Más información"});
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const region = page.locator(".dashboard-more-transition");
    await expect(region).toHaveAttribute("inert", "");

    await openDashboardMore(page);
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((element) => element.textContent)).toBe(savedPreview);
    await expect(trigger).toBeFocused();
    assertNoPageErrors();
  });
}

test("cambiar el modo y reordenar módulos conserva foco y scroll con movimiento reducido @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/");

  const main = page.locator("#main-content");
  const modes = page.getByRole("group", {name: "Vista del resumen"});
  const fullMode = modes.getByRole("button", {name: "Completo"});
  await fullMode.focus();
  await fullMode.press("Enter");
  await expect(main.locator(".dashboard-shell")).toHaveClass(/mode-full/);
  const balanceMode = modes.getByRole("button", {name: "Saldos"});
  await balanceMode.scrollIntoViewIfNeeded();
  await balanceMode.focus();
  const scrollBeforeMode = await page.evaluate(() => window.scrollY);
  await balanceMode.press("Enter");
  await expect(balanceMode).toBeFocused();
  await expect(main.getByRole("heading", {name: "Saldo por cuenta"})).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeMode);

  await fullMode.focus();
  await fullMode.press("Enter");
  await expect(fullMode).toBeFocused();
  await expect(main.locator(".dashboard-agenda")).toBeVisible();

  const customize = main.getByRole("button", {name: "Personalizar"});
  await customize.click();
  const dialog = page.getByRole("dialog", {name: "Personalizar resumen"});
  const activityTitlesBefore = await main.locator(".dashboard-activity-grid .dashboard-widget-layout .section-heading h2").allTextContents();
  const moveCandidates = [
    "Subir Saldo por cuenta", "Bajar Saldo por cuenta",
    "Subir Últimos movimientos", "Bajar Últimos movimientos",
  ];
  let moveControl = null as Awaited<ReturnType<typeof dialog.getByRole>> | null;
  for (const name of moveCandidates) {
    const candidate = dialog.getByRole("button", {name});
    if (await candidate.isEnabled()) {
      moveControl = candidate;
      break;
    }
  }
  if (!moveControl) throw new Error("El resumen no ofrece un cambio de orden disponible para los módulos de actividad.");
  await moveControl.focus();
  const scrollBeforeMove = await page.evaluate(() => window.scrollY);
  const dialogScrollBeforeMove = await dialog.evaluate((element) => element.scrollTop);
  await moveControl.press("Enter");
  await expect.poll(() => moveControl!.evaluate((element) => element.closest(".editor-row")?.contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeMove);
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(dialogScrollBeforeMove);
  await dialog.getByRole("button", {name: "Listo"}).click();
  await expect(dialog).toBeHidden();
  await expect(customize).toBeFocused();

  const activityTitles = await main.locator(".dashboard-activity-grid .dashboard-widget-layout .section-heading h2").allTextContents();
  expect(activityTitles).toEqual([...activityTitlesBefore].reverse());
  assertNoPageErrors();
});

test("anima el cambio de tamaño de las regiones cuando el usuario permite movimiento @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1280, height: 900});
  await page.emulateMedia({reducedMotion: "no-preference"});
  await openApp(page, "/");
  const modes = page.getByRole("group", {name: "Vista del resumen"});
  const fullMode = modes.getByRole("button", {name: "Completo"});
  await fullMode.focus();
  await fullMode.press("Enter");
  await expect(page.locator(".dashboard-shell")).toHaveClass(/mode-full/);

  await page.evaluate(() => {
    const probe = window as Window & {dashboardLayoutAnimated?: boolean};
    let frames = 0;
    const sample = () => {
      const activity = document.querySelector(".dashboard-activity");
      if (activity && getComputedStyle(activity).transform !== "none") probe.dashboardLayoutAnimated = true;
      if (!probe.dashboardLayoutAnimated && frames++ < 45) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const balanceMode = modes.getByRole("button", {name: "Saldos"});
  await balanceMode.focus();
  await balanceMode.press("Enter");
  await expect(page.locator(".dashboard-shell")).toHaveClass(/mode-balance/);
  await expect.poll(() => page.evaluate(() => (window as Window & {dashboardLayoutAnimated?: boolean}).dashboardLayoutAnimated)).toBe(true);
  assertNoPageErrors();
});

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  test(`Resumen conserva lectura al entrar en el estado vacío de actividad en ${viewport.label} ${viewport.width <= 480 ? "@webkit-only" : "@chromium-only"}`, async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.emulateMedia({reducedMotion: "reduce"});
    const apiOrigin = testInfo.project.name === "webkit" ? "http://127.0.0.1:18001" : "http://127.0.0.1:18000";
    let preferences: ({hidden_widgets: string[]; [key: string]: unknown}) | null = null;
    await page.route("**/api/bootstrap/", async (route) => {
      // This test covers dashboard rendering; proxy behavior has separate coverage.
      const response = await page.request.get(`${apiOrigin}/api/bootstrap/`);
      const payload = await response.json() as {preferences: {hidden_widgets: string[]; [key: string]: unknown}};
      preferences = {...payload.preferences, hidden_widgets: [...payload.preferences.hidden_widgets.filter((id) => id !== "accounts"), "accounts"]};
      await route.fulfill({status: response.status(), contentType: "application/json", json: {...payload, preferences}});
    });
    await page.route("**/api/dashboard/preferences/", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      preferences = {...(preferences || {hidden_widgets: ["accounts"]}), ...route.request().postDataJSON() as Record<string, unknown>};
      await route.fulfill({json: {ok: true, preferences}});
    });

    await openApp(page, "/");
    await expect(page.getByRole("heading", {name: "Resumen", exact: true})).toBeVisible();
    const modes = page.getByRole("group", {name: "Vista del resumen"});
    const balanceMode = modes.getByRole("button", {name: "Saldos"});
    await balanceMode.scrollIntoViewIfNeeded();
    await balanceMode.focus();
    await page.evaluate(() => window.scrollTo(0, Math.min(80, document.documentElement.scrollHeight - innerHeight)));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const buttonTopBefore = (await balanceMode.boundingBox())?.y;
    expect(scrollBefore).toBeGreaterThan(0);
    expect(buttonTopBefore).not.toBeUndefined();

    await balanceMode.press("Enter");
    await expect(page.locator(".dashboard-shell")).toHaveClass(/mode-balance/);
    await expect(page.locator(".dashboard-activity-empty")).toContainText("No hay cuentas visibles en este resumen.");
    await expect(balanceMode).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await balanceMode.boundingBox())?.y).toBeCloseTo(buttonTopBefore!, 0);
    const geometry = await dashboardGeometry(page);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    assertNoPageErrors();
  });
}

for (const viewport of [{label: "móvil", width: 390, height: 700}, {label: "desktop", width: 1280, height: 480}]) {
  test(`ocultar el módulo de cuentas conserva el foco hasta el resumen vacío en ${viewport.label} ${viewport.width <= 480 ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.emulateMedia({reducedMotion: "reduce"});
    let preferences: Record<string, unknown> = {};
    await page.route("**/api/bootstrap/", async (route) => {
      const response = await route.fetch();
      const payload = await response.json() as {preferences: {hidden_widgets: string[]; [key: string]: unknown}};
      preferences = {...payload.preferences, content_mode: "full", hidden_widgets: payload.preferences.hidden_widgets.filter((id) => id !== "accounts")};
      await route.fulfill({response, json: {...payload, preferences}});
    });
    await page.route("**/api/dashboard/preferences/", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      preferences = {...preferences, ...route.request().postDataJSON() as Record<string, unknown>};
      await route.fulfill({json: {ok: true, preferences}});
    });

    await openApp(page, "/");
    const main = page.locator("#main-content");
    const customize = main.getByRole("button", {name: "Personalizar"});
    await customize.click();
    const dialog = page.getByRole("dialog", {name: "Personalizar resumen"});
    const accountsEditorRow = dialog.locator(".editor-row").filter({hasText: "Saldo por cuenta"});
    const hideAccounts = accountsEditorRow.getByRole("button", {name: "Ocultar Saldo por cuenta"});
    await hideAccounts.focus();
    const dialogScrollBefore = await dialog.evaluate((element) => element.scrollTop);
    const documentScrollBefore = await page.evaluate(() => window.scrollY);
    await hideAccounts.press("Enter");
    const showAccounts = accountsEditorRow.getByRole("button", {name: "Mostrar Saldo por cuenta"});
    await expect(showAccounts).toBeFocused();
    expect(await dialog.evaluate((element) => element.scrollTop)).toBe(dialogScrollBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(documentScrollBefore);
    await showAccounts.click();
    const hideAccountsAgain = accountsEditorRow.getByRole("button", {name: "Ocultar Saldo por cuenta"});
    await expect(hideAccountsAgain).toBeVisible();
    await dialog.getByRole("button", {name: "Listo"}).click();
    await expect(dialog).toBeHidden();
    await expect(main.locator(".activity-accounts-widget")).toBeVisible();
    await customize.click();
    const reopenedDialog = page.getByRole("dialog", {name: "Personalizar resumen"});
    const reopenedAccountsRow = reopenedDialog.locator(".editor-row").filter({hasText: "Saldo por cuenta"});
    await reopenedAccountsRow.getByRole("button", {name: "Ocultar Saldo por cuenta"}).click();
    await expect(reopenedAccountsRow.getByRole("button", {name: "Mostrar Saldo por cuenta"})).toBeVisible();
    await reopenedDialog.getByRole("button", {name: "Listo"}).click();
    await expect(reopenedDialog).toBeHidden();
    await expect(customize).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(documentScrollBefore);

    const balanceMode = page.getByRole("group", {name: "Vista del resumen"}).getByRole("button", {name: "Saldos"});
    await balanceMode.focus();
    const modeScrollBefore = await page.evaluate(() => window.scrollY);
    const modeTopBefore = (await balanceMode.boundingBox())?.y;
    await balanceMode.press("Enter");
    await expect(page.locator(".dashboard-activity-empty")).toContainText("No hay cuentas visibles en este resumen.");
    await expect(balanceMode).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(modeScrollBefore);
    expect((await balanceMode.boundingBox())?.y).toBeCloseTo(modeTopBefore!, 0);
    assertNoPageErrors();
  });
}
