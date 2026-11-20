export type StatisticsBasis = "analytics" | "all";
export type StatisticsPeriod = "3" | "6" | "12" | "custom";
export type StatisticsActivityStatus = "recorded" | "unknown";

export interface StatisticsScope {
  period: StatisticsPeriod;
  basis: StatisticsBasis;
  basis_label: string;
  date_from: string;
  date_to: string;
  label: string;
  is_partial: boolean;
}

export interface StatisticsSummary {
  income: number;
  net_expense: number;
  refunds_applied: number;
  analytical_result: number;
  savings_rate: number | null;
}

export interface StatisticsAmountChange {
  amount: number;
  percentage: number | null;
}

export interface StatisticsCategoryDriver {
  family_id: number | null;
  family_name: string;
  current_net_expense: number;
  previous_net_expense: number;
  change: number;
  current_movements_url: string;
  previous_movements_url: string;
}

export interface StatisticsComparison {
  scope: {
    date_from: string;
    date_to: string;
    label: string;
  };
  previous: StatisticsSummary;
  changes: {
    income: StatisticsAmountChange;
    net_expense: StatisticsAmountChange;
    analytical_result: StatisticsAmountChange;
    savings_rate: {percentage_points: number | null};
  };
  category_drivers: StatisticsCategoryDriver[];
  category_variations?: StatisticsCategoryVariation[];
  previous_activity_status: StatisticsActivityStatus;
  is_comparable: boolean;
}

export interface StatisticsMonthlyPoint extends StatisticsSummary {
  month: string;
  activity_status: StatisticsActivityStatus;
  date_from: string;
  date_to: string;
  is_partial: boolean;
  is_complete: boolean;
  detail_url: string;
  movements_url: string;
  result_change?: number | null;
  expense_change?: number | null;
}

export interface StatisticsCategoryVariation {
  family_id: number | null;
  family_name: string;
  current_net_expense: number;
  previous_net_expense: number;
  change: number;
  percentage: number | null;
  current_movements_url: string;
  previous_movements_url: string;
}

export interface StatisticsObservedExpense {
  description: string;
  net_expense: number;
  transaction_count: number;
  last_date: string;
  active_months: number;
  typical_monthly_expense: number;
  percentage: number;
  movements_url: string;
}

export interface StatisticsCategoryMatrixValue {
  month: string;
  net_expense: number;
  movements_url: string;
}

export interface StatisticsCategoryMatrixRow {
  family_id: number | null;
  family_name: string;
  net_expense: number;
  values: StatisticsCategoryMatrixValue[];
}

export interface StatisticsAnalysis {
  merchants: StatisticsObservedExpense[];
  recurring: StatisticsObservedExpense[];
  category_matrix: {
    months: Array<{month: string; is_partial: boolean; activity_status: StatisticsActivityStatus}>;
    rows: StatisticsCategoryMatrixRow[];
  };
}

export interface StatisticsDataQuality {
  uncategorized: {count: number; net_expense: number; movements_url: string};
  transfers_excluded: {count: number};
  possible_bank_transfers: {count: number};
  basis: StatisticsBasis;
}

export interface StatisticsSubcategory {
  category_id: number | null;
  name: string;
  gross_expense: number;
  refunds_applied: number;
  net_expense: number;
  percentage_of_family: number;
  movements_url: string;
}

export interface StatisticsCategoryFamily {
  family_id: number | null;
  family_name: string;
  color: string;
  gross_expense: number;
  refunds_applied: number;
  net_expense: number;
  percentage: number;
  movements_url: string;
  subcategories: StatisticsSubcategory[];
}

export interface StatisticsImportCoverage {
  status: "clear" | "pending";
  pending_count: number;
  last_activity_at: string | null;
}

export interface StatisticsBankingCoverage {
  status: "not_configured" | "current" | "attention";
  pending_count: number;
  last_synced_at: string | null;
}

export interface StatisticsCoverage {
  imports: StatisticsImportCoverage;
  banking: StatisticsBankingCoverage;
}

export interface StatisticsExcludedCategory {
  family_id: number | null;
  family_name: string;
  net_expense: number;
  movements_url: string;
}

export interface StatisticsBasisReconciliation {
  excluded_summary: Pick<StatisticsSummary, "income" | "net_expense" | "analytical_result">;
  excluded_categories: StatisticsExcludedCategory[];
}

export interface StatisticsPayload {
  scope: StatisticsScope;
  summary: StatisticsSummary;
  activity_status: StatisticsActivityStatus;
  comparison: StatisticsComparison;
  monthly_series: StatisticsMonthlyPoint[];
  categories: StatisticsCategoryFamily[];
  coverage?: StatisticsCoverage;
  basis_reconciliation?: StatisticsBasisReconciliation;
  analysis?: StatisticsAnalysis;
  data_quality?: StatisticsDataQuality;
  money_map?: {nodes: Array<{id: string; label: string; kind: string; value: number}>; links: Array<{source: string; target: string; value: number; category_family: number | null; category_families?: Array<number | null>; movements_url?: string}>; grouping: string};
}

export interface StatisticsDailyPoint extends StatisticsSummary {
  date: string;
}

export interface StatisticsRhythmPoint extends Pick<StatisticsSummary, "income" | "net_expense" | "analytical_result"> {
  date: string;
  median_income: number | null;
  median_net_expense: number | null;
  median_analytical_result: number | null;
  movements_url?: string;
}

export interface StatisticsRhythmInsight {
  comparison_months: number;
  points: StatisticsRhythmPoint[];
}

export interface StatisticsExpenseSpike {
  family_id: number | null;
  family_name: string;
  current_net_expense: number;
  median_net_expense: number;
  increase_percentage: number;
  movements_url: string;
}

export interface StatisticsSpikesInsight {
  comparison_months: number;
  available_sample_months: number;
  minimum_sample_size: number;
  items: StatisticsExpenseSpike[];
}

export interface StatisticsInsights {
  rhythm: StatisticsRhythmInsight;
  spikes: StatisticsSpikesInsight;
}

export interface MonthStatisticsPayload {
  scope: {
    selected_month: string;
    basis: StatisticsBasis;
    basis_label: string;
    date_from: string;
    date_to: string;
    label: string;
    is_partial: boolean;
  };
  activity_status: StatisticsActivityStatus;
  summary: StatisticsSummary;
  daily_series: StatisticsDailyPoint[];
  categories: StatisticsCategoryFamily[];
  movements_url: string;
  insights?: StatisticsInsights;
}

export type MonthlyCloseVerification = "current" | "stale" | "superseded" | "unknown";

export interface MonthlyCloseIssue {
  key: string;
  type: string;
  title: string;
  description: string;
  account_name?: string;
  details: Record<string, unknown>;
}

export interface MonthlyCloseAccountCheck {
  account_name: string;
  account_kind: string;
  created_at: string;
  created_after_cutoff: boolean;
  ledger_balance_at_cut: string;
  active_at_capture: boolean;
  issue_codes: string[];
  reconciliation: null | {
    date: string;
    statement_balance: string;
    ledger_balance_at_reconciliation: string;
    current_ledger_balance_at_cut: string;
    difference: string;
    status: string;
    stale: boolean;
  };
  reconciliation_history: Array<{date: string; statement_balance: string; ledger_balance: string; difference: string; status: string}>;
  bank_source: null | {
    bank_name: string;
    connection_status: string;
    sync_status: string;
    last_synced_at: string | null;
    balance: string | null;
    balance_type: string;
    balance_currency: string;
    balance_reference_date: string | null;
  };
}

export interface MonthlyCloseReport {
  scope: {month: string; date_from: string; date_to: string; cutoff: string; basis: StatisticsBasis; basis_label: string};
  activity_status: StatisticsActivityStatus;
  summary: {income: string; net_expense: string; refunds_applied: string; analytical_result: string; savings_rate: number | null};
  daily_series: Array<{date: string; income: string; net_expense: string; refunds_applied: string; analytical_result: string; source_movements_url?: string}>;
  source_movements_url?: string;
}

export interface MonthlyCloseVersion {
  month: string;
  basis: StatisticsBasis;
  version: number;
  status_at_close: "clean" | "declared";
  origin: "native" | "portable_archive";
  source_verification: MonthlyCloseVerification;
  source_digest: string;
  report: MonthlyCloseReport;
  accounts: MonthlyCloseAccountCheck[];
  issues: MonthlyCloseIssue[];
  declarations: Array<{issue_key: string; reason: string}>;
  correction_reason: string;
  created_at: string;
}

export interface MonthlyClosePreview {
  month: string;
  cutoff: string;
  basis: StatisticsBasis;
  source_digest: string;
  report: MonthlyCloseReport;
  accounts: MonthlyCloseAccountCheck[];
  issues: MonthlyCloseIssue[];
}

export interface MonthlyCloseState {
  ok: boolean;
  preview: MonthlyClosePreview;
  versions: MonthlyCloseVersion[];
  created?: boolean;
}

export interface MonthlyCloseRequest {
  month: string;
  basis: StatisticsBasis;
  source_digest: string;
  idempotency_key: string;
  declarations: Record<string, string>;
  correction_reason: string;
}

export interface StatisticsDateRange {
  from: string;
  to: string;
}
