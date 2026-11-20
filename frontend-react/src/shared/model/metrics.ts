import type {Account} from "./accounts";
import type {Category} from "./categories";

export interface Projection {
  as_of: string;
  sufficient: boolean;
  actual_expense: number;
  projected_expense: number;
  projected_savings: number;
  expense_median: number;
  delta_vs_median: number;
  normalized_income: number;
  normalized_savings: number;
  normalized_savings_rate: number;
  expense_expected_to_date: number;
  expense_delta_vs_pace: number;
  method: string;
  category_watchlist: Array<{
    label: string;
    projected: number;
    baseline: number;
    difference: number;
    filters: Record<string, string>;
  }>;
}

export interface AttentionSignal {
  title: string;
  label: string;
  value: number | string;
  value_kind: "money" | "text";
  detail:
    | {kind: "projection_vs_median"; projected: number; baseline: number}
    | {kind: "above_historical_median"; baseline: number}
    | {kind: "previous_median"; baseline: number; latest_amount: number; date: string}
    | {kind: "text"; text: string};
  url: string;
  severity: number;
  filters?: Record<string, string>;
}

export interface SubscriptionDetection {
  description: string;
  median_amount: number;
  annual_cost: number;
  months_seen: number;
  typical_day: number;
  last_date: string;
  category: Category | null;
  account: Account | null;
  filters: Record<string, string>;
  url: string;
  rule_prefill: string;
  recurring_prefill: string;
}

export interface Metrics {
  start: string;
  end: string;
  total_balance?: number;
  income: number;
  expense: number;
  gross_expense?: number;
  refunds?: number;
  balance?: number;
  net_savings: number;
  savings_contributions?: number;
  commitments?: number;
  expected_income?: number;
  savings_goal?: number;
  savings_goal_progress?: number;
  safe_to_spend?: number;
  liquidity_total?: number;
  net_worth?: number;
  savings_rate?: number;
  fixed_load_ratio?: number;
  dti?: number;
  recurring_commitments?: number;
  excluded_total?: number;
  projection?: Projection;
}

export interface Review {
  bank_pending_count: number;
  csv_pending_count: number;
  total_pending_count: number;
  pending_net_amount: number;
  last_bank_sync_at: string;
  last_bank_imported_date: string;
  bank_connections_active: number;
  bank_connections_needing_reconnect: number;
  bank_connections_with_errors?: number;
  bank_accounts_linked: number;
  pending_import_batches?: number;
  has_pending_review: boolean;
  has_banking_configured: boolean;
}
