import {SectionHeader} from "../../shared/components/ui";
import {PageHeader} from "../../ui/layout/PageHeader";
import {statisticsChartEngine} from "./charts/chartEngineSelection";

function LoadingChart() {
  return (
    <figure className="chart-block" aria-hidden="true">
      <div className="uplot-chart-shell skeleton-panel" style={{height: 286}}>
        <div className="skeleton-copy"><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line medium" /></div>
      </div>
      <figcaption className="chart-caption"><span>&nbsp;</span><span>&nbsp;</span></figcaption>
    </figure>
  );
}

function LoadingDonut() {
  return (
    <div className="stats-category-layout" aria-hidden="true">
      <div className="category-hero">
        <div className="category-donut"><div className="donut-empty-ring" /></div>
        <div className="category-summary skeleton-copy"><span className="skeleton-line short" /><span className="skeleton-line medium" /><span className="skeleton-line" /></div>
      </div>
    </div>
  );
}

export function StatisticsLoadingFallback({label = "Cargando estadísticas…"}: {label?: string}) {
  return (
    <div className="view-stack stats-view" aria-busy="true" aria-label={label} data-chart-engine={statisticsChartEngine}>
      <PageHeader title="Estadísticas" className="stats-page-header" actions={<div className="stats-scope-toolbar" aria-hidden="true"><div className="skeleton-copy"><span className="skeleton-line medium" /></div><span className="stats-edit-scope stats-scope-control-skeleton skeleton-line" /></div>} />
      <section className="stats-summary-panel"><SectionHeader title="Resultado del periodo" detail={label} /><div className="stats-summary-list skeleton-panel" /></section>
      <section className="stats-category-panel"><SectionHeader title="Distribución por categorías principales" detail={label} /><LoadingDonut /></section>
      <section className="stats-trend-panel">
        <SectionHeader title="Flujo neto mensual" detail={label} />
        <LoadingChart />
        <div className="stats-month-controls" aria-hidden="true">
          <div className="stats-month-control-skeleton skeleton-copy"><span className="skeleton-line short" /><span className="skeleton-line medium" /></div>
          <div className="stats-month-table-skeleton skeleton-line medium" />
        </div>
      </section>
    </div>
  );
}
