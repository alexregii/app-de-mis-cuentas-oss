import {useEffect, useState, type ReactNode} from "react";
import {ReviewTransactionCard} from "../../ui/finance/ReviewTransactionCard";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";

const historyLabels = {new: "Nuevo", changed: "Modificado", unchanged: "", reopened: "Reabierto"} as const;
const preparationLabels = {prepared: "Preparado", needs_attention: "Necesita atención", blocked: "Bloqueado"} as const;

/**
 * Composición neutral de una revisión preparada. La feature prepara campos,
 * detalles, selección y acciones; esta pieza solo los coloca en la superficie aprobada.
 */
export type PreparedReviewCardProps = Readonly<{
  prepared: PreparedReview;
  privateAmounts?: boolean;
  inlineAmount: ReactNode;
  inlineContent: ReactNode;
  inlineIssues?: ReactNode;
  selectionControl?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  suppressActions?: boolean;
  editLabel?: string;
  editButtonTone?: "primary" | "secondary";
  exiting?: boolean;
  onExitComplete?: () => void;
}>;

export function PreparedReviewCard({prepared, privateAmounts = false, inlineAmount, inlineContent, inlineIssues, selectionControl, details, actions, selectionMode = false, selected = false, onSelect, suppressActions = false, editLabel = "Más detalles", editButtonTone = "secondary", exiting = false, onExitComplete}: PreparedReviewCardProps) {
  const [editing, setEditing] = useState(false);
  const hasDetails = Boolean(details);

  useEffect(() => {
    if (selectionMode) setEditing(false);
  }, [selectionMode]);

  return <ReviewTransactionCard
    item={prepared.item}
    privateAmounts={privateAmounts}
    inlineAmount={inlineAmount}
    inlineContent={inlineContent}
    inlineIssues={inlineIssues}
    selectionControl={selectionControl}
    selectionMode={selectionMode}
    selected={selected}
    onSelect={onSelect}
    suppressActions={suppressActions}
    preparationKey={prepared.preparation}
    historyKey={prepared.history}
    historyLabel={historyLabels[prepared.history]}
    decisionKey={prepared.decision}
    decisionLabel={prepared.decision === "pending" ? "Pendiente de decidir" : "Incorporado"}
    statusLabel={preparationLabels[prepared.preparation]}
    blockingIssueCount={prepared.blockingIssues.length}
    attentionIssues={prepared.attentionIssues}
    onEdit={hasDetails && !selectionMode ? () => setEditing(true) : undefined}
    onCloseEdit={() => setEditing(false)}
    editing={selectionMode ? false : editing}
    editLabel={editLabel}
    editButtonTone={editButtonTone}
    editor={details}
    decisionActions={actions}
    exiting={exiting}
    onExitComplete={onExitComplete}
  />;
}
