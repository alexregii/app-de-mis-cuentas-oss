import type {BasicKind} from "./common";

export interface Category {
  id: number;
  name: string;
  display_name: string;
  kind: BasicKind;
  color: string;
  icon: string;
  active: boolean;
  parent_id: number | null;
  exclude_from_analytics: boolean;
  sort_order: number;
  is_favorite: boolean;
  merged_into?: number | null;
  deactivated_at?: string;
  transaction_count?: number;
  child_count?: number;
  last_used_at?: string;
}

export type CategoryRuleMatch = Readonly<{
  id: number;
  description: string;
  kind: BasicKind;
  category: Category;
  priority: number;
  match_mode: "exact" | "contains" | "starts_with" | "ends_with";
  account_id: number | null;
  amount_min: number | null;
  amount_max: number | null;
}>;

export type CategoryRuleDraftInput = {
  description: string;
  kind: BasicKind;
  category: number;
  priority: number;
  match_mode: "exact" | "contains" | "starts_with" | "ends_with";
  account: number | null;
  amount_min: number | null;
  amount_max: number | null;
  active: boolean;
};
