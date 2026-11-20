import type {Account} from "../../shared/model/accounts";
import type {Category} from "../../shared/model/categories";
import type {BasicKind} from "../../shared/model/common";

export interface CategoryRule {
  id: number;
  description: string;
  kind: BasicKind;
  category: Category;
  active: boolean;
  updated_at: string;
  priority: number;
  match_mode: "exact" | "contains" | "starts_with" | "ends_with";
  account: Account | null;
  amount_min: number | null;
  amount_max: number | null;
  last_tested_at: string;
  last_test_result: Record<string, unknown>;
  application_count: number;
}

export interface CategoryRulePreview {
  transactions: number;
  bank_rows: number;
  csv_rows: number;
  total: number;
  changes: number;
  already_categorized: number;
  examples: Array<{description: string; amount: string}>;
}

export interface CategoryRuleApplyResult extends Pick<CategoryRulePreview, "transactions" | "bank_rows" | "csv_rows" | "total"> {
  application_id: number;
}

export interface CategoryRuleApplication {
  id: number;
  rule_id: number | null;
  rule_description: string;
  applied_at: string;
  status: "completed" | "undone" | "partial";
  reversible: boolean;
  target_category_id: number | null;
  transactions: number;
  bank_rows: number;
  csv_rows: number;
  total: number;
}

export interface AutomationSettings {
  id: number;
  llm_enabled: boolean;
  auto_apply_enabled: boolean;
  auto_apply_effective?: boolean;
  promotion_status?: "NO_PROMOTION" | "PROMOTED";
  confidence_threshold: number;
  updated_at: string;
}
