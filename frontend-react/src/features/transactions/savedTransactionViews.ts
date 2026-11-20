import type {TransactionUrlFilters} from "./transactionModel";

export const SAVED_TRANSACTION_VIEWS_KEY = "miscuentas.session.transactions.saved-views.v1";
const SAVED_TRANSACTION_VIEWS_VERSION = 1;
export const MAX_SAVED_TRANSACTION_VIEWS = 20;

export type SavedTransactionViewFilters = Omit<TransactionUrlFilters, "page">;
export type SavedTransactionViewDateMode = "fixed" | "current-month";
export type SavedTransactionView = Readonly<{
  id: string;
  name: string;
  filters: SavedTransactionViewFilters;
  dateMode: SavedTransactionViewDateMode;
}>;

const filterStringKeys = [
  "query", "month", "dateFrom", "dateTo", "kind", "account", "category",
  "categoryFamily", "source", "analytics", "statisticsAttribution",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isSavedTransactionView = (value: unknown): value is SavedTransactionView => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim()) return false;
  if (value.dateMode !== "fixed" && value.dateMode !== "current-month") return false;
  const filters = value.filters;
  if (!isRecord(filters) || !filterStringKeys.every((key) => typeof filters[key] === "string")) return false;
  if (!["all", "included", "excluded"].includes(filters.analytics as string)) return false;
  if (!["", "purchase", "report"].includes(filters.statisticsAttribution as string)) return false;
  return true;
};

export function readSavedTransactionViews(): SavedTransactionView[] {
  try {
    const raw = window.localStorage.getItem(SAVED_TRANSACTION_VIEWS_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as unknown;
    if (!isRecord(stored) || stored.version !== SAVED_TRANSACTION_VIEWS_VERSION || !Array.isArray(stored.views)) return [];
    return stored.views.filter(isSavedTransactionView).slice(0, MAX_SAVED_TRANSACTION_VIEWS);
  } catch {
    return [];
  }
}

export function writeSavedTransactionViews(views: readonly SavedTransactionView[]): boolean {
  if (views.length > MAX_SAVED_TRANSACTION_VIEWS || !views.every(isSavedTransactionView)) return false;
  try {
    window.localStorage.setItem(SAVED_TRANSACTION_VIEWS_KEY, JSON.stringify({version: SAVED_TRANSACTION_VIEWS_VERSION, views}));
    return true;
  } catch {
    return false;
  }
}

export function savedTransactionViewFilters(filters: TransactionUrlFilters): SavedTransactionViewFilters {
  const {page: _page, ...criteria} = filters;
  return criteria;
}

export function localMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function resolveSavedTransactionView(view: SavedTransactionView, now = new Date()): TransactionUrlFilters {
  return {
    ...view.filters,
    ...(view.dateMode === "current-month" ? {month: localMonthValue(now), dateFrom: "", dateTo: ""} : {}),
    page: 1,
  };
}
