export type TransactionIntentFilters = Partial<Record<
  "q" | "description" | "month" | "date_from" | "date_to" | "kind" | "account" | "category" | "category_family" | "source" | "analytics" | "statistics_attribution" | "page",
  string | number | null | undefined
>>;

export type TransactionIntent = string | URL | TransactionIntentFilters;

const transactionIntentKeys = [
  "month", "date_from", "date_to", "kind", "account", "category", "category_family", "source", "analytics", "statistics_attribution", "page",
] as const;

/** Canonical, exact route for any feature that opens a filtered Movements view. */
export const transactionIntentHref = (intent: TransactionIntent): string => {
  const source = typeof intent === "string" || intent instanceof URL
    ? new URL(intent, window.location.origin)
    : null;
  const raw = source ? source.searchParams : new URLSearchParams();
  if (!source) {
    Object.entries(intent).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") raw.set(key, String(value));
    });
  }
  const search = new URLSearchParams();
  const query = raw.get("q") || raw.get("description") || "";
  if (query) search.set("q", query);
  transactionIntentKeys.forEach((key) => {
    const value = raw.get(key);
    if (value) search.set(key, value);
  });
  search.set("tab", "transactions");
  return `/${search.toString() ? `?${search.toString()}` : ""}${source?.hash || ""}`;
};

export const isTransactionIntentHref = (href: string): boolean => {
  try {
    const target = new URL(href, window.location.origin);
    return target.origin === window.location.origin
      && (target.searchParams.get("tab") === "transactions" || /^\/movimientos\/?$/.test(target.pathname));
  } catch {
    return false;
  }
};
