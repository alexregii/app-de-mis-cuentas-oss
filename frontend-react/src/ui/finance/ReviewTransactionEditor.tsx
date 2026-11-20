import {TransactionEditor, type TransactionEditorAccount, type TransactionEditorCategory, type TransactionEditorErrors, type TransactionEditorField, type TransactionEditorInput, type TransactionEditorRefundCandidate} from "./TransactionEditor";

export function ReviewTransactionEditor({input, accounts, categoriesByKind, refundCandidates, errors, submitError, saving, attachment, onChange, onAttachmentChange, onSubmit, secondaryOnly = false, showAttachment = false}: {
  input: TransactionEditorInput;
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
  secondaryOnly?: boolean;
  showAttachment?: boolean;
}) {
  return <div className="ui-review-transaction-editor">
    <TransactionEditor
      title={secondaryOnly ? "Información adicional" : "Datos del movimiento"}
      submitLabel={secondaryOnly ? "Guardar detalles" : "Aplicar cambios"}
      input={input}
      accounts={accounts}
      categoriesByKind={categoriesByKind}
      refundCandidates={refundCandidates}
      errors={errors}
      submitError={submitError}
      saving={saving}
      attachment={attachment}
      allowedKinds={["expense", "income", "transfer"]}
      secondaryOnly={secondaryOnly}
      showAttachment={showAttachment}
      onChange={onChange}
      onAttachmentChange={onAttachmentChange}
      onSubmit={onSubmit}
    />
  </div>;
}
