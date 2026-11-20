import {beforeEach, describe, expect, it} from "vitest";
import type {TransactionUrlFilters} from "../features/transactions/transactionModel";
import {
  SAVED_TRANSACTION_VIEWS_KEY,
  localMonthValue,
  readSavedTransactionViews,
  resolveSavedTransactionView,
  savedTransactionViewFilters,
  writeSavedTransactionViews,
  type SavedTransactionView,
} from "../features/transactions/savedTransactionViews";

const filters: TransactionUrlFilters = {
  query: "supermercado",
  month: "2026-10",
  dateFrom: "",
  dateTo: "",
  kind: "expense",
  account: "4",
  category: "8",
  categoryFamily: "",
  source: "enable_banking",
  analytics: "included",
  statisticsAttribution: "",
  page: 3,
};

describe("saved transaction views", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores complete filter criteria without page or ledger data", () => {
    const view: SavedTransactionView = {
      id: "monthly-bank-review",
      name: "Revisar gastos bancarios",
      filters: savedTransactionViewFilters(filters),
      dateMode: "fixed",
    };

    expect(writeSavedTransactionViews([view])).toBe(true);
    const raw = window.localStorage.getItem(SAVED_TRANSACTION_VIEWS_KEY)!;
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({version: 1, views: [view]});
    expect(parsed).not.toHaveProperty("results");
    expect(raw).not.toMatch(/"amount"|"total"|"ledger"|"results"/i);
    expect(view.filters).not.toHaveProperty("page");
    expect(readSavedTransactionViews()).toEqual([view]);
  });

  it("keeps selected months and explicit ranges fixed while resetting pagination", () => {
    const view: SavedTransactionView = {
      id: "fixed-period",
      name: "Periodo elegido",
      filters: {...savedTransactionViewFilters(filters), month: "2026-08", dateFrom: "", dateTo: ""},
      dateMode: "fixed",
    };

    expect(resolveSavedTransactionView(view, new Date(2027, 0, 3))).toMatchObject({month: "2026-08", page: 1});
    expect(localMonthValue(new Date(2027, 0, 3))).toBe("2027-01");
  });

  it("resolves a relative current month when the view opens", () => {
    const view: SavedTransactionView = {
      id: "current-month",
      name: "Este mes",
      filters: {...savedTransactionViewFilters(filters), month: "2026-10", dateFrom: "", dateTo: ""},
      dateMode: "current-month",
    };

    expect(resolveSavedTransactionView(view, new Date(2027, 0, 3))).toMatchObject({month: "2027-01", dateFrom: "", dateTo: "", page: 1});
  });

  it("ignores a malformed or unsupported stored envelope", () => {
    window.localStorage.setItem(SAVED_TRANSACTION_VIEWS_KEY, JSON.stringify({version: 99, views: [{id: "unsafe"}]}));
    expect(readSavedTransactionViews()).toEqual([]);
  });
});
