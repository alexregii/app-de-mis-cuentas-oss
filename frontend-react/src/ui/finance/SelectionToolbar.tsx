import {useId, useLayoutEffect, useState, type ReactNode, type RefObject} from "react";
import {useInputModality} from "../foundations/useInputModality";

export type SelectionToolbarAction = Readonly<{
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  onAction: () => void;
}>;

export function SelectionToolbar({selectionMode, selectionAvailable = true, onToggleSelection, selectedCount, actions, feedback, selectionToggleRef, children}: {
  selectionMode: boolean;
  selectionAvailable?: boolean;
  onToggleSelection: () => void;
  selectedCount: number;
  actions: readonly SelectionToolbarAction[];
  feedback?: {kind: "status" | "error"; message: string} | null;
  selectionToggleRef?: RefObject<HTMLButtonElement | null>;
  children?: ReactNode;
}) {
  const modalityRef = useInputModality();
  const [revealedReasonId, setRevealedReasonId] = useState<string | null>(null);
  const contextualReasonId = useId();
  const selectionLabel = selectedCount === 1 ? "1 seleccionado" : `${selectedCount} seleccionados`;
  const noActionsAvailable = selectedCount > 0 && actions.every((action) => !action.available);
  const contextualAction = actions.find((action) => action.id === revealedReasonId && !action.available && action.reason);
  useLayoutEffect(() => {
    if (!selectionMode && feedback) selectionToggleRef?.current?.focus({preventScroll: true});
  }, [feedback, selectionMode, selectionToggleRef]);
  return <section ref={modalityRef} className="ui-selection-toolbar" aria-label={selectionMode ? "Acciones de selección" : "Selección de movimientos"}>
    <div className="ui-selection-toolbar__primary-row">
      <p className={`ui-selection-toolbar__summary${selectionMode || feedback ? "" : " is-hidden"}`} role={feedback ? feedback.kind === "error" ? "alert" : "status" : undefined} aria-live={feedback?.kind === "error" ? "assertive" : "polite"} aria-atomic="true" aria-hidden={!selectionMode && !feedback || undefined} title={feedback?.message}>{feedback?.message || (selectedCount ? `${selectionLabel}${noActionsAvailable ? " · No hay acciones disponibles." : ""}` : "0 seleccionados")}</p>
      <div className="ui-selection-toolbar__toggle-row">
        <button ref={selectionToggleRef} className="ui-selection-toolbar__toggle" type="button" aria-label={selectionMode ? "Cancelar selección" : "Seleccionar"} disabled={!selectionMode && !selectionAvailable} aria-disabled={!selectionMode && !selectionAvailable || undefined} onClick={(event) => {
        event.currentTarget.focus({preventScroll: true});
        setRevealedReasonId(null);
        onToggleSelection();
        }}>{selectionMode ? "Cancelar" : "Seleccionar"}</button>
      </div>
    </div>
    {selectionMode ? <>
    {selectedCount && !noActionsAvailable ? <div className="ui-selection-toolbar__actions">
      {actions.map((action) => {
        return <span className="ui-selection-toolbar__action" key={action.id}>
          <button type="button" aria-disabled={!action.available || undefined} aria-describedby={revealedReasonId === action.id ? contextualReasonId : undefined} onClick={() => { if (action.available) { setRevealedReasonId(null); action.onAction(); } else setRevealedReasonId(action.id); }}>{action.label}</button>
        </span>;
      })}
    </div> : null}
    {children}
    {contextualAction && !noActionsAvailable ? <p className="ui-selection-toolbar__reason" id={contextualReasonId} role="status">{contextualAction.reason}</p> : null}
    </> : null}
  </section>;
}
