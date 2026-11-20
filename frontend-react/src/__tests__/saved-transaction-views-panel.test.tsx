import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {BootstrapPayload} from "../shared/model/bootstrap";
import {SavedTransactionViewsPanel} from "../features/transactions/SavedTransactionViewsPanel";
import {readSavedTransactionViews, savedTransactionViewFilters, writeSavedTransactionViews} from "../features/transactions/savedTransactionViews";
import type {TransactionUrlFilters} from "../features/transactions/transactionModel";

const filters: TransactionUrlFilters = {
  query: "supermercado",
  month: "2026-08",
  dateFrom: "",
  dateTo: "",
  kind: "expense",
  account: "4",
  category: "8",
  categoryFamily: "",
  source: "manual",
  analytics: "included",
  statisticsAttribution: "",
  page: 4,
};

const bootstrap = {
  accounts: [{id: 4, name: "Principal", active: true}],
  categories: [{id: 8, display_name: "Hogar", active: true, merged_into: null}],
} as unknown as BootstrapPayload;

const renderPanel = (overrides: Partial<Parameters<typeof SavedTransactionViewsPanel>[0]> = {}) => render(
  <SavedTransactionViewsPanel filters={filters} bootstrap={bootstrap} canSave onOpenView={vi.fn()} {...overrides} />,
);

describe("saved transaction views panel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("saves criteria and opens the equivalent URL without calling a finance mutation", () => {
    const openView = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderPanel({onOpenView: openView});

    fireEvent.click(screen.getByRole("button", {name: "Guardar filtros actuales"}));
    const name = screen.getByRole("textbox", {name: "Nombre de la vista"});
    expect(name).toHaveFocus();
    fireEvent.change(name, {target: {value: "Cierre mensual"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar vista"}));

    const saved = readSavedTransactionViews()[0];
    expect(saved).toMatchObject({name: "Cierre mensual", dateMode: "fixed"});
    expect(saved.filters).toEqual(savedTransactionViewFilters(filters));
    const raw = window.localStorage.getItem("miscuentas.session.transactions.saved-views.v1") || "";
    expect(raw).not.toMatch(/"amount"|"results"|"summary"|"total"/i);

    fireEvent.click(screen.getByRole("button", {name: "Abrir vista"}));
    expect(openView).toHaveBeenCalledOnce();
    const search = openView.mock.calls[0][0] as URLSearchParams;
    expect(Object.fromEntries(search)).toMatchObject({q: "supermercado", month: "2026-08", kind: "expense", account: "4", category: "8", source: "manual", analytics: "included"});
    expect(search.has("page")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renames and removes a saved view", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", {name: "Guardar filtros actuales"}));
    fireEvent.change(screen.getByRole("textbox", {name: "Nombre de la vista"}), {target: {value: "Gastos"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar vista"}));

    fireEvent.click(screen.getByRole("button", {name: "Renombrar"}));
    fireEvent.change(screen.getByRole("textbox", {name: "Nombre de la vista"}), {target: {value: "Gastos fijos"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar nombre"}));
    expect(readSavedTransactionViews()[0].name).toBe("Gastos fijos");

    fireEvent.click(screen.getByRole("button", {name: "Eliminar vista"}));
    expect(readSavedTransactionViews()).toEqual([]);
  });

  it("marks an empty view as an explicit reset of filters and pagination", () => {
    const openView = vi.fn();
    renderPanel({filters: {...filters, query: "", month: "", kind: "", account: "", category: "", source: "", analytics: "all", page: 8}, onOpenView: openView});
    fireEvent.click(screen.getByRole("button", {name: "Guardar filtros actuales"}));
    fireEvent.change(screen.getByRole("textbox", {name: "Nombre de la vista"}), {target: {value: "Todos"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar vista"}));
    fireEvent.click(screen.getByRole("button", {name: "Abrir vista"}));

    const search = openView.mock.calls[0][0] as URLSearchParams;
    expect(search.get("page")).toBe("1");
    expect(search.has("analytics")).toBe(false);
    expect(search.has("q")).toBe(false);
  });

  it("defaults the selected current month to relative and opens it at use time", () => {
    const openView = vi.fn();
    const currentMonth = new Date();
    const relativeFilters = {
      ...filters,
      month: `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`,
    };
    renderPanel({filters: relativeFilters, onOpenView: openView});
    fireEvent.click(screen.getByRole("button", {name: "Guardar filtros actuales"}));
    expect(screen.getByRole("checkbox", {name: "Usar el mes actual cuando abra esta vista"})).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", {name: "Nombre de la vista"}), {target: {value: "Este mes"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar vista"}));
    expect(readSavedTransactionViews()[0].dateMode).toBe("current-month");

    fireEvent.click(screen.getByRole("button", {name: "Abrir vista"}));
    expect(Object.fromEntries(openView.mock.calls[0][0] as URLSearchParams)).toMatchObject({month: relativeFilters.month});
  });

  it("explains inactive or retired references and restores focus when the editor is cancelled", async () => {
    const view = {
      id: "retired",
      name: "Cuenta retirada",
      filters: {...savedTransactionViewFilters(filters), account: "99", category: "98", categoryFamily: "97"},
      dateMode: "fixed" as const,
    };
    writeSavedTransactionViews([view]);
    const {rerender} = renderPanel({bootstrap: {...bootstrap, accounts: [{id: 99, name: "Archivada", active: false}]} as BootstrapPayload});
    fireEvent.change(screen.getByRole("combobox", {name: "Vistas guardadas"}), {target: {value: "retired"}});
    fireEvent.click(screen.getByRole("button", {name: "Abrir vista"}));
    expect(screen.getByRole("alert")).toHaveTextContent("cuenta #99");
    expect(screen.getByRole("alert")).toHaveTextContent("categoría #98");
    expect(screen.getByRole("alert")).toHaveTextContent("familia de categoría #97");

    rerender(<SavedTransactionViewsPanel filters={filters} bootstrap={bootstrap} canSave onOpenView={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", {name: "Vistas guardadas"}), {target: {value: ""}});
    const saveButton = screen.getByRole("button", {name: "Guardar filtros actuales"});
    fireEvent.click(saveButton);
    const input = screen.getByRole("textbox", {name: "Nombre de la vista"});
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, {key: "Escape"});
    await waitFor(() => expect(saveButton).toHaveFocus());
  });

  it("keeps the rename target fixed while the view selector is locked", () => {
    writeSavedTransactionViews([
      {id: "view-a", name: "Vista A", filters: savedTransactionViewFilters(filters), dateMode: "fixed" as const},
      {id: "view-b", name: "Vista B", filters: savedTransactionViewFilters({...filters, query: "otra"}), dateMode: "fixed" as const},
    ]);
    renderPanel();
    const selector = screen.getByRole("combobox", {name: "Vistas guardadas"});
    fireEvent.change(selector, {target: {value: "view-a"}});
    fireEvent.click(screen.getByRole("button", {name: "Renombrar"}));
    expect(selector).toBeDisabled();
    fireEvent.change(selector, {target: {value: "view-b"}});
    expect(selector).toHaveValue("view-a");
    fireEvent.change(screen.getByRole("textbox", {name: "Nombre de la vista"}), {target: {value: "Vista A renombrada"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar nombre"}));

    expect(readSavedTransactionViews().map(({id, name}) => [id, name])).toEqual([
      ["view-a", "Vista A renombrada"],
      ["view-b", "Vista B"],
    ]);
  });
});
