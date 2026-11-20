import {expect, test, type Page} from "playwright/test";

const viewports = [320, 390, 393, 430, 768, 1280] as const;

async function openReview(page: Page, width: number) {
  await page.setViewportSize({width, height: 900});
  await page.goto(`/ui-lab.html?e2e=review-archetype-${width}#review-archetype`);
  const review = page.getByRole("region", {name: "Escenario de Revisión"});
  await expect(review).toBeVisible();
  return review;
}

test("la cola conserva lectura cronológica y no desborda los viewports obligatorios", {tag: ["@responsive", "@critical", "@full"]}, async ({page}) => {
  test.setTimeout(90_000);
  for (const width of viewports) {
    const review = await openReview(page, width);
    await expect(review.locator("[data-review-item]")).toHaveCount(18);
    const orderedCardIds = await review.locator("[data-review-item]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-review-item")));
    expect(orderedCardIds.slice(0, 4)).toEqual(["review-blocked", "review-new-prepared", "review-category-change", "review-modified-prepared"]);
    expect(orderedCardIds.indexOf("review-account-missing")).toBeLessThan(orderedCardIds.indexOf("review-uncategorized"));
    await expect(review.locator("[data-review-source]")).toHaveCount(0);
    await expect(review.locator("[data-review-summary]")).toHaveText("13 preparados · 3 por revisar · 2 bloqueados");
    const geometry = await review.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      const rect = (element: Element) => {const value = element.getBoundingClientRect(); return {left: value.left, right: value.right, height: value.height};};
      return {bounds: rect(root), viewportWidth: innerWidth, pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), cards: [...root.querySelectorAll("[data-review-item]")].map(rect), controls: [...root.querySelectorAll("[data-review-item] button, [data-review-item] input")].map(rect), shadows: [...root.querySelectorAll<HTMLElement>("[data-review-item]")].map((card) => getComputedStyle(card).boxShadow), queueDisplay: getComputedStyle(root.querySelector<HTMLElement>(".ui-review-archetype__queue")!).display};
    });
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.queueDisplay).not.toBe("grid");
    expect(geometry.shadows.every((shadow) => shadow === "none")).toBe(true);
    for (const element of [...geometry.cards, ...geometry.controls]) {expect(element.left).toBeGreaterThanOrEqual(geometry.bounds.left - 1); expect(element.right).toBeLessThanOrEqual(geometry.bounds.right + 1);}
    for (const control of geometry.controls) expect(control.height).toBeGreaterThanOrEqual(40);
    if (width <= 393) {
      const choiceCard = review.locator('[data-review-item="review-new-prepared"]');
      await choiceCard.getByRole("button", {name: "Cuenta: Santander"}).click();
      const menu = choiceCard.getByRole("listbox", {name: "Cuenta disponibles"});
      await expect(menu).toBeVisible();
      const menuGeometry = await menu.evaluate((element) => {const rect = element.getBoundingClientRect(); return {left: rect.left, right: rect.right, viewportWidth: innerWidth};});
      expect(menuGeometry.left).toBeGreaterThanOrEqual(0);
      expect(menuGeometry.right).toBeLessThanOrEqual(menuGeometry.viewportWidth + 1);
      await choiceCard.getByRole("combobox", {name: "Cuenta"}).press("Escape");
    }
  }
});

test("mantiene una línea de decisión contenida en desktop sin estrechar viewports menores", {tag: ["@responsive", "@critical", "@full"]}, async ({page}) => {
  for (const width of [393, 768, 1280] as const) {
    const review = await openReview(page, width);
    const geometry = await review.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      const parentRect = root.parentElement!.getBoundingClientRect();
      const cardRect = root.querySelector<HTMLElement>('[data-review-item="review-new-prepared"]')!.getBoundingClientRect();
      const rootRem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        rootWidth: rootRect.width,
        parentWidth: parentRect.width,
        cardWidth: cardRect.width,
        maxDecisionLane: rootRem * 48,
      };
    });

    expect(Math.abs(geometry.cardWidth - geometry.rootWidth)).toBeLessThanOrEqual(2);
    if (width <= 768) {
      expect(Math.abs(geometry.rootWidth - geometry.parentWidth)).toBeLessThanOrEqual(2);
    } else {
      expect(geometry.rootWidth).toBeLessThanOrEqual(geometry.maxDecisionLane + 1);
    }
  }
});

test("separa el resumen de bloqueo del footer al abrir Más detalles", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  for (const width of [320, 390, 393] as const) {
    const review = await openReview(page, width);
    const blocked = review.locator('[data-review-item="review-blocked"]');
    await blocked.getByRole("button", {name: "Más detalles"}).click();
    await page.waitForTimeout(32);
    const geometry = await blocked.evaluate((card) => {
      const summary = card.querySelector<HTMLElement>("[data-review-blocking-summary]")!;
      const actions = card.querySelector<HTMLElement>(".ui-review-transaction-card__actions")!;
      const summaryRect = summary.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const contentBottom = Math.max(summaryRect.bottom, ...[...summary.children].map((child) => child.getBoundingClientRect().bottom));
      return {summaryBottom: summaryRect.bottom, contentBottom, actionsTop: actionsRect.top, width: innerWidth};
    });
    expect(geometry.width).toBe(width);
    expect(geometry.summaryBottom + 8).toBeLessThanOrEqual(geometry.actionsTop);
    expect(geometry.contentBottom + 4).toBeLessThanOrEqual(geometry.actionsTop);
    await expect(blocked.locator('[data-review-inline-field="date"]')).toHaveClass(/ui-review-inline__field--blocking/);
    await expect(blocked.locator('[data-review-inline-field="account"]')).toHaveClass(/ui-review-inline__field--blocking/);
    await expect(blocked.locator('[data-review-inline-field="category"]')).toHaveClass(/ui-review-inline__field--attention/);
    await expect(blocked.locator('[data-review-inline-field="category"]')).not.toHaveClass(/ui-review-inline__field--blocking/);
  }
});

test("explica el recuento bloqueante y mantiene el diff idle fuera del estado de edición", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  const blocked = review.locator('[data-review-item="review-blocked"]');
  await expect(blocked.locator(".ui-review-history")).toHaveText("Nuevo");
  await expect(blocked.locator(".ui-review-source-label")).toHaveText("Banco");
  await expect(blocked.locator(".ui-review-history")).not.toContainText("Banco");
  await expect(blocked.locator(".ui-transaction-status--blocked")).toHaveCSS("border-top-style", "solid");
  await expect(blocked.locator(".ui-transaction-status--blocked")).toHaveCSS("border-radius", "999px");
  await expect(blocked.locator("[data-review-blocking-summary]")).toContainText("Hay 3 problemas que impiden incorporar");
  await expect(blocked.locator("[data-review-attention-summary]")).toHaveCount(0);
  await expect(blocked.locator('[data-review-inline-field="category"] .ui-review-inline__field-error')).toHaveText("Falta categoría.");

  const changed = review.locator('[data-review-item="review-modified-prepared"]');
  const changedAccount = changed.locator('[data-review-inline-field="account"] .ui-review-inline__value');
  await page.mouse.move(1, 1);
  await expect(changedAccount).not.toBeFocused();
  const idleStyles = await changedAccount.evaluate((element) => {
    const style = getComputedStyle(element);
    return {border: style.borderBlockEndColor, background: style.backgroundColor, tag: element.tagName};
  });
  expect(idleStyles).toEqual({border: "rgba(0, 0, 0, 0)", background: "rgba(0, 0, 0, 0)", tag: "BUTTON"});
  await changedAccount.focus();
  await expect(changedAccount).toHaveCSS("background-color", "rgb(228, 233, 236)");
  await changedAccount.blur();
});

test("distingue información válida, missing, changed y edición", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 393);
  const valid = review.locator('[data-review-item="review-new-prepared"]');
  const validStyles = await valid.locator(".ui-review-inline__value").evaluateAll((values) => values.map((value) => {
    const style = getComputedStyle(value);
    return {border: style.borderBlockEndColor, decoration: style.textDecorationLine, background: style.backgroundColor};
  }));
  expect(validStyles.every(({border, decoration, background}) => border === "rgba(0, 0, 0, 0)" && decoration === "none" && background === "rgba(0, 0, 0, 0)")).toBe(true);

  const validAccount = valid.getByRole("button", {name: "Cuenta: Santander"});
  await validAccount.focus();
  await expect(validAccount).toHaveCSS("background-color", "rgb(228, 233, 236)");
  await expect(validAccount).toHaveCSS("outline-style", "solid");

  const missing = review.locator('[data-review-item="review-blocked"] [data-review-inline-field="date"] .ui-review-inline__value');
  await expect(missing).toHaveCSS("text-decoration-line", "none");
  await expect(missing.locator(".." )).toHaveClass(/ui-review-inline__field--blocking/);
  const attentionMissing = review.locator('[data-review-item="review-blocked"] [data-review-inline-field="category"] .ui-review-inline__value');
  await expect(attentionMissing).toHaveCSS("text-decoration-line", "none");
  await expect(attentionMissing.locator("..")).toHaveAttribute("data-review-issue-kind", "attention");

  const changed = review.locator('[data-review-item="review-modified-prepared"] [data-review-inline-field="account"] .ui-review-inline__value');
  await expect(changed).toContainText("Revolut");
  await expect(changed).toContainText("Santander");
  await expect(changed).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");

  const editing = review.locator('[data-review-item="review-new-prepared"]');
  await editing.getByRole("button", {name: "Concepto: Nómina septiembre 2026"}).click();
  const editingBorder = await editing.getByLabel("Concepto").evaluate((input) => getComputedStyle(input).borderTopColor);
  expect(editingBorder).not.toBe("rgba(0, 0, 0, 0)");
});

test("expone error, retry, vacío y el estado de muchos elementos", {tag: ["@responsive", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  await review.getByText("Probar estados del arquetipo").click();
  const state = review.getByRole("combobox", {name: "Estado de página"});
  await state.selectOption("loading");
  await expect(review).toHaveAttribute("data-review-page-state", "loading");
  await expect(review).toHaveAttribute("aria-busy", "true");
  await expect(review.locator("[data-review-summary]")).toHaveText("Preparando la cola…");
  await expect(review).not.toContainText("La cola no está disponible");
  await expect(review.locator("[data-review-item]")).toHaveCount(0);
  await expect(review.getByRole("button", {name: "Ocultar importes"})).toHaveCount(0);
  await state.selectOption("error");
  await expect(review.locator("[data-review-summary]")).toHaveText("Reintenta para continuar.");
  await expect(review.getByRole("alert")).toContainText("No se pudo cargar la cola de Revisión.");
  await expect(review.getByRole("button", {name: "Ocultar importes"})).toHaveCount(0);
  await review.getByRole("button", {name: "Reintentar"}).click();
  await expect(review.locator("[data-review-item]")).toHaveCount(18);
  await state.selectOption("empty");
  await expect(review.locator('[data-review-state-panel="empty"]')).toContainText("No hay movimientos pendientes de revisión.");
  await expect(review.getByRole("button", {name: "Ocultar importes"})).toHaveCount(0);
  await review.getByRole("button", {name: "Mostrar datos de ejemplo"}).click();
  for (const width of [320, 430, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    const manyReview = review;
    const normalCard = manyReview.locator('[data-review-item="review-new-prepared"]');
    const normalFieldCount = await normalCard.locator("[data-review-inline-field]").count();
    await manyReview.getByRole("combobox", {name: "Estado de página"}).selectOption("many");
    await expect(manyReview.locator("[data-review-item]")).toHaveCount(36);
    await expect(manyReview.locator("[data-review-summary]")).toHaveText("26 preparados · 6 por revisar · 4 bloqueados");
    await expect(manyReview.getByText("Las decisiones están desactivadas.")).toBeVisible();
    await expect(manyReview.getByRole("button", {name: "Seleccionar", exact: true})).toHaveCount(0);
    await expect(manyReview.locator("[data-review-decision-action]")).toHaveCount(0);
    await expect(manyReview.locator("[data-review-inline-content]")).toHaveCount(36);
    await expect(manyReview.locator('[data-review-item$="--review-new-prepared"] [data-review-inline-field]')).toHaveCount(normalFieldCount);
    await expect(manyReview.locator('[data-review-item] button')).toHaveCount(0);
    await expect(manyReview.locator('[data-review-item] input')).toHaveCount(0);
    await expect(manyReview.getByRole("button", {name: "Más detalles"})).toHaveCount(0);
    await expect(manyReview.getByRole("button", {name: "Ver cambios"})).toHaveCount(0);
    await expect(manyReview.locator(".ui-review-inline--readonly")).toHaveCount(36);
    expect(await manyReview.locator(".ui-review-inline--readonly .ui-review-inline__value").first().evaluate((value) => getComputedStyle(value).cursor)).not.toBe("pointer");
    expect(await manyReview.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width);
    await manyReview.getByRole("combobox", {name: "Estado de página"}).selectOption("content");
  }
});

test("abre editores directos, cancela y conserva la privacidad", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 393);
  const concept = review.locator('[data-review-item="review-new-prepared"]').getByRole("button", {name: "Concepto: Nómina septiembre 2026"});
  await concept.click();
  const conceptInput = review.locator('[data-review-item="review-new-prepared"]').getByLabel("Concepto");
  await conceptInput.press("Escape");
  await expect(concept).toBeFocused();

  const account = review.locator('[data-review-item="review-account-missing"]');
  const category = review.locator('[data-review-item="review-uncategorized"]');
  await category.getByRole("button", {name: "Categoría: Sin categoría"}).click();
  await expect(category.getByRole("listbox", {name: "Categorías disponibles"})).toBeVisible();
  await category.getByRole("option", {name: "Restaurantes"}).click();
  await expect(category).toHaveAttribute("data-review-preparation", "prepared");
  await account.getByRole("button", {name: "Cuenta: Sin cuenta"}).click();
  await expect(account.getByRole("listbox", {name: "Cuenta disponibles"})).toBeVisible();
  await expect(account.getByRole("combobox", {name: "Cuenta"})).toHaveValue("");
  await account.getByRole("option", {name: "Santander"}).click();
  await expect(account).toHaveAttribute("data-review-preparation", "prepared");
  const prepared = review.locator('[data-review-item="review-prepared-pending"]');
  await prepared.getByRole("button", {name: "Tipo: Gasto"}).click();
  await expect(prepared.getByRole("listbox", {name: "Tipo disponibles"})).toBeVisible();
  await prepared.getByRole("combobox", {name: "Tipo"}).press("Escape");
  await prepared.getByRole("button", {name: "Fecha: 08/09/2026"}).click();
  await expect(prepared.getByLabel("Fecha")).toBeFocused();
  await review.getByRole("button", {name: "Ocultar importes"}).click();
  const privateCard = review.locator('[data-review-item="review-private-amount"]');
  await expect(privateCard).toContainText("••••••");
  await privateCard.getByRole("button", {name: "Importe: ••••••"}).click();
  await privateCard.getByLabel("Importe").blur();
  await expect(privateCard).toContainText("••••••");
});

test("todos los comboboxes respetan Tab, Shift+Tab y Enter sin cambios accidentales", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  const conceptCard = review.locator('[data-review-item="review-new-prepared"]');
  await conceptCard.getByRole("button", {name: "Concepto: Nómina septiembre 2026"}).click();
  await conceptCard.getByLabel("Concepto").press("Tab");
  await expect(conceptCard.getByRole("button", {name: "Fecha: 01/09/2026"})).toBeFocused();

  const accountCard = review.locator('[data-review-item="review-category-change"]');
  await accountCard.getByRole("button", {name: "Cuenta: Revolut"}).click();
  const accountInput = accountCard.getByRole("combobox", {name: "Cuenta"});
  await expect(accountInput).toHaveValue("");
  await expect(accountInput).toHaveAttribute("placeholder", "Buscar cuenta…");
  await expect(accountInput).not.toHaveAttribute("aria-valuetext");
  await expect(accountCard.getByRole("option", {name: "Revolut"})).toHaveAttribute("aria-selected", "true");
  await expect(accountCard.getByRole("option").first()).toHaveAttribute("tabindex", "-1");
  await accountInput.press("Tab");
  await expect(accountCard.getByRole("button", {name: "Categoría: Restaurantes"})).toBeFocused();
  await expect(accountCard.getByRole("combobox", {name: "Cuenta"})).toHaveCount(0);

  const categoryCard = review.locator('[data-review-item="review-modified-prepared"]');
  await categoryCard.getByRole("button", {name: "Categoría: Alimentación"}).click();
  const categoryInput = categoryCard.getByRole("combobox", {name: "Categoría"});
  await expect(categoryInput).toHaveValue("");
  await expect(categoryInput).toHaveAttribute("placeholder", "Buscar categoría…");
  await expect(categoryInput).not.toHaveAttribute("aria-valuetext");
  await expect(categoryCard.getByRole("option", {name: "Alimentación"})).toHaveAttribute("aria-selected", "true");
  await categoryInput.press("Shift+Tab");
  await expect(categoryCard.getByRole("button", {name: "Cuenta: Santander"})).toBeFocused();

  await categoryCard.getByRole("button", {name: "Categoría: Alimentación"}).click();
  await categoryCard.getByRole("combobox", {name: "Categoría"}).press("Tab");
  await expect(categoryCard.getByRole("button", {name: "Más detalles"})).toBeFocused();

  const typeCard = review.locator('[data-review-item="review-prepared-pending"]');
  await typeCard.getByRole("button", {name: "Tipo: Gasto"}).click();
  const typeInput = typeCard.getByRole("combobox", {name: "Tipo"});
  await expect(typeInput).toHaveAttribute("placeholder", "Seleccionar tipo");
  await expect(typeInput).not.toHaveAttribute("aria-valuetext");
  await typeInput.press("Tab");
  await expect(typeCard.getByRole("button", {name: "Cuenta: Santander"})).toBeFocused();

  const transfer = review.locator('[data-review-item="review-transfer"]');
  await transfer.getByRole("button", {name: "Origen: Santander"}).click();
  await transfer.getByRole("combobox", {name: "Cuenta de origen"}).press("Tab");
  await expect(transfer.getByRole("button", {name: "Destino: Cuenta ahorro"})).toBeFocused();
  await transfer.getByRole("button", {name: "Destino: Cuenta ahorro"}).click();
  await transfer.getByRole("combobox", {name: "Cuenta de destino"}).press("Tab");
  await expect(transfer.getByRole("button", {name: "Más detalles"})).toBeFocused();

  await accountCard.getByRole("button", {name: "Cuenta: Revolut"}).click();
  await accountCard.getByRole("combobox", {name: "Cuenta"}).press("Enter");
  await expect(accountCard.getByRole("button", {name: "Cuenta: Revolut"})).toBeVisible();
  await categoryCard.getByRole("button", {name: "Categoría: Alimentación"}).click();
  await categoryCard.getByRole("combobox", {name: "Categoría"}).press("Enter");
  await expect(categoryCard.getByRole("button", {name: "Categoría: Alimentación"})).toBeVisible();
  await conceptCard.getByRole("button", {name: "Tipo: Ingreso"}).click();
  await conceptCard.getByRole("combobox", {name: "Tipo"}).press("Enter");
  await expect(conceptCard.getByRole("button", {name: "Tipo: Ingreso"})).toBeVisible();
  await transfer.getByRole("button", {name: "Tipo: Traspaso"}).click();
  await transfer.getByRole("combobox", {name: "Tipo"}).press("Enter");
  await expect(transfer.getByRole("button", {name: "Tipo: Traspaso"})).toBeVisible();
});

test("el blur diferido nunca cierra el editor que acaba de abrirse", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);

  const accountCard = review.locator('[data-review-item="review-prepared-pending"]');
  await accountCard.getByRole("button", {name: "Cuenta: Santander"}).click();
  await accountCard.getByRole("button", {name: "Fecha: 08/09/2026"}).click();
  await expect(accountCard.getByRole("combobox", {name: "Cuenta"})).toHaveCount(0);
  await expect(accountCard.getByLabel("Fecha")).toBeFocused();
  await accountCard.getByLabel("Fecha").press("Escape");

  const categoryCard = review.locator('[data-review-item="review-category-change"]');
  await categoryCard.getByRole("button", {name: "Categoría: Restaurantes"}).click();
  await categoryCard.getByRole("button", {name: "Concepto: PAYPAL *ABC"}).click();
  await expect(categoryCard.getByRole("combobox", {name: "Categoría"})).toHaveCount(0);
  await expect(categoryCard.getByLabel("Concepto")).toBeFocused();
  await categoryCard.getByLabel("Concepto").press("Escape");

  await accountCard.getByRole("button", {name: "Tipo: Gasto"}).click();
  await accountCard.locator('[data-review-inline-field="amount"] .ui-review-inline__value').click();
  await expect(accountCard.getByRole("combobox", {name: "Tipo"})).toHaveCount(0);
  await expect(accountCard.getByLabel("Importe")).toBeFocused();
});

test("separa el mensaje many, alinea el error de importe y conserva el no-op de Más detalles", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 1280);
  const controls = review.getByText("Probar estados del arquetipo");
  await controls.click();
  const state = review.getByRole("combobox", {name: "Estado de página"});
  for (const value of ["loading", "error", "empty"] as const) {
    await state.selectOption(value);
    await expect(review).not.toContainText("estado de estrés visual");
  }
  await state.selectOption("content");
  await expect(review).not.toContainText("estado de estrés visual");
  await state.selectOption("many");
  await expect(review).toContainText("estado de estrés visual");

  await state.selectOption("content");
  const blocked = review.locator('[data-review-item="review-blocked"]');
  const geometry = await blocked.evaluate((card) => {
    const block = card.querySelector<HTMLElement>(".ui-review-inline__amount")!.getBoundingClientRect();
    const amount = card.querySelector<HTMLElement>(".ui-review-inline__amount .ui-review-inline__value")!.getBoundingClientRect();
    const error = card.querySelector<HTMLElement>(".ui-review-inline__amount .ui-review-inline__field-error")!.getBoundingClientRect();
    return {amountBottom: amount.bottom, blockLeft: block.left, blockRight: block.right, errorTop: error.top, errorLeft: error.left, errorRight: error.right};
  });
  expect(geometry.errorTop).toBeGreaterThanOrEqual(geometry.amountBottom - 1);
  expect(geometry.errorLeft).toBeGreaterThanOrEqual(geometry.blockLeft - 1);
  expect(geometry.errorRight).toBeLessThanOrEqual(geometry.blockRight + 1);

  const details = review.locator('[data-review-item="review-new-prepared"]');
  const closedTrigger = details.getByRole("button", {name: "Más detalles"});
  await expect(closedTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(closedTrigger).toHaveCSS("--review-disclosure-indicator", '"↓"');
  await closedTrigger.click();
  const openTrigger = details.getByRole("button", {name: "Cerrar detalles"});
  await expect(openTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(openTrigger).toHaveAttribute("aria-controls", /.+/);
  await expect(openTrigger).toHaveCSS("--review-disclosure-indicator", '"↑"');
  await expect(details.locator('input[type="file"]')).toHaveCount(0);
  await details.getByLabel("Etiquetas").fill("casa,anual");
  await expect(details.getByRole("heading", {name: "Más detalles"})).toHaveCount(0);
  await expect(details.getByRole("heading", {name: "Información adicional"})).toBeVisible();
  await expect(details).toContainText("Notas y etiquetas opcionales.");
  const nextCard = review.locator('[data-review-item="review-category-change"]');
  await details.getByLabel("Notas").evaluate((textarea) => { textarea.style.height = "220px"; });
  await page.waitForTimeout(32);
  const containment = await details.evaluate((card) => {
    const editor = card.querySelector<HTMLElement>(".ui-review-transaction-card__editor")!;
    const submit = card.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const cardRect = card.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const submitRect = submit.getBoundingClientRect();
    return {cardBottom: cardRect.bottom, editorBottom: editorRect.bottom, submitBottom: submitRect.bottom};
  });
  const nextTop = await nextCard.evaluate((card) => card.getBoundingClientRect().top);
  expect(containment.editorBottom).toBeLessThanOrEqual(containment.cardBottom + 1);
  expect(containment.submitBottom).toBeLessThanOrEqual(containment.cardBottom + 1);
  expect(nextTop).toBeGreaterThanOrEqual(containment.cardBottom - 1);
  const detailsGeometry = await details.evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const saveRect = card.querySelector<HTMLButtonElement>('button[type="submit"]')!.getBoundingClientRect();
    return {cardWidth: cardRect.width, saveWidth: saveRect.width};
  });
  expect(detailsGeometry.saveWidth).toBeLessThan(detailsGeometry.cardWidth - 8);
  await details.getByRole("button", {name: "Guardar detalles"}).click();
  await expect(details.getByRole("button", {name: "Más detalles"})).toBeVisible();
  await expect(review.locator("[data-review-status]")).toHaveText("");
});

test("reevalúa incidencias al cambiar Tipo y conserva la fixture del reembolso", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  const refund = review.locator('[data-review-item="review-refund-dependent"]');
  await expect(refund.getByRole("button", {name: "Categoría: Hogar"})).toBeVisible();

  const uncategorized = review.locator('[data-review-item="review-uncategorized"]');
  await uncategorized.getByRole("button", {name: "Tipo: Gasto"}).click();
  await uncategorized.getByRole("option", {name: "Traspaso"}).click();
  await expect(uncategorized.getByRole("button", {name: "Destino: Sin cuenta"})).toBeVisible();
  await expect(uncategorized.getByRole("button", {name: "Categoría: Sin categoría"})).toHaveCount(0);
  await expect(uncategorized).not.toContainText("Falta categoría.");
  await uncategorized.getByRole("button", {name: "Destino: Sin cuenta"}).click();
  await uncategorized.getByRole("option", {name: "Santander"}).click();
  await expect(uncategorized).toHaveAttribute("data-review-preparation", "prepared");

  await uncategorized.getByRole("button", {name: "Tipo: Traspaso"}).click();
  await uncategorized.getByRole("option", {name: "Gasto"}).click();
  await expect(uncategorized.getByRole("button", {name: "Categoría: Sin categoría"})).toBeVisible();

  const accountMissing = review.locator('[data-review-item="review-account-missing"]');
  await accountMissing.getByRole("button", {name: "Tipo: Gasto"}).click();
  await accountMissing.getByRole("option", {name: "Traspaso"}).click();
  await expect(accountMissing.getByRole("button", {name: "Origen: Sin cuenta"})).toBeVisible();
  await expect(accountMissing).not.toContainText("Falta únicamente la cuenta.");
  await expect(accountMissing).not.toContainText("Falta la cuenta.");
  await accountMissing.getByRole("button", {name: "Origen: Sin cuenta"}).click();
  await accountMissing.getByRole("option", {name: "Santander"}).click();
  await accountMissing.getByRole("button", {name: "Destino: Sin cuenta"}).click();
  await accountMissing.getByRole("option", {name: "Revolut"}).click();
  await expect(accountMissing).toHaveAttribute("data-review-preparation", "prepared");

  const invalidTransfer = review.locator('[data-review-item="review-transfer-invalid"]');
  await invalidTransfer.getByRole("button", {name: "Tipo: Traspaso"}).click();
  await invalidTransfer.getByRole("option", {name: "Gasto"}).click();
  await expect(invalidTransfer).not.toContainText("Falta la cuenta de destino.");
  await expect(invalidTransfer.getByRole("button", {name: "Cuenta: Santander"})).toBeVisible();
  await expect(invalidTransfer).not.toContainText("Origen y destino distintos");

  const sameAccountTransfer = review.locator('[data-review-item="review-transfer"]');
  await sameAccountTransfer.getByRole("button", {name: "Destino: Cuenta ahorro"}).click();
  await sameAccountTransfer.getByRole("option", {name: "Santander"}).click();
  await expect(sameAccountTransfer).toContainText("Origen y destino distintos");
  await sameAccountTransfer.getByRole("button", {name: "Tipo: Traspaso"}).click();
  await sameAccountTransfer.getByRole("option", {name: "Ingreso"}).click();
  await expect(sameAccountTransfer).not.toContainText("Origen y destino distintos");

  const categoryMemory = review.locator('[data-review-item="review-modified-prepared"]');
  await categoryMemory.getByRole("button", {name: "Tipo: Gasto"}).click();
  await categoryMemory.getByRole("option", {name: "Traspaso"}).click();
  await expect(categoryMemory.getByRole("button", {name: "Categoría: Sin categoría"})).toHaveCount(0);
  await categoryMemory.getByRole("button", {name: "Tipo: Traspaso"}).click();
  await categoryMemory.getByRole("option", {name: "Gasto"}).click();
  await expect(categoryMemory.getByRole("button", {name: "Categoría: Alimentación"})).toBeVisible();
});

test("corrige excepciones con señal local, sale de Atención y conserva Más detalles secundario", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 1280);
  const blocked = review.locator('[data-review-item="review-blocked"]');
  await expect(blocked.locator('.ui-review-inline__issues:not([data-review-blocking-summary]):not([data-review-attention-summary])')).toHaveCount(0);
  await expect(blocked.locator("[data-review-blocking-summary]")).toContainText("Hay 3 problemas que impiden incorporar");
  await expect(blocked.locator("[data-review-attention-summary]")).toHaveCount(0);
  await expect(blocked.locator('[data-review-inline-field="date"]')).toHaveClass(/ui-review-inline__field--blocking/);
  await expect(blocked.locator('[data-review-inline-field="account"]')).toHaveClass(/ui-review-inline__field--blocking/);
  await expect(blocked.locator('[data-review-inline-field="category"]')).toHaveClass(/ui-review-inline__field--attention/);
  await expect(blocked.locator('[data-review-inline-field="amount"] .ui-review-inline__field-error')).toHaveText("El importe debe ser mayor que 0.");
  await expect(blocked.locator('[data-review-inline-field="date"] .ui-review-inline__field-error')).toHaveText("Falta la fecha de origen.");
  await expect(blocked.locator('[data-review-inline-field="account"] .ui-review-inline__field-error')).toHaveText("Falta la cuenta.");
  await expect(blocked.locator('[data-review-inline-field="category"] .ui-review-inline__field-error')).toHaveText("Falta categoría.");
  await expect(blocked.locator('[data-review-inline-field="date"] .ui-review-inline__value')).toHaveAttribute("aria-describedby", /review-inline-field-error-review-blocked-date/);
  await expect(blocked.locator('[data-review-inline-field="account"] .ui-review-inline__value')).toHaveAttribute("aria-describedby", /review-inline-field-error-review-blocked-account/);
  await expect(blocked.locator('[data-review-inline-field="category"] .ui-review-inline__value')).toHaveAttribute("aria-describedby", /review-inline-field-error-review-blocked-category/);
  await expect(review.locator('[data-review-item="review-transfer-invalid"] [data-review-blocking-summary]')).toContainText("Hay 1 problema que impide incorporar");
  await expect(blocked.locator(".ui-review-inline__field-error")).toHaveCount(4);

  await blocked.getByRole("button", {name: "Importe: 0,00 €"}).click();
  const invalidAmount = blocked.getByLabel("Importe");
  await invalidAmount.fill("abc");
  await invalidAmount.press("Enter");
  await expect(invalidAmount).toHaveValue("abc");
  await expect(blocked.locator('[data-review-inline-field="amount"] .ui-review-inline__field-error')).toHaveText("El importe debe ser mayor que 0.");
  await expect(blocked).toContainText("Sin fecha");
  const attention = review.locator('[data-review-item="review-description-attention"]');
  await review.getByRole("button", {name: "Necesitan atención"}).click();
  await attention.getByRole("button", {name: "Concepto: RESTAURANTE 024"}).click();
  await attention.getByLabel("Concepto").fill("Restaurante confirmado");
  await attention.getByLabel("Concepto").press("Enter");
  await expect(attention).toHaveCount(0);
  await review.getByRole("button", {name: "Todos", exact: true}).click();
  const corrected = review.locator('[data-review-item="review-description-attention"]');
  await expect(corrected).toBeVisible();
  await expect(corrected).toHaveAttribute("data-review-preparation", "prepared");
  await corrected.getByRole("button", {name: "Más detalles"}).click();
  await expect(corrected.getByRole("heading", {name: "Más detalles"})).toHaveCount(0);
  await expect(corrected.getByRole("heading", {name: "Información adicional"})).toBeVisible();
  await expect(corrected.getByRole("combobox", {name: "Tipo"})).toHaveCount(0);
  await corrected.getByRole("button", {name: "Cerrar detalles"}).click();
});

test("incorpora individualmente y en batch con salida animada y mantiene la dependencia de reembolso", {tag: ["@focused", "@selection", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 393);
  const refund = review.locator('[data-review-item="review-refund-dependent"]');
  await expect(refund).toContainText("Pendiente de incorporar");
  await expect(refund.getByRole("button", {name: "Incorporar"})).toBeDisabled();
  const parent = review.locator('[data-review-item="review-prepared-pending"]');
  const nextCard = review.locator('[data-review-item="review-private-amount"]');
  await expect(parent).toHaveCSS("overflow", "visible");
  const reflow = await review.evaluate(async () => {
    const exitingCard = document.querySelector<HTMLElement>('[data-review-item="review-prepared-pending"]');
    const next = document.querySelector<HTMLElement>('[data-review-item="review-private-amount"]');
    const documentTop = (card: HTMLElement) => card.getBoundingClientRect().top + window.scrollY;
    const topBeforeExit = next ? documentTop(next) : Number.NaN;
    exitingCard?.querySelector<HTMLButtonElement>("[data-review-decision-action]")?.click();
    const samples: number[] = [];
    let overflowDuringExit: string | null = null;
    for (let frame = 0; frame < 18; frame += 1) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (exitingCard?.dataset.reviewExiting === "true") overflowDuringExit ||= getComputedStyle(exitingCard).overflow;
      if (next) samples.push(documentTop(next));
    }
    const duringIndex = samples.findIndex((value, index) => index > 0 && samples[index - 1] > value);
    return {topBeforeExit, samples, duringIndex, overflowDuringExit};
  });
  expect(reflow.overflowDuringExit).toBe("hidden");
  expect(reflow.duringIndex).toBeGreaterThan(0);
  expect(reflow.topBeforeExit).toBeGreaterThan(reflow.samples[reflow.duringIndex]);
  expect(reflow.samples[reflow.duringIndex]).toBeGreaterThan(reflow.samples.at(-1) ?? Number.NaN);
  await expect(parent).toHaveCount(0);
  await expect(refund).toContainText("Disponible");
  await expect(refund.getByRole("button", {name: "Incorporar"})).toBeEnabled();
  await refund.getByRole("button", {name: "Incorporar"}).click();
  await expect(refund).toHaveCount(0);

  await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
  const batchA = review.locator('[data-review-item="review-batch-a"]'); const batchB = review.locator('[data-review-item="review-batch-b"]');
  await batchA.getByRole("checkbox", {name: "Seleccionar Compra batch A"}).check();
  await batchB.getByRole("checkbox", {name: "Seleccionar Compra batch B"}).check();
  await review.getByRole("button", {name: "Incorporar 2"}).click();
  await expect(batchA).toHaveCount(0); await expect(batchB).toHaveCount(0);
});

test("mueve el foco al siguiente, al anterior y al empty state tras retirar tarjetas", {tag: ["@selection", "@reduced-motion", "@critical", "@full"]}, async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  const review = await openReview(page, 390);
  const intermediate = review.locator('[data-review-item="review-batch-a"]');
  await intermediate.getByRole("button", {name: "Incorporar"}).click();
  await expect(intermediate).toHaveCount(0);
  expect(await review.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-review-item]")?.dataset.reviewItem)).toBe("review-batch-b");

  await review.getByRole("button", {name: "Necesitan atención"}).click();
  const attentionAccount = review.locator('[data-review-item="review-account-missing"]');
  await attentionAccount.getByRole("button", {name: "Cuenta: Sin cuenta"}).click();
  await attentionAccount.getByRole("option", {name: "Santander"}).click();
  const attentionCategory = review.locator('[data-review-item="review-uncategorized"]');
  await attentionCategory.getByRole("button", {name: "Categoría: Sin categoría"}).click();
  await attentionCategory.getByRole("option", {name: "Alimentación"}).click();
  const attentionBlocked = review.locator('[data-review-item="review-blocked"]');
  await attentionBlocked.getByRole("button", {name: "Cuenta: Sin cuenta"}).click();
  await attentionBlocked.getByRole("option", {name: "Santander"}).click();
  await attentionBlocked.getByRole("button", {name: "Importe: 0,00 €"}).click();
  await attentionBlocked.getByLabel("Importe").fill("1");
  await attentionBlocked.getByLabel("Importe").press("Enter");
  await attentionBlocked.getByRole("button", {name: "Fecha: Sin fecha"}).click();
  await attentionBlocked.getByLabel("Fecha").fill("2026-09-06");
  await attentionBlocked.getByLabel("Fecha").press("Enter");
  await attentionBlocked.getByRole("button", {name: "Categoría: Sin categoría"}).click();
  await attentionBlocked.getByRole("option", {name: "Alimentación"}).click();
  const lastVisible = review.locator('[data-review-item="review-transfer-invalid"]');
  await lastVisible.getByRole("button", {name: "Destino: Sin cuenta"}).click();
  await lastVisible.getByRole("option", {name: "Revolut"}).click();
  await expect(lastVisible).toHaveCount(0);
  expect(await review.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-review-item]")?.dataset.reviewItem)).toBe("review-description-attention");
  const lastAttention = review.locator('[data-review-item="review-description-attention"]');
  await lastAttention.getByRole("button", {name: "Concepto: RESTAURANTE 024"}).click();
  await lastAttention.getByLabel("Concepto").fill("Restaurante confirmado");
  await lastAttention.getByLabel("Concepto").press("Enter");
  await expect(lastAttention).toHaveCount(0);
  await expect(review.locator("#review-filter-empty")).toBeFocused();

  await review.getByRole("button", {name: "Todos", exact: true}).click();
  await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
  const checkboxes = review.locator('[data-review-item] input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(16);
  for (const checkbox of await checkboxes.all()) await checkbox.check();
  await review.getByRole("button", {name: "Incorporar 16"}).click();
  const refund = review.locator('[data-review-item="review-refund-dependent"]');
  await expect(refund.locator("[data-review-dependency]")).toHaveAttribute("data-review-dependency-status", "available");
  await expect(refund.getByRole("button", {name: "Incorporar"})).toBeEnabled();
  await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
  await refund.locator('input[type="checkbox"]').check();
  await review.getByRole("button", {name: "Incorporar 1"}).click();
  await expect(review.locator("#review-empty-state")).toBeFocused();
});

test("conserva la tarjeta y recupera la CTA cuando falla la incorporación", {tag: ["@focused", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 393);
  await review.getByText("Probar estados del arquetipo").click();
  await review.getByLabel("Simular fallo de incorporación").check();
  const prepared = review.locator('[data-review-item="review-prepared-pending"]');
  await prepared.getByRole("button", {name: "Incorporar"}).click();
  await expect(review.locator("[data-review-status]")).toContainText("Sigue pendiente de revisión.");
  await expect(prepared).toBeVisible();
  await expect(prepared.getByRole("button", {name: "Incorporar"})).toBeEnabled();
});

test("edita transferencias y respeta reduced motion", {tag: ["@focused", "@reduced-motion", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 393);
  const transfer = review.locator('[data-review-item="review-transfer"]');
  await transfer.getByRole("button", {name: "Destino: Cuenta ahorro"}).click();
  await transfer.getByRole("option", {name: "Revolut"}).click();
  await expect(transfer.getByRole("button", {name: "Destino: Revolut"})).toBeVisible();
  const invalid = review.locator('[data-review-item="review-transfer-invalid"]');
  await expect(invalid).toContainText("Sin cuenta");
  await expect(invalid.locator('[data-review-inline-field="transfer_target_account"] .ui-review-inline__field-error')).toHaveText("Falta la cuenta de destino.");
  await page.emulateMedia({reducedMotion: "reduce"});
  await review.getByRole("button", {name: "Necesitan atención"}).click();
  const attention = review.locator('[data-review-item="review-description-attention"]');
  await attention.getByRole("button", {name: "Concepto: RESTAURANTE 024"}).click();
  await attention.getByLabel("Concepto").fill("Restaurante confirmado");
  await attention.getByLabel("Concepto").press("Enter");
  await expect(attention).toHaveCount(0);
  await expect(review.locator("[data-review-status]")).toContainText("Dato corregido");
  const motion = await review.locator('[data-review-item]').first().evaluate((card) => {const style = getComputedStyle(card); return {duration: Number.parseFloat(style.transitionDuration), property: style.transitionProperty};});
  expect(motion.duration).toBeLessThanOrEqual(0.01);
  expect(motion.property).toBe("none");
});

test("mantiene la jerarquía compacta del footer y el reembolso sin duplicación", {tag: ["@responsive", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  const prepared = review.locator('[data-review-item="review-new-prepared"]');
  const actions = prepared.locator(".ui-review-transaction-card__actions");
  const actionGeometry = await actions.evaluate((element) => [...element.children].map((child) => {const rect = child.getBoundingClientRect(); return {top: rect.top, bottom: rect.bottom, width: rect.width};}));
  const preparedWidth = await prepared.evaluate((element) => element.getBoundingClientRect().width);
  expect(actionGeometry).toHaveLength(2);
  expect(Math.abs(actionGeometry[0].top - actionGeometry[1].top)).toBeLessThanOrEqual(1);
  expect(Math.abs(actionGeometry[0].bottom - actionGeometry[1].bottom)).toBeLessThanOrEqual(1);
  expect(actionGeometry[0].width).toBeLessThan(preparedWidth - 8);

  const blocked = review.locator('[data-review-item="review-blocked"]');
  const blockedButton = blocked.getByRole("button", {name: "Más detalles"});
  const blockedGeometry = await blockedButton.evaluate((button) => {const rect = button.getBoundingClientRect(); const card = button.closest<HTMLElement>("[data-review-item]")!.getBoundingClientRect(); return {buttonWidth: rect.width, cardWidth: card.width, height: rect.height};});
  expect(blockedGeometry.buttonWidth).toBeLessThan(blockedGeometry.cardWidth - 8);
  expect(blockedGeometry.height).toBeGreaterThanOrEqual(40);

  const refund = review.locator('[data-review-item="review-refund-dependent"]');
  await expect(refund.getByText("Reembolso", {exact: true})).toHaveCount(0);
  await expect(refund.locator('[data-review-dependency="refund"]')).toHaveCount(1);
  expect(await review.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(390);
});

test("mantiene utilizable un selector junto al borde inferior del viewport", {tag: ["@responsive", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  const card = review.locator('[data-review-item="review-private-amount"]');
  const trigger = card.getByRole("button", {name: "Cuenta: Cuenta ahorro"});
  await trigger.click();
  const menu = card.getByRole("listbox", {name: "Cuenta disponibles"});
  await expect(menu).toBeVisible();
  await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[data-review-item="review-private-amount"] [role="listbox"]');
    if (menu) window.scrollTo(0, Math.max(0, menu.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 4));
  });
  const option = menu.getByRole("option", {name: "Santander"});
  await option.scrollIntoViewIfNeeded();
  await expect(option).toBeVisible();
  const geometry = await menu.evaluate((element) => {const menuRect = element.getBoundingClientRect(); const optionRect = element.querySelector<HTMLElement>('[role="option"]')!.getBoundingClientRect(); return {menuLeft: menuRect.left, menuRight: menuRect.right, optionBottom: optionRect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight};});
  expect(geometry.menuLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.menuRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.optionBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.clientHeight);
  await card.getByRole("combobox", {name: "Cuenta"}).press("Escape");
});

test("separa la barra contextual de selección de las acciones normales", {tag: ["@selection", "@responsive", "@critical", "@full"]}, async ({page}) => {
  const review = await openReview(page, 390);
  await expect(review.locator("[data-review-selection-bar]")).toHaveCount(0);
  await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
  const bar = review.locator("[data-review-selection-bar]");
  await expect(bar).toBeVisible();
  await expect(bar.locator(".ui-review-archetype__privacy")).toHaveCount(0);
  await expect(review.locator(".ui-review-archetype__toolbar-normal-actions .ui-review-archetype__privacy")).toBeVisible();
  await expect(bar.getByRole("button", {name: "Incorporar 0"})).toBeDisabled();

  const batchA = review.locator('[data-review-item="review-batch-a"]');
  await batchA.evaluate((card) => card.dispatchEvent(new MouseEvent("click", {bubbles: true})));
  await expect(batchA.getByRole("checkbox")).toBeChecked();
  await expect(batchA).toHaveAttribute("data-review-selected", "true");
  await expect(bar.getByRole("button", {name: "Incorporar 1"})).toBeEnabled();
  await expect(review.locator('[data-review-item] [data-review-decision-action]')).toHaveCount(0);
  await expect(review.locator('[data-review-item] button[aria-label="Más detalles"]')).toHaveCount(0);
  const geometry = await bar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const count = element.querySelector<HTMLElement>("[data-review-selection-count]")!.getBoundingClientRect();
    const cancel = element.querySelector<HTMLElement>(".ui-review-archetype__selection-cancel")!.getBoundingClientRect();
    const action = element.querySelector<HTMLElement>("[data-review-bulk-action]")!.getBoundingClientRect();
    return {position: getComputedStyle(element).position, rect: {top: rect.top, bottom: rect.bottom}, countTop: count.top, cancelTop: cancel.top, actionTop: action.top};
  });
  expect(geometry.position).toBe("fixed");
  expect(geometry.cancelTop).toBe(geometry.actionTop);
  await bar.getByRole("button", {name: "Cancelar"}).click();
  await expect(bar).toHaveCount(0);
  await expect(review.getByRole("button", {name: "Seleccionar", exact: true})).toBeFocused();
});

test("mantiene el CTA individual dentro del footer de la tarjeta", {tag: ["@selection", "@responsive", "@critical", "@full"]}, async ({page}) => {
  for (const width of [320, 390, 393, 768, 1280] as const) {
    const review = await openReview(page, width);
    const prepared = review.locator('[data-review-item="review-new-prepared"]');
    const geometry = await prepared.evaluate((card) => {
      const cardRect = card.getBoundingClientRect();
      const buttonRect = card.querySelector<HTMLElement>('[data-review-decision-action]')!.getBoundingClientRect();
      const detailsRect = card.querySelector<HTMLElement>(".ui-review-transaction-card__secondary-actions")!.getBoundingClientRect();
      return {bottomGap: cardRect.bottom - buttonRect.bottom, rightInset: cardRect.right - buttonRect.right, leftInset: detailsRect.left - cardRect.left};
    });
    expect(geometry.bottomGap).toBeGreaterThanOrEqual(8);
    expect(geometry.rightInset).toBeGreaterThanOrEqual(8);
    expect(geometry.leftInset).toBeGreaterThanOrEqual(8);
  }
});

test("reserva la barra bulk al final de la cola en 390 y 320", {tag: ["@selection", "@responsive", "@critical", "@full"]}, async ({page}) => {
  for (const width of [390, 320] as const) {
    const review = await openReview(page, width);
    await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
    await review.locator('[data-review-item="review-batch-a"] input[type="checkbox"]').check();
    const bar = review.locator("[data-review-selection-bar]");
    await bar.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const geometry = await review.evaluate((root) => {
      const barRect = root.querySelector<HTMLElement>("[data-review-selection-bar]")!.getBoundingClientRect();
      const lastRect = root.querySelector<HTMLElement>(".ui-review-archetype__queue [data-review-item]:last-child")!.getBoundingClientRect();
      const style = getComputedStyle(root.querySelector<HTMLElement>("[data-review-selection-bar]")!);
      return {lastBottom: lastRect.bottom, barTop: barRect.top, display: style.display, overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth};
    });
    expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.barTop + 1);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    if (width === 320) expect(geometry.display).toBe("grid");
  }
});

test("usa una fila en 390 y dos filas explícitas en 320 para el bulk", {tag: ["@selection", "@responsive", "@critical", "@full"]}, async ({page}) => {
  for (const width of [390, 320] as const) {
    const review = await openReview(page, width);
    await review.getByRole("button", {name: "Seleccionar", exact: true}).click();
    const bar = review.locator("[data-review-selection-bar]");
    const geometry = await bar.evaluate((element) => {
      const cancel = element.querySelector<HTMLElement>(".ui-review-archetype__selection-cancel")!.getBoundingClientRect();
      const action = element.querySelector<HTMLElement>("[data-review-bulk-action]")!.getBoundingClientRect();
      const barRect = element.getBoundingClientRect();
      return {barTop: barRect.top, barBottom: barRect.bottom, cancelTop: cancel.top, cancelBottom: cancel.bottom, actionTop: action.top, actionBottom: action.bottom, actionWidth: action.width, barWidth: barRect.width, background: getComputedStyle(element).backgroundColor, shadow: getComputedStyle(element).boxShadow};
    });
    if (width === 390) {
      expect(geometry.actionTop).toBe(geometry.cancelTop);
      expect(geometry.actionWidth).toBeLessThan(geometry.barWidth - 16);
    } else {
      expect(geometry.actionTop).toBeGreaterThanOrEqual(geometry.cancelBottom);
      expect(geometry.actionWidth).toBeGreaterThanOrEqual(geometry.barWidth - 16);
    }
    expect(geometry.barBottom).toBeLessThanOrEqual(900);
    expect(geometry.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(geometry.shadow).toBe("none");
  }
});
