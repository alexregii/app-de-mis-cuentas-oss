import type {LucideIcon} from "lucide-react";
import type {Tab} from "./contracts";
import {navigationCatalog} from "./navigationCatalog";

export type {Tab} from "./contracts";

export interface NavigationItem {
  id: Tab;
  label: string;
  shortLabel?: string;
  Icon: LucideIcon;
}

export interface InitialNavigationAction {
  action: string;
  focus: string;
}

export interface NavigationRoute {
  pathname: string;
  tab: Tab;
  search: URLSearchParams;
  hash: string;
}

export interface RouteTransition {
  tab: Tab;
  search?: URLSearchParams;
  hash?: string;
  history?: "push" | "replace";
}

const historyEntryIdKey = "__appHistoryEntryId";
const historyParentIdKey = "__appHistoryParentId";
let historyEntrySequence = 0;

const historyStateRecord = (state: unknown): Record<string, unknown> => (
  state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {}
);

const newHistoryEntryId = (): string => {
  const randomId = window.crypto?.randomUUID?.();
  return randomId || `${Date.now().toString(36)}-${(++historyEntrySequence).toString(36)}`;
};

export const historyEntryId = (state: unknown = window.history.state): string | null => {
  const value = historyStateRecord(state)[historyEntryIdKey];
  return typeof value === "string" ? value : null;
};

export const historyParentEntryId = (state: unknown = window.history.state): string | null => {
  const value = historyStateRecord(state)[historyParentIdKey];
  return typeof value === "string" ? value : null;
};

export const ensureCurrentHistoryEntryId = (): string => {
  const state = historyStateRecord(window.history.state);
  const existingId = historyEntryId(state);
  if (existingId) return existingId;
  const entryId = newHistoryEntryId();
  window.history.replaceState(
    {...state, [historyEntryIdKey]: entryId},
    "",
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  return entryId;
};

export const navigationRouteKey = (): string => {
  // Keep the focus signal distinct for repeated history entries without changing the visible URL.
  const url = new URL(window.location.href);
  url.searchParams.set("__appEntry", ensureCurrentHistoryEntryId());
  return url.href;
};

const ownedParams: Record<Tab, readonly string[]> = {
  // El resumen comparte explícitamente el alcance estadístico para conservar el contexto de decisión al volver desde el informe.
  dashboard: ["period", "basis", "date_from", "date_to", "month"], transactions: ["q", "month", "date_from", "date_to", "kind", "account", "category", "category_family", "source", "analytics", "statistics_attribution", "page", "description"],
  review: ["focus"], planning: ["plan_month", "budget_category", "liquidity_account", "liquidity_from", "liquidity_to", "liquidity_scenario", "liquidity_day"], accounts: ["account"], statistics: ["period", "basis", "date_from", "date_to", "month"], settings: ["settings_section", "focus", "rule", "category"],
};

const ownedSearch = (tab: Tab, search: URLSearchParams) => {
  const next = new URLSearchParams();
  ownedParams[tab].forEach((key) => { const value = search.get(key); if (value) next.set(key, value); });
  return next;
};

export const navItems: NavigationItem[] = [...navigationCatalog];

export const primaryNavIds: Tab[] = navigationCatalog.filter(({navigationGroup}) => navigationGroup === "primary").map(({id}) => id);
export const secondaryNavIds: Tab[] = navigationCatalog.filter(({navigationGroup}) => navigationGroup === "secondary").map(({id}) => id);

const tabFromSearch = (search: URLSearchParams): Tab | null => {
  const value = search.get("tab");
  if (value === "automations") return "settings";
  return navItems.some((item) => item.id === value) ? (value as Tab) : null;
};

const tabFromPathname = (pathname: string): Tab | null => {
  if (/^\/movimientos\/?$/.test(pathname)) return "transactions";
  return null;
};

export const parseRoute = (location: Pick<Location, "pathname" | "search" | "hash"> = window.location): NavigationRoute => {
  const search = new URLSearchParams(location.search);
  const tab = tabFromSearch(search) || tabFromPathname(location.pathname) || "dashboard";
  return {pathname: location.pathname, tab, search, hash: location.hash};
};

export const serializeRoute = ({pathname, tab, search, hash}: NavigationRoute): string => {
  const nextSearch = new URLSearchParams(search);
  if (tab === "dashboard") nextSearch.delete("tab");
  else nextSearch.set("tab", tab);
  const canonicalPathname = tabFromPathname(pathname) ? "/" : pathname;
  return `${canonicalPathname}${nextSearch.toString() ? `?${nextSearch.toString()}` : ""}${hash}`;
};

export const navigateRoute = ({tab, search, hash, history = "push"}: RouteTransition): void => {
  const current = parseRoute();
  const currentState = historyStateRecord(window.history.state);
  const currentEntryId = ensureCurrentHistoryEntryId();
  const nextEntryId = history === "push" ? newHistoryEntryId() : currentEntryId;
  const nextState: Record<string, unknown> = {...currentState, [historyEntryIdKey]: nextEntryId};
  if (history === "push") nextState[historyParentIdKey] = currentEntryId;
  window.history[history === "replace" ? "replaceState" : "pushState"](
    nextState,
    "",
    serializeRoute({...current, tab, search: ownedSearch(tab, search || current.search), hash: hash ?? current.hash}),
  );
};

export const pushRoute = (tab: Tab, search?: URLSearchParams): void => {
  navigateRoute({tab, search});
};

export const replaceViewState = (tab: Tab): void => {
  navigateRoute({tab, history: "replace"});
};

export const readInitialTab = (): Tab => {
  return parseRoute().tab;
};

export const readInitialAction = (): InitialNavigationAction => {
  const params = new URLSearchParams(window.location.search);
  return {
    action: params.get("action") || "",
    focus: params.get("focus") || "",
  };
};
