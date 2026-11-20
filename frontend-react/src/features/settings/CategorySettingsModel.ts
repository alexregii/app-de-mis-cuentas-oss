import type {Dispatch, SetStateAction} from "react";
import {euro} from "../../format";
import type {Account} from "../../shared/model/accounts";
import type {Category, CategoryRuleDraftInput} from "../../shared/model/categories";
import type {CategoryRule} from "./types";

export type CategoryRuleFormValues = {
  description: string;
  kind: CategoryRule["kind"];
  category: string;
  priority: string;
  match_mode: CategoryRule["match_mode"];
  account: string;
  amount_min: string;
  amount_max: string;
  active: boolean;
};

export const emptyCategoryRuleForm = (): CategoryRuleFormValues => ({description: "", kind: "expense", category: "", priority: "100", match_mode: "exact", account: "", amount_min: "", amount_max: "", active: true});

export const ruleDraftValuesFromSuggestion = (draft: CategoryRuleDraftInput): CategoryRuleFormValues => ({
  description: draft.description,
  kind: draft.kind,
  category: String(draft.category),
  priority: String(draft.priority),
  match_mode: draft.match_mode,
  account: draft.account === null ? "" : String(draft.account),
  amount_min: draft.amount_min === null ? "" : String(draft.amount_min),
  amount_max: draft.amount_max === null ? "" : String(draft.amount_max),
  active: draft.active,
});

export const hasCategoryRuleDraftContent = (draft?: CategoryRuleFormValues) => Boolean(draft && (
  draft.description.trim() || draft.category || draft.account || draft.amount_min || draft.amount_max
  || draft.kind !== "expense" || draft.priority !== "100" || draft.match_mode !== "exact" || !draft.active
));

export const sameCategoryRuleDraft = (left?: CategoryRuleFormValues, right?: CategoryRuleFormValues) => Boolean(left && right
  && left.description === right.description && left.kind === right.kind && left.category === right.category
  && left.priority === right.priority && left.match_mode === right.match_mode && left.account === right.account
  && left.amount_min === right.amount_min && left.amount_max === right.amount_max && left.active === right.active);

export type CategorySettingsPanelsProps = {
  categories: Category[];
  rules: CategoryRule[];
  load: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
  accounts?: Account[];
  showCategories?: boolean;
  showRules?: boolean;
  showCategoryFormToggle?: boolean;
  showCategoryList?: boolean;
  categoryIntent?: {id: number | null; token: number};
  openRule?: boolean;
  openRuleList?: boolean;
  selectedRuleId?: number | null;
  ruleDraftSuggestion?: CategoryRuleDraftInput | null;
  onRuleDraftSuggestionConsumed?: () => void;
  onCategoryUpdated?: (category: Category) => void;
};

export const matchModeLabel = (mode: CategoryRule["match_mode"]) => ({exact: "es exactamente", contains: "contiene", starts_with: "empieza por", ends_with: "termina en"})[mode];
export const ruleCountLabel = (count: number) => `${count} ${count === 1 ? "regla" : "reglas"}`;

export const ruleScope = (rule: CategoryRule) => [
  `Prioridad ${rule.priority}`,
  rule.account ? `Cuenta: ${rule.account.name}` : "Cualquier cuenta",
  rule.amount_min !== null || rule.amount_max !== null ? `Importe: ${rule.amount_min === null ? "sin mínimo" : euro(rule.amount_min)}–${rule.amount_max === null ? "sin máximo" : euro(rule.amount_max)}` : "Cualquier importe",
  rule.active ? "Activa" : "Inactiva",
].join(" · ");

export const ruleFormValues = (rule: CategoryRule): CategoryRuleFormValues => ({
  description: rule.description,
  kind: rule.kind,
  category: String(rule.category.id),
  priority: String(rule.priority),
  match_mode: rule.match_mode,
  account: String(rule.account?.id || ""),
  amount_min: rule.amount_min === null ? "" : String(rule.amount_min),
  amount_max: rule.amount_max === null ? "" : String(rule.amount_max),
  active: rule.active,
});
