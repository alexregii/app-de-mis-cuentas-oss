import {type CSSProperties, type FormEvent, type ReactNode, useLayoutEffect, useRef} from "react";
import {Loader2, Save} from "lucide-react";
import {euro, formatDate} from "../../format";

export type TransactionEditorKind = "income" | "expense" | "transfer";

export type TransactionEditorInput = {
  kind: TransactionEditorKind;
  amount: string;
  account: string;
  source_account?: string;
  target_account?: string;
  date: string;
  description: string;
  category: string;
  refund_for: string;
  notes: string;
  tag_names: string;
};

export type TransactionEditorAccount = {
  id: number;
  name: string;
  balance?: number;
};

export type TransactionEditorCategory = {
  id: number;
  display_name: string;
  kind: "income" | "expense";
  color: string;
};

export type TransactionEditorRefundCandidate = {
  id: number | string;
  kind: "expense";
  amount: number;
  date: string;
  description: string;
};

export type TransactionEditorErrors = Record<string, string[]>;
export type TransactionEditorField = keyof TransactionEditorInput;

const kindLabels: Record<TransactionEditorKind, string> = {expense: "Gasto", income: "Ingreso", transfer: "Traspaso"};
const defaultKinds: readonly TransactionEditorKind[] = ["expense", "income"];

function FieldError({errors, name}: {errors?: TransactionEditorErrors; name: string}) {
  if (!errors?.[name]?.length) return null;
  return <small className="field-error" role="alert">{errors[name].join(" ")}</small>;
}

export function TransactionEditor({
  input,
  title,
  submitLabel,
  accounts,
  categoriesByKind,
  refundCandidates = [],
  errors,
  submitError,
  saving = false,
  attachment,
  onChange,
  onAttachmentChange,
  onSubmit,
  categoryEditor,
  allowedKinds = defaultKinds,
  showAttachment = false,
  secondaryOnly = false,
}: {
  input: TransactionEditorInput;
  title: string;
  submitLabel: string;
  accounts: readonly TransactionEditorAccount[];
  categoriesByKind: Readonly<Record<"income" | "expense", readonly TransactionEditorCategory[]>>;
  refundCandidates?: readonly TransactionEditorRefundCandidate[];
  errors?: TransactionEditorErrors;
  submitError?: string;
  saving?: boolean;
  attachment?: File | null;
  onChange: (field: TransactionEditorField, value: string) => void;
  onAttachmentChange?: (attachment: File | null) => void;
  onSubmit: () => void | Promise<void>;
  categoryEditor?: ReactNode;
  allowedKinds?: readonly TransactionEditorKind[];
  showAttachment?: boolean;
  /** Review uses this mode after the visible fields have become inline controls. */
  secondaryOnly?: boolean;
}) {
  const submitInProgressRef = useRef(false);
  const submitAnchorRef = useRef<{element: HTMLElement; top: number} | null>(null);
  const previousSubmitErrorRef = useRef(submitError);
  useLayoutEffect(() => {
    if (!submitError) {
      previousSubmitErrorRef.current = "";
      if (!saving) submitAnchorRef.current = null;
      return;
    }
    if (saving) return;
    const previousError = previousSubmitErrorRef.current;
    previousSubmitErrorRef.current = submitError;
    const anchor = submitAnchorRef.current;
    if (previousError === submitError) {
      submitAnchorRef.current = null;
      return;
    }
    submitAnchorRef.current = null;
    if (!anchor?.element.isConnected) return;
    const drift = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(drift) > 0.5 && document.scrollingElement) document.scrollingElement.scrollTop += drift;
  }, [saving, submitError]);
  const categoryOptions = input.kind === "transfer" ? [] : categoriesByKind[input.kind];
  const quickCategories = categoryOptions.slice(0, 8);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || submitInProgressRef.current) return;
    const activeElement = document.activeElement;
    submitAnchorRef.current = activeElement instanceof HTMLElement && event.currentTarget.contains(activeElement)
      ? {element: activeElement, top: activeElement.getBoundingClientRect().top}
      : null;
    submitInProgressRef.current = true;
    try {
      await onSubmit();
    } finally {
      submitInProgressRef.current = false;
    }
  };
  const change = (field: TransactionEditorField) => (event: {target: {value: string}}) => onChange(field, event.target.value);

  return (
    <form className="ui-transaction-editor entry-form" data-transaction-editor aria-busy={saving || undefined} autoComplete="off" noValidate onSubmit={submit}>
      <div className="ui-transaction-editor__heading full">
        <h3>{title}</h3>
        <p>{secondaryOnly ? "Notas y etiquetas opcionales." : "Completa los datos del movimiento en una sola edición."}</p>
      </div>
      {submitError ? <div className="message error" role="alert">{submitError}</div> : null}
      {!secondaryOnly ? <>
        <label>
          Tipo
          <select name="kind" required value={input.kind} onChange={change("kind")}>
            {allowedKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
          </select>
        </label>
        <label>
          Importe
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={input.amount} onChange={change("amount")} />
          <FieldError errors={errors} name="amount" />
        </label>
        {input.kind === "transfer" ? <>
          <label>
            Origen
            <select name="source_account" required value={input.source_account || ""} onChange={change("source_account")}>
              <option value="">Selecciona cuenta</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <FieldError errors={errors} name="source_account" />
          </label>
          <label>
            Destino
            <select name="target_account" required value={input.target_account || ""} onChange={change("target_account")}>
              <option value="">Selecciona cuenta</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <FieldError errors={errors} name="target_account" />
          </label>
          <p className="ui-transaction-editor__field-hint full">El traspaso mueve el importe entre dos cuentas y no afecta a ingresos ni gastos.</p>
        </> : <>
          <label>
            Cuenta
            <select name="account" required value={input.account} onChange={change("account")}>
              <option value="">Selecciona cuenta</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <FieldError errors={errors} name="account" />
          </label>
          <div className="ui-transaction-editor__quick-picker quick-picker" aria-label="Cuentas rápidas">
            {accounts.slice(0, 4).map((account) => (
              <button key={account.id} type="button" className={input.account === String(account.id) ? "selected" : ""} onClick={() => onChange("account", String(account.id))}>
                <span>{account.name}</span>
                {typeof account.balance === "number" ? <small>{euro(account.balance)}</small> : null}
              </button>
            ))}
          </div>
        </>}
        <label>
          Fecha
          <input name="date" type="date" required value={input.date} onChange={change("date")} />
          <FieldError errors={errors} name="date" />
        </label>
        <label className="ui-transaction-editor__full full">
          Concepto
          <input name="description" type="text" required value={input.description} onChange={change("description")} placeholder="Ej. compra semanal" />
          <FieldError errors={errors} name="description" />
        </label>
        {categoryEditor ?? <>
          <label>
            Categoría
            <select name="category" value={input.category} onChange={change("category")}>
              <option value="">Sin categoría</option>
              {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.display_name}</option>)}
            </select>
          </label>
          <div className="ui-transaction-editor__quick-picker ui-transaction-editor__quick-picker--category quick-picker category-picker ui-transaction-editor__full full" aria-label="Categorías rápidas">
            {quickCategories.map((category) => (
              <button key={category.id} type="button" className={input.category === String(category.id) ? "selected" : ""} style={{"--chip-color": category.color} as CSSProperties} onClick={() => onChange("category", String(category.id))}>
                <i aria-hidden="true" />
                <span>{category.display_name}</span>
              </button>
            ))}
          </div>
        </>}
      </> : null}
      <label>
        Etiquetas
        <input name="tag_names" type="text" value={input.tag_names} onChange={change("tag_names")} placeholder="casa, anual" />
      </label>
      {!secondaryOnly && input.kind === "income" ? (
        <label className="ui-transaction-editor__full full">
          Reembolso de gasto
          <select name="refund_for" value={input.refund_for} onChange={change("refund_for")}>
            <option value="">Sin reembolso asociado</option>
            {refundCandidates.map((item) => <option key={item.id} value={item.id}>{formatDate(item.date)} · {item.description} · {euro(item.amount)}</option>)}
          </select>
          <FieldError errors={errors} name="refund_for" />
        </label>
      ) : null}
      <label className="ui-transaction-editor__full full">
        Notas
        <textarea name="notes" rows={3} value={input.notes} onChange={change("notes")} />
      </label>
      {showAttachment ? <label className="ui-transaction-editor__full full">
        Ticket o factura
        <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => onAttachmentChange?.(event.target.files?.[0] || null)} />
        {attachment ? <small>{attachment.name}</small> : null}
        <FieldError errors={errors} name="attachment" />
      </label> : null}
      <button className="button primary ui-transaction-editor__full full" type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>
        {saving ? <Loader2 aria-hidden="true" className="spin" /> : <Save aria-hidden="true" />}
        {saving ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
