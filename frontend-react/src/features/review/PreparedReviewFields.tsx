import {useEffect, useRef, useState, type ReactNode} from "react";
import {parseMoneyInput} from "../../format";
import {ReviewInlineChoice, type ReviewInlineChoiceOption} from "../../ui/finance/ReviewInlineChoice";
import {TransactionCategoryEditor} from "../../ui/finance/TransactionCategoryEditor";
import type {TransactionEditorAccount, TransactionEditorCategory, TransactionEditorField} from "../../ui/finance/TransactionEditor";
import type {ReviewField, ReviewIssue} from "../../ui/finance/ReviewItem";
import {reviewInlineDisplayValue, reviewInlineValueWithChange} from "../../ui/finance/reviewInlineFormatting";
import type {PreparedReview, ReviewDraft} from "./adapters/reviewAdapterTypes";

const localIssueCodes = new Set(["account-missing", "category-missing", "date-missing", "amount-invalid", "description-missing", "transfer-source-missing", "transfer-target-missing"]);

export type PreparedReviewFieldsProps = Readonly<{
  prepared: PreparedReview;
  accounts: readonly TransactionEditorAccount[];
  categoriesByKind: Readonly<Record<"income" | "expense", readonly TransactionEditorCategory[]>>;
  onDraftChange: (field: TransactionEditorField, value: string) => void;
  disabled?: boolean;
  privateAmounts?: boolean;
}>;

export type PreparedReviewFieldNodes = Readonly<{
  inlineAmount: ReactNode;
  inlineContent: ReactNode;
  inlineIssues: ReactNode;
}>;

function compactIssue(issue: ReviewIssue) {
  if (issue.code === "transfer-same-account") return "Origen y destino distintos";
  return issue.message.replace(/\.$/, "");
}

function draftValue(draft: ReviewDraft, field: ReviewField): string {
  if (field === "amount") return draft.amount;
  if (field === "transfer_source_account") return draft.source_account;
  if (field === "transfer_target_account") return draft.target_account;
  return draft[field];
}

function draftField(field: ReviewField): TransactionEditorField {
  if (field === "transfer_source_account") return "source_account";
  if (field === "transfer_target_account") return "target_account";
  return field;
}

function isEmptyField(field: ReviewField, value: string) {
  return ["description", "date", "account", "category", "transfer_source_account", "transfer_target_account"].includes(field) && !value;
}

const reviewFieldIssueCodes: Partial<Record<ReviewField, readonly string[]>> = {
  account: ["account-missing"],
  category: ["category-missing"],
  date: ["date-missing"],
  amount: ["amount-invalid"],
  description: ["description-missing"],
  transfer_source_account: ["transfer-source-missing"],
  transfer_target_account: ["transfer-target-missing"],
};

function issueForField(prepared: PreparedReview, field: ReviewField) {
  const matches = reviewFieldIssueCodes[field];
  return [...prepared.blockingIssues, ...prepared.attentionIssues].find((issue) => matches?.includes(issue.code));
}

function issueKindForField(prepared: PreparedReview, field: ReviewField) {
  const matches = reviewFieldIssueCodes[field];
  if (prepared.blockingIssues.some((issue) => matches?.includes(issue.code))) return "blocking";
  if (prepared.attentionIssues.some((issue) => matches?.includes(issue.code))) return "attention";
  return undefined;
}

export function usePreparedReviewFields({prepared, accounts, categoriesByKind, onDraftChange, disabled = false, privateAmounts = false}: PreparedReviewFieldsProps): PreparedReviewFieldNodes {
  const [inlineField, setInlineField] = useState<ReviewField | null>(null);
  const [inlineDraft, setInlineDraft] = useState("");
  const [inlineError, setInlineError] = useState<string | undefined>();
  const inlineFieldRef = useRef<ReviewField | null>(null);
  const categoryOptions = prepared.editorInput.kind === "transfer" ? [] : categoriesByKind[prepared.editorInput.kind];
  const accountOptions: ReviewInlineChoiceOption[] = [{id: "", label: "Sin cuenta"}, ...accounts.map((account) => ({id: String(account.id), label: account.name}))];
  const isEditable = prepared.capabilities.canEditDraft && !disabled;
  const editableFields = prepared.capabilities.editableFields;
  const amountEditable = isEditable && editableFields.includes("amount");

  useEffect(() => {
    if (!inlineField) return;
    document.getElementById(`prepared-review-inline-editor-${prepared.item.id}-${inlineField}`)?.querySelector<HTMLElement>("input")?.focus({preventScroll: true});
  }, [inlineField, prepared.item.id]);

  const closeInline = (restoreFocus: boolean) => {
    const field = inlineFieldRef.current;
    inlineFieldRef.current = null;
    setInlineField(null);
    setInlineError(undefined);
    if (restoreFocus && field) window.setTimeout(() => document.getElementById(`prepared-review-inline-value-${prepared.item.id}-${field}`)?.focus({preventScroll: true}), 0);
  };

  const beginInline = (field: ReviewField, value: string) => {
    inlineFieldRef.current = field;
    setInlineField(field);
    setInlineDraft(field === "amount" ? (privateAmounts ? "" : String(Math.abs(Number(value)))) : value);
    setInlineError(undefined);
  };

  const commitInline = (field: ReviewField, value: string, restoreFocus: boolean) => {
    if (inlineFieldRef.current !== field) return;
    if (field === "amount") {
      if (privateAmounts && !value.trim()) { closeInline(restoreFocus); return; }
      const parsed = parseMoneyInput(value);
      if (parsed === null || parsed <= 0) { setInlineDraft(value); setInlineError("El importe debe ser mayor que 0."); return; }
    } else if ((field === "description" || field === "date") && !value.trim()) {
      setInlineDraft(value);
      setInlineError(field === "date" ? "Falta la fecha." : "Falta el concepto.");
      return;
    }
    if (draftValue(prepared.draft, field) === value || (field === "amount" && Math.abs(Number(prepared.draft.amount)) === Number(value))) { closeInline(restoreFocus); return; }
    onDraftChange(draftField(field), value);
    closeInline(restoreFocus);
  };

  const renderTextEditor = (field: "description" | "date", type: "text" | "date", placeholder?: string) => <div id={`prepared-review-inline-editor-${prepared.item.id}-${field}`} className="ui-review-inline__editor-wrap">
    <input
      autoFocus
      className="ui-review-inline__input"
      data-review-inline-editor={field}
      aria-label={field === "description" ? "Concepto" : "Fecha"}
      aria-invalid={inlineError ? true : undefined}
      type={type}
      value={inlineDraft}
      placeholder={placeholder}
      onChange={(event) => { setInlineDraft(event.target.value); setInlineError(undefined); }}
      onKeyDown={(event) => { if (event.key === "Enter") { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; event.preventDefault(); commitInline(field, event.currentTarget.value, true); } if (event.key === "Escape") { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; event.preventDefault(); closeInline(true); } }}
      onBlur={(event) => commitInline(field, event.currentTarget.value, false)}
    />
    {inlineError ? <span className="ui-review-inline__field-error" role="alert">{inlineError}</span> : null}
  </div>;

  const renderChoiceEditor = (field: ReviewField, value: string, label: string, options: readonly ReviewInlineChoiceOption[], placeholder: string, emptyLabel?: string) => <div id={`prepared-review-inline-editor-${prepared.item.id}-${field}`}>
    <ReviewInlineChoice ariaLabel={label} value={value} options={options} placeholder={placeholder} emptyLabel={emptyLabel} ariaInvalid={Boolean(issueForField(prepared, field))} onChange={(next) => commitInline(field, next, true)} onCancel={(restoreFocus) => { if (inlineFieldRef.current === field) closeInline(Boolean(restoreFocus)); }} />
  </div>;

  const renderInlineField = (field: ReviewField, label: string, value: string, editor: ReactNode) => {
    const editable = isEditable && editableFields.includes(field);
    const active = editable && inlineField === field;
    const issue = issueForField(prepared, field);
    const absent = isEmptyField(field, value);
    const issueKind = issueKindForField(prepared, field) || (absent ? "attention" : undefined);
    const change = prepared.changes.find((candidate) => candidate.field === field);
    const currentLabel = field === "account"
      ? reviewInlineDisplayValue(field, prepared.item.account || value)
      : field === "category"
        ? reviewInlineDisplayValue(field, prepared.item.category || value)
        : field === "transfer_source_account"
          ? prepared.item.transferFrom || reviewInlineDisplayValue(field, value)
          : field === "transfer_target_account"
            ? prepared.item.transferTo || reviewInlineDisplayValue(field, value)
            : reviewInlineDisplayValue(field, value);
    const issueId = `prepared-review-inline-error-${prepared.item.id}-${field}`;
    return <div className={`ui-review-inline__field${issueKind ? ` ui-review-inline__field--${issueKind}` : ""}`} data-review-inline-field={field} data-review-issue-kind={issueKind} data-review-missing={absent || undefined}>
      <span className="ui-review-inline__label">{label}</span>
      {active ? editor : editable ? <button id={`prepared-review-inline-value-${prepared.item.id}-${field}`} className="ui-review-inline__value ui-review-inline__value--editable" type="button" aria-label={`${label}: ${currentLabel}`} aria-invalid={issue ? true : undefined} aria-describedby={issue ? issueId : undefined} onClick={() => beginInline(field, value)}>{reviewInlineValueWithChange(field, currentLabel, change, false, currentLabel)}</button> : <span className="ui-review-inline__value ui-review-inline__value--readonly" aria-label={`${label}: ${currentLabel}`}>{reviewInlineValueWithChange(field, currentLabel, change, false, currentLabel)}</span>}
      {issue && field !== "amount" ? <span id={issueId} className="ui-review-inline__field-error" role="alert">{issue.message}</span> : null}
    </div>;
  };

  const amountIssue = issueForField(prepared, "amount");
  const amountMessage = inlineField === "amount" ? inlineError || amountIssue?.message : amountIssue?.message;
  const amountValue = prepared.draft.amount;
  const amountDisplayValue = prepared.item.signedAmount;
  const amountCurrentLabel = reviewInlineDisplayValue("amount", amountDisplayValue, privateAmounts);
  const amountChange = prepared.changes.find((change) => change.field === "amount");
  const amountDisplay = reviewInlineValueWithChange("amount", amountDisplayValue, amountChange, privateAmounts, amountCurrentLabel);
  const amountNode = <div className="ui-review-inline__amount" data-review-inline-field="amount">
    <span className="sr-only">Importe</span>
      {inlineField === "amount" && amountEditable ? <div id={`prepared-review-inline-editor-${prepared.item.id}-amount`} className="ui-review-inline__editor-wrap">
      <input autoFocus className="ui-review-inline__input ui-review-inline__amount-input" data-review-inline-editor="amount" aria-label="Importe" aria-invalid={amountMessage ? true : undefined} aria-describedby={amountMessage ? `prepared-review-inline-error-${prepared.item.id}-amount` : undefined} type="text" inputMode="decimal" value={inlineDraft} placeholder={privateAmounts ? "••••••" : "0,00"} onChange={(event) => { setInlineDraft(event.target.value); setInlineError(undefined); }} onKeyDown={(event) => { if (event.key === "Enter") { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; event.preventDefault(); commitInline("amount", event.currentTarget.value, true); } if (event.key === "Escape") { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; event.preventDefault(); closeInline(true); } }} onBlur={(event) => commitInline("amount", event.currentTarget.value, false)} />
      {amountMessage ? <span id={`prepared-review-inline-error-${prepared.item.id}-amount`} className="ui-review-inline__field-error" role="alert">{amountMessage}</span> : null}
      </div> : amountEditable ? <button id={`prepared-review-inline-value-${prepared.item.id}-amount`} className="ui-review-inline__value ui-review-inline__value--amount ui-review-inline__value--editable" type="button" aria-label={`Importe: ${amountCurrentLabel}`} aria-invalid={amountIssue ? true : undefined} aria-describedby={amountIssue ? `prepared-review-inline-error-${prepared.item.id}-amount` : undefined} onClick={() => beginInline("amount", amountValue)}>{amountDisplay}</button> : <span className="ui-review-inline__value ui-review-inline__value--amount ui-review-inline__value--readonly" aria-label={`Importe: ${amountCurrentLabel}`}>{amountDisplay}</span>}
    {inlineField !== "amount" && amountMessage ? <span id={`prepared-review-inline-error-${prepared.item.id}-amount`} className="ui-review-inline__field-error" role="alert">{amountMessage}</span> : null}
  </div>;

  const inlineContent = <div className={`ui-review-inline${isEditable ? "" : " ui-review-inline--readonly"}`} data-review-inline-content>
    <div className="ui-review-inline__concept">{renderInlineField("description", "Concepto", prepared.draft.description, renderTextEditor("description", "text", "Añade un concepto"))}</div>
    <div className="ui-review-inline__grid">
      {renderInlineField("date", "Fecha", prepared.draft.date, renderTextEditor("date", "date"))}
      {renderInlineField("kind", "Tipo", prepared.draft.kind, renderChoiceEditor("kind", prepared.draft.kind, "Tipo", [{id: "expense", label: "Gasto"}, {id: "income", label: "Ingreso"}, {id: "transfer", label: "Traspaso"}], "Seleccionar tipo"))}
      {prepared.draft.kind === "transfer" ? <>
        {renderInlineField("transfer_source_account", "Origen", prepared.draft.source_account, renderChoiceEditor("transfer_source_account", prepared.draft.source_account, "Cuenta de origen", accountOptions, "Seleccionar cuenta de origen", "Sin cuenta"))}
        {renderInlineField("transfer_target_account", "Destino", prepared.draft.target_account, renderChoiceEditor("transfer_target_account", prepared.draft.target_account, "Cuenta de destino", accountOptions, "Seleccionar cuenta de destino", "Sin cuenta"))}
      </> : <>
        {renderInlineField("account", "Cuenta", prepared.draft.account, renderChoiceEditor("account", prepared.draft.account, "Cuenta", accountOptions, "Buscar cuenta…", "Sin cuenta"))}
        {renderInlineField("category", "Categoría", prepared.draft.category, <TransactionCategoryEditor autoFocus ariaLabel="Categoría" placeholder="Buscar categoría…" ariaInvalid={Boolean(issueForField(prepared, "category"))} ariaDescribedBy={issueForField(prepared, "category") ? `prepared-review-inline-error-${prepared.item.id}-category` : undefined} categories={categoryOptions} value={prepared.draft.category} onChange={(value) => commitInline("category", value, true)} onCancel={(restoreFocus) => { if (inlineFieldRef.current === "category") closeInline(Boolean(restoreFocus)); }} />)}
      </>}
    </div>
  </div>;
  const localAttentionIssues = prepared.attentionIssues.filter((issue) => localIssueCodes.has(issue.code));
  const residualIssues = [...prepared.attentionIssues, ...prepared.blockingIssues].filter((issue) => !localIssueCodes.has(issue.code));
  const inlineIssues = <>
    {localAttentionIssues.length ? <div className="ui-review-inline__issues ui-review-inline__issues--attention" data-review-attention-summary role="status"><strong>Necesita atención</strong><span>{localAttentionIssues.map((issue) => issue.message).join(" ")}</span></div> : null}
    {residualIssues.length ? <div className="ui-review-inline__issues" role="alert"><strong>Revisión</strong><span>{residualIssues.map(compactIssue).join(" · ")}</span></div> : null}
  </>;

  return {inlineAmount: amountNode, inlineContent, inlineIssues};
}
