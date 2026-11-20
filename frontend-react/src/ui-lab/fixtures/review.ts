import type {TransactionEditorAccount, TransactionEditorCategory, TransactionEditorErrors, TransactionEditorField, TransactionEditorInput, TransactionEditorKind} from "../../ui/finance/TransactionEditor";
import type {ReviewChange, ReviewDisplayStatus, ReviewIssue, ReviewItem as ReviewViewItem} from "../../ui/finance/ReviewItem";
import type {LedgerEntity, LedgerKind} from "../../ui/finance/LedgerItem";

export type ReviewSource = "bank" | "csv" | "manual";
export type ReviewHistory = "new" | "changed" | "unchanged" | "reopened";
export type ReviewPreparation = "prepared" | "needs_attention" | "blocked";
export type ReviewDecision = "pending" | "incorporated";
export type ReviewEntity = LedgerEntity & {id: number};
export type ReviewTransfer = {sourceAccount: ReviewEntity | null; targetAccount: ReviewEntity | null};
export type TransactionDraft = {
  description: string;
  amount: number;
  date: string;
  kind: LedgerKind;
  account: ReviewEntity | null;
  category: ReviewEntity | null;
  transfer?: ReviewTransfer;
  notes: string;
  tags: string[];
  isRefund?: boolean;
  attachmentCount?: number;
};
export type ReviewFixture = {
  id: string;
  source: ReviewSource;
  transaction: TransactionDraft;
  changes: ReviewChange[];
  history: ReviewHistory;
  preparation: ReviewPreparation;
  decision: ReviewDecision;
  attentionIssues: ReviewIssue[];
  blockingIssues: ReviewIssue[];
  reopened?: boolean;
  lastSyncedAt?: string;
};

export const reviewAccounts: readonly (TransactionEditorAccount & {color: string})[] = [
  {id: 1, name: "Santander", color: "var(--entity-1)", balance: 2180},
  {id: 2, name: "Revolut", color: "var(--entity-4)", balance: 760},
  {id: 3, name: "Cuenta ahorro", color: "var(--entity-5)", balance: 4900},
];

export const reviewCategories: readonly TransactionEditorCategory[] = [
  {id: 10, display_name: "Alimentación", kind: "expense", color: "var(--entity-3)"},
  {id: 11, display_name: "Restaurantes", kind: "expense", color: "var(--entity-2)"},
  {id: 12, display_name: "Hogar", kind: "expense", color: "var(--entity-5)"},
  {id: 13, display_name: "Nómina", kind: "income", color: "var(--entity-1)"},
];

export const reviewCategoriesByKind: Readonly<Record<"income" | "expense", readonly TransactionEditorCategory[]>> = {
  income: reviewCategories.filter((item) => item.kind === "income"),
  expense: reviewCategories.filter((item) => item.kind === "expense"),
};

const account = (id: number): ReviewEntity => {
  const option = reviewAccounts.find((item) => item.id === id)!;
  return {id: option.id, name: option.name, color: option.color};
};

const category = (id: number): ReviewEntity => {
  const option = reviewCategories.find((item) => item.id === id)!;
  return {id: option.id, name: option.display_name, color: option.color};
};

const syncedAt = "2026-09-08T17:32:00+02:00";

export const reviewFixtures: ReviewFixture[] = [
  {id: "review-new-prepared", source: "bank", transaction: {description: "Nómina septiembre 2026", amount: 1955, date: "2026-09-01", kind: "income", account: account(1), category: category(13), notes: "", tags: []}, changes: [], history: "new", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-modified-prepared", source: "bank", transaction: {description: "Compra semanal", amount: -67.2, date: "2026-09-03", kind: "expense", account: account(1), category: category(10), notes: "", tags: []}, changes: [{field: "account", previous: account(2), current: account(1)}], history: "changed", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-category-change", source: "bank", transaction: {description: "PAYPAL *ABC", amount: -42.5, date: "2026-09-02", kind: "expense", account: account(2), category: category(11), notes: "", tags: []}, changes: [{field: "category", previous: null, current: category(11)}], history: "changed", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-description-change", source: "csv", transaction: {description: "Restaurante ABC", amount: -31.4, date: "2026-09-05", kind: "expense", account: account(1), category: category(11), notes: "", tags: []}, changes: [{field: "description", previous: "RESTAURANTE 024 BCN", current: "Restaurante ABC"}], history: "changed", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-uncategorized", source: "bank", transaction: {description: "Cargo pendiente de clasificar", amount: -18.9, date: "2026-09-04", kind: "expense", account: account(2), category: null, notes: "", tags: []}, changes: [], history: "unchanged", preparation: "needs_attention", decision: "pending", attentionIssues: [{code: "category-missing", message: "Falta categoría."}], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-account-missing", source: "manual", transaction: {description: "Compra sin cuenta", amount: -24.6, date: "2026-09-04", kind: "expense", account: null, category: category(10), notes: "", tags: []}, changes: [], history: "new", preparation: "needs_attention", decision: "pending", attentionIssues: [{code: "account-missing", message: "Falta únicamente la cuenta."}], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-description-attention", source: "csv", transaction: {description: "RESTAURANTE 024", amount: -31.4, date: "2026-09-05", kind: "expense", account: account(1), category: category(11), notes: "", tags: []}, changes: [{field: "description", previous: "RESTAURANTE 024 BCN", current: "RESTAURANTE 024"}], history: "changed", preparation: "needs_attention", decision: "pending", attentionIssues: [{code: "description-review", message: "Confirma el concepto importado antes de incorporarlo."}], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-blocked", source: "bank", transaction: {description: "Cargo incompleto", amount: 0, date: "2026-09-06", kind: "expense", account: null, category: null, notes: "", tags: []}, changes: [], history: "new", preparation: "blocked", decision: "pending", attentionIssues: [], blockingIssues: [{code: "account-missing", message: "Falta la cuenta."}, {code: "amount-invalid", message: "El importe debe ser mayor que 0."}, {code: "date-missing", message: "Falta la fecha de origen."}], lastSyncedAt: syncedAt},
  {id: "review-transfer", source: "csv", transaction: {description: "Ahorro mensual", amount: 300, date: "2026-09-07", kind: "transfer", account: null, transfer: {sourceAccount: account(1), targetAccount: account(3)}, category: null, notes: "", tags: []}, changes: [], history: "unchanged", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-transfer-invalid", source: "manual", transaction: {description: "Traspaso sin destino", amount: 120, date: "2026-09-07", kind: "transfer", account: null, transfer: {sourceAccount: account(1), targetAccount: null}, category: null, notes: "", tags: []}, changes: [], history: "new", preparation: "blocked", decision: "pending", attentionIssues: [], blockingIssues: [{code: "transfer-target-missing", message: "Falta la cuenta de destino."}], lastSyncedAt: syncedAt},
  {id: "review-prepared-pending", source: "csv", transaction: {description: "Factura electricidad", amount: -74.8, date: "2026-09-08", kind: "expense", account: account(1), category: category(12), notes: "", tags: []}, changes: [], history: "unchanged", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-incorporated", source: "bank", transaction: {description: "Compra ya incorporada", amount: -12.5, date: "2026-09-08", kind: "expense", account: account(2), category: category(10), notes: "", tags: []}, changes: [], history: "unchanged", preparation: "prepared", decision: "incorporated", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-reopened", source: "bank", transaction: {description: "Suscripción modificada", amount: -15.9, date: "2026-09-08", kind: "expense", account: account(2), category: category(11), notes: "", tags: []}, changes: [{field: "amount", previous: -14.9, current: -15.9}], history: "reopened", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], reopened: true, lastSyncedAt: syncedAt},
  {id: "review-batch-a", source: "manual", transaction: {description: "Compra batch A", amount: -9.2, date: "2026-09-08", kind: "expense", account: account(1), category: category(10), notes: "", tags: []}, changes: [], history: "new", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-batch-b", source: "manual", transaction: {description: "Compra batch B", amount: -11.8, date: "2026-09-08", kind: "expense", account: account(1), category: category(11), notes: "", tags: []}, changes: [], history: "new", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-long-description", source: "bank", transaction: {description: "Comercio con una descripción deliberadamente larga para comprobar que la cola conserva la lectura y los controles sin desbordamiento horizontal en pantallas pequeñas", amount: -123.45, date: "2026-09-08", kind: "expense", account: account(2), category: category(10), notes: "", tags: []}, changes: [], history: "unchanged", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-extreme-amount", source: "csv", transaction: {description: "Pago de importe extremo", amount: -9876543.21, date: "2026-09-08", kind: "expense", account: account(1), category: category(12), notes: "", tags: []}, changes: [{field: "amount", previous: -9876540.21, current: -9876543.21}], history: "changed", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
  {id: "review-private-amount", source: "manual", transaction: {description: "Movimiento con privacidad", amount: -88.4, date: "2026-09-08", kind: "expense", account: account(3), category: category(10), notes: "", tags: []}, changes: [{field: "amount", previous: -80.4, current: -88.4}], history: "changed", preparation: "prepared", decision: "pending", attentionIssues: [], blockingIssues: [], lastSyncedAt: syncedAt},
];

export function reviewDisplayStatus(item: Pick<ReviewFixture, "history" | "preparation" | "blockingIssues">): ReviewDisplayStatus {
  if (item.blockingIssues.length || item.preparation === "blocked") return "blocked";
  if (item.preparation === "needs_attention") return "needs_attention";
  if (item.history === "new") return "new";
  if (item.history === "changed" || item.history === "reopened") return "changed";
  return "ready";
}

export function isReviewReady(item: Pick<ReviewFixture, "preparation" | "blockingIssues">) {
  return item.preparation === "prepared" && item.blockingIssues.length === 0;
}

export function validateReviewEditorInput(input: TransactionEditorInput): TransactionEditorErrors {
  const errors: TransactionEditorErrors = {};
  const amount = Number(input.amount);
  if (!input.amount.trim() || !Number.isFinite(amount) || amount <= 0) errors.amount = ["El importe debe ser mayor que 0."];
  if (input.kind === "transfer") {
    if (!input.source_account) errors.source_account = ["Selecciona la cuenta de origen."];
    if (!input.target_account) errors.target_account = ["Selecciona la cuenta de destino."];
    if (input.source_account && input.source_account === input.target_account) errors.target_account = ["El origen y el destino deben ser distintos."];
  } else if (!input.account) errors.account = ["Selecciona una cuenta."];
  if (!input.date) errors.date = ["Selecciona una fecha."];
  if (!input.description.trim()) errors.description = ["Escribe una descripción."];
  return errors;
}

export function hasReviewEditorErrors(errors: TransactionEditorErrors) {
  return Object.values(errors).some((messages) => messages.length > 0);
}

export function updateReviewEditorField(input: TransactionEditorInput, field: TransactionEditorField, value: string): TransactionEditorInput {
  if (field !== "kind") return {...input, [field]: value};
  const kind = value as TransactionEditorKind;
  return {
    ...input,
    kind,
    category: "",
    refund_for: "",
    account: kind === "transfer" ? input.account : input.account || input.source_account || "",
    source_account: kind === "transfer" ? input.source_account || input.account || "" : input.source_account,
  };
}

const signedAmount = (transaction: TransactionDraft) => transaction.kind === "expense" ? -Math.abs(transaction.amount) : transaction.kind === "income" ? Math.abs(transaction.amount) : transaction.amount;
const sourceLabels = {bank: "Banco", csv: "CSV", manual: "Manual"} as const;

export function toReviewItem(item: ReviewFixture): ReviewViewItem {
  const {transaction} = item;
  const account = transaction.kind === "transfer" ? transaction.transfer?.sourceAccount : transaction.account;
  return {
    id: item.id,
    description: transaction.description,
    date: transaction.date,
    signedAmount: signedAmount(transaction),
    kind: transaction.kind,
    account: account || null,
    category: transaction.category,
    sourceLabel: sourceLabels[item.source],
    isRefund: Boolean(transaction.isRefund),
    attachmentCount: transaction.attachmentCount || 0,
    transferFrom: transaction.transfer?.sourceAccount?.name,
    transferTo: transaction.transfer?.targetAccount?.name,
    status: reviewDisplayStatus(item),
    showMissingCategory: !transaction.category && transaction.kind !== "transfer" && !item.blockingIssues.length,
    changes: item.changes,
    issues: item.blockingIssues,
  };
}

export function reviewItemToEditorInput(item: ReviewFixture): TransactionEditorInput {
  const {transaction} = item;
  return {
    kind: transaction.kind,
    amount: String(Math.abs(transaction.amount)),
    account: transaction.account ? String(transaction.account.id) : "",
    source_account: transaction.transfer?.sourceAccount ? String(transaction.transfer.sourceAccount.id) : "",
    target_account: transaction.transfer?.targetAccount ? String(transaction.transfer.targetAccount.id) : "",
    date: transaction.date,
    description: transaction.description,
    category: transaction.category ? String(transaction.category.id) : "",
    refund_for: "",
    notes: transaction.notes,
    tag_names: transaction.tags.join(", "),
  };
}
