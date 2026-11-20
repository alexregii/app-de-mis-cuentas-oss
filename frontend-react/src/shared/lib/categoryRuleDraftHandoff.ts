import type {CategoryRuleDraftInput} from "../model/categories";

const key = "mis-cuentas:category-rule-draft";
const maxAgeMs = 5 * 60 * 1000;

export function storeCategoryRuleDraftHandoff(draft: CategoryRuleDraftInput) {
  try {
    sessionStorage.setItem(key, JSON.stringify({createdAt: Date.now(), draft}));
  } catch {
    return false;
  }
  return true;
}

export function consumeCategoryRuleDraftHandoff(): CategoryRuleDraftInput | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const handoff = JSON.parse(raw) as {createdAt?: unknown; draft?: unknown};
    const draft = handoff.draft as CategoryRuleDraftInput | undefined;
    const validMode = draft && ["exact", "contains", "starts_with", "ends_with"].includes(draft.match_mode);
    const validAmount = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
    if (
      typeof handoff.createdAt !== "number" || Date.now() - handoff.createdAt > maxAgeMs || handoff.createdAt > Date.now() + 30_000
      || !draft || typeof draft.description !== "string" || !draft.description.trim()
      || !["income", "expense"].includes(draft.kind) || !Number.isInteger(draft.category) || draft.category < 1
      || !Number.isInteger(draft.priority) || draft.priority < 1 || !validMode
      || !(draft.account === null || (Number.isInteger(draft.account) && draft.account > 0))
      || !validAmount(draft.amount_min) || !validAmount(draft.amount_max) || typeof draft.active !== "boolean"
    ) return null;
    return draft;
  } catch {
    return null;
  }
}
