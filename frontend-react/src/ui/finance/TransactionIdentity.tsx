import {formatDate} from "../../format";
import {EntityMarker} from "./EntityMarker";
import type {LedgerEntity, LedgerKind} from "./LedgerItem";

const kindLabels: Record<LedgerKind, string> = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Traspaso",
};

export function TransactionIdentity({
  description,
  date,
  account,
  kind,
  sourceLabel,
}: {
  description?: string;
  date?: string;
  account?: LedgerEntity | null;
  kind?: LedgerKind;
  sourceLabel?: string;
}) {
  const hasMeta = Boolean(date || account || kind || sourceLabel);
  return (
    <div className="ui-transaction-identity" data-transaction-identity>
      {description ? <strong className="ui-transaction-identity__description">{description}</strong> : null}
      {hasMeta ? <div className="ui-transaction-identity__meta">
        {date ? <time dateTime={date}>{formatDate(date)}</time> : null}
        {account ? <EntityMarker entity={account} /> : account === null ? <span className="ui-transaction-identity__missing">Cuenta pendiente</span> : null}
        {kind ? <span className="ui-transaction-identity__kind">{kindLabels[kind]}</span> : null}
        {sourceLabel ? <span className="ui-transaction-identity__source">{sourceLabel}</span> : null}
      </div> : null}
    </div>
  );
}

export {kindLabels as transactionKindLabels};
