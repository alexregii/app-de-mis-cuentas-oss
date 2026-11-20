import type {ReviewChange, ReviewIssue} from "../../../ui/finance/ReviewItem";
import type {BankReviewRow} from "../types";
import type {Account} from "../../../shared/model/accounts";
import {toReviewEditorInput} from "./reviewEditorAdapter";
import {accountEntity, categoryEntity, isPendingReviewStatus, mergeReviewIssues, preferredCategory, signedBasicAmount, toReviewDisplayStatus, toReviewPreparation} from "./reviewAdapterSemantics";
import {reviewDraftChanges, reviewDraftEquals, reviewDraftFromEditorInput, reviewDraftToEditorInput, toBankConfirmMutation, toBankTransferMutation} from "./reviewDraft";
import type {Category} from "../../../shared/model/categories";
import type {BankConfirmPayload, PreparedReview, ReviewCapabilities, ReviewConfirmAction, ReviewDraft, ReviewForceAction, ReviewSkipAction, ReviewTransferAction} from "./reviewAdapterTypes";

function bankBlockingIssues(draft: ReviewDraft, category: Category | null, preservesSplit: boolean): readonly ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (draft.kind !== "transfer" && !draft.account) issues.push({code: "account-missing", message: "Selecciona una cuenta."});
  if (draft.kind !== "transfer" && !category && !preservesSplit) issues.push({code: "category-missing", message: "Selecciona una categoría."});
  if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) issues.push({code: "amount-invalid", message: "El importe debe ser mayor que 0."});
  if (!draft.date) issues.push({code: "date-missing", message: "Falta la fecha."});
  if (!draft.description.trim()) issues.push({code: "description-missing", message: "Falta el concepto."});
  if (draft.kind === "transfer") {
    if (!draft.source_account) issues.push({code: "transfer-source-missing", message: "Selecciona la cuenta de origen."});
    if (!draft.target_account) issues.push({code: "transfer-target-missing", message: "Selecciona la cuenta de destino."});
    if (draft.source_account && draft.source_account === draft.target_account) issues.push({code: "transfer-same-account", message: "El origen y el destino deben ser distintos."});
  }
  return issues;
}

function bankAttentionIssues(row: BankReviewRow): readonly ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (row.possible_duplicate) issues.push({code: "possible-duplicate", message: "El movimiento podría estar duplicado."});
  if (row.possible_transfer) issues.push({code: "possible-transfer", message: "El movimiento podría ser un traspaso."});
  return issues;
}

function bankCapabilities(draft: ReviewDraft, pending: boolean, preparation: PreparedReview["preparation"], categoryPresent: boolean, preservesSplit: boolean): ReviewCapabilities {
  return {
    canEditDraft: pending && !preservesSplit,
    editableFields: pending && !preservesSplit ? ["category"] : [],
    canPersistStandaloneEdit: false,
    select: pending && !preservesSplit,
    confirm: pending && preparation === "prepared",
    force: pending && preparation === "needs_attention",
    category: false,
    skip: pending,
    transfer: pending && !preservesSplit,
    canChooseRefund: pending && !preservesSplit && draft.kind === "income",
    canRememberCategory: pending && !preservesSplit && categoryPresent,
  };
}

function bankConfirmAction(row: BankReviewRow, draft: ReviewDraft): ReviewConfirmAction {
  const input: BankConfirmPayload = toBankConfirmMutation(draft);
  return {kind: "confirm", source: "bank", sourceId: row.id, input};
}

function bankForceAction(row: BankReviewRow, draft: ReviewDraft): ReviewForceAction {
  const input: BankConfirmPayload = toBankConfirmMutation(draft);
  return {kind: "force", source: "bank", sourceId: row.id, input};
}

function bankSkipAction(row: BankReviewRow): ReviewSkipAction {
  return {kind: "skip", source: "bank", sourceId: row.id};
}

function bankTransferAction(row: BankReviewRow, draft: ReviewDraft): ReviewTransferAction {
  return {kind: "transfer", source: "bank", sourceId: row.id, input: toBankTransferMutation(draft)};
}

function bankCategory(row: BankReviewRow, draft: ReviewDraft, categories: readonly Category[]): Category | null {
  if (!draft.category) return null;
  return categories.find((category) => String(category.id) === draft.category)
    || [row.category, row.suggested_category].find((category) => category && String(category.id) === draft.category)
    || null;
}

function accountForDraft(row: BankReviewRow, id: string, accounts: readonly Account[]) {
  if (!id) return null;
  if (String(row.bank_account.account.id) === id) return accountEntity(row.bank_account.account);
  const account = accounts.find((candidate) => String(candidate.id) === id);
  return account ? accountEntity(account) : null;
}

function accountLabelForDraft(row: BankReviewRow, id: string, accounts: readonly Account[]) {
  if (!id) return undefined;
  if (String(row.bank_account.account.id) === id) return row.bank_account.account.name;
  return accounts.find((candidate) => String(candidate.id) === id)?.name;
}

function bankChangeValue(row: BankReviewRow, draft: ReviewDraft, field: ReviewChange["field"], categories: readonly Category[], accounts: readonly Account[]) {
  if (field === "amount") return Number(draft.amount);
  if (field === "category") return categoryEntity(bankCategory(row, draft, categories));
  if (field === "account") return accountForDraft(row, draft.account, accounts);
  if (field === "transfer_source_account") return accountForDraft(row, draft.source_account, accounts);
  if (field === "transfer_target_account") return accountForDraft(row, draft.target_account, accounts);
  if (field === "kind") return draft.kind;
  if (field === "description") return draft.description;
  return draft.date;
}

export function toPreparedBankReview(row: BankReviewRow, draft?: ReviewDraft, categories: readonly Category[] = [], accounts: readonly Account[] = []): PreparedReview | null {
  if (row.status !== "pending" && row.status !== "imported") return null;

  const preservesSplit = Boolean(row.reopened_split?.allocations.length);
  const reopened = preservesSplit || Boolean(row.reopened_refund);
  const initialCategory = preservesSplit ? null : preferredCategory(row.category, row.suggested_category);
  const initialDraft = reviewDraftFromEditorInput(toReviewEditorInput({source: "bank", row}), {
    category: initialCategory ? String(initialCategory.id) : "",
    refund_for: row.reopened_refund?.id ? String(row.reopened_refund.id) : "",
  });
  const currentDraft = preservesSplit ? initialDraft : draft || initialDraft;
  const category = bankCategory(row, currentDraft, categories);
  const blockingIssues = bankBlockingIssues(currentDraft, category, preservesSplit);
  const attentionIssues = bankAttentionIssues(row);
  const issues = mergeReviewIssues(blockingIssues, attentionIssues);
  const pending = isPendingReviewStatus(row.status);
  const history = reopened ? "reopened" : pending ? "new" : "unchanged";
  const preparation = toReviewPreparation(blockingIssues, attentionIssues);
  const decision = pending ? "pending" : "incorporated";
  const displayStatus = toReviewDisplayStatus(history, preparation);
  const changes: readonly ReviewChange[] = reviewDraftChanges(initialDraft, currentDraft).map((change) => ({
    field: change.field,
    previous: bankChangeValue(row, initialDraft, change.field, categories, accounts),
    current: bankChangeValue(row, currentDraft, change.field, categories, accounts),
  }));
  const editorInput = reviewDraftToEditorInput(currentDraft);
  const item = {
    id: `bank:${row.id}`,
    description: currentDraft.description,
    date: currentDraft.date,
    signedAmount: signedBasicAmount(currentDraft.kind === "transfer" ? "income" : currentDraft.kind, Number(currentDraft.amount)),
    kind: currentDraft.kind,
    account: currentDraft.kind === "transfer" ? null : accountForDraft(row, currentDraft.account, accounts),
    category: categoryEntity(category),
    sourceLabel: row.bank_account.display_name,
    isRefund: false,
    attachmentCount: 0,
    status: displayStatus,
    showMissingCategory: false,
    changes,
    issues: blockingIssues,
    transferFrom: currentDraft.kind === "transfer" ? accountLabelForDraft(row, currentDraft.source_account, accounts) : undefined,
    transferTo: currentDraft.kind === "transfer" ? accountLabelForDraft(row, currentDraft.target_account, accounts) : undefined,
  } as const;

  return {
    source: "bank",
    sourceId: row.id,
    contextAccountId: row.bank_account.account.id,
    contextBatchId: null,
    categoryRuleMatches: row.category_rule_matches ?? [],
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
    ...(!preservesSplit && row.prediction ? {suggestion: {
      category: categoryEntity(row.prediction.category),
      confidence: row.prediction.confidence,
      reason: row.prediction.reason,
      modelName: row.prediction.model_name,
      status: row.prediction.status,
    }} : {}),
    ...(row.reopened_split ? {preservedAllocationLabels: row.reopened_split.allocations.map((part) => part.category?.display_name || "Sin categoría")} : {}),
    ...(row.reopened_refund ? {preservedRefundDescription: `${row.reopened_refund.description} · ${row.reopened_refund.date}`} : {}),
    capabilities: bankCapabilities(currentDraft, pending, preparation, Boolean(category), preservesSplit),
    editorInput,
    actions: {
      ...(pending && preparation === "prepared" ? {confirm: bankConfirmAction(row, currentDraft)} : {}),
      ...(pending && preparation === "needs_attention" ? {force: bankForceAction(row, currentDraft)} : {}),
      ...(pending ? {skip: bankSkipAction(row)} : {}),
      ...(pending && !preservesSplit ? {transfer: bankTransferAction(row, currentDraft)} : {}),
    },
    displayStatus,
  };
}
