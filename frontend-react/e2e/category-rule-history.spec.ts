import {expect, test} from "playwright/test";
import {installPageErrorGuard, openApp} from "./helpers";

test("el historial de reglas conserva aplicación y undo tras navegar y volver a entrar @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  let status: "completed" | "undone" = "completed";
  const application = () => ({
    id: 17,
    rule_id: 3,
    rule_description: "Regla Mercado demo",
    applied_at: "2026-10-23T12:00:00+00:00",
    status,
    reversible: status === "completed",
    target_category_id: 2,
    transactions: 2,
    bank_rows: 1,
    csv_rows: 0,
    total: 3,
  });
  const history = [
    ...Array.from({length: 20}, (_, index) => ({
      ...application(),
      id: 100 + index,
      rule_description: `Regla anterior ${index + 1}`,
    })),
    application(),
  ];
  await page.route("**/api/category-rule-applications/**", (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const applications = history.slice(offset, offset + limit).map((item) => item.id === 17 ? application() : item);
    const nextOffset = offset + applications.length < history.length ? offset + applications.length : null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({applications, next_offset: nextOffset}),
    });
  });
  await page.route("**/api/category-rules/3/undo/17/", (route) => {
    status = "undone";
    return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, partial: false, application_id: 17})});
  });

  await openApp(page, "/?tab=settings&settings_section=classification");
  const settings = page.locator(".settings-view");
  await settings.getByRole("button", {name: "Reglas y sugerencias", exact: true}).click();
  const historyPanel = settings.locator(".rule-application-history");
  await expect(historyPanel.getByText("Regla anterior 1", {exact: true})).toBeVisible();
  await historyPanel.getByRole("button", {name: "Cargar más aplicaciones"}).click();
  const targetRow = historyPanel.locator(".list-card", {hasText: "Regla Mercado demo"});
  await expect(targetRow.getByText(/3 registros/)).toBeVisible();
  const undo = targetRow.getByRole("button", {name: "Deshacer aplicación"});
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(targetRow.getByRole("button", {name: "Deshecha"})).toBeFocused();
  await expect(page.getByText("Aplicación deshecha.")).toBeVisible();

  await page.reload();
  const reopenedSettings = page.locator(".settings-view");
  await reopenedSettings.getByRole("button", {name: "Reglas y sugerencias", exact: true}).click();
  const persisted = reopenedSettings.locator(".rule-application-history");
  await persisted.getByRole("button", {name: "Cargar más aplicaciones"}).click();
  const persistedRow = persisted.locator(".list-card", {hasText: "Regla Mercado demo"});
  await expect(persistedRow.getByText("Regla Mercado demo")).toBeVisible();
  await expect(persisted.getByRole("button", {name: "Deshecha"})).toBeVisible();
  await expect(persistedRow.getByRole("button", {name: "Deshacer aplicación"})).toHaveCount(0);
  assertNoPageErrors();
});
