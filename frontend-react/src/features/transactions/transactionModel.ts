import {todayInputValue} from "../../format";
import type {Transaction} from "../../shared/model/transactions";
import type {TransactionInput, TransferInput} from "./types";

export type StatisticsAttributionMode = "" | "purchase" | "report";

export type TransactionUrlFilters = {
  query: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  kind: string;
  account: string;
  category: string;
  categoryFamily: string;
  source: string;
  analytics: string;
  statisticsAttribution: StatisticsAttributionMode;
  page: number;
};

const positiveIntegerPattern = /^[1-9]\d*$/;

const validCategoryFamily = (value: string) => value === "uncategorized" || positiveIntegerPattern.test(value);

export const emptyTransaction: TransactionInput = {
  kind: "expense",
  amount: "",
  account: "",
  date: todayInputValue(),
  description: "",
  category: "",
  refund_for: "",
  notes: "",
  tag_names: "",
};

export const emptyTransfer: TransferInput = {
  source_account: "",
  target_account: "",
  amount: "",
  date: todayInputValue(),
  description: "Traspaso",
  notes: "",
};

export const readTransactionFiltersFromUrl = (): TransactionUrlFilters => {
  const params = new URLSearchParams(window.location.search);
  const pageValue = Number(params.get("page") || "1");
  const analyticsValue = params.get("analytics") || "all";
  const categoryFamilyValue = params.get("category_family") || "";
  const attributionValue = params.get("statistics_attribution") || "";
  return {
    query: params.get("q") || params.get("description") || "",
    month: params.get("month") || "",
    dateFrom: params.get("date_from") || "",
    dateTo: params.get("date_to") || "",
    kind: params.get("kind") || "",
    account: params.get("account") || "",
    category: params.get("category") || "",
    categoryFamily: validCategoryFamily(categoryFamilyValue) ? categoryFamilyValue : "",
    source: params.get("source") || "",
    analytics: ["all", "included", "excluded"].includes(analyticsValue) ? analyticsValue : "all",
    statisticsAttribution: attributionValue === "purchase" || attributionValue === "report" ? attributionValue : "",
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
  };
};

export function buildTransactionParams(filters: TransactionUrlFilters, {compact = false} = {}) {
  const params = new URLSearchParams();
  const values: Array<[string, string]> = [
    ["q", filters.query.trim()],
    ["month", filters.month],
    ["date_from", filters.dateFrom],
    ["date_to", filters.dateTo],
    ["kind", filters.kind],
    ["account", filters.account],
    ["category", filters.category],
    ["category_family", filters.categoryFamily],
    ["source", filters.source],
    ["analytics", filters.analytics],
    ["statistics_attribution", filters.statisticsAttribution],
    ["page", String(filters.page)],
  ];
  for (const [key, value] of values) {
    if (!value) continue;
    if (compact && key === "analytics" && value === "all") continue;
    if (compact && key === "page" && value === "1") continue;
    params.set(key, value);
  }
  return params;
}

export function transactionToInput(movement: Transaction): TransactionInput {
  return {
    kind: movement.kind === "income" ? "income" : "expense",
    amount: String(movement.amount),
    account: String(movement.account.id),
    date: movement.date,
    description: movement.description,
    category: movement.category ? String(movement.category.id) : "",
    expected_allocation_revision: movement.allocation_revision ?? 0,
    ...(movement.allocations?.length ? {
      allocations: movement.allocations.map((item) => ({category_id: item.category?.id ?? null, amount: item.amount.toFixed(2)})),
    } : {}),
    refund_for: movement.refund_for_id ? String(movement.refund_for_id) : "",
    notes: movement.notes || "",
    tag_names: movement.tags.join(", "),
  };
}

export function transactionFormData(input: TransactionInput & {attachment?: File | null}) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (value instanceof File) formData.set(key, value);
    else formData.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  return formData;
}
