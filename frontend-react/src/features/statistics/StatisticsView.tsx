import {useCallback, useLayoutEffect, useRef, useState} from "react";
import {ViewLoadError} from "../../shared/components/ViewLoadError";
import {StatisticsDetailPanels} from "./components/StatisticsDetailPanels";
import {StatisticsFilters, StatisticsScopeToolbar} from "./components/StatisticsFilters";
import {StatisticsCategoryPanel, StatisticsTrendPanel} from "./components/StatisticsPeriodPanels";
import {StatisticsSummaryPanel} from "./components/StatisticsSummary";
import {
  StatisticsAdvancedAnalysis,
} from "./components/StatisticsAnalysis";
import {StatisticsLoadingFallback} from "./StatisticsLoadingFallback";
import {statisticsChartEngine} from "./charts/chartEngineSelection";
import {useStatisticsData} from "./hooks/useStatisticsData";
import {Button} from "../../ui/controls/Button";
import {categoryChartColorMap, type StatisticsCategoryColorMap} from "./statisticsFormatting";
import {MonthlyClosePanel} from "./components/MonthlyClosePanel";
import type {AppNavigation} from "../../app/contracts";
import {navigateRoute} from "../../app/navigation";
import type {AppTheme} from "../../app/preferences/appPreferences";

const fallbackNavigate: AppNavigation["navigate"] = (tab, transition = {}) => navigateRoute({tab, ...transition});

export function StatisticsView({isActive = true, privateAmounts = false, theme = "mineral", navigate}: {isActive?: boolean; privateAmounts?: boolean; theme?: AppTheme; navigate?: AppNavigation["navigate"]}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const state = useStatisticsData(isActive);
  const pendingFilterAnchor = useRef<{element: HTMLElement; top: number} | null>(null);
  useLayoutEffect(() => {
    const anchor = pendingFilterAnchor.current;
    if (!isActive) {
      pendingFilterAnchor.current = null;
      return;
    }
    if (state.reportPending || state.monthPending || (state.selectedMonth && !state.monthData && !state.monthError) || !anchor) return;
    pendingFilterAnchor.current = null;
    if (!anchor.element.isConnected || document.activeElement !== anchor.element) return;
    const drift = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(drift) > 0.5 && document.scrollingElement) document.scrollingElement.scrollTop += drift;
  }, [isActive, state.data, state.monthData, state.monthError, state.monthPending, state.reportError, state.reportPending, state.selectedMonth]);
  const {
    data,
    monthData,
    monthError,
    monthPending,
    rangeError,
    reportError,
    reportPending,
    selectedMonth,
  } = state;
  const navigateWithinApp = navigate ?? fallbackNavigate;
  const [categoryColors, setCategoryColors] = useState<StatisticsCategoryColorMap>(() => new Map());
  const selectedMonthRef = useRef(selectedMonth);
  selectedMonthRef.current = selectedMonth;
  useLayoutEffect(() => {
    setCategoryColors(categoryChartColorMap([
      ...(data?.categories || []),
      ...(data?.comparison.category_variations || []),
      ...(data?.analysis?.category_matrix.rows || []),
      ...(monthData?.categories || []),
    ]));
  }, [data, monthData, theme]);
  const selectMonth = useCallback((month: string) => {
    const activeElement = document.activeElement;
    if (month !== selectedMonthRef.current && activeElement instanceof HTMLElement && activeElement !== document.body) {
      pendingFilterAnchor.current = {element: activeElement, top: activeElement.getBoundingClientRect().top};
    }
    state.selectMonth(month);
  }, [state.selectMonth]);

  if (!data && reportPending) return <StatisticsLoadingFallback />;
  if (!data && reportError) {
    return (
      <div data-chart-engine={statisticsChartEngine}>
        <ViewLoadError title="Estadísticas" message={reportError} onRetry={state.retryReport} />
      </div>
    );
  }

  const hasActivity = data?.activity_status === "recorded";
  const unknownMonthCount = data?.monthly_series.filter((item) => item.activity_status === "unknown").length ?? 0;
  const closeFilters = () => {
    setFiltersOpen(false);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".stats-edit-scope")?.focus({preventScroll: true}));
  };
  const setBasis = (basis: Parameters<typeof state.setBasis>[0]) => {
    if (basis !== state.basis && document.activeElement instanceof HTMLElement) {
      pendingFilterAnchor.current = {element: document.activeElement, top: document.activeElement.getBoundingClientRect().top};
    }
    state.setBasis(basis);
  };
  const selectPreset = (period: Parameters<typeof state.selectPreset>[0]) => {
    if (period !== state.period && document.activeElement instanceof HTMLElement) {
      pendingFilterAnchor.current = {element: document.activeElement, top: document.activeElement.getBoundingClientRect().top};
    }
    state.selectPreset(period);
  };
  return (
    <div className="view-stack stats-view" aria-busy={reportPending} data-chart-engine={statisticsChartEngine}>
      <StatisticsScopeToolbar
        basis={state.basis}
        activeFilterCount={Number(state.period !== "12") + Number(state.basis !== "analytics")}
        editOpen={filtersOpen}
        reportPending={reportPending}
        scope={data?.scope || null}
        onEdit={() => setFiltersOpen((current) => !current)}
      />

      <StatisticsFilters
        basis={state.basis}
        customApplyPending={state.customApplyPending}
        customEditorOpen={state.customEditorOpen}
        draftRange={state.draftRange}
        period={state.period}
        rangeError={rangeError}
        reportPending={reportPending}
        open={filtersOpen}
        onClose={closeFilters}
        applyCustomRange={state.applyCustomRange}
        openCustomEditor={state.openCustomEditor}
        resetFilters={state.resetFilters}
        selectPreset={selectPreset}
        setBasis={setBasis}
        setDraftRange={state.setDraftRange}
      />

      {reportError && data ? (
        <div className="stats-inline-error" role="alert">
          <div><strong>No se pudo actualizar el informe.</strong><span>{reportError} Se mantienen los datos anteriores.</span></div>
          <Button variant="secondary" onClick={state.retryReport}>Reintentar</Button>
        </div>
      ) : null}

      {data && hasActivity && unknownMonthCount > 0 ? (
        <div className="stats-connectivity-status" role="status" aria-label="Cobertura estadística">
          <strong>Hay meses sin cobertura acreditada.</strong>
          <span>{unknownMonthCount} {unknownMonthCount === 1 ? "mes no contiene" : "meses no contienen"} actividad reportable; su gasto es desconocido. Los totales suman los movimientos registrados, no prueban cobertura completa.</span>
        </div>
      ) : null}
      {data ? <StatisticsSummaryPanel summary={data.summary} comparison={data.comparison} activityStatus={data.activity_status} previousActivityStatus={data.comparison.previous_activity_status} privateAmounts={privateAmounts} /> : null}
      {data && hasActivity ? <StatisticsCategoryPanel data={data} categoryColors={categoryColors} /> : null}

      {!data && rangeError ? (
        <div className="empty-state empty-state--plain">Corrige el rango y pulsa «Aplicar rango» para generar el informe.</div>
      ) : null}

      {data && !hasActivity ? (
        <div className="empty-state empty-state--plain">No hay movimientos reportables en este periodo y la cobertura no está acreditada. El gasto es desconocido, no cero demostrado. Amplía el rango, cambia la base o registra movimientos para generar la evolución.</div>
      ) : null}

      {data && hasActivity ? (
        <>
          <StatisticsTrendPanel data={data} selectedMonth={selectedMonth} selectMonth={selectMonth} theme={theme} />
          <StatisticsDetailPanels
            monthData={monthData}
            monthError={monthError}
            monthPending={monthPending}
            selectedMonth={selectedMonth}
            activityStatus={data.monthly_series.find((item) => item.month === selectedMonth)?.activity_status ?? "unknown"}
            categoryColors={categoryColors}
            retryMonth={state.retryMonth}
            onPrepareBudget={(categoryId, month) => navigateWithinApp("planning", {search: new URLSearchParams([
              ["plan_month", month],
              ["budget_category", String(categoryId)],
            ])})}
          />
          <MonthlyClosePanel month={selectedMonth} basis={state.basis} privateAmounts={privateAmounts} />
          {data.analysis ? <StatisticsAdvancedAnalysis analysis={data.analysis} comparison={data.comparison} categoryColors={categoryColors} /> : null}
        </>
      ) : null}
    </div>
  );
}
