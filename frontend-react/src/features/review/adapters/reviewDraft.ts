import type {TransactionEditorInput} from "../../../ui/finance/TransactionEditor";
import type {ReviewChange, ReviewField} from "../../../ui/finance/ReviewItem";
import {changeTransactionEditorKind} from "../../../shared/model/transactionEditorOptions";
import type {BankConfirmPayload, CsvConfirmPayload, EmptyMutationPayload, ReviewDraft, ReviewDraftKind} from "./reviewAdapterTypes";

export type ReviewDraftPatch = Partial<ReviewDraft>;

const draftChangeFields: readonly [ReviewField, keyof ReviewDraft][] = [
  ["amount", "amount"],
  ["description", "description"],
  ["date", "date"],
  ["account", "account"],
  ["category", "category"],
  ["kind", "kind"],
  ["transfer_source_account", "source_account"],
  ["transfer_target_account", "target_account"],
];

export function reviewDraftFromEditorInput(input: TransactionEditorInput, patch: ReviewDraftPatch = {}): ReviewDraft {
  return {
    kind: input.kind,
    amount: input.amount,
    account: input.account,
    source_account: input.source_account || "",
    target_account: input.target_account || "",
    date: input.date,
    description: input.description,
    category: input.category,
    refund_for: input.refund_for,
    notes: input.notes,
    tag_names: input.tag_names,
    remember_category: false,
    new_category: "",
    new_subcategory: "",
    ...patch,
  };
}

export function reviewDraftToEditorInput(draft: ReviewDraft): TransactionEditorInput {
  return {
    kind: draft.kind,
    amount: draft.amount,
    account: draft.account,
    source_account: draft.source_account,
    target_account: draft.target_account,
    date: draft.date,
    description: draft.description,
    category: draft.category,
    refund_for: draft.refund_for,
    notes: draft.notes,
    tag_names: draft.tag_names,
  };
}

function comparableDraftValue(field: ReviewField, value: ReviewDraft[keyof ReviewDraft]) {
  return field === "amount" ? Number(value) : String(value ?? "");
}

/** Cambios visibles entre el draft base y el draft actual; volver al base elimina el cambio. */
export function reviewDraftChanges(previous: ReviewDraft, current: ReviewDraft): readonly ReviewChange[] {
  return draftChangeFields.flatMap(([field, key]) => {
    const before = previous[key];
    const after = current[key];
    return comparableDraftValue(field, before) === comparableDraftValue(field, after)
      ? []
      : [{field, previous: before, current: after}];
  });
}

export function reviewDraftEquals(left: ReviewDraft, right: ReviewDraft): boolean {
  return draftChangeFields.every(([field, key]) => comparableDraftValue(field, left[key]) === comparableDraftValue(field, right[key]))
    && left.refund_for === right.refund_for
    && left.notes === right.notes
    && left.tag_names === right.tag_names
    && left.remember_category === right.remember_category
    && left.new_category === right.new_category
    && left.new_subcategory === right.new_subcategory;
}

/** Frontera pura editor/draft -> payload compatible con las mutaciones reales. */
export function toBankConfirmMutation(draft: ReviewDraft): BankConfirmPayload {
  const identifier = (value: string): number | string => value === "" ? "" : /^\d+$/.test(value) ? Number(value) : value;
  return {category: identifier(draft.category), refund_for: identifier(draft.refund_for), remember_category: draft.remember_category};
}

export function toCsvMutation(draft: ReviewDraft): CsvConfirmPayload {
  return {category: draft.category, new_category: draft.new_category, new_subcategory: draft.new_subcategory};
}

export function toBankTransferMutation(_draft: ReviewDraft): EmptyMutationPayload {
  return {};
}

export function changeReviewDraftKind(draft: ReviewDraft, kind: ReviewDraftKind): ReviewDraft {
  const changed = changeTransactionEditorKind(reviewDraftToEditorInput(draft), kind);
  return reviewDraftFromEditorInput(changed, {
    remember_category: draft.remember_category,
    new_category: draft.new_category,
    new_subcategory: draft.new_subcategory,
  });
}
