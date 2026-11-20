import {useMemo, useRef, useState} from "react";
import {dashboardApi as api} from "./api";
import type {BootstrapPayload} from "../../shared/model/bootstrap";
import type {DashboardContentMode, DashboardPreferences} from "../../shared/model/dashboard";
import {
  dashboardData,
  dashboardWidgetOrder,
  dashboardWidgetMoveTarget,
  canMoveDashboardWidget,
  defaultDashboardPreferences,
  isDashboardWidgetVisible,
} from "./dashboardModel";

export function useDashboardPreferences(data: BootstrapPayload) {
  const [preferences, setPreferences] = useState<DashboardPreferences>(
    data.preferences || defaultDashboardPreferences(),
  );
  const [error, setError] = useState("");
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  const dashboard = dashboardData(data);
  const order = useMemo(() => dashboardWidgetOrder(preferences), [preferences]);
  const hidden = preferences.hidden_widgets;
  const mode = preferences.content_mode || "full";

  const persist = (next: Partial<DashboardPreferences>) => {
    setError("");
    setPreferences((current) => ({...current, ...next}));
    persistQueue.current = persistQueue.current
      .then(async () => {
        const response = await api.updateDashboardPreferences(next);
        setPreferences(response.preferences);
      })
      .catch(async (reason) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo guardar la personalización del resumen.",
        );
        try {
          const response = await api.dashboardPreferences();
          setPreferences(response.preferences);
        } catch {
          // The visible error remains actionable; a later change will retry the queue.
        }
      });
    return persistQueue.current;
  };

  const move = (id: string, direction: -1 | 1) => {
    const next = [...order];
    const index = next.indexOf(id);
    const target = dashboardWidgetMoveTarget({order, id, direction});
    if (index < 0 || target < 0) return;
    [next[index], next[target]] = [next[target], next[index]];
    void persist({widget_order: next});
  };

  const toggle = (id: string) => {
    const next = hidden.includes(id)
      ? hidden.filter((item) => item !== id)
      : [...hidden, id];
    void persist({hidden_widgets: next});
  };

  const setMode = (next: DashboardContentMode) => void persist({content_mode: next});
  const visible = order.filter((id) =>
    isDashboardWidgetVisible({id, mode, hidden, data, dashboard}),
  );

  const canMove = (id: string, direction: -1 | 1) =>
    canMoveDashboardWidget({order, id, direction});

  const reset = async () => {
    const response = await api.resetDashboardPreferences();
    setPreferences(response.preferences);
  };

  return {
    dashboard,
    canMove,
    error,
    hidden,
    mode,
    move,
    order,
    preferences,
    reset,
    setError,
    setMode,
    setPreferences,
    toggle,
    visible,
  };
}
