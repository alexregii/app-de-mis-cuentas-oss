import {jsonBody, request} from "../../shared/api/client";
import type {Category} from "../../shared/model/categories";
import type {AutomationSettings, CategoryRule, CategoryRuleApplication, CategoryRuleApplyResult, CategoryRulePreview} from "./types";

export type RestoreStatus = "idle" | "staged" | "validating" | "backing_up_current" | "quiescing" | "restoring" | "starting" | "verifying" | "completed" | "rolling_back" | "failed";
export type RuntimeHealth = {status: "ok"; date: string};
export type ScheduledBackupStatus = {
  worker: "healthy" | "stale";
  schedule: "healthy" | "failed" | "missing" | "stale";
  heartbeat_at: string | null;
  last_failure_at: string | null;
  last_success_at: string | null;
};
export type RecoveryPayload = {ok: true; latest_backup: {name: string; created_at: string; size: number; destination: string} | null; backup_status: ScheduledBackupStatus; restore: {available: boolean; status: {status: RestoreStatus; message: string} | null}};

export const settingsApi = {
  categories: (options: Pick<RequestInit, "cache"> = {}) => request<{categories: Category[]; roots: Array<Category & {children: Category[]}>}>("/api/categories/", options),
  createCategory: (input: Record<string, unknown>) => request<{ok: true; category: Category}>("/api/categories/", {method: "POST", body: jsonBody(input)}),
  updateCategory: (id: number, input: Record<string, unknown>) =>
    request<{ok: true; category: Category}>(`/api/categories/${id}/`, {method: "PATCH", body: jsonBody(input)}),
  previewDeactivateCategory: (id: number) => request<{ok: true; impact: Record<string, unknown>}>(`/api/categories/${id}/preview-deactivate/`, {method: "POST"}),
  deactivateCategory: (id: number) => request<{ok: true; category: Category}>(`/api/categories/${id}/deactivate/`, {method: "POST"}),
  categoryOrder: (order: Array<{id: number; parent_id: number | null}>) => request<{ok: true}>("/api/categories/order/", {method: "PUT", body: jsonBody({order})}),
  categoryFavorites: (category_ids: number[]) => request<{ok: true}>("/api/categories/favorites/", {method: "PUT", body: jsonBody({category_ids})}),
  categoryDuplicates: () => request<{groups: Category[][]}>("/api/categories/duplicates/"),
  categoryUnused: (days = 365) => request<{categories: Category[]; cutoff: string}>(`/api/categories/unused/?days=${days}`),
  previewCategoryMerge: (source_ids: number[], destination_id: number) => request<{ok: true; sources: Array<Record<string, unknown>>; totals: Record<string, number>}>("/api/categories/merge-preview/", {method: "POST", body: jsonBody({source_ids, destination_id})}),
  mergeCategories: (source_ids: number[], destination_id: number) => request<{ok: true; operation: {id: number}; category: Category}>("/api/categories/merge/", {method: "POST", body: jsonBody({source_ids, destination_id})}),
  undoCategoryMerge: (id: number) => request<{ok: true}>(`/api/categories/merge/${id}/undo/`, {method: "POST"}),
  categoryRules: () => request<{rules: CategoryRule[]}>("/api/category-rules/"),
  createCategoryRule: (input: Record<string, unknown>) =>
    request<{ok: true; rule: CategoryRule}>("/api/category-rules/", {method: "POST", body: jsonBody(input)}),
  updateCategoryRule: (id: number, input: Record<string, unknown>) =>
    request<{ok: true; rule: CategoryRule}>(`/api/category-rules/${id}/`, {method: "PATCH", body: jsonBody(input)}),
  deleteCategoryRule: (id: number) => request<{ok: true; message: string}>(`/api/category-rules/${id}/`, {method: "DELETE"}),
  applyCategoryRule: (id: number) => request<{ok: true; message: string; result: CategoryRuleApplyResult}>(`/api/category-rules/${id}/apply/`, {method: "POST"}),
  previewCategoryRule: (id: number) => request<{ok: true; result: CategoryRulePreview}>(`/api/category-rules/${id}/preview/`, {method: "POST"}),
  undoCategoryRule: (id: number, applicationId: number) => request<{ok: true; partial: boolean}>(`/api/category-rules/${id}/undo/${applicationId}/`, {method: "POST"}),
  categoryRuleApplications: (offset = 0, limit = 20) => request<{applications: CategoryRuleApplication[]; next_offset: number | null}>(`/api/category-rule-applications/?limit=${limit}&offset=${offset}`),
  categoryRuleOrder: (rule_ids: number[]) => request<{ok: true}>("/api/category-rules/order/", {method: "PUT", body: jsonBody({rule_ids})}),
  categoryRuleConflicts: () => request<{conflicts: Array<Record<string, unknown>>}>("/api/category-rules/conflicts/"),
  automation: () => request<{ok: true; automation: AutomationSettings}>("/api/settings/automation/"),
  updateAutomation: (input: Record<string, unknown>) =>
    request<{ok: true; automation: AutomationSettings}>("/api/settings/automation/", {method: "PUT", body: jsonBody(input)}),
  recovery: () => request<RecoveryPayload>("/api/recovery/"),
  runtimeHealth: () => request<RuntimeHealth>("/health/", {cache: "no-store"}),
  createBackup: () => request<RecoveryPayload>("/api/recovery/", {method: "POST"}),
  previewRestore: (archive: File) => { const body = new FormData(); body.set("archive", archive); return request<{ok: true; token: string; impact: {files: number; media_files: number; size: number}}>("/api/recovery/restore/preview/", {method: "POST", body}); },
  restore: (token: string, confirmation: string) => request<{ok: true; message: string}>("/api/recovery/restore/", {method: "POST", body: jsonBody({token, confirmation})}),
};
