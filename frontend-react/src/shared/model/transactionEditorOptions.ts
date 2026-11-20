import type {Account} from "./accounts";
import type {Category} from "./categories";

export type EditorAccountOption = Readonly<{
  id: number;
  name: string;
  balance?: number;
}>;

export type EditorCategoryOption = Readonly<{
  id: number;
  display_name: string;
  kind: "income" | "expense";
  color: string;
}>;

export type EditorRefundCandidate = Readonly<{
  id: number | string;
  kind: "expense";
  amount: number;
  date: string;
  description: string;
}>;

export type TransactionEditorKind = "income" | "expense" | "transfer";

export type TransactionEditorDraft = {
  kind: TransactionEditorKind;
  amount: string;
  date: string;
  description: string;
  category: string;
  refund_for: string;
  account: string;
  source_account?: string;
  target_account?: string;
  notes: string;
  tag_names: string;
};

/** R3-C2: cambiar de tipo limpia los campos dependientes del tipo anterior. */
export function changeTransactionEditorKind(input: TransactionEditorDraft, kind: TransactionEditorKind): TransactionEditorDraft {
  return {
    ...input,
    kind,
    category: "",
    refund_for: "",
    account: kind === "transfer" ? input.account : input.account || input.source_account || "",
    source_account: kind === "transfer" ? input.source_account || input.account || "" : input.source_account,
    target_account: kind === "transfer" ? input.target_account || "" : "",
  };
}

export function prepareEditorAccounts(accounts: readonly Account[]): EditorAccountOption[] {
  return accounts.filter((account) => account.active).map(({id, name, balance}) => ({id, name, balance}));
}

export function prepareEditorCategories(categories: readonly Category[]): Record<"income" | "expense", EditorCategoryOption[]> {
  return {
    income: categories.filter((category) => category.kind === "income").map(({id, display_name, kind, color}) => ({id, display_name, kind, color})),
    expense: categories.filter((category) => category.kind === "expense").map(({id, display_name, kind, color}) => ({id, display_name, kind, color})),
  };
}

export function prepareRefundCandidates(candidates: readonly Readonly<{
  id: number | string;
  kind: string;
  amount: number;
  date: string;
  description: string;
}>[]): EditorRefundCandidate[] {
  return candidates
    .filter((candidate) => candidate.kind === "expense")
    .map(({id, kind, amount, date, description}) => ({id, kind: "expense" as const, amount, date, description}));
}
