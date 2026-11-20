import {useEffect, useId, useMemo, useRef, useState} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {euro} from "../../../../../format";
import {chartTickValue, shortDayLabel, shortMonthLabel} from "../../../statisticsFormatting";
import type {FinanceChartProps} from "../../chartTypes";
import {chartAxisDateValue, chartTimestamp} from "./chartTimestamp";
import {splitPartialSeries} from "./partialSeries";

const cssColor = (styles: CSSStyleDeclaration, name: string, fallback: string) =>
  styles.getPropertyValue(name).trim() || fallback;

export function UPlotFinanceChart({
  points,
  title,
  height = 286,
  granularity = "month",
  selectedDate = "",
  onSelectPoint,
  theme,
}: FinanceChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const pointsRef = useRef(points);
  const onSelectPointRef = useRef(onSelectPoint);
  const keyboardIndexRef = useRef(-1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const captionId = useId();
  const hasPoints = points.length > 0;
  const showMarkers = points.length <= 12;
  const seriesData = useMemo(() => {
    const partialFlags = points.map((point) => Boolean(point.isPartial));
    const values = [
      points.map((point) => point.income),
      points.map((point) => point.netExpense),
      points.map((point) => point.netResult ?? (point.income !== null && point.netExpense !== null ? point.income - point.netExpense : null)),
    ];
    return values.map((series) => splitPartialSeries(series, partialFlags));
  }, [points]);
  const chartData = useMemo<uPlot.AlignedData>(() => [
    points.map((point) => chartTimestamp(point.date)),
    ...seriesData.flatMap((series) => [series.complete, series.dashed, series.partialPoints]),
  ], [points, seriesData]);
  const selectedIndex = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
  const activeIndex = hoveredIndex ?? (selectedIndex >= 0 ? selectedIndex : null);
  const activePoint = activeIndex === null ? null : points[activeIndex];

  useEffect(() => {
    pointsRef.current = points;
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint, points]);

  useEffect(() => {
    if (!hasPoints) return;
    const host = hostRef.current;
    if (!host) return;
    const styles = getComputedStyle(host);
    const muted = cssColor(styles, "--ink-2", cssColor(styles, "--color-muted", "#667085"));
    const rule = cssColor(styles, "--color-rule", cssColor(styles, "--rule", "#d0d7e2"));
    const income = cssColor(styles, "--stats-series-income", "#16835f");
    const expense = cssColor(styles, "--stats-series-expense", "#c6533d");
    const accent = cssColor(styles, "--stats-series-result", "#2563eb");
    const surface = cssColor(styles, "--surface-soft", "#ffffff");
    const axisLabel = (timestamp: number) => {
      const date = chartAxisDateValue(timestamp, pointsRef.current.map((point) => point.date));
      return granularity === "month" ? shortMonthLabel(date) : shortDayLabel(date);
    };
    const width = Math.max(Math.floor(host.getBoundingClientRect().width), 1);
    const options: uPlot.Options = {
      width,
      height,
      legend: {show: false},
      cursor: {
        show: true,
        drag: {x: false, y: false, setScale: false},
        hover: {prox: 32},
        points: {size: 10, width: 2},
      },
      select: {show: Boolean(selectedDate), left: 0, top: 0, width: 0, height: 0, over: true},
      scales: {x: {time: true}, y: {auto: true}},
      tzDate: (timestamp) => uPlot.tzDate(new Date(timestamp * 1000), "UTC"),
      axes: [
        {
          stroke: muted,
          grid: {show: false},
          ticks: {stroke: rule, width: 1, size: 5},
          font: "600 11px 'Geist Mono', ui-monospace, monospace",
          size: 36,
          values: (_plot, splits) => splits.map(axisLabel),
        },
        {
          stroke: muted,
          grid: {stroke: rule, width: 1},
          ticks: {show: false},
          font: "600 11px 'Geist Mono', ui-monospace, monospace",
          size: 54,
          values: (_plot, splits) => splits.map(chartTickValue),
        },
      ],
      series: [
        {},
        ...[
          {label: "Ingresos", stroke: income},
          {label: "Gasto neto", stroke: expense},
          {label: "Resultado", stroke: accent},
        ].flatMap(({label, stroke}) => [
          {label, stroke, width: 2.4, points: {show: showMarkers, size: 7}},
          {label: `${label} periodo parcial`, stroke, width: 2.4, dash: [5, 4], points: {show: false}},
          {label: `${label} marcador parcial`, stroke, width: 0, paths: () => null, points: {show: showMarkers, size: 7, width: 2, stroke, fill: surface}},
        ]),
      ],
      hooks: {
        setCursor: [(plot) => setHoveredIndex(plot.cursor.idx ?? null)],
      },
    };
    const plot = new uPlot(options, chartData, host);
    plotRef.current = plot;
    keyboardIndexRef.current = -1;
    if (onSelectPoint) {
      plot.over.setAttribute("role", "img");
      plot.over.setAttribute("aria-label", `${title}. Usa las flechas para elegir un mes y Enter para abrirlo.`);
      plot.over.setAttribute("aria-describedby", captionId);
      plot.over.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Enter");
      plot.over.tabIndex = 0;
      host.querySelectorAll("canvas").forEach((canvas) => canvas.setAttribute("aria-hidden", "true"));
    } else {
      host.setAttribute("aria-hidden", "true");
    }

    const applySelection = () => {
      const index = selectedDate ? pointsRef.current.findIndex((point) => point.date === selectedDate) : -1;
      if (index < 0) return;
      const left = plot.valToPos(chartTimestamp(pointsRef.current[index].date), "x");
      plot.setSelect({left: Math.max(left - 1, 0), top: 0, width: 2, height: plot.bbox.height}, false);
    };
    applySelection();

    const selectCursorPoint = () => {
      const index = plot.cursor.idx ?? keyboardIndexRef.current;
      const point = index === null || index === undefined ? null : pointsRef.current[index];
      if (point) onSelectPointRef.current?.(point.date);
    };
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const currentIndex = plot.cursor.idx ?? keyboardIndexRef.current;
        const nextIndex = currentIndex < 0
          ? (direction > 0 ? 0 : pointsRef.current.length - 1)
          : (currentIndex + direction + pointsRef.current.length) % pointsRef.current.length;
        keyboardIndexRef.current = nextIndex;
        const point = pointsRef.current[nextIndex];
        plot.setCursor({left: plot.valToPos(chartTimestamp(point.date), "x"), top: plot.bbox.height / 2});
      } else if (event.key === "Enter" || event.key === " ") {
        if ((plot.cursor.idx ?? keyboardIndexRef.current) < 0) return;
        event.preventDefault();
        selectCursorPoint();
      }
    };
    if (onSelectPoint) plot.over.addEventListener("click", selectCursorPoint);
    if (onSelectPoint) plot.over.addEventListener("keydown", handleKeyboardNavigation);

    const resize = () => {
      const nextWidth = Math.floor(host.getBoundingClientRect().width);
      if (nextWidth > 0 && nextWidth !== plot.width) {
        plot.setSize({width: nextWidth, height});
        applySelection();
      }
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (observer) observer.observe(host);
    else window.addEventListener("resize", resize);

    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", resize);
      if (onSelectPoint) plot.over.removeEventListener("click", selectCursorPoint);
      if (onSelectPoint) plot.over.removeEventListener("keydown", handleKeyboardNavigation);
      plot.destroy();
      if (plotRef.current === plot) plotRef.current = null;
    };
  }, [granularity, hasPoints, height, onSelectPoint, selectedDate, showMarkers, theme]);

  useEffect(() => {
    plotRef.current?.setData(chartData);
  }, [chartData]);

  if (!hasPoints) return null;
  const first = granularity === "month" ? shortMonthLabel(points[0].date) : shortDayLabel(points[0].date);
  const last = granularity === "month" ? shortMonthLabel(points[points.length - 1].date) : shortDayLabel(points[points.length - 1].date);
  const hasPartialPoint = points.some((point) => point.isPartial);

  return (
    <figure className="chart-block" aria-labelledby={captionId} data-chart-engine="uplot" data-interactive={Boolean(onSelectPoint)}>
      <div className="uplot-chart-shell" ref={hostRef} />
      {activePoint ? (
        <div className="chart-inspector">
          <strong>{granularity === "month" ? shortMonthLabel(activePoint.date) : shortDayLabel(activePoint.date)}</strong>
          {activePoint.isPartial ? <span className="status-chip">Periodo parcial</span> : null}
          {activePoint.activityStatus === "unknown" ? (
            <span>Sin actividad reportable; cobertura no acreditada. Gasto desconocido.</span>
          ) : (
            <>
              <span className="income">Ingresos <b>{euro(activePoint.income ?? 0)}</b></span>
              <span className="expense">Gasto <b>{euro(activePoint.netExpense ?? 0)}</b></span>
              <span className={(activePoint.income ?? 0) - (activePoint.netExpense ?? 0) >= 0 ? "positive" : "negative"}>
                Resultado <b>{euro((activePoint.income ?? 0) - (activePoint.netExpense ?? 0))}</b>
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
