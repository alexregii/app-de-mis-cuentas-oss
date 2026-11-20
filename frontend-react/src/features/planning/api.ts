import {jsonBody, request} from "../../shared/api/client";
import type {Budget, LiquidityForecast, PlanningCalendarPayload, PlanningPayload, RecurringRule, SavingsObjective, SavingsObjectiveSummary, SubscriptionCandidate} from "../../shared/model/planning";

const planningPath = (month?: string) => `/api/planning/${month ? `?month=${encodeURIComponent(month)}` : ""}`;

export type BudgetCopyPreviewItem = {
  category: {id: number; display_name: string; active: boolean; kind: string};
  source_limit: string;
  destination_limit: string | null;
  status: "new" | "existing" | "inactive" | "unsupported";
  can_copy: boolean;
  selected_by_default: boolean;
};

export type BudgetCopyPreview = {
  ok: true;
  source_month: string;
  target_month: string;
  preview_token: string;
  items: BudgetCopyPreviewItem[];
};

export type BudgetCopyResult = {
  ok: true;
  created: number;
  updated: number;
  unchanged: number;
  budget_ids: number[];
};

export type SavingsObjectiveMutation = {
  ok: true;
  objective: SavingsObjective;
  summary: SavingsObjectiveSummary;
  created?: boolean;
};

export type SavingsObjectiveCreate = {
  name: string;
  target_amount: string;
  target_date: string;
  priority: 1 | 2 | 3;
  idempotency_key: string;
};

export type AnnualReserveCreate = {recurring_rule_id: number; idempotency_key: string};
export type SavingsObjectiveUpdate = {
  expected_revision: number;
  recurring_rule_id?: null;
  name?: string;
  target_amount?: string;
  target_date?: string;
  priority?: 1 | 2 | 3;
  archived?: boolean;
  confirm_overallocation?: boolean;
  confirmed_snapshot?: string;
};

export type SavingsObjectiveAllocation = {
  expected_revision: number;
  assigned_amount: string;
  confirm_overallocation?: boolean;
  confirmed_snapshot?: string;
};

export const planningApi = {
  savingsGoal: () => request<{ok: boolean; goal: {id: number | null; percentage: number; minimum: number; active: boolean; updated_at: string}}>("/api/settings/savings-goal/"),
  updateSavingsGoal: (input: {percentage: string; minimum: string; active: boolean}) => request<{ok: boolean; goal: {id: number | null; percentage: number; minimum: number; active: boolean; updated_at: string}}>("/api/settings/savings-goal/", {method: "PUT", body: jsonBody(input)}),
  createSavingsObjective: (input: SavingsObjectiveCreate | AnnualReserveCreate) => request<SavingsObjectiveMutation>("/api/planning/savings-objectives/", {method: "POST", body: jsonBody(input)}),
  updateSavingsObjective: (id: number, input: SavingsObjectiveUpdate) => request<SavingsObjectiveMutation>("/api/planning/savings-objectives/" + id + "/", {method: "PATCH", body: jsonBody(input)}),
  updateSavingsObjectiveAllocation: (id: number, input: SavingsObjectiveAllocation) => request<SavingsObjectiveMutation>("/api/planning/savings-objectives/" + id + "/allocation/", {method: "PUT", body: jsonBody(input)}),
  planning: (month?: string, options?: RequestInit, shouldCache?: (payload: PlanningPayload) => boolean) => request<PlanningPayload>(planningPath(month), options, shouldCache),
  calendar: (month: string) => request<PlanningCalendarPayload>(`/api/planning/calendar/?month=${encodeURIComponent(month)}`),
  liquidity: (account: number, dateFrom: string, dateTo: string) => {
    const params = new URLSearchParams({account: String(account), date_from: dateFrom, date_to: dateTo});
    return request<LiquidityForecast>(`/api/planning/liquidity/?${params}`, {cache: "no-store"});
  },
  prepare: (month: string) => request<{ok: true; month: string; created: number}>("/api/planning/prepare/", {method: "POST", body: jsonBody({month})}),
  createBudget: (input: Record<string, unknown>) => request<{ok: true; budget: Budget}>("/api/budgets/", {method: "POST", body: jsonBody(input)}),
  previewBudgetCopy: (sourceMonth: string, targetMonth: string) => request<BudgetCopyPreview>(
    `/api/budgets/copy-preview/?source_month=${encodeURIComponent(sourceMonth)}&target_month=${encodeURIComponent(targetMonth)}`,
    {cache: "no-store"},
  ),
  copyBudgets: (previewToken: string, selectedCategoryIds: number[]) => request<BudgetCopyResult>("/api/budgets/copy/", {
    method: "POST",
    body: jsonBody({preview_token: previewToken, selected_category_ids: selectedCategoryIds}),
  }),
  updateBudget: (id: number, input: Record<string, unknown>) =>
    request<{ok: true; budget: Budget}>(`/api/budgets/${id}/`, {method: "PATCH", body: jsonBody(input)}),
  deleteBudget: (id: number) => request<{ok: true; message: string}>(`/api/budgets/${id}/`, {method: "DELETE"}),
  createRecurringRule: (input: Record<string, unknown>) =>
    request<{ok: true; rule: RecurringRule}>("/api/recurring-rules/", {method: "POST", body: jsonBody(input)}),
  createCategoryRuleFromCandidate: (input: SubscriptionCandidate["category_rule_input"]) =>
    request<{ok: true}>("/api/category-rules/", {method: "POST", body: jsonBody(input)}),
  reviewSubscription: (input: {
    account_id: number;
    normalized_description: string;
    evidence_signature: string;
    expected_revision: number;
    action: "accept" | "dismiss";
    next_review_date: string | null;
    monthly_periodicity_confirmed: boolean;
    confirmed_annual_cost: string | null;
  }) => request<{ok: true; idempotent: boolean}>("/api/subscription-reviews/", {method: "POST", body: jsonBody(input)}),
  updateRecurringRule: (id: number, input: Record<string, unknown>) =>
    request<{ok: true; rule: RecurringRule}>(`/api/recurring-rules/${id}/`, {method: "PATCH", body: jsonBody(input)}),
  setRecurringRuleActive: (id: number, active: boolean) =>
    request<{ok: true; rule: RecurringRule}>(`/api/recurring-rules/${id}/`, {method: "PATCH", body: jsonBody({active})}),
  occurrenceAction: (id: number, action: "confirm" | "skip") => request(`/api/occurrences/${id}/${action}/`, {method: "POST"}),
};
