import {useEffect, useId, useRef} from "react";
import type {Transaction} from "../../shared/model/transactions";
import {IconButton} from "../../ui/controls/Button";

export function TransactionAttachmentsDialog({movement, onClose}: {
  movement: Transaction | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!movement) return;
    const activeElement = document.activeElement;
    const summary = activeElement?.closest("details")?.querySelector("summary");
    triggerRef.current = summary instanceof HTMLElement ? summary : activeElement instanceof HTMLElement ? activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    dialog?.querySelector<HTMLButtonElement>(".ui-icon-button")?.focus({preventScroll: true});
    return () => {
      if (dialog?.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger?.isConnected) {
        window.setTimeout(() => {
          if (!trigger.isConnected) return;
          trigger.focus({preventScroll: true});
        }, 100);
      }
    };
  }, [movement]);

  if (!movement) return null;

  const closeDialog = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    onClose();
  };

  return <dialog ref={dialogRef} className="transaction-attachments-dialog" aria-labelledby={titleId} onCancel={(event) => {
    event.preventDefault();
    closeDialog();
  }}>
    <div className="transaction-attachments-dialog__heading">
      <div>
        <p>Detalle del movimiento</p>
        <h2 id={titleId}>Adjuntos de {movement.description}</h2>
      </div>
      <IconButton variant="subtle" aria-label="Cerrar adjuntos" onClick={closeDialog}>×</IconButton>
    </div>
    <ul className="transaction-attachments-dialog__list">
      {movement.attachments.map((attachment) => <li key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a></li>)}
    </ul>
  </dialog>;
}
