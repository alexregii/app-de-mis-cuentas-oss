import type {Tab} from "./contracts";
import type {ImportPayload} from "../shared/model/imports";
import {prefetchGet} from "../shared/api/client";

const transactionPath = () => {
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const values: Array<[string, string]> = [
    ["q", source.get("q") || source.get("description") || ""],
    ["month", source.get("month") || ""],
    ["date_from", source.get("date_from") || ""],
    ["date_to", source.get("date_to") || ""],
    ["kind", source.get("kind") || ""],
    ["account", source.get("account") || ""],
    ["category", source.get("category") || ""],
    ["category_family", source.get("category_family") || ""],
    ["source", source.get("source") || ""],
    ["analytics", ["all", "included", "excluded"].includes(source.get("analytics") || "all") ? source.get("analytics") || "all" : "all"],
    ["statistics_attribution", ["purchase", "report"].includes(source.get("statistics_attribution") || "") ? source.get("statistics_attribution") || "" : ""],
    ["page", String(Math.max(1, Number(source.get("page") || "1") || 1))],
  ];
  values.forEach(([key, value]) => { if (value) params.set(key, value); });
  return `/api/transactions/?${params.toString()}`;
};

const statisticsPath = () => {
  const source = new URLSearchParams(window.location.search);
  const requestedPeriod = source.get("period") || "12";
  const period = ["3", "6", "12", "custom"].includes(requestedPeriod) ? requestedPeriod : "12";
  const basis = source.get("basis") === "all" ? "all" : "analytics";
  const params = new URLSearchParams({period, basis});
  if (period === "custom") {
    if (source.get("date_from")) params.set("date_from", source.get("date_from") || "");
    if (source.get("date_to")) params.set("date_to", source.get("date_to") || "");
  }
  return `/api/statistics/?${params.toString()}`;
};

const prefetchReview = async () => {
  const [imports] = await Promise.all([
    prefetchGet<ImportPayload>("/api/imports/"),
    prefetchGet("/api/bank-review/"),
  ]);
  const batchId = imports.batches[0]?.id;
  if (batchId) await prefetchGet(`/api/imports/${batchId}/rows/?page=1&status=pending`);
};

export const prefetchDatabaseScreen = (tab: Tab): Promise<unknown> => {
  if (tab === "transactions") return prefetchGet(transactionPath());
  if (tab === "review") return prefetchReview();
  if (tab === "statistics") return prefetchGet(statisticsPath());
  return Promise.resolve();
};
