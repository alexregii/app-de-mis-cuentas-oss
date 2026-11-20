import {beforeEach, describe, expect, it, vi} from "vitest";
import {
  navItems,
  parseRoute,
  primaryNavIds,
  pushRoute,
  readInitialAction,
  readInitialTab,
  replaceViewState,
  serializeRoute,
  secondaryNavIds,
  ensureCurrentHistoryEntryId,
  historyEntryId,
  historyParentEntryId,
  navigationRouteKey,
} from "../app/navigation";
import {isTransactionIntentHref, transactionIntentHref} from "../shared/lib/transactionIntent";

describe("app navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("preserves the navigation order and groups", () => {
    expect(navItems.map(({id, label, shortLabel}) => ({id, label, shortLabel}))).toEqual([
      {id: "dashboard", label: "Resumen", shortLabel: undefined},
      {id: "transactions", label: "Movimientos", shortLabel: undefined},
      {id: "review", label: "Revisión", shortLabel: undefined},
      {id: "planning", label: "Plan", shortLabel: undefined},
      {id: "accounts", label: "Cuentas", shortLabel: undefined},
      {id: "statistics", label: "Estadísticas", shortLabel: "Estad."},
      {id: "settings", label: "Ajustes", shortLabel: undefined},
    ]);
    expect(primaryNavIds).toEqual(["dashboard", "transactions", "review", "statistics"]);
    expect(secondaryNavIds).toEqual(["planning", "accounts", "settings"]);
  });

  it("reads a valid tab and falls back to the dashboard", () => {
    window.history.replaceState({}, "", "/?tab=statistics");
    expect(readInitialTab()).toBe("statistics");

    window.history.replaceState({}, "", "/?tab=unknown");
    expect(readInitialTab()).toBe("dashboard");
  });

  it("parses and canonicalizes legacy movements links without losing filters", () => {
    const route = parseRoute({pathname: "/movimientos/", search: "?q=Restaurantes&kind=expense&analytics=included", hash: "#results"});

    expect(route.tab).toBe("transactions");
    expect(serializeRoute(route)).toBe("/?q=Restaurantes&kind=expense&analytics=included&tab=transactions#results");
  });

  it("redirects legacy automation links to Settings while retaining rule targets", () => {
    const route = parseRoute({pathname: "/", search: "?tab=automations&focus=new-rule&rule=27", hash: ""});

    expect(route.tab).toBe("settings");
    expect(route.search.get("focus")).toBe("new-rule");
    expect(route.search.get("rule")).toBe("27");
    expect(serializeRoute(route)).toBe("/?tab=settings&focus=new-rule&rule=27");
  });

  it("preserves Settings subsection and deep-link parameters through the legacy alias", () => {
    const route = parseRoute({pathname: "/", search: "?tab=automations&settings_section=classification&focus=new-rule&rule=27", hash: ""});
    expect(route.tab).toBe("settings");
    expect(serializeRoute(route)).toBe("/?tab=settings&settings_section=classification&focus=new-rule&rule=27");

    pushRoute("settings", new URLSearchParams("settings_section=imports"));
    expect(window.location.search).toBe("?settings_section=imports&tab=settings");
  });

  it("preserva el destino interno de Ajustes al canonicalizar Automatizaciones", () => {
    const route = parseRoute({pathname: "/", search: "?tab=automations&settings_section=classification&focus=new-rule&rule=27", hash: ""});
    expect(route.tab).toBe("settings");
    expect(serializeRoute(route)).toBe("/?tab=settings&settings_section=classification&focus=new-rule&rule=27");

    pushRoute("settings", new URLSearchParams("settings_section=imports"));
    expect(window.location.search).toBe("?settings_section=imports&tab=settings");
  });

  it("normalizes every movement intent to the declared filter contract", () => {
    expect(transactionIntentHref({category: 14, kind: "expense", analytics: "included"})).toBe("/?kind=expense&category=14&analytics=included&tab=transactions");
    expect(transactionIntentHref("/movimientos/?description=Mercado&category=14&unexpected=value#results")).toBe("/?q=Mercado&category=14&tab=transactions#results");
    expect(isTransactionIntentHref("/?tab=transactions&category=14")).toBe(true);
    expect(isTransactionIntentHref("/?tab=statistics&category=14")).toBe(false);
  });

  it("uses history entries for destinations and replacement for route normalization", () => {
    window.history.replaceState({}, "", "/?tab=transactions&q=coffee");
    const sourceEntryId = ensureCurrentHistoryEntryId();
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    pushRoute("statistics");
    const pushedState = pushSpy.mock.calls[0]?.[0];
    expect(pushSpy).toHaveBeenCalledWith(pushedState, "", "/?tab=statistics");
    expect(historyEntryId(pushedState)).not.toBe(sourceEntryId);
    expect(historyParentEntryId(pushedState)).toBe(sourceEntryId);
    expect(JSON.stringify(pushedState)).not.toContain("coffee");

    const pushedEntryId = historyEntryId(pushedState);
    replaceViewState("dashboard");
    const replacedState = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1]?.[0];
    expect(replaceSpy).toHaveBeenLastCalledWith(replacedState, "", "/");
    expect(historyEntryId(replacedState)).toBe(pushedEntryId);
    expect(historyParentEntryId(replacedState)).toBe(sourceEntryId);
  });

  it("signals distinct internal routes for repeated URLs without changing the browser URL", () => {
    const categorySearch = new URLSearchParams("settings_section=classification&category=3");
    pushRoute("settings", categorySearch);
    const browserUrl = window.location.href;
    const firstRouteKey = navigationRouteKey();
    pushRoute("settings", categorySearch);
    const secondRouteKey = navigationRouteKey();

    expect(window.location.href).toBe(browserUrl);
    expect(firstRouteKey).not.toBe(secondRouteKey);
    expect(new URL(firstRouteKey).searchParams.get("__appEntry")).not.toBe(new URL(secondRouteKey).searchParams.get("__appEntry"));
  });

  it("retains the Planning month parameter in route updates", () => {
    pushRoute("planning", new URLSearchParams("plan_month=2026-08"));
    expect(window.location.search).toBe("?plan_month=2026-08&tab=planning");
  });

  it("retains daily liquidity filters and selected day in Planning routes", () => {
    pushRoute("planning", new URLSearchParams("liquidity_account=4&liquidity_from=2026-10-23&liquidity_to=2026-11-21&liquidity_scenario=conservador&liquidity_day=2026-10-28"));
    expect(window.location.search).toBe("?liquidity_account=4&liquidity_from=2026-10-23&liquidity_to=2026-11-21&liquidity_scenario=conservador&liquidity_day=2026-10-28&tab=planning");
  });

  it("reads the initial shortcut action and focus", () => {
    window.history.replaceState({}, "", "/?action=new-expense&focus=bank");
    expect(readInitialAction()).toEqual({action: "new-expense", focus: "bank"});

    window.history.replaceState({}, "", "/");
    expect(readInitialAction()).toEqual({action: "", focus: ""});
  });
});
