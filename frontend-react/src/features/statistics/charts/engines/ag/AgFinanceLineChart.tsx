import "./offscreen-canvas-polyfill";
import {useId, useMemo} from "react";
import type {AgChartOptions, AgSeriesLineSegmentOptions} from "ag-charts-community";
import {AgCharts} from "ag-charts-react";
import {AG_CHARTS_LOCALE_ES_ES} from "ag-charts-locale";
import {euro} from "../../../../../format";
import {chartTickValue, shortDayLabel, shortMonthLabel} from "../../../statisticsFormatting";
import type {StatisticsActivityStatus} from "../../../types";
import type {FinanceChartProps} from "../../chartTypes";
import {useAgChartPalette} from "./agChartSetup";

interface FinanceDatum {
  date: string;
  label: string;
  displayLabel: string;
  income: number | null;
  netExpense: number | null;
  netResult: number | null;
  activityStatus?: StatisticsActivityStatus;
  partial: boolean;
}

const partialSegmentation = (data: FinanceDatum[]) => {
  if (data.length < 2 || (!data[0].partial && !data[data.length - 1].partial)) return undefined;
  if (data.length === 2) {
    return {enabled: true, key: "x" as const, segments: [{lineDash: [5, 4]}]};
  }
  const segments: AgSeriesLineSegmentOptions[] = [];
  const firstCompleteIndex = data[0].partial ? 1 : 0;
  const lastCompleteIndex = data[data.length - 1].partial ? data.length - 2 : data.length - 1;
  if (data[0].partial) segments.push({stop: data[1].label, lineDash: [5, 4]});
  if (firstCompleteIndex <= lastCompleteIndex) {
    segments.push({start: data[firstCompleteIndex].label, stop: data[lastCompleteIndex].label});
  }
  if (data[data.length - 1].partial) segments.push({start: data[data.length - 2].label, lineDash: [5, 4]});
  return {enabled: true, key: "x" as const, segments};
};

export function AgFinanceLineChart({
  points,
  title,
  height = 286,
  granularity = "month",
  selectedDate = "",
  onSelectPoint,
}: FinanceChartProps) {
  const captionId = useId();
  const showMarkers = points.length <= 12;
  const palette = useAgChartPalette();
  const options = useMemo<AgChartOptions<FinanceDatum>>(() => {
    const labelFor = granularity === "month" ? shortMonthLabel : shortDayLabel;
    const chartData = points.map((point) => ({
      date: point.date,
      label: `${labelFor(point.date)}${point.isPartial ? " *" : ""}`,
      displayLabel: labelFor(point.date),
      income: point.income,
      netExpense: point.netExpense,
      netResult: point.netResult ?? (point.income !== null && point.netExpense !== null ? point.income - point.netExpense : null),
      activityStatus: point.activityStatus,
      partial: Boolean(point.isPartial),
    }));
    const segmentation = partialSegmentation(chartData);
    const marker = (color: string) => ({
      enabled: showMarkers,
      fill: color,
      size: 5,
      stroke: color,
      strokeWidth: 0,
      itemStyler: ({first, last}: {first: boolean; last: boolean}) => {
        const partial = (first && chartData[0].partial) || (last && chartData[chartData.length - 1].partial);
        return partial
          ? {fill: palette.surface, size: 7, stroke: color, strokeWidth: 2}
          : {fill: color, size: 5, stroke: color, strokeWidth: 0};
      },
    });
    return {
      data: chartData,
      minHeight: 0,
      minWidth: 0,
      padding: {top: 8, right: 8, bottom: 4, left: 4},
      background: {visible: false},
      locale: {localeText: AG_CHARTS_LOCALE_ES_ES},
      animation: {enabled: false},
      highlight: {enabled: true},
      keyboard: {enabled: true, tabIndex: 0},
      legend: {enabled: false},
      tooltip: {enabled: true, mode: "shared", range: "nearest", delay: 0},
      touch: {dragAction: "none"},
      listeners: {
        seriesNodeClick: ({datum}) => onSelectPoint?.(datum.date),
      },
      axes: {
        x: {
          type: "category",
          position: "bottom",
          gridLine: {enabled: false},
          line: {stroke: palette.rule},
          tick: {stroke: palette.rule, size: 5},
          label: {
            autoRotate: false,
            color: palette.muted,
            fontFamily: "Geist Mono, ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 600,
          },
        },
        y: {
          type: "number",
          position: "left",
          line: {enabled: false},
          tick: {enabled: false},
          gridLine: {style: [{stroke: palette.rule, lineDash: [3, 3]}]},
          label: {
            color: palette.muted,
            fontFamily: "Geist Mono, ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 600,
            formatter: ({value}) => chartTickValue(Number(value)),
          },
        },
      },
      series: [
        {
          type: "line",
          xKey: "label",
          yKey: "income",
          yName: "Ingresos",
          stroke: palette.income,
          strokeWidth: 2,
          marker: marker(palette.income),
          segmentation,
          tooltip: {
            enabled: true,
            renderer: ({datum}) => ({
              title: datum.displayLabel,
              data: datum.activityStatus === "unknown"
                ? [{label: "Estado", value: "Cobertura no acreditada; gasto desconocido"}]
                : [
                  {label: "Ingresos", value: euro(datum.income ?? 0)},
                  ...(datum.partial ? [{label: "Estado", value: "Periodo parcial"}] : []),
                ],
            }),
          },
        },
        {
          type: "line",
          xKey: "label",
          yKey: "netResult",
          yName: "Resultado",
          stroke: palette.accent,
          strokeWidth: 2.4,
          marker: marker(palette.accent),
          segmentation,
          tooltip: {
            enabled: true,
            renderer: ({datum}) => ({
              title: datum.displayLabel,
              data: datum.activityStatus === "unknown"
                ? [{label: "Estado", value: "Cobertura no acreditada; gasto desconocido"}]
                : [
                  {label: "Resultado", value: euro(datum.netResult ?? 0)},
                  ...(datum.partial ? [{label: "Estado", value: "Periodo parcial"}] : []),
                ],
            }),
          },
        },
        {
          type: "line",
          xKey: "label",
          yKey: "netExpense",
          yName: "Gasto neto",
          stroke: palette.expense,
          strokeWidth: 2,
          marker: marker(palette.expense),
          segmentation,
          tooltip: {
            enabled: true,
            renderer: ({datum}) => ({
              title: datum.displayLabel,
              data: datum.activityStatus === "unknown"
                ? [{label: "Estado", value: "Cobertura no acreditada; gasto desconocido"}]
                : [
                  {label: "Gasto neto", value: euro(datum.netExpense ?? 0)},
                  ...(datum.partial ? [{label: "Estado", value: "Periodo parcial"}] : []),
                ],
            }),
          },
        },
      ],
    };
  }, [granularity, onSelectPoint, palette, points, showMarkers]);

  if (!points.length) return null;
  const first = granularity === "month" ? shortMonthLabel(points[0].date) : shortDayLabel(points[0].date);
  const last = granularity === "month"
    ? shortMonthLabel(points[points.length - 1].date)
    : shortDayLabel(points[points.length - 1].date);
  const selectedPoint = selectedDate ? points.find((point) => point.date === selectedDate) : null;
  const hasPartialPoint = points.some((point) => point.isPartial);

  return (
    <figure className="chart-block" aria-labelledby={captionId} data-chart-engine="ag-charts" data-interactive={Boolean(onSelectPoint)}>
      <div className="ag-chart-shell" style={{height}} aria-label={title}>
        <AgCharts options={options} style={{width: "100%", height: "100%"}} />
      </div>
      {selectedPoint ? (
        <div className="chart-inspector selected">
          <strong>{granularity === "month" ? shortMonthLabel(selectedPoint.date) : shortDayLabel(selectedPoint.date)}</strong>
          {selectedPoint.isPartial ? <span className="status-chip">Periodo parcial</span> : null}
          {selectedPoint.activityStatus === "unknown" ? (
            <span>Sin actividad reportable; cobertura no acreditada. Gasto desconocido.</span>
          ) : (
            <>
              <span className="income">Ingresos <b>{euro(selectedPoint.income ?? 0)}</b></span>
              <span className="expense">Gasto <b>{euro(selectedPoint.netExpense ?? 0)}</b></span>
              <span className={(selectedPoint.income ?? 0) - (selectedPoint.netExpense ?? 0) >= 0 ? "positive" : "negative"}>
                Resultado <b>{euro((selectedPoint.income ?? 0) - (selectedPoint.netExpense ?? 0))}</b>
              </span>
            </>
          )}
        </div>
      ) : null}
      <figcaption className="chart-caption" id={captionId}>
        <span className="sr-only">{title}.</span>
        <span>{first}–{last}. {onSelectPoint ? "Pasa el cursor para consultar valores o selecciona un punto para abrir el mes." : "Pasa el cursor para consultar valores exactos."}</span>
        {hasPartialPoint ? <span className="sr-only chart-partial-description">Los segmentos discontinuos y los marcadores huecos indican meses parciales, que no equivalen a meses completos.</span> : null}
      </figcaption>
    </figure>
  );
}
