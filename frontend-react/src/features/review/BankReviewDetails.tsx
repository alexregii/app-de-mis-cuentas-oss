import {FormField, Select} from "../../ui/controls/FormField";
import type {TransactionEditorField, TransactionEditorRefundCandidate} from "../../ui/finance/TransactionEditor";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";

export function BankReviewDetails({prepared, refundCandidates, onDraftChange, onRememberCategoryChange}: {
  prepared: PreparedReview;
  refundCandidates: readonly TransactionEditorRefundCandidate[];
  onDraftChange: (field: TransactionEditorField, value: string) => void;
  onRememberCategoryChange: (value: boolean) => void;
}) {
  return <div className="prepared-review-details">
    {prepared.preservedRefundDescription ? <p className="prepared-review-suggestion">
      <strong>Reembolso vinculado</strong> Gasto asociado: {prepared.preservedRefundDescription}.
    </p> : null}
    {prepared.preservedAllocationLabels?.length ? <p className="prepared-review-suggestion">
      <strong>Reparto existente</strong> Al reconfirmar se conservarán estas categorías: {prepared.preservedAllocationLabels.join(", ")}.
    </p> : null}
    {prepared.capabilities.canChooseRefund ? <FormField label="Reembolso de gasto" className="compact-label">
      <Select value={prepared.draft.refund_for} onChange={(event) => onDraftChange("refund_for", event.target.value)}>
        <option value="">No es reembolso</option>
        {refundCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.date} · {candidate.description}</option>)}
      </Select>
    </FormField> : null}
    {prepared.capabilities.canRememberCategory ? <label className="check-row compact-check-row">
      <input type="checkbox" checked={prepared.draft.remember_category} onChange={(event) => onRememberCategoryChange(event.target.checked)} />
      Recordar categoría para descripciones futuras
    </label> : null}
    {prepared.suggestion?.reason ? <p className="prepared-review-suggestion"><strong>Sugerencia</strong>{prepared.suggestion.modelName ? ` · ${prepared.suggestion.modelName}` : ""}{prepared.suggestion.confidence ? ` · ${Math.round(prepared.suggestion.confidence * 100)}% de confianza` : ""}{prepared.suggestion.status ? ` · ${prepared.suggestion.status}` : ""} · {prepared.suggestion.reason}</p> : null}
  </div>;
}
