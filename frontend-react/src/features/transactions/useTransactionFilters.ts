import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {navigateRoute} from "../../app/navigation";
import type {LedgerFilterKey} from "../../ui/finance/LedgerFilterStrip";
import {buildTransactionParams, readTransactionFiltersFromUrl} from "./transactionModel";

const explicitFilterKeys = [
  "q", "description", "month", "date_from", "date_to", "kind", "account", "category", "category_family", "source",
  "analytics", "statistics_attribution", "page",
];

export function useTransactionFilters({isActive, routeKey}: {isActive: boolean; routeKey: string}) {
  const initial = useRef(readTransactionFiltersFromUrl()).current;
  const [query, setQuery] = useState(initial.query);
  const [effectiveQuery, setEffectiveQuery] = useState(initial.query);
  const [month, setMonth] = useState(initial.month);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [kind, setKind] = useState(initial.kind);
  const [account, setAccount] = useState(initial.account);
  const [category, setCategory] = useState(initial.category);
  const [categoryFamily, setCategoryFamily] = useState(initial.categoryFamily);
  const [source, setSource] = useState(initial.source);
  const [analytics, setAnalytics] = useState(initial.analytics);
  const [statisticsAttribution, setStatisticsAttribution] = useState(initial.statisticsAttribution);
  const [page, setPage] = useState(initial.page);
  const preserveEmptyRoute = useRef(false);
  const wasActive = useRef(isActive);
  const processedRouteKey = useRef(routeKey);

  const currentFilters = () => ({
    query: effectiveQuery, month, dateFrom, dateTo, kind, account, category,
    categoryFamily, source, analytics, statisticsAttribution, page,
  });

  useLayoutEffect(() => {
    const becameActive = isActive && !wasActive.current;
    const routeChanged = Boolean(routeKey) && routeKey !== processedRouteKey.current;
    wasActive.current = isActive;
    processedRouteKey.current = routeKey;
    if (!isActive || (!becameActive && !routeChanged)) return;
    const params = new URLSearchParams(window.location.search);
    const hasExplicitFilter = explicitFilterKeys.some((key) => params.has(key));
    if (!hasExplicitFilter) {
      preserveEmptyRoute.current = false;
      return;
    }
    const hasNonDefaultFilter = explicitFilterKeys.some((key) => key !== "page" && key !== "analytics" && params.has(key));
    const hasDefaultAnalytics = !params.has("analytics") || params.get("analytics") === "all";
    preserveEmptyRoute.current = params.get("page") === "1" && hasDefaultAnalytics && !hasNonDefaultFilter;
    const next = readTransactionFiltersFromUrl();
    setQuery(next.query);
    setEffectiveQuery(next.query);
    setMonth(next.month);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
    setKind(next.kind);
    setAccount(next.account);
    setCategory(next.category);
    setCategoryFamily(next.categoryFamily);
    setSource(next.source);
    setAnalytics(next.analytics);
    setStatisticsAttribution(next.statisticsAttribution);
    setPage(next.page);
  }, [isActive, routeKey]);

  useEffect(() => {
    if (query === effectiveQuery) return;
    const timer = window.setTimeout(() => {
      setEffectiveQuery(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [effectiveQuery, query]);

  useEffect(() => {
    if (!isActive) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "transactions");
    const values = buildTransactionParams(currentFilters(), {compact: !preserveEmptyRoute.current});
    const managedKeys = [...explicitFilterKeys].filter((key) => key !== "description");
    managedKeys.forEach((key) => params.delete(key));
    values.forEach((value, key) => params.set(key, value));
    params.delete("description");
    navigateRoute({tab: "transactions", search: params, history: "replace"});
  }, [account, analytics, category, categoryFamily, dateFrom, dateTo, effectiveQuery, isActive, kind, month, page, source, statisticsAttribution]);

  const changeFilter = (key: LedgerFilterKey, value: string) => {
    if (key !== "query") setPage(1);
    switch (key) {
      case "query": setQuery(value); break;
      case "month": setMonth(value); break;
      case "dateFrom": setDateFrom(value); break;
      case "dateTo": setDateTo(value); break;
      case "kind": setKind(value); break;
      case "account": setAccount(value); break;
      case "category":
        setCategory(value);
        setCategoryFamily("");
        setStatisticsAttribution("");
        break;
      case "source": setSource(value); break;
      case "analytics": setAnalytics(value); break;
    }
  };

  const clearFilters = () => {
    setPage(1);
    setQuery("");
    setEffectiveQuery("");
    setMonth("");
    setDateFrom("");
    setDateTo("");
    setKind("");
    setAccount("");
    setCategory("");
    setCategoryFamily("");
    setSource("");
    setAnalytics("all");
    setStatisticsAttribution("");
  };

  const clearStatisticsContext = () => {
    setPage(1);
    setCategoryFamily("");
    setStatisticsAttribution("");
  };

  return {
    query, effectiveQuery, month, dateFrom, dateTo, kind, account, category,
    categoryFamily, source, analytics, statisticsAttribution, page,
    setMonth, setDateFrom, setDateTo, setKind, setAccount, setCategory,
    setCategoryFamily, setSource, setAnalytics, setStatisticsAttribution, setPage,
    currentFilters, changeFilter, clearFilters, clearStatisticsContext,
  };
}
