import type {Account, Connection} from "./accounts";
import type {Category} from "./categories";
import type {Choice} from "./common";
import type {DashboardData, DashboardPreferences} from "./dashboard";
import type {AttentionSignal, Metrics, Review} from "./metrics";
import type {BudgetItem} from "./planning";
import type {Transaction} from "./transactions";

export interface RefundCandidate {
  id: number;
  kind: "expense";
  amount: number;
  date: string;
  description: string;
}

export interface DashboardActivation {
  has_active_account: boolean;
  has_reviewed_movement: boolean;
  pending_review_count: number;
  has_savings_objective: boolean;
  distinct_activity_months: number;
  is_mature: boolean;
  time_to_first_reviewed_movement_seconds: number | null;
}

export interface BootstrapPayload {
  csrf_token: string;
  metrics: Metrics;
  review: Review;
  accounts: Account[];
  categories: Category[];
  recent: Transaction[];
  budget_items: BudgetItem[];
  signals: AttentionSignal[];
  connections: Connection[];
  preferences: DashboardPreferences;
  dashboard: DashboardData;
  review_queue?: Array<{id: string; type: string; priority: number; title: string; detail: string; impact: number; href: string}>;
  activation?: DashboardActivation;
}

export interface OptionsPayload {
  refund_candidates: RefundCandidate[];
  account_kinds: Choice[];
  category_kinds: Choice[];
  transaction_kinds: Choice[];
  transaction_sources: Choice[];
  recurring_frequencies: Choice[];
}
