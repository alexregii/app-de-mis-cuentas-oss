import {hasCategoryRuleDraftContent, sameCategoryRuleDraft, type CategoryRuleFormValues} from "./CategorySettingsModel";

type DraftKey = number | "new";
export type CategoryRuleDraftKey = DraftKey;
export type CategoryRuleDraftSaveNotice = {key: DraftKey; submittedDraft: CategoryRuleFormValues; origin: Map<DraftKey, CategoryRuleFormValues>};
const storageKey = "mis-cuentas:settings:category-rule-drafts";
const maxAgeMs = 24 * 60 * 60 * 1000;
const savedEvent = "mis-cuentas:category-rule-draft-saved";

const isDraft = (value: unknown): value is CategoryRuleFormValues => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CategoryRuleFormValues>;
  return typeof draft.description === "string"
    && (draft.kind === "expense" || draft.kind === "income")
    && typeof draft.category === "string"
    && typeof draft.priority === "string"
    && ["exact", "contains", "starts_with", "ends_with"].includes(draft.match_mode || "")
    && typeof draft.account === "string"
    && typeof draft.amount_min === "string"
    && typeof draft.amount_max === "string"
    && typeof draft.active === "boolean";
};

export function restoreCategoryRuleDrafts(): Map<DraftKey, CategoryRuleFormValues> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return new Map();
    sessionStorage.removeItem(storageKey);
    const stored = JSON.parse(raw) as {savedAt?: unknown; drafts?: unknown};
    if (typeof stored.savedAt !== "number" || Date.now() - stored.savedAt > maxAgeMs || stored.savedAt > Date.now() + 30_000 || !Array.isArray(stored.drafts)) return new Map();
    const restored = new Map<DraftKey, CategoryRuleFormValues>();
    for (const entry of stored.drafts) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, draft] = entry as [unknown, unknown];
      if (!(key === "new" || (typeof key === "number" && Number.isInteger(key) && key > 0)) || !isDraft(draft) || !hasCategoryRuleDraftContent(draft)) continue;
      restored.set(key, draft);
    }
    return restored;
  } catch {
    return new Map();
  }
}

export function storeCategoryRuleDrafts(drafts: Map<DraftKey, CategoryRuleFormValues>) {
  try {
    const entries = [...drafts.entries()].filter(([, draft]) => hasCategoryRuleDraftContent(draft));
    if (!entries.length) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, JSON.stringify({savedAt: Date.now(), drafts: entries}));
  } catch {
    // Draft preservation is best-effort when session storage is unavailable.
  }
}

export function removeSavedCategoryRuleDraft(key: DraftKey, submittedDraft: CategoryRuleFormValues) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    const stored = JSON.parse(raw) as {savedAt?: unknown; drafts?: unknown};
    if (!Array.isArray(stored.drafts)) return;
    const remaining = stored.drafts.filter((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) return true;
      const [storedKey, storedDraft] = entry as [unknown, unknown];
      if (storedKey !== key || !isDraft(storedDraft)) return true;
      return !sameCategoryRuleDraft(storedDraft, submittedDraft);
    });
    if (!remaining.length) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, JSON.stringify({savedAt: Date.now(), drafts: remaining}));
  } catch {
    // A saved request must not fail because its local draft could not be cleared.
  }
}

export function notifyCategoryRuleDraftSaved(detail: CategoryRuleDraftSaveNotice) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(savedEvent, {detail}));
}

export function subscribeToCategoryRuleDraftSaved(listener: (detail: CategoryRuleDraftSaveNotice) => void) {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<CategoryRuleDraftSaveNotice>).detail;
    if (!detail || !(detail.key === "new" || (typeof detail.key === "number" && Number.isInteger(detail.key) && detail.key > 0)) || !isDraft(detail.submittedDraft) || !(detail.origin instanceof Map)) return;
    listener(detail);
  };
  window.addEventListener(savedEvent, handle);
  return () => window.removeEventListener(savedEvent, handle);
}
