import {useEffect, useState, type FormEvent} from "react";
import {errorMessage} from "../../shared/lib/errors";
import type {Account} from "../../shared/model/accounts";
import type {Category} from "../../shared/model/categories";
import type {RefundCandidate} from "../../shared/model/bootstrap";
import type {TransactionInput} from "./types";
import {
  hasTransactionEditorErrors,
  prepareEditorAccounts,
  prepareEditorCategories,
  prepareRefundCandidates,
  resetTransactionEditorInput,
  transactionEditorKinds,
  updateTransactionEditorField,
  validateTransactionDraft,
} from "./transactionEditorModel";
import {TransactionEditor, type TransactionEditorErrors, type TransactionEditorInput} from "../../ui/finance/TransactionEditor";
import {allocationDraftsFrom, allocationPayload, allocationSumError, TransactionAllocationEditor} from "./TransactionAllocationEditor";

export function TransactionForm({title, submitLabel, accounts, categories, refundCandidates, initial, errors, onSubmit}: {
  title: string;
  submitLabel: string;
  accounts: Account[];
  categories: Category[];
  refundCandidates: RefundCandidate[];
  initial: TransactionInput;
  errors?: TransactionEditorErrors;
  onSubmit: (input: TransactionInput & {attachment?: File | null}) => Promise<void>;
}) {
  const initialEditorInput = initial as TransactionEditorInput;
  const [input, setInput] = useState<TransactionEditorInput>(initialEditorInput);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [clientErrors, setClientErrors] = useState<TransactionEditorErrors>({});
  const [allocations, setAllocations] = useState(() => allocationDraftsFrom(initial));
  const [allocationsEdited, setAllocationsEdited] = useState(false);
  const [allocationTouched, setAllocationTouched] = useState(false);
  const [allocationMessage, setAllocationMessage] = useState("");
  const initialAllocationsKey = JSON.stringify(initial.allocations || []);

  useEffect(() => {
    setInput(initialEditorInput);
    setAttachment(null);
    setClientErrors({});
    setSubmitError("");
    setAllocations(allocationDraftsFrom(initial));
    setAllocationsEdited(false);
    setAllocationTouched(false);
    setAllocationMessage("");
  }, [initial.account, initial.amount, initial.category, initial.date, initial.description, initial.kind, initial.notes, initial.refund_for, initial.tag_names, initialAllocationsKey, initial.expected_allocation_revision]);

  const fieldErrors = {...clientErrors, ...errors};
  const editorAccounts = prepareEditorAccounts(accounts);
  const categoriesByKind = prepareEditorCategories(categories);
  const editorRefundCandidates = prepareRefundCandidates(refundCandidates);
  const linkedRefund = Boolean(input.refund_for);
  const allocationProblem = allocationSumError(input.amount, allocations);
  const allocationFeedback = allocationMessage || (allocationTouched ? allocationProblem : "");

  const changeField = (field: keyof TransactionEditorInput, value: string) => {
    setInput((current) => updateTransactionEditorField(current, field, value));
    if (field === "amount") {
      setAllocations((current) => current.length === 1 ? [{...current[0], amount: value}] : current);
    } else if (field === "kind") {
      setAllocations((current) => current.map((part) => ({...part, category_id: ""})));
    }
    setAllocationTouched(true);
    setAllocationMessage("");
  };

  const categoryEditor = <TransactionAllocationEditor
    kind={input.kind as "income" | "expense"}
    total={input.amount}
    categories={categories}
    allocations={allocations}
    linkedRefund={linkedRefund}
    disabled={saving}
    feedback={allocationFeedback}
    onChange={(next) => {
      setAllocations(next);
      setAllocationsEdited(true);
      setAllocationTouched(true);
      setAllocationMessage("");
    }}
  />;

  const handleSubmit = async (_event?: FormEvent<HTMLFormElement>) => {
    const nextErrors = validateTransactionDraft(input);
    setClientErrors(nextErrors);
    if (hasTransactionEditorErrors(nextErrors)) return;
    if (allocationProblem) {
      setAllocationTouched(true);
      setAllocationMessage(allocationProblem);
      return;
    }
    setSaving(true);
    setSubmitError("");
    try {
      const splitInput: TransactionInput = {
        ...input,
        kind: input.kind as TransactionInput["kind"],
        category: allocations.length === 1 ? allocations[0].category_id : "",
        allocations: initial.allocations?.length || allocationsEdited ? allocationPayload(allocations) : undefined,
        expected_allocation_revision: initial.allocations?.length || allocationsEdited ? initial.expected_allocation_revision : undefined,
      };
      await onSubmit({...splitInput, attachment});
      setInput(resetTransactionEditorInput(input, transactionEditorKinds[0]));
      setAttachment(null);
      setAllocations([{category_id: "", amount: ""}]);
      setAllocationsEdited(false);
      setAllocationTouched(false);
      setAllocationMessage("");
    } catch (error) {
      setSubmitError(errorMessage(error, "No se pudo guardar el movimiento."));
    } finally {
      setSaving(false);
    }
  };

  return <TransactionEditor
    title={title}
    submitLabel={submitLabel}
    input={input}
    accounts={editorAccounts}
    categoriesByKind={categoriesByKind}
    refundCandidates={editorRefundCandidates}
    errors={fieldErrors}
    submitError={submitError}
    saving={saving}
    attachment={attachment}
    allowedKinds={transactionEditorKinds}
    showAttachment
    categoryEditor={categoryEditor}
    onChange={changeField}
    onAttachmentChange={setAttachment}
    onSubmit={handleSubmit}
  />;
}
