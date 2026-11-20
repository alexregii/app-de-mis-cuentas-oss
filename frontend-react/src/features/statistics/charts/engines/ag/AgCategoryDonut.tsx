import "./offscreen-canvas-polyfill";
import {useMemo} from "react";
import type {AgChartOptions} from "ag-charts-community";
import {AgCharts} from "ag-charts-react";
import {AG_CHARTS_LOCALE_ES_ES} from "ag-charts-locale";
import {compactEuro, euro} from "../../../../../format";
import {categoryChartColors, formatPercent} from "../../../statisticsFormatting";
import type {CategoryChartProps} from "../../chartTypes";
import {useAgChartPalette} from "./agChartSetup";

interface CategoryDatum {
  family: string;
  amount: number;
  percentage: number;
  movementsUrl: string;
}

export function AgCategoryDonut({items, label, detail, categoryColors}: CategoryChartProps) {
  const segments = useMemo(() => items.filter((item) => item.net_expense > 0), [items]);
  const total = segments.reduce((sum, item) => sum + item.net_expense, 0);
  const topCategory = segments[0] || null;
  const colors = useMemo(() => categoryChartColors(segments, categoryColors), [categoryColors, segments]);
  const palette = useAgChartPalette();
  const options = useMemo<AgChartOptions<CategoryDatum>>(() => {
    return {
      data: segments.map((segment) => ({
        family: segment.family_name,
        amount: segment.net_expense,
        percentage: segment.percentage,
        movementsUrl: segment.movements_url,
      })),
      minHeight: 0,
      minWidth: 0,
      padding: 0,
      background: {visible: false},
      locale: {
        localeText: {
          ...AG_CHARTS_LOCALE_ES_ES,
          ariaAnnounceChart: "gráfico, ${seriesCount}[number] serie",
        },
      },
      animation: {enabled: false},
      highlight: {enabled: true},
      keyboard: {enabled: true, tabIndex: 0},
      legend: {enabled: false},
      tooltip: {enabled: true, range: "exact", delay: 0},
      touch: {dragAction: "none"},
      listeners: {
        seriesNodeClick: ({datum}) => window.location.assign(datum.movementsUrl),
      },
      series: [{
        type: "donut",
        angleKey: "amount",
        angleName: "Gasto neto",
        calloutLabelKey: "family",
        calloutLabel: {enabled: false},
        sectorLabel: {enabled: false},
        fills: colors,
        strokes: segments.map(() => palette.surface),
        strokeWidth: 2,
        sectorSpacing: 1,
        innerRadiusRatio: 0.72,
        tooltip: {
          enabled: true,
          renderer: ({datum}) => ({
            title: datum.family,
            data: [
              {label: "Gasto neto", value: euro(datum.amount)},
              {label: "Peso", value: formatPercent(datum.percentage)},
              {label: "Acción", value: "Abrir movimientos"},
            ],
          }),
        },
      }],
    };
  }, [colors, palette, segments]);

  return (
    <div className="category-hero" data-chart-engine="ag-charts" data-interactive="true">
      <figure className="category-donut">
        {segments.length ? (
          <div className="ag-donut-shell" aria-label="Distribución interactiva del gasto neto por familia">
            <AgCharts options={options} style={{width: "100%", height: "100%"}} />
          </div>
        ) : <div className="donut-empty-ring" aria-hidden="true" />}
        <div className="donut-copy" aria-hidden="true">
          <span>{label}</span>
          <strong>{compactEuro(total)}</strong>
        </div>
        <figcaption className="sr-only">Selecciona un sector para abrir los movimientos exactos de esa familia. La lista adyacente ofrece la misma navegación.</figcaption>
      </figure>
      <div className="category-summary">
        <p>{topCategory
          ? `${topCategory.family_name} concentra ${formatPercent(topCategory.percentage)} del gasto neto categorizado.`
          : detail}</p>
        <span className="category-count">{segments.length} {segments.length === 1 ? "familia principal" : "familias principales"}</span>
      </div>
    </div>
  );
}
