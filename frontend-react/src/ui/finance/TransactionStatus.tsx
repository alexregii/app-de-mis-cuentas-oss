export type TransactionStatusValue = "new" | "changed" | "needs_attention" | "blocked" | "prepared" | "incorporated" | "ready";

const statusLabels: Record<TransactionStatusValue, string> = {
  new: "Nuevo",
  changed: "Modificado",
  needs_attention: "Necesita atención",
  blocked: "Bloqueado",
  prepared: "Preparado",
  incorporated: "Incorporado",
  ready: "Listo",
};

export function TransactionStatus({state, label}: {state: TransactionStatusValue; label?: string}) {
  const visibleLabel = label || statusLabels[state];
  return <span className={`ui-transaction-status ui-transaction-status--${state}`} data-transaction-status={state} aria-label={`Estado: ${visibleLabel}`}>{visibleLabel}</span>;
}

export {statusLabels as transactionStatusLabels};
