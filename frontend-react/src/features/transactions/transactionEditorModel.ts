import {todayInputValue} from "../../format";
import type {
  TransactionEditorErrors,
  TransactionEditorField,
  TransactionEditorInput,
  TransactionEditorKind,
} from "../../ui/finance/TransactionEditor";
import {changeTransactionEditorKind} from "../../shared/model/transactionEditorOptions";
export {changeTransactionEditorKind, prepareEditorAccounts, prepareEditorCategories, prepareRefundCandidates} from "../../shared/model/transactionEditorOptions";

export const transactionEditorKinds: readonly TransactionEditorKind[] = ["expense", "income"];

export function validateTransactionDraft(input: TransactionEditorInput): TransactionEditorErrors {
  const errors: TransactionEditorErrors = {};
  const amount = Number(input.amount);
  if (!input.amount.trim() || !Number.isFinite(amount) || amount <= 0) errors.amount = ["El importe debe ser mayor que 0."];
  if (input.kind === "transfer") {
    if (!input.source_account) errors.source_account = ["Selecciona la cuenta de origen."];
    if (!input.target_account) errors.target_account = ["Selecciona la cuenta de destino."];
    if (input.source_account && input.source_account === input.target_account) errors.target_account = ["El origen y el destino deben ser distintos."];
  } else if (!input.account) {
    errors.account = ["Selecciona una cuenta."];
  }
  if (!input.date) errors.date = ["Selecciona una fecha."];
  if (!input.description.trim()) errors.description = ["Escribe una descripción."];
  return errors;
}

export function hasTransactionEditorErrors(errors: TransactionEditorErrors) {
  return Object.values(errors).some((messages) => messages.length > 0);
}

export function emptyTransactionEditorInput(kind: TransactionEditorKind = "expense"): TransactionEditorInput {
  return {kind, amount: "", account: "", source_account: "", target_account: "", date: todayInputValue(), description: "", category: "", refund_for: "", notes: "", tag_names: ""};
}

export function resetTransactionEditorInput(input: TransactionEditorInput, kind: TransactionEditorKind): TransactionEditorInput {
  return {...emptyTransactionEditorInput(kind), account: input.account, source_account: input.source_account, target_account: input.target_account, date: todayInputValue()};
}

export function updateTransactionEditorField(input: TransactionEditorInput, field: TransactionEditorField, value: string): TransactionEditorInput {
  return field === "kind" ? changeTransactionEditorKind(input, value as TransactionEditorKind) : {...input, [field]: value};
}
