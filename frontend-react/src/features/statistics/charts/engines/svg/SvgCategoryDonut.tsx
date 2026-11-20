import {compactEuro, euro} from "../../../../../format";
import {categoryChartColors, formatPercent} from "../../../statisticsFormatting";
import type {CategoryChartProps} from "../../chartTypes";

export function SvgCategoryDonut({items, label, detail, categoryColors}: CategoryChartProps) {
  const segments = items.filter((item) => item.net_expense > 0);
  const total = segments.reduce((sum, item) => sum + item.net_expense, 0);
  const topCategory = segments[0] || null;
  const colors = categoryChartColors(segments, categoryColors);
  const pointAt = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return {x: 50 + 39 * Math.cos(radians), y: 50 + 39 * Math.sin(radians)};
  };
  let cursor = 0;

  return (
    <div className="category-hero" data-chart-engine="svg" data-interactive="true">
      <figure className="category-donut">
        {segments.length ? (
          <svg className="donut-svg" viewBox="0 0 100 100" aria-label="Distribución interactiva del gasto neto por familia">
            <circle className="donut-track" cx="50" cy="50" r="39" />
            {segments.map((segment, index) => {
              const share = total > 0 ? (segment.net_expense / total) * 100 : 0;
              const offset = cursor;
              cursor += share;
              const visibleShare = Math.max(share - Math.min(0.8, share / 3), 0);
              const start = pointAt(-90 + (offset / 100) * 360);
              const end = pointAt(-90 + ((offset + visibleShare) / 100) * 360);
              const path = `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 39 39 0 ${visibleShare >= 50 ? 1 : 0} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
              return (
                <a
                  className="donut-segment-link"
                  href={segment.movements_url}
                  key={`${segment.family_id ?? "uncategorized"}-${segment.family_name}`}
                  aria-label={`${segment.family_name}: ${euro(segment.net_expense)}, ${formatPercent(segment.percentage)}. Ver movimientos`}
                >
                  <title>{segment.family_name}: {euro(segment.net_expense)} · {formatPercent(segment.percentage)}</title>
                  <path
                    className="donut-segment-hit-area"
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="30"
                    pointerEvents="stroke"
                    aria-hidden="true"
                  />
                  <path
                    className="donut-segment"
                    d={path}
                    stroke={colors[index]}
                  />
                </a>
              );
            })}
          </svg>
        ) : <div className="donut-empty-ring" aria-hidden="true" />}
        <div className="donut-copy" aria-hidden="true">
          <span>{label}</span>
          <strong>{compactEuro(total)}</strong>
        </div>
        <figcaption className="sr-only">Cada sector abre los movimientos exactos de su familia. La lista adyacente ofrece la misma navegación por teclado.</figcaption>
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
