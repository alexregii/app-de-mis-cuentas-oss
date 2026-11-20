import {expect, test, type Page} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

const boundaryGroups = [
  {
    widths: [320, 390],
    sections: [["settings", "Ajustes"]],
  },
  {
    widths: [367, 368, 369],
    sections: [["dashboard", "Resumen"]],
  },
  {
    widths: [639, 640, 641],
    sections: [
      ["transactions", "Movimientos"],
      ["review", "Revisión"],
      ["statistics", "Estadísticas"],
    ],
  },
  {
    widths: [719, 720, 721],
    sections: [
      ["dashboard", "Resumen"],
      ["settings", "Ajustes"],
    ],
  },
  {
    widths: [767, 768, 769],
    sections: [
      ["dashboard", "Resumen"],
      ["statistics", "Estadísticas"],
    ],
  },
  {
    widths: [1023, 1024, 1025],
    sections: [["dashboard", "Resumen"]],
  },
] as const;

const waitForSettledView = async (page: Page, heading: string) => {
  const viewHeading = heading === "Resumen"
    ? page.locator("#main-content .dashboard-operational-header")
    : page.getByRole("heading", {name: heading, exact: true});
  await expect(viewHeading).toBeVisible();
  await expect(page.locator('#main-content [aria-busy="true"]')).toHaveCount(0);
  if (heading === "Estadísticas") {
    await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
    await expect(page.getByLabel("Mes para profundizar")).toBeVisible();
    await expect(page.getByRole("navigation", {name: "Abrir movimientos por familia principal"})).toBeVisible();
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
};

const statisticsQueryKeys = ["period", "basis", "date_from", "date_to", "month"] as const;

const navigateToSection = async (page: Page, section: string, heading: string) => {
  if (await page.getByRole("heading", {name: heading, exact: true}).isVisible()) return;

  const beforeNavigation = new URL(page.url());
  const statisticsQuery = Object.fromEntries(
    statisticsQueryKeys
      .map((key) => [key, beforeNavigation.searchParams.get(key)] as const)
      .filter((entry): entry is readonly [typeof statisticsQueryKeys[number], string] => entry[1] !== null),
  );
  const desktopNavigation = page.locator(".desktop-rail .rail-nav");
  const usesDesktopNavigation = await desktopNavigation.isVisible();
  const labels: Record<string, string> = {
    dashboard: "Resumen",
    transactions: "Movimientos",
    review: "Revisión",
    statistics: "Estadísticas",
  };
  if (!usesDesktopNavigation && section === "settings") {
    await page.locator(".bottom-nav").getByRole("button", {name: "Más", exact: true}).click();
    await page.getByRole("dialog", {name: "Más secciones"}).getByRole("button", {name: "Ajustes", exact: true}).click();
  } else {
    const navigation = usesDesktopNavigation ? desktopNavigation : page.locator(".bottom-nav");
    await navigation.getByRole("button", {name: labels[section], exact: true}).click();
  }
  await expect(page).toHaveURL((url) => (
    url.pathname === "/"
    && (section === "dashboard" ? !url.searchParams.has("tab") : url.searchParams.get("tab") === section)
  ));
  if (section === "dashboard") {
    const afterNavigation = new URL(page.url());
    for (const [key, value] of Object.entries(statisticsQuery)) {
      expect(afterNavigation.searchParams.get(key), `Resumen debe conservar el filtro estadístico ${key}`).toBe(value);
    }
  }
};

const inspectResponsiveSurface = (page: Page) => page.evaluate(() => {
  const root = document.documentElement;
  const body = document.body;
  const viewportWidth = root.clientWidth;
  const documentWidth = Math.max(root.scrollWidth, body.scrollWidth);
  const controlSelector = [
    "button",
    "a[href]",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "[contenteditable=true]",
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="radio"]',
    '[role="searchbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[role="treeitem"]',
  ].join(",");

  const hasText = (value: string | null | undefined) => Boolean(value?.replace(/\s+/g, " ").trim());
  const hasAccessibleName = (element: Element) => {
    if (hasText(element.getAttribute("aria-label"))) return true;

    const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
    if (labelledBy.some((id) => {
      const label = document.getElementById(id);
      return label && (hasText(label.textContent) || hasText(label.getAttribute("aria-label")));
    })) return true;

    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if ([...element.labels].some((label) => hasText(label.textContent))) return true;
      if (element instanceof HTMLInputElement && ["button", "reset", "submit"].includes(element.type) && hasText(element.value)) return true;
      if (element instanceof HTMLInputElement && element.type === "image" && hasText(element.alt)) return true;
      if (hasText(element.placeholder)) return true;
    }

    if (hasText(element.textContent) || hasText(element.getAttribute("title"))) return true;
    return [...element.querySelectorAll("img")].some((image) => hasText(image.alt));
  };

  const unnamedControls = [...document.querySelectorAll(controlSelector)]
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    })
    .filter((element) => !hasAccessibleName(element))
    .map((element) => {
      const role = element.getAttribute("role");
      const identity = element.id ? `#${element.id}` : [...element.classList].slice(0, 2).map((name) => `.${name}`).join("");
      return `${element.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${identity}`;
    });

  return {documentWidth, viewportWidth, unnamedControls};
});

test("los puntos de corte críticos mantienen layout y controles accesibles", {tag: "@app-critical"}, async ({page}) => {
  test.setTimeout(90_000);
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: boundaryGroups[0].widths[0], height: 900});
  await openApp(page);

  for (const {widths, sections} of boundaryGroups) {
    await page.setViewportSize({width: widths[0], height: 900});
    for (const [section, heading] of sections) {
      await navigateToSection(page, section, heading);
      await waitForSettledView(page, heading);
      for (const width of widths) {
        await page.setViewportSize({width, height: 900});
        await waitForSettledView(page, heading);
        const surface = await inspectResponsiveSurface(page);
        const context = `${heading} a ${width}px`;

        expect.soft(
          surface.documentWidth,
          `${context} no debe desbordar horizontalmente (viewport ${surface.viewportWidth}px)`,
        ).toBeLessThanOrEqual(surface.viewportWidth);
        expect.soft(surface.unnamedControls, `${context} no debe exponer controles visibles sin nombre`).toEqual([]);
      }
    }
  }

  assertNoPageErrors();
});

test("Movimientos no agranda el título al bajar de 23rem @chromium-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  const titleSizes: number[] = [];
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, "/?tab=transactions");
  await waitForSettledView(page, "Movimientos");

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({width, height: 900});
    const surface = await page
      .locator("#main-content")
      .getByRole("heading", {name: "Movimientos", exact: true})
      .evaluate((title) => ({
      fontSize: Number.parseFloat(getComputedStyle(title).fontSize),
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
    }));
    titleSizes.push(surface.fontSize);
    expect(surface.documentWidth).toBeLessThanOrEqual(surface.viewportWidth);
  }

  expect(titleSizes[0]).toBeLessThanOrEqual(titleSizes[2]);
  expect(titleSizes[1]).toBeLessThanOrEqual(titleSizes[2]);
  assertNoPageErrors();
});

test("el catálogo de categorías conserva acciones táctiles ordenadas en móvil @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 320, height: 900});
  await openApp(page, "/?tab=settings&settings_section=classification");
  await waitForSettledView(page, "Ajustes");

  const firstRow = page.locator(".catalog-row").first();
  const actions = firstRow.locator(".catalog-row-actions");
  await expect(firstRow).toBeVisible();
  await expect(actions).toBeVisible();

  const geometry = await firstRow.evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const actionGroup = row.querySelector<HTMLElement>(".catalog-row-actions");
    const actionRect = actionGroup?.getBoundingClientRect();
    const buttons = actionGroup ? [...actionGroup.querySelectorAll<HTMLElement>("button")] : [];
    return {
      row: {left: rowRect.left, right: rowRect.right},
      actions: actionRect ? {left: actionRect.left, right: actionRect.right} : null,
    };
  });

  expect(geometry.actions).not.toBeNull();
  expect(geometry.actions!.left).toBeGreaterThanOrEqual(geometry.row.left);
  expect(geometry.actions!.right).toBeLessThanOrEqual(geometry.row.right);
  await expect.poll(() => firstRow.evaluate((row) => {
    const heights = [...row.querySelectorAll<HTMLElement>(".catalog-row-actions button")]
      .filter((button) => {
        const style = getComputedStyle(button);
        return style.display !== "none" && style.visibility !== "hidden" && button.getClientRects().length > 0;
      })
      .map((button) => button.getBoundingClientRect().height);
    return heights.length ? Math.min(...heights) : 0;
  })).toBeGreaterThanOrEqual(44);
  assertNoPageErrors();
});

test("el catálogo no recorta contenido en una web app de iPhone 16 @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 393, height: 852});
  await openApp(page, "/?tab=settings&settings_section=classification");
  await waitForSettledView(page, "Ajustes");

  const overflow = await page.locator(".settings-catalog-context").evaluate((panel) => {
    const manager = panel.querySelector<HTMLElement>(".catalog-manager");
    const filters = panel.querySelector<HTMLElement>(".catalog-filters");
    return {
      panel: panel.scrollWidth - panel.clientWidth,
      manager: manager ? manager.scrollWidth - manager.clientWidth : null,
      filters: filters ? filters.scrollWidth - filters.clientWidth : null,
    };
  });

  expect(overflow).toEqual({panel: 0, manager: 0, filters: 0});
  assertNoPageErrors();
});

test("el rail desktop se contrae con teclado, conserva accesibilidad y persiste la preferencia @webkit-only", async ({page}) => {
  test.setTimeout(90_000);
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 1024, height: 900});
  await openApp(page, "/");
  const storedLocalStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

  const rail = page.locator("#desktop-rail, aside.desktop-rail").first();
  const compactState = page.locator(".app-frame.is-rail-collapsed");
  const desktopToggle = () => page.getByRole("button", {name: "Contraer barra lateral", exact: true});
  const expandedToggle = () => page.getByRole("button", {name: "Expandir barra lateral", exact: true});

  try {
    for (const width of [1024, 1280]) {
      await page.evaluate(() => localStorage.clear());
      await page.setViewportSize({width, height: 900});
      await openApp(page);

      await expect(rail).toBeVisible();
      await expect(desktopToggle()).toBeVisible();
      await expect(desktopToggle()).toHaveAttribute("aria-controls", "desktop-rail");
      await expect(desktopToggle()).toHaveAttribute("aria-expanded", "true");

      const before = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>(".app-frame");
        const railElement = document.querySelector<HTMLElement>("#desktop-rail, aside.desktop-rail");
        const content = document.querySelector<HTMLElement>("#main-content");
        return {
          railWidth: railElement?.getBoundingClientRect().width ?? 0,
          contentWidth: content?.getBoundingClientRect().width ?? 0,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          frameWidth: frame?.getBoundingClientRect().width ?? 0,
        };
      });
      expect(before.railWidth).toBeGreaterThan(0);
      expect(before.frameWidth).toBeLessThanOrEqual(width);

      await desktopToggle().focus();
      await page.keyboard.press("Enter");
      await expect(expandedToggle()).toBeVisible();
      await expect(expandedToggle()).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => compactState.count()).toBeGreaterThan(0);
      await expect.poll(async () => page.evaluate(() => {
        const railElement = document.querySelector<HTMLElement>("#desktop-rail, aside.desktop-rail");
        return railElement?.getBoundingClientRect().width ?? 0;
      })).toBeLessThan(before.railWidth);

      const after = await page.evaluate(() => {
        const railElement = document.querySelector<HTMLElement>("#desktop-rail, aside.desktop-rail");
        const content = document.querySelector<HTMLElement>("#main-content");
        return {
          railWidth: railElement?.getBoundingClientRect().width ?? 0,
          contentWidth: content?.getBoundingClientRect().width ?? 0,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        };
      });
      expect(after.railWidth).toBeLessThan(before.railWidth);
      expect(after.contentWidth).toBeGreaterThan(before.contentWidth);
      expect(after.documentWidth).toBeLessThanOrEqual(width);
      await expect(rail.getByRole("button", {name: "Resumen", exact: true})).toBeVisible();

      await page.reload();
      await expect(page.locator("#main-content")).toBeVisible();
      await expect(expandedToggle()).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => compactState.count()).toBeGreaterThan(0);
      await expect(rail.getByRole("button", {name: "Resumen", exact: true})).toBeVisible();
    }

    await page.setViewportSize({width: 390, height: 852});
    await page.reload();
    await expect(page.locator("#desktop-rail, aside.desktop-rail")).toBeHidden();
    await expect(page.getByRole("button", {name: /barra lateral/i})).toBeHidden();
  } finally {
    await page.evaluate((snapshot) => {
      localStorage.clear();
      for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
    }, storedLocalStorage);
  }

  assertNoPageErrors();
});
