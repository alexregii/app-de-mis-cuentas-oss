import {expect, test} from "playwright/test";
import {openApp} from "./helpers";

for (const width of [390, 1280]) {
  test(`las pantallas inactivas no reciben foco ni alargan el scroll a ${width}px${width === 390 ? " @webkit-only" : " @chromium-only"}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await openApp(page, "/");
    await expect(page.locator('[data-cached-tab="transactions"]')).toBeAttached();

    const navigation = width < 1024
      ? page.getByRole("navigation", {name: "Navegación principal"})
      : page.getByRole("navigation", {name: "Navegación principal de escritorio"});
    await navigation.getByRole("button", {name: "Movimientos", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toBeVisible();
    const activeTransactions = page.locator('[data-cached-tab="transactions"]');
    const transactionControl = activeTransactions.locator("button").first();
    await transactionControl.focus();
    await expect(transactionControl).toBeFocused();

    const reviewNavigation = navigation.getByRole("button", {name: "Revisión", exact: true});
    await reviewNavigation.focus();
    await reviewNavigation.press("Enter");
    await expect(reviewNavigation).toBeFocused();

    const inactiveScreen = page.locator('[data-cached-tab="transactions"].database-screen-cache__inactive');
    await expect(inactiveScreen).toBeAttached();
    await expect(inactiveScreen).toHaveAttribute("aria-hidden", "true");
    expect(await inactiveScreen.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
    await expect(page.getByRole("heading", {name: "Revisión", exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Movimientos", exact: true})).toHaveCount(0);
    expect(await inactiveScreen.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab");
      expect(await inactiveScreen.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });

    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await inactiveScreen.evaluate((element) => {
      const oversizedContent = document.createElement("div");
      oversizedContent.style.height = "5000px";
      element.appendChild(oversizedContent);
    });

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(scrollHeight + 100);
  });
}

test("la navegación reduce el movimiento espacial cuando el usuario lo solicita @webkit-only", async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await page.emulateMedia({reducedMotion: "reduce"});
  await openApp(page, "/");

  const planningNavigation = page.getByRole("navigation", {name: "Navegación principal de escritorio"}).getByRole("button", {name: "Plan", exact: true});
  await planningNavigation.focus();
  await planningNavigation.press("Enter");
  await expect(page.getByRole("heading", {name: "Plan", exact: true})).toBeVisible();
  const planningPage = page.locator(".motion-page").filter({has: page.getByRole("heading", {name: "Plan", exact: true})});
  await expect.poll(() => planningPage.evaluate((element) => ({opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform}))).toEqual({opacity: "1", transform: "none"});
});

test("la navegación anima la sección si el usuario permite movimiento @chromium-only", async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await page.emulateMedia({reducedMotion: "no-preference"});
  await openApp(page, "/");

  const dashboardPage = page.locator(".motion-page").filter({has: page.getByRole("heading", {name: "Resumen", exact: true})});
  await expect.poll(() => dashboardPage.evaluate((element) => getComputedStyle(element).transform === "none" && getComputedStyle(element).opacity === "1")).toBe(true);
  await page.evaluate(() => {
    const probe = window as Window & {sectionMotionObserved?: boolean};
    let frames = 0;
    const sample = () => {
      const pages = [...document.querySelectorAll<HTMLElement>(".motion-page:not(.database-screen-cache__inactive)")];
      if (pages.some((element) => getComputedStyle(element).transform !== "none" || getComputedStyle(element).opacity !== "1")) probe.sectionMotionObserved = true;
      if (!probe.sectionMotionObserved && frames++ < 45) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const planningNavigation = page.getByRole("navigation", {name: "Navegación principal de escritorio"}).getByRole("button", {name: "Plan", exact: true});
  await planningNavigation.focus();
  await planningNavigation.press("Enter");
  await expect(page.getByRole("heading", {name: "Plan", exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & {sectionMotionObserved?: boolean}).sectionMotionObserved)).toBe(true);
});
