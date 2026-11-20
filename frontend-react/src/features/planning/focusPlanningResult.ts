import {useEffect, useRef} from "react";

type PlanningResultKind = "budget" | "recurring";

export function focusPlanningResult(kind: PlanningResultKind, id: number) {
  const focusResult = (attempt = 0) => {
    const result = document.getElementById(`planning-${kind}-${id}`);
    const trackingHeading = document.getElementById("planning-tracking-title");
    const nearbyAction = kind === "budget"
      ? document.querySelector<HTMLElement>("#planning-budgets .section-header .ui-button")
      : document.querySelector<HTMLElement>("#planning-occurrences .planning-empty .ui-button");
    const disclosure = Array.from(document.querySelectorAll<HTMLButtonElement>(".planning-composers .disclosure-button"))
      .find((button) => button.getAttribute("aria-label") === `Expandir nuevo ${kind === "budget" ? "presupuesto" : "recurrente"}`);
    const inViewport = (target: HTMLElement | null | undefined) => {
      const bounds = target?.getBoundingClientRect();
      return Boolean(bounds && bounds.bottom > 0 && bounds.top < window.innerHeight);
    };
    if (result) {
      if (!inViewport(result)) result.scrollIntoView?.({block: "nearest"});
      result.focus({preventScroll: true});
      return true;
    }
    if (attempt < 5) return false;
    const target = [trackingHeading, nearbyAction, disclosure].find(inViewport) ?? disclosure ?? trackingHeading;
    target?.focus({preventScroll: true});
    return true;
  };
  const retryWhenRendered = (attempt = 0) => {
    if (focusResult(attempt) || attempt >= 5) return;
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => retryWhenRendered(attempt + 1));
    } else {
      window.setTimeout(() => retryWhenRendered(attempt + 1), 0);
    }
  };
  retryWhenRendered();
}

export function useFocusPlanningRouteTarget(routeKey: string, isActive: boolean, planningReady: boolean) {
  const focusedRoute = useRef("");
  useEffect(() => {
    if (!isActive) {
      focusedRoute.current = "";
      return;
    }
    if (!planningReady) return;
    const hash = new URL(routeKey || window.location.href, window.location.origin).hash;
    const createObjective = hash === "#planning-objective-create";
    const recurringTarget = /^#planning-recurring-\d+$/.test(hash) ? document.getElementById(hash.slice(1)) : null;
    if (!createObjective && !recurringTarget) {
      focusedRoute.current = "";
      return;
    }
    if (focusedRoute.current === routeKey) return;
    if (createObjective) {
      const disclosure = document.querySelector<HTMLDetailsElement>(".planning-objective-create");
      const input = disclosure?.querySelector<HTMLInputElement>('input[name="name"]');
      if (!disclosure || !input) return;
      focusedRoute.current = routeKey;
      disclosure.open = true;
      input.scrollIntoView?.({block: "nearest"});
      input.focus({preventScroll: true});
      return;
    }
    if (!recurringTarget) return;
    focusedRoute.current = routeKey;
    recurringTarget.scrollIntoView?.({block: "nearest"});
    recurringTarget.focus({preventScroll: true});
  }, [isActive, planningReady, routeKey]);
}
