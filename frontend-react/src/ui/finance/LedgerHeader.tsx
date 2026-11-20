import {MoneyAmount} from "./MoneyAmount";

export type LedgerHeaderSummary = Readonly<{
  period: string;
  /** Signed aggregate supplied by the consumer; normally >= 0. */
  income: number;
  /** Signed aggregate supplied by the consumer; normally <= 0. */
  expense: number;
  /** Final prepared value, displayed verbatim; never derived by this component. */
  net: number;
  /** Optional secondary aggregate retained from the transaction summary. */
  excluded?: number;
}>;

export function LedgerHeader({summary, privateAmounts}: {
  summary: LedgerHeaderSummary;
  privateAmounts: boolean;
}) {
  return <header className="ui-ledger-header">
    <div>
      <p>{summary.period}</p>
      <h2>Extracto de movimientos</h2>
    </div>
    <div className="ui-ledger-header__reading">
      <span className="ui-ledger-header__net"><small>Neto operativo</small><MoneyAmount value={summary.net} privateAmounts={privateAmounts} label="Neto operativo" /></span>
      <span className="ui-ledger-header__values">
        <span>Ingresos <MoneyAmount value={summary.income} privateAmounts={privateAmounts} tone="income" label="Ingresos" /></span>
        <span>Gastos <MoneyAmount value={summary.expense} privateAmounts={privateAmounts} label="Gastos" /></span>
      </span>
      {summary.excluded != null ? <span className="ui-ledger-header__excluded">Excluido <MoneyAmount value={summary.excluded} privateAmounts={privateAmounts} label="Excluido" /></span> : null}
    </div>
  </header>;
}
