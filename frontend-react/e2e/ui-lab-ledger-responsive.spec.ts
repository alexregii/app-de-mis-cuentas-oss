import {expect, test} from "playwright/test";
import {expectLedgerGeometry, expectOpenOverlayWithinViewport, expectPaginationGeometry, expectSelectionStates, expectSelectionToolbarGeometry, openLedger, viewports} from "./ui-lab-helpers";

test("el ledger preserva sus invariantes móviles en todos los viewports obligatorios", {tag: ["@responsive", "@critical"]}, async ({page}) => {
  test.setTimeout(90_000);
  for (const width of viewports) {
    await page.setViewportSize({width, height: 900});
    await openLedger(page, `mineral-${width}`);
    await page.getByRole("button", {name: "Probar contenido largo"}).click();
    await expectLedgerGeometry(page);
    await expect(page.locator(".ui-statement-ledger__row > time").first()).toBeVisible();
    await expect(page.locator(".ui-statement-ledger__row > time").first()).toHaveText(/\d{1,2}\/\d{1,2}\/\d{4}/);
    await expectOpenOverlayWithinViewport(page, /Periodo:/);
    await expectOpenOverlayWithinViewport(page, "Filtros");
    await page.getByRole("button", {name: "Seleccionar"}).click();
    await expect(page.locator(".ui-ledger-filter-strip details[open]")).toHaveCount(0);
    await expect(page.getByRole("button", {name: "Seleccionar"})).toHaveCount(0);
    await expect(page.getByLabel("Búsqueda")).toBeDisabled();
    await expect(page.getByRole("button", {name: /Periodo:/ })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", {name: "Filtros", exact: true})).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("checkbox", {name: "Seleccionar Ingreso extraordinario con una descripción deliberadamente extensa para comprobar la lectura móvil", exact: true}).click();
    await page.getByRole("checkbox", {name: "Seleccionar Gasto con descripción extensa para comprobar que el importe negativo conserva su columna", exact: true}).click();
    await expect(page.getByRole("region", {name: "Acciones de selección"})).toContainText("2 seleccionados");
    await expectLedgerGeometry(page);
    await expectSelectionToolbarGeometry(page);
    if (width === 393 || width === 1280) await expectSelectionStates(page);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const toolbarTop = await page.getByRole("region", {name: "Acciones de selección"}).evaluate((toolbar) => toolbar.getBoundingClientRect().top);
    expect(toolbarTop).toBeGreaterThanOrEqual(0);
    if ([320, 393, 768, 1280].includes(width)) {
      await page.getByRole("button", {name: "Cancelar selección"}).click();

    }
  }
});

test("Basalt Ledger v2 conserva selección a 393px y desktop", {tag: ["@responsive", "@full"]}, async ({page}) => {
  test.setTimeout(90_000);
  for (const width of [393, 1280]) {
    await page.setViewportSize({width, height: 900});
    await openLedger(page, `basalt-${width}`);
    await page.getByLabel("Tema del experimento").selectOption("basalt");
    await expectLedgerGeometry(page);
    await expectOpenOverlayWithinViewport(page, "Filtros");
    await page.getByRole("button", {name: "Seleccionar"}).click();
    await expect(page.locator(".ui-ledger-filter-strip details[open]")).toHaveCount(0);
    await page.getByRole("checkbox", {name: "Seleccionar Nómina septiembre 2026", exact: true}).click();
    await expectSelectionStates(page);
    await expectLedgerGeometry(page);
    await expectSelectionToolbarGeometry(page);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const toolbarTop = await page.getByRole("region", {name: "Acciones de selección"}).evaluate((toolbar) => toolbar.getBoundingClientRect().top);
    expect(toolbarTop).toBeGreaterThanOrEqual(0);
    await page.getByRole("button", {name: "Cancelar selección"}).click();

  }
});

test.describe("reflow de totales largos M6", {tag: ["@responsive", "@full"]}, () => {
  test.use({hasTouch: true});
  for (const theme of ["mineral", "basalt"]) {
    test(theme, async ({page}) => {
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({width, height: 900});
        await openLedger(page, "long-total-" + theme + "-" + width);
        await page.getByLabel("Tema del experimento").selectOption(theme);
        // Stress de presentación: el consumidor entrega este texto numérico;
        // no se simulan un millón de movimientos ni llamadas de datos.
        await page.getByRole("navigation", {name: "Páginas de movimientos"}).getByRole("status").evaluate((status) => {
          status.textContent = "999921–999928 de 1000000 movimientos";
        });
        await expectPaginationGeometry(page);
      }
    });
  }
});
