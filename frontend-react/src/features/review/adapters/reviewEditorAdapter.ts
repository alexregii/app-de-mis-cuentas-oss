import type {Account} from "../../../shared/model/accounts";
import type {Category} from "../../../shared/model/categories";
import type {RefundCandidate} from "../../../shared/model/bootstrap";
import type {Transaction} from "../../../shared/model/transactions";
import {prepareEditorAccounts, prepareEditorCategories, prepareRefundCandidates} from "../../../shared/model/transactionEditorOptions";
import type {
  TransactionEditorAccount,
  TransactionEditorCategory,
  TransactionEditorInput,
  TransactionEditorRefundCandidate,
} from "../../../ui/finance/TransactionEditor";
import type {BankReviewRow} from "../types";
import type {ImportBatch, ImportRow} from "../../../shared/model/imports";
import {editorAmountValue, preferredCategory} from "./reviewAdapterSemantics";

export type ReviewEditorOptions = Readonly<{
  accounts: readonly TransactionEditorAccount[];
  categoriesByKind: Readonly<Record<"income" | "expense", readonly TransactionEditorCategory[]>>;
  refundCandidates: readonly TransactionEditorRefundCandidate[];
}>;

export type ReviewEditorSource =
  | Readonly<{source: "bank"; row: BankReviewRow}>
  | Readonly<{source: "csv"; row: ImportRow; batch: ImportBatch}>;

export function prepareReviewEditorOptions(
  accounts: readonly Account[],
  categories: readonly Category[],
  refundCandidates: readonly (RefundCandidate | Transaction)[],
): ReviewEditorOptions {
  const candidates = refundCandidates
    .filter((candidate) => candidate.kind === "expense")
    .map(({id, kind, amount, date, description}) => ({id, kind: "expense" as const, amount, date, description}));

  return {
    accounts: prepareEditorAccounts(accounts),
    categoriesByKind: prepareEditorCategories(categories),
    refundCandidates: prepareRefundCandidates(candidates),
  };
}

function baseEditorInput({kind, amount, account, date, description, category}: {
  kind: "income" | "expense";
  amount: number;
  account: number;
  date: string;
  description: string;
  category: number | null;
}): TransactionEditorInput {
  return {
    kind,
    amount: editorAmountValue(amount),
    account: String(account),
    source_account: "",
    target_account: "",
    date,
    description,
    category: category === null ? "" : String(category),
    refund_for: "",
    notes: "",
    tag_names: "",
  };
}

export function toReviewEditorInput(source: ReviewEditorSource): TransactionEditorInput {
  if (source.source === "bank") {
    const {row} = source;
    return baseEditorInput({
      kind: row.kind,
      amount: row.amount,
      account: row.bank_account.account.id,
      date: row.booking_date,
      description: row.description,
      category: preferredCategory(row.category, row.suggested_category)?.id ?? null,
    });
  }

  const {row, batch} = source;
  return baseEditorInput({
    kind: row.kind,
    amount: row.amount,
    account: batch.account.id,
    date: row.date,
    description: row.description,
    category: row.category?.id ?? null,
  });
}
