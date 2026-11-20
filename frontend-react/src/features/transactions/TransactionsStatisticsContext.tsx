import {MoneyAmount} from "../../ui/finance/MoneyAmount";
import type {TransactionListPayload} from "./types";
import {Button} from "../../ui/controls/Button";

export function TransactionsStatisticsContext({
  payload,
  privateAmounts,
  statisticsAttribution,
  contextScope,
  onClear,
}: {
  payload: TransactionListPayload | null;
  privateAmounts: boolean;
  statisticsAttribution: string;
  contextScope: string | null;
  onClear: () => void;
}) {
  const contextTitle = statisticsAttribution === "report"
    ? "Detalle exacto del informe estadístico"
    : statisticsAttribution === "purchase"
      ? "Detalle estadístico por compra"
      : "Familia estadística";

  return (
    <section className="transactions-statistics-context" aria-labelledby="statistics-context-title">
      <div className="transactions-statistics-context-copy">
        <div className="transactions-statistics-context-heading">
          <h2 id="statistics-context-title">{contextTitle}</h2>
          {contextScope ? <dl className="transactions-statistics-context-scope"><div><dt>Familia</dt><dd>{contextScope}</dd></div></dl> : null}
        </div>
        <p className="transactions-statistics-context-description">
          {statisticsAttribution === "report"
            ? "Replica el resultado del informe: ingresos reales, compras del intervalo y reembolsos imputados a su compra original. La fecha visible de un reembolso puede quedar fuera del intervalo."
            : statisticsAttribution === "purchase"
              ? "Incluye las compras del intervalo y los reembolsos vinculados, aunque se recibieran después."
              : "Mantiene la misma familia principal que usa Estadísticas."}
        </p>
        {payload?.statistics_attribution ? (
          <dl className="transactions-attribution-summary" aria-label="Resumen atribuido de los movimientos filtrados">
            <div><dt>Gasto bruto</dt><dd><MoneyAmount value={payload.statistics_attribution.gross_expense} privateAmounts={privateAmounts} label="Gasto bruto" /></dd></div>
            <div><dt>Reembolsos aplicados</dt><dd><MoneyAmount value={payload.statistics_attribution.refunds_applied} privateAmounts={privateAmounts} label="Reembolsos aplicados" /></dd></div>
            <div><dt>Gasto neto</dt><dd><MoneyAmount value={payload.statistics_attribution.net_expense} privateAmounts={privateAmounts} label="Gasto neto" /></dd></div>
            {payload.statistics_attribution.extra_income ? <div><dt>Exceso como ingreso</dt><dd><MoneyAmount value={payload.statistics_attribution.extra_income} privateAmounts={privateAmounts} label="Exceso como ingreso" /></dd></div> : null}
            {payload.statistics_attribution.income != null ? <div><dt>Ingresos</dt><dd><MoneyAmount value={payload.statistics_attribution.income} privateAmounts={privateAmounts} label="Ingresos" /></dd></div> : null}
            {payload.statistics_attribution.analytical_result != null ? <div><dt>Resultado</dt><dd><MoneyAmount value={payload.statistics_attribution.analytical_result} privateAmounts={privateAmounts} label="Resultado" /></dd></div> : null}
            {"savings_rate" in payload.statistics_attribution ? (
              <div><dt>Tasa de ahorro</dt><dd>{payload.statistics_attribution.savings_rate == null ? "No disponible" : `${payload.statistics_attribution.savings_rate.toLocaleString("es-ES", {maximumFractionDigits: 1})} %`}</dd></div>
            ) : null}
          </dl>
        ) : null}
      </div>
      <Button className="secondary-action" variant="secondary" onClick={onClear}>Quitar filtro de Estadísticas</Button>
    </section>
  );
}
