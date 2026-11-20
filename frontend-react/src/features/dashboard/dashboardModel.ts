import type {BootstrapPayload} from "../../shared/model/bootstrap";
import type {DashboardContentMode, DashboardData, DashboardPreferences} from "../../shared/model/dashboard";
import {
  DASHBOARD_WIDGET_IDS,
  dashboardWidgetDefinition,
  type DashboardWidgetId,
} from "./widgets/dashboardWidgetRegistry";

export {DASHBOARD_WIDGET_IDS, type DashboardWidgetId};

export const DEFAULT_DASHBOARD_WIDGET_ORDER: readonly DashboardWidgetId[] = DASHBOARD_WIDGET_IDS;

export function defaultDashboardPreferences(): DashboardPreferences {
  return {
    widget_order: [...DEFAULT_DASHBOARD_WIDGET_ORDER],
    hidden_widgets: [],
    density: "normal",
    content_mode: "full",
    created_at: "",
    updated_at: "",
    last_snapshot_month: "",
  };
}

export function dashboardData(data: BootstrapPayload): DashboardData {
  return data.dashboard || {
    priority_tasks: [],
    bank_errors: [],
    recurring_next: null,
    budget_risk: null,
    category_rise: null,
    refunds: [],
    subscriptions: [],
    account_balances: data.accounts || [],
  };
}

export function dashboardWidgetOrder(preferences: DashboardPreferences): string[] {
  return [
    ...preferences.widget_order,
    ...DEFAULT_DASHBOARD_WIDGET_ORDER.filter((id) => !preferences.widget_order.includes(id)),
  ];
}

export function dashboardWidgetMoveTarget({
  order,
  id,
  direction,
}: {
  order: string[];
  id: string;
  direction: -1 | 1;
}): number {
  const index = order.indexOf(id);
  const widget = dashboardWidgetDefinition(id);
  if (!widget?.reorderable) return -1;
  for (let target = index + direction; target >= 0 && target < order.length; target += direction) {
    const targetWidget = dashboardWidgetDefinition(order[target]);
    if (targetWidget?.reorderable && widget.region === targetWidget.region) return target;
  }
  return -1;
}

export function canMoveDashboardWidget(args: {
  order: string[];
  id: string;
  direction: -1 | 1;
}): boolean {
  return dashboardWidgetMoveTarget(args) >= 0;
}

export function isDashboardWidgetVisible({
  id,
  mode,
  hidden,
  data,
  dashboard,
}: {
  id: string;
  mode: DashboardContentMode;
  hidden: string[];
  data: BootstrapPayload;
  dashboard: DashboardData;
}): boolean {
  const widget = dashboardWidgetDefinition(id);
  if (!widget) return false;
  if (!widget.modes.includes(mode)) return false;
  if (!widget.available({data, bootstrap: dashboard})) return false;
  return !hidden.includes(id) || !widget.hideable;
}
