import {startTransition, useCallback, useEffect, useRef, useState} from "react";
import {navigateRoute, navigationRouteKey, parseRoute, pushRoute, readInitialAction, readInitialTab, replaceViewState} from "../navigation";
import {transactionIntentHref, type TransactionIntent} from "../../shared/lib/transactionIntent";
import {sectionById} from "../sections";
import type {AppNavigation, Tab} from "../contracts";

export interface AppNavigationState extends AppNavigation {
  newMovementToken: number;
  planningComposerToken: number;
  preload: (tab: Tab) => void;
  preloadedTabs: readonly Tab[];
  routeKey: string;
}

export function useAppNavigation({ready, onNavigate, onOpenNewMovement, onPreload}: {ready: boolean; onNavigate: () => void; onOpenNewMovement: () => void; onPreload?: (tab: Tab) => unknown | Promise<unknown>}): AppNavigationState {
  const [activeTab, setActiveTab] = useState<Tab>(readInitialTab);
  const [routeKey, setRouteKey] = useState(navigationRouteKey);
  const [newMovementToken, setNewMovementToken] = useState(0);
  const [planningComposerToken, setPlanningComposerToken] = useState(0);
  const [preloadedTabs, setPreloadedTabs] = useState<Tab[]>([]);
  const handledInitialAction = useRef(false);
  const preparedTabs = useRef(new Set<Tab>());
  const preparingTabs = useRef(new Map<Tab, Promise<void>>());

  const prepare = useCallback((tab: Tab) => {
    if (preparedTabs.current.has(tab)) return Promise.resolve();
    const ongoing = preparingTabs.current.get(tab);
    if (ongoing) return ongoing;
    let data: Promise<unknown>;
    let module: Promise<unknown>;
    try {
      data = Promise.resolve(onPreload?.(tab)).catch(() => undefined);
    } catch {
      data = Promise.resolve();
    }
    try {
      module = Promise.resolve(sectionById(tab).preload?.()).catch(() => undefined);
    } catch {
      module = Promise.resolve();
    }
    const pending = Promise.all([data, module]).then(() => {
      if (["transactions", "review", "statistics"].includes(tab)) {
        preparedTabs.current.add(tab);
        startTransition(() => setPreloadedTabs((current) => current.includes(tab) ? current : [...current, tab]));
      }
    }).finally(() => preparingTabs.current.delete(tab));
    preparingTabs.current.set(tab, pending);
    return pending;
  }, [onPreload]);

  const preload = useCallback((tab: Tab) => {
    try {
      void prepare(tab);
    } catch {
      // A failed optional download must never block navigation.
    }
  }, [prepare]);

  useEffect(() => {
    if (!ready || activeTab !== "dashboard") return;
    let cancelled = false;
    let startHandle: number | null = null;
    let idleHandle: number | null = null;
    let timerHandle: number | null = null;
    let index = 0;
    const warmNext = () => {
      if (cancelled || index >= 3) return;
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(() => {
          const tab = (["transactions", "review", "statistics"] as const)[index];
          index += 1;
          void prepare(tab).then(() => {
            if (!cancelled) warmNext();
          });
        }, {timeout: 5_000});
      } else {
        timerHandle = window.setTimeout(() => {
          const tab = (["transactions", "review", "statistics"] as const)[index];
          index += 1;
          void prepare(tab).then(() => {
            if (!cancelled) warmNext();
          });
        }, 200);
      }
    };
    // Give the first deliberate navigation a chance to take priority over background warming.
    startHandle = window.setTimeout(warmNext, 2_500);
    return () => {
      cancelled = true;
      if (startHandle !== null) window.clearTimeout(startHandle);
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
      if (timerHandle !== null) window.clearTimeout(timerHandle);
    };
  }, [activeTab, prepare, ready]);

  const navigate = useCallback((tab: Tab, transition: {search?: URLSearchParams; hash?: string; history?: "push" | "replace"} = {}) => {
    preload(tab);
    onNavigate();
    navigateRoute({tab, ...transition});
    setActiveTab(tab);
    setRouteKey(navigationRouteKey());
  }, [onNavigate, preload]);

  const openNewMovement = useCallback(() => {
    setNewMovementToken((value) => value + 1);
    pushRoute("transactions");
    setActiveTab("transactions");
    setRouteKey(navigationRouteKey());
    onOpenNewMovement();
  }, [onOpenNewMovement]);

  const openPlanningComposer = useCallback(() => {
    setPlanningComposerToken((value) => value + 1);
    pushRoute("planning");
    setActiveTab("planning");
    setRouteKey(navigationRouteKey());
    onNavigate();
  }, [onNavigate]);

  const openTransactionIntent = useCallback((intent: TransactionIntent, {history = "push"}: {history?: "push" | "replace"} = {}) => {
    preload("transactions");
    onNavigate();
    const route = new URL(transactionIntentHref(intent), window.location.origin);
    navigateRoute({tab: "transactions", search: route.searchParams, hash: route.hash, history});
    setActiveTab("transactions");
    setRouteKey(navigationRouteKey());
  }, [onNavigate, preload]);

  useEffect(() => {
    const handlePopState = () => {
      const route = parseRoute();
      if (route.search.get("tab") === "automations") navigateRoute({tab: "settings", search: route.search, history: "replace"});
      const {tab} = parseRoute();
      preload(tab);
      onNavigate();
      setActiveTab(tab);
      setRouteKey(navigationRouteKey());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onNavigate, preload]);

  useEffect(() => {
    if (!ready) return;
    const route = parseRoute();
    if (route.search.get("tab") !== "automations") return;
    navigateRoute({tab: "settings", search: route.search, history: "replace"});
    setActiveTab("settings");
    setRouteKey(navigationRouteKey());
  }, [ready]);

  useEffect(() => {
    if (handledInitialAction.current || !ready) return;
    handledInitialAction.current = true;
    const {action, focus} = readInitialAction();
    if (action === "new-expense") openNewMovement();
    if (focus === "bank") {
      replaceViewState("review");
      setActiveTab("review");
      setRouteKey(navigationRouteKey());
    }
  }, [openNewMovement, ready]);

  return {activeTab, navigate, openNewMovement, openPlanningComposer, openTransactionIntent, newMovementToken, planningComposerToken, preload, preloadedTabs, routeKey};
}
