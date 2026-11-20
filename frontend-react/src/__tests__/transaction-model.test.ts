import {beforeEach, describe, expect, it} from "vitest";
import {buildTransactionParams, readTransactionFiltersFromUrl} from "../features/transactions/transactionModel";

describe("transaction URL filters", () => {
  beforeEach(() => window.history.replaceState({}, "", "/?tab=transactions"));

  it("restores and requests the complete statistical category attribution", () => {
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-01-01&date_to=2026-07-13&analytics=included&category_family=4&statistics_attribution=purchase&page=2");

    const filters = readTransactionFiltersFromUrl();
    expect(filters).toMatchObject({
      dateFrom: "2026-01-01",
      dateTo: "2026-07-13",
      analytics: "included",
      categoryFamily: "4",
      statisticsAttribution: "purchase",
      page: 2,
    });
    expect(Object.fromEntries(buildTransactionParams(filters))).toMatchObject({
      date_from: "2026-01-01",
      date_to: "2026-07-13",
      analytics: "included",
      category_family: "4",
      statistics_attribution: "purchase",
      page: "2",
    });
  });

  it("preserves uncategorized families and rejects invented hidden filter values", () => {
    window.history.replaceState({}, "", "/?tab=transactions&category_family=uncategorized");
    const filters = readTransactionFiltersFromUrl();
    expect(filters.categoryFamily).toBe("uncategorized");
    expect(Object.fromEntries(buildTransactionParams(filters, {compact: true}))).toMatchObject({
      category_family: "uncategorized",
    });

    window.history.replaceState({}, "", "/?tab=transactions&statistics_attribution=refund_date&category_family=not-an-id");
    expect(readTransactionFiltersFromUrl()).toMatchObject({
      categoryFamily: "",
      statisticsAttribution: "",
    });
  });

  it("preserves the exact report attribution used by monthly drill-down", () => {
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-06-01&date_to=2026-06-30&analytics=included&statistics_attribution=report");
    const filters = readTransactionFiltersFromUrl();
    expect(filters.statisticsAttribution).toBe("report");
    expect(Object.fromEntries(buildTransactionParams(filters))).toMatchObject({
      date_from: "2026-06-01",
      date_to: "2026-06-30",
      analytics: "included",
      statistics_attribution: "report",
    });
  });
});
