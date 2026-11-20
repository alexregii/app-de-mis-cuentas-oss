import {useId} from "react";

export type LedgerStateAction = Readonly<{
  label: string;
  onAction: () => void;
}>;

export function LedgerEmptyState({title, detail, action}: {
  title: string;
  detail?: string;
  action?: LedgerStateAction;
}) {
  const titleId = useId();
  const detailId = useId();

  return (
    <section className="ui-ledger-state ui-ledger-state--empty" tabIndex={-1} aria-labelledby={titleId} aria-describedby={detail ? detailId : undefined}>
      <div className="ui-ledger-state__copy">
        <h3 id={titleId}>{title}</h3>
        {detail ? <p id={detailId}>{detail}</p> : null}
      </div>
      {action ? <button type="button" onClick={action.onAction}>{action.label}</button> : null}
    </section>
  );
}

export function LedgerLoadingState({label = "Cargando movimientos…"}: {label?: string}) {
  return (
    <div className="ui-ledger-loading-state" role="status" aria-live="polite" aria-busy="true">
      <p>{label}</p>
      <div className="ui-ledger-loading-state__rows" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <span className="ui-ledger-loading-state__row" key={row}>
            <i className="ui-ledger-loading-state__date" />
            <span className="ui-ledger-loading-state__copy">
              <i />
              <i />
            </span>
            <i className="ui-ledger-loading-state__amount" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function LedgerErrorState({message, onRetry}: {
  message: string;
  onRetry?: () => void;
}) {
  const titleId = useId();
  const messageId = useId();

  return (
    <section className="ui-ledger-state ui-ledger-state--error" role="alert" aria-labelledby={titleId} aria-describedby={messageId}>
      <div className="ui-ledger-state__copy">
        <h3 id={titleId}>No se pudieron cargar los movimientos</h3>
        <p id={messageId}>{message}</p>
      </div>
      {onRetry ? <button type="button" onClick={onRetry}>Reintentar</button> : null}
    </section>
  );
}
