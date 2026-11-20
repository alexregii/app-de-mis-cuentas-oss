import type {Account} from "./accounts";
import type {Category, CategoryRuleDraftInput} from "./categories";
import type {BasicKind, Pace} from "./common";
import type {Metrics, Projection} from "./metrics";

export interface BudgetItem {
  id: number;
  category: Category;
  limit: number;
  spent: number;
  remaining: number;
  percent: number;
  actual_percent: number;
  projected_percent: number;
  pace: Pace;
}

export interface Budget {
  id: number;
  month: string;
  category: Category;
  limit: number;
}

export interface RecurringRule {
  id: number;
  name: string;
  kind: BasicKind;
  amount: number;
  account: Account;
  category: Category;
  frequency: string;
  frequency_display: string;
  day_of_month: number;
  start_date: string;
  end_date: string;
  notes: string;
  active: boolean;
  lifecycle: "active" | "paused" | "expired";
  affects_selected_month: boolean;
}

export interface RecurringOccurrence {
  id: number;
  due_date: string;
  amount: number;
  status: string;
  status_display: string;
  rule: RecurringRule;
}

export interface SubscriptionCandidate {
  key: string;
  normalized_description: string;
  evidence_signature: string;
  description: string;
  median_amount: number;
  annual_cost: number;
  confirmed_annual_cost: number | null;
  monthly_periodicity_confirmed: boolean;
  months_seen: number;
  typical_day: number;
  last_date: string;
  latest_amount: number;
  latest_month_median: number;
  previous_median: number;
  exceptional_charge: boolean;
  confirmed_step_change: boolean;
  has_category_rule: boolean;
  has_recurring_rule: boolean;
  review_status: "pending" | "accepted" | "dismissed";
  review_reason: "new" | "material_change" | "review_due" | "";
  reviewed_status: "accepted" | "dismissed" | null;
  review_revision: number;
  next_review_date: string | null;
  reviewed_at: string | null;
  account: {id: number; name: string};
  category: {id: number; name: string; display_name: string};
  movements_url: string;
  category_rule_input: CategoryRuleDraftInput;
  recurring_rule_input: {
    name: string;
    kind: BasicKind;
    amount: number;
    account: number;
    category: number;
    frequency: string;
    day_of_month: number;
    start_date: string;
    end_date: string;
    notes: string;
    active: boolean;
  };
}

export interface PlanningPayload {
  period: {
    month: string;
    start: string;
    end: string;
    as_of: string;
    status: "past" | "current" | "future";
    partial: boolean;
  };
  goal: {
    configured: boolean;
    active: boolean;
    percentage: number;
    minimum: number;
    target: number;
  };
  savings_objectives: {
    items: SavingsObjective[];
    summary: SavingsObjectiveSummary;
  };
  margin: {
    expected_income: number;
    confirmed_expense: number;
    pending_recurring: number;
    savings_goal: number;
    available: number;
  };
  metrics: Metrics;
  projection: Projection | null;
  subscription_candidates: SubscriptionCandidate[];
  budget_progress: BudgetItem[];
  budgets: Budget[];
  rules: RecurringRule[];
  occurrences: RecurringOccurrence[];
  accounts: Account[];
  categories: Category[];
}

export interface SavingsObjective {
  id: number;
  name: string;
  target_amount: number;
  target_date: string;
  priority: 1 | 2 | 3;
  assigned_amount: number;
  remaining_amount: number;
  archived: boolean;
  achieved: boolean;
  revision: number;
  recurring_rule_id: number | null;
  annual_reserve: {
    rule_id: number;
    rule_name: string;
    status: "active" | "overdue" | "paused" | "ended" | "suspended" | "archived";
    due_date: string;
    months_remaining: number | null;
    remaining_amount: number;
    monthly_amount: number | null;
  } | null;
}

export interface SavingsObjectiveSummary {
  ledger_balance: number;
  eligible_balance: number;
  assigned_total: number;
  free_to_assign: number;
  overallocated: boolean;
  overallocated_by: number;
  confirmation_token: string;
}

export interface PlanningCalendarItem {id: string; date: string; description: string; amount: number; kind: string; state: string; account: string; is_transfer: boolean}
export interface PlanningCalendarDay {date: string; in_month: boolean; confirmed: PlanningCalendarItem[]; forecast: PlanningCalendarItem[]; income: number; expense: number; transfer_net: number; actual_income: number; actual_expense: number; actual_transfer_net: number; projected_income: number; projected_expense: number; projected_transfer_net: number; actual_count: number; projected_count: number; has_income: boolean; has_expense: boolean; has_transfer: boolean; ending_balance: number}
export interface PlanningCalendarPayload {month: string; currency: string; period: {start: string; end: string; as_of: string; status: string}; days: PlanningCalendarDay[]; confirmed_count: number; forecast_count: number; warning: string}

export interface LiquidityCashflow {
  date: string;
  account_id: number;
  kind: "income" | "expense" | "transfer_in" | "transfer_out";
  state: "confirmed" | "forecast" | "forecast_before_start";
  amount: number;
  signed_amount: number;
  description: string;
  origin: string;
  source_id: number;
  transfer_group: string;
}

export interface LiquidityDailyPoint {
  date: string;
  opening_balance: number | null;
  closing_balance: number | null;
  confirmed_net_cashflow: number;
  forecast_net_cashflow: number;
  confirmed_income: number;
  confirmed_expense: number;
  confirmed_transfer_net: number;
  forecast_income: number;
  forecast_expense: number;
  forecast_transfer_net: number;
  cashflows: LiquidityCashflow[];
}

export interface LiquidityAccountForecast {
  account_id: number;
  name: string;
  status: "known" | "unknown";
  starting_balance: number | null;
  provenance: {kind: string; cut_date: string | null; observed_at?: string | null; balance_type?: string; currency?: string};
  unknown_reasons: string[];
  starting_adjustments: LiquidityCashflow[];
  minimum_balance: number | null;
  minimum_date: string | null;
  first_deficit_date: string | null;
  daily_series: LiquidityDailyPoint[];
}

export interface LiquidityForecast {
  date_from: string;
  date_to: string;
  currency: "EUR";
  status: "known" | "unknown";
  accounts: LiquidityAccountForecast[];
  starting_balance: number | null;
  daily_series: LiquidityDailyPoint[];
  minimum_balance: number | null;
  minimum_date: string | null;
  first_deficit_date: string | null;
  assumptions: string[];
}
