import {expect, type Page, type TestInfo} from "playwright/test";

export const viewports = [320, 390, 393, 430, 768, 1280] as const;

export async function openLedger(page: Page, run: string) {
  await page.goto(`/ui-lab.html?e2e=${run}#ledger-archetype`);
  await expect(page.getByLabel("Escenario de ledger archetype")).toBeVisible();
  await page.getByText("Herramientas de prueba").click();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

export async function expectHeaderGeometry(page: Page) {
  const geometry = await page.locator(".ui-ledger-header").evaluate((header) => {
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom}; };
    return {bounds: rect(header), width: innerWidth, scroll: header.scrollWidth, client: header.clientWidth,
      groups: [...header.children].map(rect), amounts: [...header.querySelectorAll(".ui-money-amount")].map(rect)};
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  for (const [i, group] of geometry.groups.entries()) {
    for (const other of geometry.groups.slice(i + 1)) {
      expect(group.right <= other.left + 1 || other.right <= group.left + 1 || group.bottom <= other.top + 1 || other.bottom <= group.top + 1).toBe(true);
    }
  }
  for (const amount of geometry.amounts) {
    expect(amount.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(amount.right).toBeLessThanOrEqual(geometry.bounds.right);
  }
}

export async function expectLedgerGeometry(page: Page) {
  await expectHeaderGeometry(page);
  const geometry = await page.locator(".ui-statement-ledger").evaluate((ledger) => {
    const rows = [...ledger.querySelectorAll<HTMLElement>(".ui-statement-ledger__row")];
    return {
      pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
      rows: rows.map((row) => {
        const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.getBoundingClientRect();
        const selectionTarget = row.querySelector<HTMLElement>(".ui-statement-ledger__selection")?.getBoundingClientRect();
        const content = row.querySelector<HTMLElement>(".ui-statement-ledger__content")?.getBoundingClientRect();
        const amount = row.querySelector<HTMLElement>(".ui-statement-ledger__amount")?.getBoundingClientRect();
        const menu = row.querySelector<HTMLElement>(".ui-statement-ledger__menu .ui-overflow-menu__trigger")?.getBoundingClientRect();
        return {selectionMode: row.classList.contains("is-selection-mode"), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, checkbox: checkbox && {left: checkbox.left, right: checkbox.right, width: checkbox.width, height: checkbox.height}, selectionTarget: selectionTarget && {width: selectionTarget.width, height: selectionTarget.height}, content: content && {left: content.left, right: content.right, top: content.top, bottom: content.bottom}, amount: amount && {left: amount.left, right: amount.right, top: amount.top, bottom: amount.bottom}, menu: menu && {width: menu.width, height: menu.height}};
      }),
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const row of geometry.rows) {
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    if (row.selectionTarget) {
      expect(row.selectionTarget.width).toBeGreaterThanOrEqual(43.5);
      expect(row.selectionTarget.height).toBeGreaterThanOrEqual(43.5);
    }
    if (row.checkbox && row.content) {
      expect(row.checkbox.right).toBeLessThanOrEqual(row.content.left);
      expect(row.checkbox.width).toBeGreaterThanOrEqual(20);
      expect(row.checkbox.width).toBeLessThanOrEqual(24);
      expect(row.checkbox.height).toBeGreaterThanOrEqual(20);
      expect(row.checkbox.height).toBeLessThanOrEqual(24);
    }
    if (row.content && row.amount) {
      const separated = row.content.right <= row.amount.left + 1
        || row.amount.right <= row.content.left + 1
        || row.content.bottom <= row.amount.top + 1
        || row.amount.bottom <= row.content.top + 1;
      expect(separated).toBe(true);
    }
    if (geometry.viewportWidth <= 512 && row.menu && !row.selectionMode) {
      expect(row.menu.width).toBeGreaterThanOrEqual(44);
      expect(row.menu.height).toBeGreaterThanOrEqual(44);
    }
  }
}

export async function ledgerContentAmountPosition(page: Page) {
  return page.locator(".ui-statement-ledger__row").first().evaluate((row) => {
    const content = row.querySelector<HTMLElement>(".ui-statement-ledger__content")!.getBoundingClientRect();
    const amount = row.querySelector<HTMLElement>(".ui-statement-ledger__amount")!.getBoundingClientRect();
    return {contentLeft: content.left, contentRight: content.right, amountLeft: amount.left, amountRight: amount.right};
  });
}

export function expectSameHorizontalPosition(actual: Awaited<ReturnType<typeof ledgerContentAmountPosition>>, expected: Awaited<ReturnType<typeof ledgerContentAmountPosition>>) {
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(0.01);
}

export async function selectionToolbarLayout(page: Page) {
  await page.evaluate(async () => {
    const read = () => {
      const toolbar = document.querySelector<HTMLElement>(".ui-selection-toolbar");
      const filter = document.querySelector<HTMLElement>(".ui-ledger-filter-strip");
      const row = document.querySelector<HTMLElement>(".ui-statement-ledger__row");
      if (!toolbar || !filter || !row) throw new Error("El layout del ledger todavía no está disponible.");
      return [toolbar.getBoundingClientRect().height, filter.getBoundingClientRect().top + scrollY, row.getBoundingClientRect().top + scrollY];
    };
    let previous = read();
    let stableFrames = 0;
    for (let frame = 0; frame < 60 && stableFrames < 3; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = read();
      stableFrames = current.every((value, index) => Math.abs(value - previous[index]) <= 0.05) ? stableFrames + 1 : 0;
      previous = current;
    }
    if (stableFrames < 3) throw new Error("El layout del ledger no se estabilizó en tres frames.");
  });
  return page.locator(".ui-selection-toolbar").evaluate((toolbar) => {
    const filter = document.querySelector<HTMLElement>(".ui-ledger-filter-strip")!.getBoundingClientRect();
    const row = document.querySelector<HTMLElement>(".ui-statement-ledger__row")!.getBoundingClientRect();
    return {toolbarHeight: toolbar.getBoundingClientRect().height, filterTop: filter.top + scrollY, rowTop: row.top + scrollY};
  });
}

export async function resetLedgerScroll(page: Page) {
  await page.evaluate(() => scrollTo(0, 0));
}

export function expectSameVerticalLayout(actual: Awaited<ReturnType<typeof selectionToolbarLayout>>, expected: Awaited<ReturnType<typeof selectionToolbarLayout>>) {
  expect(Math.abs(actual.toolbarHeight - expected.toolbarHeight)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(actual.filterTop - expected.filterTop)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(actual.rowTop - expected.rowTop)).toBeLessThanOrEqual(0.5);
}

export async function expectSelectionToolbarGeometry(page: Page) {
  const geometry = await page.getByRole("region", {name: "Acciones de selección"}).evaluate((toolbar) => {
    const bounds = toolbar.getBoundingClientRect();
    const summary = toolbar.querySelector<HTMLElement>(".ui-selection-toolbar__summary")?.getBoundingClientRect();
    const actions = toolbar.querySelector<HTMLElement>(".ui-selection-toolbar__actions")?.getBoundingClientRect();
    return {left: bounds.left, right: bounds.right, width: innerWidth, summary: summary && {top: summary.top, bottom: summary.bottom}, actions: actions && {top: actions.top}};
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  if (geometry.summary && geometry.actions) expect(geometry.actions.top).toBeGreaterThanOrEqual(geometry.summary.bottom);
}

export async function expectPaginationGeometry(page: Page) {
  const nav = page.getByRole("navigation", {name: "Páginas de movimientos"});
  const geometry = await nav.evaluate((pagination) => {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height};
    };
    return {bounds: rect(pagination), viewportWidth: innerWidth, scrollWidth: pagination.scrollWidth, clientWidth: pagination.clientWidth,
      touch: matchMedia("(pointer: coarse)").matches || innerWidth <= 512,
      controls: [...pagination.querySelectorAll("button")].filter((element) => (element as HTMLElement).offsetParent !== null).map(rect)};
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  for (const [i, target] of geometry.controls.entries()) {
    expect(target.left).toBeGreaterThanOrEqual(0);
    expect(target.right).toBeLessThanOrEqual(geometry.viewportWidth);
    if (geometry.touch) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    for (const other of geometry.controls.slice(i + 1)) {
      expect(target.right <= other.left || other.right <= target.left || target.bottom <= other.top || other.bottom <= target.top).toBe(true);
    }
  }
}

export async function expectStateGeometry(page: Page) {
  const geometry = await page.getByRole("region", {name: "Resultados del ledger"}).evaluate((region) => ({
    page: document.documentElement.scrollWidth, viewport: innerWidth,
    scroll: region.scrollWidth, client: region.clientWidth,
    controls: [...region.querySelectorAll("button")].map((b) => {
      const r = b.getBoundingClientRect(); return {width: r.width, height: r.height};
    }),
  }));
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
}

export async function expectLedgerStates(page: Page) {
  const state = page.getByLabel("Estado del ledger");
  const pagination = page.getByRole("navigation", {name: "Páginas de movimientos"});
  await expect(state).toHaveValue("many");
  await expect(pagination.getByRole("button", {name: "Ir a página 1"})).toHaveAttribute("aria-current", "page");
  await expect(pagination.getByRole("button", {name: "Ir a página 4"})).toBeVisible();
  await expect(pagination).toContainText("1–8 de 32 movimientos");
  await expect(pagination.getByRole("button", {name: "Página anterior"})).toBeDisabled();
  await expect(pagination.getByRole("button", {name: "Página siguiente"})).toBeEnabled();
  await expectPaginationGeometry(page);
  await pagination.getByRole("button", {name: "Página siguiente"}).focus();
  await pagination.getByRole("button", {name: "Página siguiente"}).press("PageDown");
  const pageTwo = pagination.getByRole("button", {name: "Ir a página 2"});
  await expect(pageTwo).toHaveAttribute("aria-current", "page");
  await expectPaginationGeometry(page);
  await expect(pageTwo).toBeFocused();
  await expect(page.getByText("Compra semanal · 2")).toBeVisible();
  await pageTwo.press("End");
  const pageFour = pagination.getByRole("button", {name: "Ir a página 4"});
  await expect(pageFour).toHaveAttribute("aria-current", "page");
  await expectPaginationGeometry(page);
  await expect(pagination.getByRole("button", {name: "Página siguiente"})).toBeDisabled();
  await pageFour.press("Home");
  const pageOne = pagination.getByRole("button", {name: "Ir a página 1"});
  await expect(pageOne).toHaveAttribute("aria-current", "page");
  await expect(pageOne).toBeFocused();
  await pageOne.press("PageDown");
  await expect(pageTwo).toHaveAttribute("aria-current", "page");
  await expect(pageTwo).toBeFocused();
  await pageTwo.press("PageUp");
  await expect(pageOne).toHaveAttribute("aria-current", "page");
  await pageTwo.click();
  await pageTwo.press("Shift+Tab");
  await expect(pageOne).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pageTwo).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pagination.getByRole("button", {name: "Ir a página 3"})).toBeFocused();
  await pagination.getByRole("button", {name: "Ir a página 3"}).click();
  await pagination.getByRole("button", {name: "Página siguiente"}).focus();
  await page.keyboard.press("Enter");
  await expect(pageFour).toHaveAttribute("aria-current", "page");
  await expect(pageFour).toBeFocused();
  await pagination.getByRole("button", {name: "Ir a página 2"}).click();
  await pagination.getByRole("button", {name: "Página anterior"}).focus();
  await page.keyboard.press("Enter");
  await expect(pageOne).toHaveAttribute("aria-current", "page");
  await expect(pageOne).toBeFocused();
  await page.getByLabel("Búsqueda").focus();
  for (const key of ["Home", "End", "PageUp", "PageDown"]) await page.keyboard.press(key);
  await expect(pageOne).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", {name: "Probar paginación larga"}).click();
  await expect(pagination).toContainText("1–8 de 1000000 movimientos");
  await expect(pagination.getByText("…")).toHaveCount(1);
  for (let index = 0; index < 6; index += 1) await pagination.getByRole("button", {name: "Página siguiente"}).click();
  await expect(pagination.getByRole("button", {name: "Ir a página 7"})).toHaveAttribute("aria-current", "page");
  await expect(pagination).toContainText("49–56 de 1000000 movimientos");
  await expect(pagination.getByText("…")).toHaveCount(2);
  await pagination.getByRole("button", {name: "Ir a página 125000"}).click();
  await expect(pagination).toContainText("999993–1000000 de 1000000 movimientos");
  await page.getByRole("button", {name: "Restablecer paginación"}).click();
  await expect(pagination).toContainText("1–8 de 32 movimientos");

  await state.selectOption("few");
  await expect(page.locator(".ui-statement-ledger__row")).toHaveCount(3);
  await expect(pagination).toHaveCount(0);
  await expectLedgerGeometry(page);

  await state.selectOption("empty");
  await expect(page.getByRole("heading", {name: "No hay movimientos con estos filtros"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Limpiar filtros"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Seleccionar"})).toHaveCount(0);
  await page.getByRole("button", {name: "Limpiar filtros"}).focus();
  expect(await page.getByRole("button", {name: "Limpiar filtros"}).evaluate((button) => Number.parseFloat(getComputedStyle(button).outlineWidth))).toBeGreaterThanOrEqual(2);

  await expectStateGeometry(page);
  await page.getByRole("button", {name: "Limpiar filtros"}).press("Enter");
  await expect(page.getByRole("region", {name: "Resultados del ledger"})).toBeFocused();
  await state.selectOption("loading");
  await expect(page.getByRole("status").filter({hasText: "Cargando movimientos…"})).toBeVisible();
  await expect(page.locator(".ui-ledger-loading-state__row")).toHaveCount(4);
  await expect(page.getByRole("button", {name: "Seleccionar"})).toHaveCount(0);

  await expectStateGeometry(page);
  await state.selectOption("error");
  const error = page.getByRole("alert");
  await expect(error).toContainText("No se pudieron cargar los movimientos");
  await expect(error).toContainText("Se mantiene el contexto: el extracto completo");
  await expect(page.getByRole("button", {name: "Seleccionar"})).toHaveCount(0);
  await expectStateGeometry(page);
  await error.getByRole("button", {name: "Reintentar"}).focus();
  expect(await error.getByRole("button", {name: "Reintentar"}).evaluate((button) => Number.parseFloat(getComputedStyle(button).outlineWidth))).toBeGreaterThanOrEqual(2);
  await error.getByRole("button", {name: "Reintentar"}).press("Enter");
  await expect(page.locator(".ui-statement-ledger__row")).toHaveCount(8);
  await expect(page.getByRole("button", {name: "Ir a página 1"})).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("status").filter({hasText: "Los movimientos se han cargado de nuevo."})).toBeVisible();
  const results = page.getByRole("region", {name: "Resultados del ledger"});
  await expect(results).toBeFocused();
  expect(await results.evaluate((region) => Number.parseFloat(getComputedStyle(region).outlineWidth))).toBeGreaterThanOrEqual(2);
}

export async function expectSelectionStates(page: Page) {
  const toolbar = page.getByRole("region", {name: "Acciones de selección"});
  const availability = page.getByLabel("Disponibilidad masiva");
  await expect(toolbar.getByRole("button", {name: "Categorizar"})).toBeEnabled();
  await availability.selectOption("mixed");
  await expect(toolbar.getByRole("button", {name: "Categorizar"})).toHaveAttribute("aria-disabled", "true");
  await toolbar.getByRole("button", {name: "Categorizar"}).click({force: true});
  await expect(toolbar.getByText("La selección contiene movimientos no compatibles.")).toBeVisible();
  await toolbar.getByRole("button", {name: "Exportar"}).click();
  await expect(toolbar.getByText("La selección contiene movimientos no compatibles.")).toHaveCount(0);
  await availability.selectOption("blocked");
  await expect(toolbar).toContainText("No hay acciones disponibles");
  await expect(toolbar.getByRole("button", {name: "Categorizar"})).toHaveCount(0);
  await availability.selectOption("ready");
  await expect(toolbar.getByRole("button", {name: "Categorizar"})).toBeEnabled();
}

export async function expectOpenOverlayWithinViewport(page: Page, triggerName: RegExp | string) {
  await page.getByRole("button", {name: triggerName, exact: typeof triggerName === "string"}).click();
  await expectOverlayControlsContained(page);
}

export async function expectOverlayControlsContained(page: Page) {
  const controls = await page.locator(".ui-ledger-filter-strip input, .ui-ledger-filter-strip select").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().width > 0).map((element) => {
    const rect = element.getBoundingClientRect();
    const label = element.closest("label")!.getBoundingClientRect();
    return {fontSize: parseFloat(getComputedStyle(element).fontSize), touch: matchMedia("(any-pointer: coarse)").matches,
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      label: {left: label.left, right: label.right, top: label.top, bottom: label.bottom}};
  }));
  for (const control of controls) {
    if (control.touch) expect(control.fontSize).toBeGreaterThanOrEqual(16);
    expect(control.left).toBeGreaterThanOrEqual(control.label.left);
    expect(control.right).toBeLessThanOrEqual(control.label.right);
    expect(control.top).toBeGreaterThanOrEqual(control.label.top);
    expect(control.bottom).toBeLessThanOrEqual(control.label.bottom);
  }
  const bounds = await page.locator(".ui-ledger-filter-strip details[open] > div").evaluate((overlay) => {
    const rect = overlay.getBoundingClientRect();
    const style = getComputedStyle(overlay);
    const targets = [...overlay.querySelectorAll<HTMLElement>("input, select, button")]
      .map((target) => {
        // WebKit native selects report an extra anonymous pixel, but cannot scroll.
        const nativeSelect = target instanceof HTMLSelectElement;
        if (nativeSelect) target.scrollLeft = target.scrollWidth;
        return {rect: target.getBoundingClientRect(), scroll: target.scrollWidth, client: target.clientWidth, nativeSelect, scrollLeft: target.scrollLeft};
      })
      .filter(({rect}) => rect.width > 0 && rect.height > 0)
      .map(({rect, scroll, client, nativeSelect, scrollLeft}) => ({left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scroll, client, nativeSelect, scrollLeft}));
    return {left: rect.left, right: rect.right, width: innerWidth, scroll: overlay.scrollWidth, client: overlay.clientWidth,
      innerTop: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      innerBottom: rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
      innerLeft: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      innerRight: rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      pageWidth: document.documentElement.scrollWidth, targets};
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
  expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.width);
  for (const target of bounds.targets) {
    expect(target.top).toBeGreaterThanOrEqual(bounds.innerTop - 1);
    expect(target.bottom).toBeLessThanOrEqual(bounds.innerBottom + 1);
    expect(target.left).toBeGreaterThanOrEqual(bounds.innerLeft - 1);
    expect(target.right).toBeLessThanOrEqual(bounds.innerRight + 1);
    if (target.nativeSelect) expect(target.scrollLeft).toBe(0);
    else expect(target.scroll).toBeLessThanOrEqual(target.client);
  }
}

export async function expectCheckpointFixes(page: Page, testInfo: TestInfo) {
  const menus = page.locator(".ui-statement-ledger__menu.is-open");
  const triggers = page.locator(".ui-statement-ledger__menu .ui-overflow-menu__trigger");
  await triggers.nth(0).tap();
  await expect(menus).toHaveCount(1);
  await triggers.last().tap();
  await expect(menus).toHaveCount(1);
  await expect(menus.locator(".ui-overflow-menu__trigger")).toHaveAttribute("aria-label", "Acciones para Farmacia");
  await page.getByRole("heading", {name: "Ledger archetype", exact: true}).tap();
  await expect(menus).toHaveCount(0);
  await triggers.first().tap();
  await menus.getByRole("button", {name: /^Archivar /}).focus();
  await page.keyboard.press("Escape");
  await expect(menus).toHaveCount(0);
  await expect(triggers.first()).toBeFocused();
  expect(await triggers.first().evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  await triggers.first().tap();
  await menus.getByRole("button", {name: /^Archivar /}).tap();
  await expect(menus).toHaveCount(0);
  await expect(page.getByRole("status").filter({hasText: /Archivar .* se probaría/})).toBeVisible();
  await triggers.first().tap();
  await page.getByRole("button", {name: "Seleccionar", exact: true}).tap();
  await expect(page.locator(".ui-statement-ledger__menu.is-open")).toHaveCount(0);
  await page.getByRole("button", {name: "Cancelar selección", exact: true}).tap();
  await expect(menus).toHaveCount(0);

  const next = page.getByRole("button", {name: "Página siguiente"});
  const pageOne = page.getByRole("button", {name: "Ir a página 1"});
  await triggers.first().tap();
  await next.tap();
  await expect(menus).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Ir a página 2"})).toHaveAttribute("aria-current", "page");
  await next.tap();
  await next.tap();
  await expect(page.getByRole("button", {name: "Ir a página 4"})).toHaveAttribute("aria-current", "page");
  // Consumer/paginator focus transfer keeps touch modality while numeric navigation remains a real control.
  const pageFour = page.getByRole("button", {name: "Ir a página 4"});
  await expect(pageFour).toBeFocused();
  await expect(pageFour).toHaveCSS("outline-style", "none");
  await pageFour.tap();
  await expect(pageFour).toHaveCSS("outline-style", "none");
  await pageFour.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", {name: "Ir a página 3"})).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pageFour).toBeFocused();
  expect(await pageFour.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  await pageFour.press("Home");
  await expect(pageOne).toHaveAttribute("aria-current", "page");
  await next.click();
  const pageTwo = page.getByRole("button", {name: "Ir a página 2"});
  await expect(pageTwo).toHaveCSS("outline-style", "none");
  await pageTwo.press("Home");
  // Real touch on an editable input must also suppress the keyboard ring.
  await page.getByLabel("Búsqueda").tap();
  await expect(page.getByLabel("Búsqueda")).toBeFocused();
  await expect(page.getByLabel("Búsqueda")).toHaveCSS("outline-style", "none");
  const search = page.getByRole("searchbox", {name: "Búsqueda", exact: true});
  await search.pressSequentially("Nom");
  await expect(search).toHaveCSS("outline-style", "none");
  for (const key of ["ArrowLeft", "Home", "End", "Backspace"]) {
    await search.press(key);
    await expect(search).toHaveCSS("outline-style", "none");
  }
  await search.fill("");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", {name: /Periodo:/})).toBeFocused();
  expect(await page.getByRole("button", {name: /Periodo:/}).evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);

  for (const [state, action] of [["empty", "Limpiar filtros"], ["error", "Reintentar"]]) {
    await triggers.first().tap();
    await page.getByLabel("Estado del ledger").selectOption(state);
    await expect(menus).toHaveCount(0);
    await page.getByRole("button", {name: action, exact: true}).tap();
    const results = page.getByRole("region", {name: "Resultados del ledger"});
    await expect(results).toBeFocused();
    await expect(results).toHaveCSS("outline-style", "none");
  }
  await page.getByRole("button", {name: /Periodo:/}).tap();
  const month = page.getByLabel("Mes", {exact: true});
  await month.fill("2026-09");
  await expect(month).toHaveValue("2026-09");
  await expectOverlayControlsContained(page);
  if (page.viewportSize()?.width === 393) await page.screenshot({path: testInfo.outputPath("period-month.png"), fullPage: false});
  await page.getByRole("button", {name: "Rango personalizado", exact: true}).tap();
  await page.getByLabel("Desde", {exact: true}).fill("2026-09-01");
  await page.getByLabel("Hasta", {exact: true}).fill("2026-09-30");
  await expectOverlayControlsContained(page);
  if (page.viewportSize()?.width === 393) await page.screenshot({path: testInfo.outputPath("period-range.png"), fullPage: false});
  await page.getByLabel("Hasta", {exact: true}).press("Escape");
  await page.getByRole("button", {name: "Limpiar", exact: true}).click();
}

export async function expectCompleteArchetype(page: Page, testInfo: TestInfo) {
  const header = page.locator(".ui-ledger-header");
  const originalSummary = await header.innerText();
  // Full-page Chromium screenshots reset touch emulation; preserve the tested viewport.
  await header.scrollIntoViewIfNeeded();
  if ([393, 1280].includes(page.viewportSize()!.width)) await page.screenshot({path: testInfo.outputPath("archetype.png"), fullPage: false});
  await page.getByRole("button", {name: "Página siguiente"}).tap();
  await expect(header).toHaveText(originalSummary.replace(/\n/g, " "), {useInnerText: true});
  await page.getByRole("button", {name: "Ir a página 2"}).press("Home");
  await page.getByRole("button", {name: "Ocultar importes", exact: true}).tap();
  const hidden = await page.getByLabel("Escenario de ledger archetype").evaluate((ledger) => ({
    money: [...ledger.querySelectorAll(".ui-money-amount")].map((amount) => ({text: amount.textContent, label: amount.getAttribute("aria-label")})),
  }));
  expect(hidden.money).toHaveLength(11);
  for (const money of hidden.money) expect(money).toEqual({text: "••••••", label: "Importe oculto"});
  await expectHeaderGeometry(page);
  await page.getByRole("button", {name: "Mostrar importes", exact: true}).tap();

  const noCategory = page.getByText("Cargo pendiente de clasificar", {exact: true});
  const contrast = await noCategory.evaluate((element) => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const foreground = luminance(getComputedStyle(element).color);
    const root = element.closest("main")!;
    const background = luminance(getComputedStyle(root).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  const paginationStatus = page.locator(".ui-ledger-pagination__status");
  expect(await paginationStatus.evaluate((status) => status.getBoundingClientRect().height <= parseFloat(getComputedStyle(status).lineHeight) + 1)).toBe(true);

  const firstMenu = page.locator(".ui-statement-ledger__menu").first();
  await firstMenu.locator(".ui-overflow-menu__trigger").tap();
  await firstMenu.getByRole("button", {name: /^Editar /}).tap();
  await expect(firstMenu).not.toHaveAttribute("open");
  const bankMenu = page.locator(".ui-statement-ledger__row").filter({hasText: "Compra semanal"}).locator(".ui-statement-ledger__menu");
  await bankMenu.locator(".ui-overflow-menu__trigger").tap();
  await bankMenu.getByRole("button", {name: /^Reabrir /}).tap();
  await expect(bankMenu).not.toHaveAttribute("open");

  await page.getByRole("button", {name: "Filtros", exact: true}).tap();
  await page.getByRole("combobox", {name: "Tipo", exact: true}).selectOption("expense");
  await page.getByRole("combobox", {name: "Cuenta", exact: true}).selectOption("Tarjeta diaria");
  await page.getByRole("combobox", {name: "Categoría", exact: true}).selectOption("Salud");
  await expectOverlayControlsContained(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ui-ledger-filter-strip__active > button")).toHaveCount(4);
  await expect(page.locator(".ui-statement-ledger__row")).toHaveCount(4);
  await expect(header).not.toHaveText(originalSummary.replace(/\n/g, " "), {useInnerText: true});
  await expectLedgerGeometry(page);
  await page.getByRole("button", {name: "Seleccionar", exact: true}).tap();
  await expect(page.getByLabel("Búsqueda", {exact: true})).toBeDisabled();
  await page.getByRole("checkbox").first().tap();
  await page.getByRole("checkbox").nth(1).tap();
  await expectSelectionToolbarGeometry(page);
  await expectSelectionStates(page);
  await page.getByRole("button", {name: "Cancelar selección", exact: true}).tap();
  await page.getByRole("button", {name: "Limpiar", exact: true}).tap();
  await expect(header).toHaveText(originalSummary.replace(/\n/g, " "), {useInnerText: true});
  await page.getByRole("button", {name: "Probar contenido largo", exact: true}).tap();
  await expectLedgerGeometry(page);
  if ([393, 1280].includes(page.viewportSize()!.width)) await page.screenshot({path: testInfo.outputPath("archetype-long.png"), fullPage: false});
  await page.getByRole("button", {name: "Restablecer contenido", exact: true}).tap();
}
