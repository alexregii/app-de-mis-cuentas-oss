import type {Account, Connection} from "./accounts";
import type {Metrics, Review, SubscriptionDetection} from "./metrics";
import type {BudgetItem} from "./planning";

export type DashboardContentMode = "full" | "balance" | "review";
export type DashboardDensity = "normal" | "compact";

export interface DashboardPreferences {
  widget_order: string[];
  hidden_widgets: string[];
  density: DashboardDensity;
  content_mode: DashboardContentMode;
  created_at: string;
  updated_at: string;
  last_snapshot_month: string;
}

export interface DashboardData {
  priority_tasks: Array<{id: string; label: string; count: number; severity: string; url: string}>;
  bank_errors: Connection[];
  recurring_next: {name: string; date: string; amount: number; account: string; category: string; status: string; url: string} | null;
  budget_risk: BudgetItem | null;
  category_rise: {category: string; current: number; previous: number; difference: number; percent: number | null} | null;
  refunds: Array<{description: string; amount: number; date: string; status: string; url: string}>;
  subscriptions: SubscriptionDetection[];
  account_balances: Account[];
}

export interface DashboardSnapshotPayload {
  month: string;
  metrics: Metrics;
  review: Review;
  accounts: Account[];
  budget_items: BudgetItem[];
  dashboard: DashboardData;
}

export interface DashboardSnapshot {
  month: string;
  payload: DashboardSnapshotPayload;
  captured_at: string;
}
