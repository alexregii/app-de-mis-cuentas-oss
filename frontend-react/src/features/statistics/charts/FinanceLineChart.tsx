import {Suspense} from "react";
import {FinanceChartEngine} from "./chartEngineRuntime";
import type {FinanceChartProps} from "./chartTypes";

export function FinanceLineChart(props: FinanceChartProps) {
  return (
    <Suspense fallback={<div className="chart-engine-loading skeleton-panel" style={{height: props.height ?? 286}} aria-hidden="true" />}>
      <FinanceChartEngine {...props} />
    </Suspense>
  );
}

export function ChartLegendInline({hasPartialPeriod = false, hasUnknownPeriod = false}: {hasPartialPeriod?: boolean; hasUnknownPeriod?: boolean}) {
  return (
    <div className="chart-legend-inline" aria-label="Leyenda del gráfico">
      <span className="legend-chip income"><i aria-hidden="true" />Ingresos</span>
      <span className="legend-chip expense"><i aria-hidden="true" />Gasto neto</span>
      <span className="legend-chip result"><i aria-hidden="true" />Resultado</span>
      {hasPartialPeriod ? <span className="legend-chip partial"><i aria-hidden="true" />Mes parcial</span> : null}
      {hasUnknownPeriod ? <span className="status-chip">Mes sin cobertura acreditada</span> : null}
    </div>
  );
}
