import {MoneyAmount} from "../../ui/finance/MoneyAmount";

export const headerCandidates = [
  {id: "statement", label: "A · Statement"},
  {id: "inline", label: "B · Compact inline"},
  {id: "editorial", label: "C · Editorial balance"},
  {id: "ledger", label: "D · Ledger masthead"},
  {id: "register", label: "E · Registro contable"},
  {id: "brief", label: "F · Period brief"},
] as const;

export type HeaderCandidate = typeof headerCandidates[number]["id"];

const headerSummary = {period: "Septiembre 2026", income: 7894.26, expense: -3427.79, net: 4466.47};

function SummaryAmounts({privateAmounts, compact = false}: {privateAmounts: boolean; compact?: boolean}) {
  return <span className={compact ? "ui-lab-statement-summary__compact-values" : "ui-lab-statement-summary__values"}>
    <span>Ingresos <MoneyAmount value={headerSummary.income} privateAmounts={privateAmounts} tone="income" label="Ingresos" /></span>
    <span>Gastos <MoneyAmount value={headerSummary.expense} privateAmounts={privateAmounts} tone="neutral" label="Gastos" /></span>
  </span>;
}

export function LedgerHeader({candidate = "statement", privateAmounts, selectionMode, onTogglePrivate, onToggleSelection}: {
  candidate?: HeaderCandidate;
  privateAmounts: boolean;
  selectionMode: boolean;
  onTogglePrivate: () => void;
  onToggleSelection: () => void;
}) {
  const actions = <div className="ui-lab-statement-header__actions"><button type="button" onClick={onTogglePrivate}>{privateAmounts ? "Mostrar importes" : "Ocultar importes"}</button><button type="button" aria-pressed={selectionMode} onClick={onToggleSelection}>{selectionMode ? "Cancelar selección" : "Seleccionar"}</button></div>;
  const net = <span className="ui-lab-statement-summary__net"><small>Neto operativo</small><MoneyAmount value={headerSummary.net} privateAmounts={privateAmounts} label="Neto operativo" /></span>;

  if (candidate === "inline") return <header className="ui-lab-statement-header ui-lab-statement-header--inline"><span className="ui-lab-statement-summary__period">{headerSummary.period}</span>{net}<SummaryAmounts privateAmounts={privateAmounts} compact />{actions}</header>;
  if (candidate === "editorial") return <header className="ui-lab-statement-header ui-lab-statement-header--editorial"><div><p>{headerSummary.period}</p><div className="ui-lab-statement-summary__editorial-line"><MoneyAmount value={headerSummary.income} privateAmounts={privateAmounts} tone="income" label="Ingresos" /><span>entradas</span></div><div className="ui-lab-statement-summary__editorial-line"><MoneyAmount value={headerSummary.expense} privateAmounts={privateAmounts} tone="neutral" label="Gastos" /><span>salidas</span></div><div className="ui-lab-statement-summary__editorial-net"><MoneyAmount value={headerSummary.net} privateAmounts={privateAmounts} label="Neto operativo" /><span>neto</span></div></div>{actions}</header>;
  if (candidate === "ledger") return <header className="ui-lab-statement-header ui-lab-statement-header--ledger"><div><p>{headerSummary.period} · Extracto</p><h3>Movimientos</h3></div><div className="ui-lab-statement-summary__ledger-reading">{net}<SummaryAmounts privateAmounts={privateAmounts} compact /></div>{actions}</header>;
  if (candidate === "register") return <header className="ui-lab-statement-header ui-lab-statement-header--register"><div><p>Extracto del periodo</p><h3>{headerSummary.period}</h3></div><div className="ui-lab-statement-summary__register"><span>Entradas <MoneyAmount value={headerSummary.income} privateAmounts={privateAmounts} tone="income" label="Ingresos" /></span><span>Salidas <MoneyAmount value={headerSummary.expense} privateAmounts={privateAmounts} tone="neutral" label="Gastos" /></span><b>{net}</b></div>{actions}</header>;
  if (candidate === "brief") return <header className="ui-lab-statement-header ui-lab-statement-header--brief"><div><p>{headerSummary.period}</p><h3>Balance del periodo</h3><SummaryAmounts privateAmounts={privateAmounts} compact /></div>{net}{actions}</header>;
  return <header className="ui-lab-statement-header ui-lab-statement-header--statement"><div><p>{headerSummary.period}</p><h3>Extracto de movimientos</h3></div><div className="ui-lab-statement-summary__statement-reading">{net}<SummaryAmounts privateAmounts={privateAmounts} compact /></div>{actions}</header>;
}
