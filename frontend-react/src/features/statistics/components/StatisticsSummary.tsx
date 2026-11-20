import {RotateCcw} from "lucide-react";
import {euro} from "../../../format";
import {MoneyAmount} from "../../../ui/finance/MoneyAmount";
import {formatPercent} from "../statisticsFormatting";
import type {StatisticsActivityStatus, StatisticsComparison, StatisticsSummary} from "../types";

function PeriodValue({children}: {children: React.ReactNode}) {
  return (
    <span className="stats-previous-value">
      <span>Periodo anterior</span>
      <strong>{children}</strong>
    </span>
  );
}

export function StatisticsSummaryPanel({
  summary,
  comparison,
  activityStatus,
  previousActivityStatus,
  privateAmounts,
}: {
  summary: StatisticsSummary;
  comparison: StatisticsComparison;
  activityStatus: StatisticsActivityStatus;
  previousActivityStatus: StatisticsActivityStatus;
  privateAmounts: boolean;
}) {
  const previousUnknown = previousActivityStatus === "unknown" || !comparison.is_comparable;
  if (activityStatus === "unknown") {
    return (
      <section className="stats-summary-panel" aria-labelledby="statistics-summary-title">
        <div className="stats-summary-heading">
          <h2 id="statistics-summary-title">Resultado del periodo</h2>
          <span>La cobertura no está acreditada; los totales financieros son desconocidos.</span>
        </div>
        <div className="stats-primary-result">
          <div><span>Ingresos menos gasto neto</span><strong>Desconocido</strong></div>
          <PeriodValue>No comparable</PeriodValue>
        </div>
        <div className="stats-supporting-comparison">
          <div className="stats-supporting-headings" aria-hidden="true"><span /><span>Actual</span><span>Anterior</span></div>
          <dl className="stats-supporting-values">
            <div><dt>Ingresos</dt><dd>Desconocidos</dd><small><span className="stats-previous-label">Anterior </span>No comparable</small></div>
            <div><dt>Gasto neto</dt><dd>Desconocido</dd><small><span className="stats-previous-label">Anterior </span>No comparable</small></div>
            <div><dt>Tasa de ahorro</dt><dd>Desconocida</dd><small><span className="stats-previous-label">Anterior </span>No comparable</small></div>
          </dl>
        </div>
      </section>
    );
  }
  return (
    <section className="stats-summary-panel" aria-labelledby="statistics-summary-title">
      <div className="stats-summary-heading">
        <h2 id="statistics-summary-title">Resultado del periodo</h2>
        <span>{comparison.is_comparable ? `Frente a ${comparison.scope.label}; según la base seleccionada y sin equivaler al saldo por cuenta.` : "Comparación anterior no fiable: hay meses sin actividad reportable y cobertura no acreditada. El resultado del periodo no equivale al saldo por cuenta."}</span>
      </div>
      <div className="stats-primary-result">
        <div>
          <span>Ingresos menos gasto neto</span>
          <strong className={summary.analytical_result >= 0 ? "positive" : "negative"}><MoneyAmount value={summary.analytical_result} privateAmounts={privateAmounts} label="Resultado del periodo" /></strong>
        </div>
        <PeriodValue>{previousUnknown ? "No comparable" : <MoneyAmount value={comparison.previous.analytical_result} privateAmounts={privateAmounts} label="Resultado del periodo anterior" />}</PeriodValue>
      </div>
      <div className="stats-supporting-comparison">
        <div className="stats-supporting-headings" aria-hidden="true">
          <span />
          <span>Actual</span>
          <span>Anterior</span>
        </div>
        <dl className="stats-supporting-values">
          <div>
            <dt>Ingresos</dt>
            <dd className="positive"><MoneyAmount value={summary.income} privateAmounts={privateAmounts} tone="income" label="Ingresos del periodo actual" /></dd>
            <small><span className="stats-previous-label">Anterior </span>{previousUnknown ? "No comparable" : <MoneyAmount value={comparison.previous.income} privateAmounts={privateAmounts} tone="income" label="Ingresos del periodo anterior" />}</small>
          </div>
          <div>
            <dt>Gasto neto</dt>
            <dd className="negative"><MoneyAmount value={summary.net_expense} privateAmounts={privateAmounts} tone="expense" label="Gasto neto del periodo actual" /></dd>
            <small><span className="stats-previous-label">Anterior </span>{previousUnknown ? "No comparable" : <MoneyAmount value={comparison.previous.net_expense} privateAmounts={privateAmounts} tone="expense" label="Gasto neto del periodo anterior" />}</small>
          </div>
          <div>
            <dt>Tasa de ahorro</dt>
            <dd className={summary.savings_rate === null ? undefined : summary.savings_rate >= 0 ? "positive" : "negative"}>{formatPercent(summary.savings_rate)}</dd>
            <small aria-label={`Tasa de ahorro del periodo anterior: ${previousUnknown ? "no comparable" : formatPercent(comparison.previous.savings_rate)}`}><span className="stats-previous-label">Anterior </span>{previousUnknown ? "No comparable" : formatPercent(comparison.previous.savings_rate)}</small>
          </div>
        </dl>
      </div>
      {summary.refunds_applied > 0 ? <p className="stats-refund-note">
        <RotateCcw aria-hidden="true" />
        <span>Reembolsos <strong>{euro(summary.refunds_applied)}</strong> · Se descuentan de la compra original; los posteriores pueden ajustar el periodo.</span>
      </p> : null}
    </section>
  );
}
