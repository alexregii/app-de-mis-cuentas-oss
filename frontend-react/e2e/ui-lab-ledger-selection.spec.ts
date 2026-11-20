import {expect, test} from "playwright/test";
import {expectLedgerGeometry, expectSameHorizontalPosition, expectSameVerticalLayout, ledgerContentAmountPosition, openLedger, resetLedgerScroll, selectionToolbarLayout} from "./ui-lab-helpers";

const ctaScenarios = [
  {touch: false, width: 1280, theme: "mineral", tags: ["@critical"]},
  {touch: true, width: 393, theme: "mineral", tags: ["@focused", "@critical"]},
  {touch: true, width: 320, theme: "basalt", tags: ["@full"]},
  {touch: true, width: 1280, theme: "basalt", tags: ["@full"]},
];

for (const touch of [false, true]) {
  test.describe(touch ? "continuidad CTA · touch" : "continuidad CTA · keyboard", {tag: "@selection"}, () => {
    test.use({hasTouch: touch});
    for (const scenario of ctaScenarios.filter(({touch: scenarioTouch}) => scenarioTouch === touch)) {
      test(`${scenario.theme} / ${scenario.width}`, {tag: scenario.tags}, async ({page}, testInfo) => {
        await page.setViewportSize({width: scenario.width, height: 900});
        await openLedger(page, `cta-${scenario.theme}-${scenario.width}`);
        await page.getByLabel("Tema del experimento").selectOption(scenario.theme);
        const browseLayout = await selectionToolbarLayout(page);
        const button = page.locator(".ui-selection-toolbar__toggle");
        const motion = await page.locator(".ui-statement-ledger__row").first().evaluate((row) => {
          const selection = row.querySelector<HTMLElement>(".ui-statement-ledger__selection")!;
          const menu = row.querySelector<HTMLElement>(".ui-statement-ledger__menu")!;
          const menuStyle = getComputedStyle(menu);
          return {
            selection: getComputedStyle(selection).transitionProperty,
            menu: menuStyle.transitionProperty,
            menuDuration: Number.parseFloat(menuStyle.transitionDuration),
            menuVisibilityDelay: Number.parseFloat(menuStyle.transitionDelay.split(",").slice(-1)[0].trim()),
          };
        });
        expect(motion.selection).toContain("opacity");
        expect(motion.selection).toContain("transform");
        expect(motion.menu).toContain("opacity");
        expect(motion.menuDuration).toBeGreaterThanOrEqual(0.14);
        expect(motion.menuVisibilityDelay).toBeLessThanOrEqual(0.01);
        const original = await button.elementHandle();
        const position = () => button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height};
        });
        await button.focus();
        const before = await position();
        const ledgerBefore = await ledgerContentAmountPosition(page);
        await button.press("Enter");
        await expect(page.getByRole("region", {name: "Acciones de selección"})).toBeVisible();
        await expect(button).toHaveText("Cancelar");
        await expect(button).toBeFocused();
        expectSameVerticalLayout(await selectionToolbarLayout(page), browseLayout);
        await expectLedgerGeometry(page);
        const suspendedMenu = await page.locator(".ui-statement-ledger__menu").first().evaluate((menu) => {
          const trigger = menu.querySelector<HTMLButtonElement>(".ui-overflow-menu__trigger")!;
          const style = getComputedStyle(menu);
          return {triggerDisplay: getComputedStyle(trigger).display, pointerEvents: style.pointerEvents, visibility: style.visibility, visibilityDelay: Number.parseFloat(style.transitionDelay.split(",").slice(-1)[0].trim()), tabIndex: trigger.tabIndex, ariaHidden: menu.getAttribute("aria-hidden")};
        });
        expect(suspendedMenu.triggerDisplay).not.toBe("none");
        expect(suspendedMenu.pointerEvents).toBe("none");
        expect(suspendedMenu.tabIndex).toBe(-1);
        expect(suspendedMenu.ariaHidden).toBe("true");
        expect(suspendedMenu.visibilityDelay).toBeGreaterThanOrEqual(0.14);
        if ([393, 1280].includes(scenario.width)) await page.screenshot({path: testInfo.outputPath("selection.png"), fullPage: false});
        expect(await position()).toEqual(before);
        expectSameHorizontalPosition(await ledgerContentAmountPosition(page), ledgerBefore);
        expect(await button.evaluate((element, previous) => element === previous, original)).toBe(true);
        await expect(page.getByRole("button", {name: "Cancelar selección"})).toHaveCount(1);
        await button.press("Enter");
        await expect(button).toHaveText("Seleccionar");
        await expect(button).toBeFocused();
        expectSameVerticalLayout(await selectionToolbarLayout(page), browseLayout);
        expect(await position()).toEqual(before);
        expectSameHorizontalPosition(await ledgerContentAmountPosition(page), ledgerBefore);
        const restoredMenuMotion = await page.locator(".ui-statement-ledger__menu").first().evaluate((menu) => Number.parseFloat(getComputedStyle(menu).transitionDelay.split(",").slice(-1)[0].trim()));
        expect(restoredMenuMotion).toBeLessThanOrEqual(0.01);
        await expect(page.getByRole("region", {name: "Acciones de selección"})).toHaveCount(0);
        await expectLedgerGeometry(page);
        if (touch) {
          await button.tap();
          await expect(button).toBeFocused();
          await expect(button).toHaveText("Cancelar");
          expect(await position()).toEqual(before);
          await button.tap();
          await expect(button).toBeFocused();
          await expect(button).toHaveText("Seleccionar");
        }
      });
    }
  });
}

const persistentScenarios = [
  {touch: true, width: 393, theme: "mineral", state: {count: 2, availability: "mixed"}, tags: ["@critical"]},
  {touch: false, width: 1280, theme: "basalt", state: {count: 2, availability: "blocked"}, tags: ["@full"]},
];

for (const touch of [false, true]) {
  test.describe(touch ? "salida persistente · touch" : "salida persistente · keyboard", {tag: "@selection"}, () => {
    test.use({hasTouch: touch});
    for (const scenario of persistentScenarios.filter(({touch: scenarioTouch}) => scenarioTouch === touch)) {
      test(`${scenario.theme} / ${scenario.width} / ${scenario.state.availability}`, {tag: scenario.tags}, async ({page}, testInfo) => {
        const {state} = scenario;
        await page.setViewportSize({width: scenario.width, height: 700});
        await openLedger(page, `persistent-exit-${scenario.theme}-${scenario.width}`);
        await page.getByLabel("Tema del experimento").selectOption(scenario.theme);
        await resetLedgerScroll(page);
        await page.locator("main.ui-lab").evaluate((root) => root.classList.remove("ui-input-modality"));
        await page.getByRole("button", {name: "Probar contenido largo"}).click();
        await page.getByLabel("Disponibilidad masiva").selectOption(state.availability);
        await resetLedgerScroll(page);
        const browseLayout = await selectionToolbarLayout(page);
        const button = page.getByRole("button", {name: "Seleccionar", exact: true});
        if (touch) await button.tap();
        else { await button.focus(); await button.press("Enter"); }
        const cancel = page.getByRole("button", {name: "Cancelar selección", exact: true});
        await expect(cancel).toBeFocused();
        await resetLedgerScroll(page);
        const emptySelectionLayout = await selectionToolbarLayout(page);
        expectSameVerticalLayout(emptySelectionLayout, browseLayout);
        await expect(cancel).toHaveCSS("outline-style", touch ? "none" : "solid");
        if (!touch) expect(await cancel.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
        for (let index = 0; index < state.count; index++) await page.getByRole("checkbox").nth(index).click();
        const selectedLayout = await selectionToolbarLayout(page);
        expect(selectedLayout.toolbarHeight).toBeGreaterThanOrEqual(emptySelectionLayout.toolbarHeight - 0.5);
        const toolbar = page.getByRole("region", {name: "Acciones de selección"});
        await expect(toolbar).toContainText(`${state.count} seleccionados`);
        if (state.availability === "blocked") await expect(toolbar).toContainText("No hay acciones disponibles");
        if (state.availability === "mixed") {
          await toolbar.getByRole("button", {name: "Categorizar"}).focus();
          await toolbar.getByRole("button", {name: "Categorizar"}).press("Enter");
          await expect(toolbar).toContainText("La selección contiene movimientos no compatibles");
        }
        await cancel.focus();
        await page.evaluate(async () => {
          scrollTo(0, document.documentElement.scrollHeight);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        const exit = await cancel.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {top: rect.top, bottom: rect.bottom, viewport: innerHeight, reachable: hit === element || element.contains(hit), scrolled: scrollY};
        });
        expect(exit.scrolled).toBeGreaterThan(200);
        expect(exit.top).toBeGreaterThanOrEqual(0);
        expect(exit.bottom).toBeLessThanOrEqual(exit.viewport);
        expect(exit.reachable).toBe(true);
        await expect(page.getByRole("button", {name: "Cancelar selección"})).toHaveCount(1);
        if (touch) await cancel.tap();
        else await cancel.press("Enter");
        await expect(page.getByRole("region", {name: "Acciones de selección"})).toHaveCount(0);
        await expect(page.getByRole("checkbox")).toHaveCount(0);
        const restored = page.getByRole("button", {name: "Seleccionar", exact: true});
        await expect(restored).toBeFocused();
        await expect(restored).toHaveCSS("outline-style", touch ? "none" : "solid");
        const after = await restored.boundingBox();
        expect(after!.y).toBeGreaterThanOrEqual(0);
        expect(after!.y + after!.height).toBeLessThanOrEqual(700);
        if (state.availability === "mixed") await page.screenshot({path: testInfo.outputPath("scrolled-selection.png"), fullPage: false});
      });
    }
  });
}
