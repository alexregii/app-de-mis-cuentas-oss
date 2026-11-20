import type {ReviewCategoryRuleMatch} from "./types";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";

export type ReviewRuleGroup = Readonly<{
  id: string;
  source: PreparedReview["source"];
  accountId: number;
  batchId: number | null;
  kind: PreparedReview["draft"]["kind"];
  rule: ReviewCategoryRuleMatch;
  rows: readonly PreparedReview[];
}>;

export type ReviewRuleConflict = Readonly<{
  prepared: PreparedReview;
  matches: readonly ReviewCategoryRuleMatch[];
  reason: string;
}>;

const ruleOrder = (left: ReviewCategoryRuleMatch, right: ReviewCategoryRuleMatch) =>
  left.priority - right.priority || left.description.localeCompare(right.description) || left.id - right.id;

function individualReason(prepared: PreparedReview, matches: readonly ReviewCategoryRuleMatch[]) {
  if (new Set(matches.map((rule) => rule.category.id)).size > 1) return "Varias reglas coinciden con categorías distintas.";
  if (!matches[0].category.active) return "La categoría de la regla ya no está activa.";
  if (prepared.attentionIssues.length) return prepared.attentionIssues.map((issue) => issue.message).join(" ");
  if (prepared.capabilities.canChooseRefund) return "Los posibles reembolsos se revisan individualmente.";
  if (prepared.draft.kind === "transfer" || matches[0].kind !== prepared.draft.kind) return "Los traspasos se revisan individualmente.";
  const nonCategoryIssues = prepared.blockingIssues.filter((issue) => issue.code !== "category-missing");
  if (nonCategoryIssues.length) return nonCategoryIssues.map((issue) => issue.message).join(" ");
  if (!prepared.contextAccountId) return "No se pudo verificar la cuenta de contexto.";
  if (prepared.draft.category && prepared.draft.category !== String(matches[0].category.id)) return "La categoría del borrador difiere de la regla; se conserva para revisión individual.";
  if (prepared.draftIsDirty) return "El borrador tiene cambios sin aplicar; se conserva para revisión individual.";
  if (prepared.suggestion?.category && prepared.suggestion.category.name !== matches[0].category.display_name) {
    return "La sugerencia automática difiere de la regla; revisa la fila individualmente.";
  }
  return "";
}

export function buildReviewRuleGroups(preparedRows: readonly PreparedReview[]): {groups: ReviewRuleGroup[]; conflicts: ReviewRuleConflict[]} {
  const grouped = new Map<string, {source: PreparedReview["source"]; accountId: number; batchId: number | null; kind: PreparedReview["draft"]["kind"]; rule: ReviewCategoryRuleMatch; rows: PreparedReview[]}>();
  const conflicts: ReviewRuleConflict[] = [];
  for (const prepared of preparedRows) {
    const matches = prepared.categoryRuleMatches ?? [];
    if (!matches.length || prepared.decision !== "pending") continue;
    const reason = individualReason(prepared, matches);
    if (reason) {
      conflicts.push({prepared, matches, reason});
      continue;
    }
    const rule = matches[0];
    const accountId = prepared.contextAccountId!;
    const batchId = prepared.contextBatchId ?? null;
    const id = `${prepared.source}:${batchId ?? "bank"}:${accountId}:${prepared.draft.kind}:${rule.id}:${rule.category.id}`;
    const current = grouped.get(id) ?? {source: prepared.source, accountId, batchId, kind: prepared.draft.kind, rule, rows: []};
    current.rows.push(prepared);
    grouped.set(id, current);
  }
  const groups = [...grouped.entries()]
    .filter(([, group]) => group.rows.length > 1)
    .map(([id, group]) => ({
      id,
      ...group,
      rows: [...group.rows].sort((left, right) => left.item.date.localeCompare(right.item.date) || left.sourceId - right.sourceId),
    }))
    .sort((left, right) => ruleOrder(left.rule, right.rule) || left.accountId - right.accountId || left.source.localeCompare(right.source));
  return {groups, conflicts: conflicts.sort((left, right) => left.prepared.sourceId - right.prepared.sourceId)};
}
