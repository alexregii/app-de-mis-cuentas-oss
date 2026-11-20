import type {ImportBatch, ImportRow} from "../../../shared/model/imports";
import type {ReviewChange, ReviewIssue} from "../../../ui/finance/ReviewItem";
import {toReviewEditorInput} from "./reviewEditorAdapter";
import {accountEntity, categoryEntity, isPendingReviewStatus, mergeReviewIssues, signedBasicAmount, toReviewDisplayStatus, toReviewPreparation} from "./reviewAdapterSemantics";
import {reviewDraftEquals, reviewDraftFromEditorInput, reviewDraftToEditorInput, toCsvMutation} from "./reviewDraft";
import type {Category} from "../../../shared/model/categories";
import type {CsvConfirmPayload, PreparedReview, ReviewCapabilities, ReviewCategoryAction, ReviewConfirmAction, ReviewDraft, ReviewForceAction, ReviewSkipAction} from "./reviewAdapterTypes";

function csvAttentionIssues(row: ImportRow): readonly ReviewIssue[] {
  return row.possible_duplicate
    ? [{code: "possible-duplicate", message: "La fila está marcada como posible duplicado."}]
    : [];
}

function csvCapabilities(pending: boolean, preparation: PreparedReview["preparation"], preservesSplit: boolean): ReviewCapabilities {
  const canEditCategory = pending && !preservesSplit;
  return {
    canEditDraft: canEditCategory,
    editableFields: canEditCategory ? ["category"] : [],
    canPersistStandaloneEdit: canEditCategory,
    select: pending,
    confirm: pending && preparation === "prepared",
    force: pending && preparation === "needs_attention",
    category: canEditCategory,
    skip: pending,
    transfer: false,
    canChooseRefund: false,
    canRememberCategory: false,
  };
}

function csvConfirmAction(row: ImportRow, input: CsvConfirmPayload): ReviewConfirmAction {
  return {kind: "confirm", source: "csv", sourceId: row.id, input};
}

function csvForceAction(row: ImportRow, input: CsvConfirmPayload): ReviewForceAction {
  return {kind: "force", source: "csv", sourceId: row.id, input};
}

function csvCategoryAction(row: ImportRow, input: CsvConfirmPayload): ReviewCategoryAction {
  return {kind: "category", source: "csv", sourceId: row.id, input};
}

function csvSkipAction(row: ImportRow): ReviewSkipAction {
  return {kind: "skip", source: "csv", sourceId: row.id};
}

function csvCategory(row: ImportRow, draft: ReviewDraft, categories: readonly Category[]): Category | null {
  if (!draft.category) return null;
  return categories.find((category) => String(category.id) === draft.category)
    || (row.category && String(row.category.id) === draft.category ? row.category : null);
}

export function toPreparedCsvReview(row: ImportRow, batch: ImportBatch, draft?: ReviewDraft, categories: readonly Category[] = []): PreparedReview | null {
  if (row.status !== "pending" && row.status !== "imported") return null;

  const preservesSplit = Boolean(row.reopened_split?.allocations.length);
  const reopened = preservesSplit || Boolean(row.reopened_refund);
  const blockingIssues: readonly ReviewIssue[] = [];
  const attentionIssues = csvAttentionIssues(row);
  const issues = mergeReviewIssues(blockingIssues, attentionIssues);
  const pending = isPendingReviewStatus(row.status);
  const history = reopened ? "reopened" : pending ? "new" : "unchanged";
  const preparation = toReviewPreparation(blockingIssues, attentionIssues);
  const decision = pending ? "pending" : "incorporated";
  const displayStatus = toReviewDisplayStatus(history, preparation);
  const changes: readonly ReviewChange[] = [];
  const initialDraft = reviewDraftFromEditorInput(toReviewEditorInput({source: "csv", row, batch}), preservesSplit ? {category: ""} : {});
  const currentDraft = preservesSplit ? initialDraft : draft || initialDraft;
  const currentCategory = preservesSplit ? null : csvCategory(row, currentDraft, categories);
  const editorInput = reviewDraftToEditorInput(currentDraft);
  const item = {
    id: `csv:${row.id}`,
    description: currentDraft.description,
    date: currentDraft.date,
    signedAmount: signedBasicAmount(currentDraft.kind === "transfer" ? "income" : currentDraft.kind, Number(currentDraft.amount)),
    kind: currentDraft.kind,
    account: accountEntity(batch.account),
    category: categoryEntity(currentCategory),
    sourceLabel: batch.filename,
    isRefund: false,
    attachmentCount: 0,
    status: displayStatus,
    changes,
    issues: blockingIssues,
  } as const;

  return {
    source: "csv",
    sourceId: row.id,
    contextAccountId: batch.account.id,
    contextBatchId: batch.id,
    categoryRuleMatches: preservesSplit ? [] : row.category_rule_matches ?? [],
    draftIsDirty: !reviewDraftEquals(initialDraft, currentDraft),
    item,
    draft: currentDraft,
    history,
    preparation,
    decision,
    changes,
    issues,
    blockingIssues,
    attentionIssues,
    ...(preservesSplit ? {preservedAllocationLabels: row.reopened_split!.allocations.map((part) => part.category?.display_name || "Sin categoría")} : {}),
    ...(row.reopened_refund ? {preservedRefundDescription: `${row.reopened_refund.description} · ${row.reopened_refund.date}`} : {}),
    capabilities: csvCapabilities(pending, preparation, preservesSplit),
    editorInput,
    actions: {
      ...(pending && preparation === "prepared" ? {confirm: csvConfirmAction(row, toCsvMutation(currentDraft))} : {}),
      ...(pending && preparation === "needs_attention" ? {force: csvForceAction(row, toCsvMutation(currentDraft))} : {}),
      ...(pending && !preservesSplit ? {category: csvCategoryAction(row, toCsvMutation(currentDraft))} : {}),
      ...(pending ? {skip: csvSkipAction(row)} : {}),
    },
    displayStatus,
  };
}
