import {euro, formatMonth} from "../../../format";
import {SectionHeader} from "../../../shared/components/ui";
import type {MonthStatisticsPayload, StatisticsActivityStatus} from "../types";
import {CategoryDonut} from "../charts/CategoryDonut";
import {CategoryDataDisclosure, CategoryQuickLinks} from "./StatisticsTables";
import {StatisticsInsightsPanel} from "./StatisticsInsights";
import {Button, ButtonLink} from "../../../ui/controls/Button";
import type {StatisticsCategoryColorMap} from "../statisticsFormatting";

const dayFormatter = new Intl.DateTimeFormat("es-ES", {day: "numeric", month: "short"});
const formatDay = (value: string) => dayFormatter.format(new Date(`${value}T00:00:00`));

function MonthDetailLoading() {
  return (
    <div className="stats-detail-skeleton" aria-busy="true" aria-label="Cargando detalle mensual">
      <div className="skeleton-copy"><span className="skeleton-line short" /><span className="skeleton-line medium" /></div>
      <div className="uplot-chart-shell skeleton-panel" />
    </div>
  );
}

export function StatisticsDetailPanels({
  monthData,
  monthError,
  monthPending,
  selectedMonth,
  activityStatus,
  retryMonth,
  categoryColors,
  onPrepareBudget,
}: {
  monthData: MonthStatisticsPayload | null;
  monthError: string;
  monthPending: boolean;
  selectedMonth: string;
  activityStatus: StatisticsActivityStatus;
  retryMonth: () => void;
  categoryColors: StatisticsCategoryColorMap;
  onPrepareBudget: (categoryId: number, month: string) => void;
}) {
  const activeDailyPoints = monthData?.daily_series.filter((point) =>
    point.income !== 0
    || point.net_expense !== 0
    || point.refunds_applied !== 0
    || point.analytical_result !== 0
  ) ?? [];
  const largestExpenseDay = activeDailyPoints.reduce((largest, point) =>
    point.net_expense > (largest?.net_expense ?? 0) ? point : largest, activeDailyPoints[0]);
  const largestIncomeDay = activeDailyPoints.reduce((largest, point) =>
    point.income > (largest?.income ?? 0) ? point : largest, activeDailyPoints[0]);
  const chartableCategories = monthData?.categories.filter((item) => item.net_expense > 0) ?? [];
  const showDonut = chartableCategories.length <= 8;
  const effectiveActivityStatus = monthData
    ? monthData.activity_status === "recorded" ? "recorded" : "unknown"
    : activityStatus;

  if (!selectedMonth) return null;

  return (
    <section className="stats-month-detail-panel" id="statistics-month-detail" tabIndex={-1}>
      <SectionHeader
        title={`Detalle mensual · ${formatMonth(selectedMonth)}`}
        detail={effectiveActivityStatus === "unknown" ? "La cobertura del mes no está acreditada." : monthData?.scope.is_partial ? "Mes parcial, limitado al periodo activo." : undefined}
      />
      {effectiveActivityStatus === "unknown" ? <div className="empty-state empty-state--plain">No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.</div> : null}
      {effectiveActivityStatus !== "unknown" && monthPending ? <MonthDetailLoading /> : null}
      {effectiveActivityStatus !== "unknown" && !monthPending && monthError ? (
        <div className="stats-inline-error" role="alert">
          <div><strong>No se pudo cargar este mes.</strong><span>{monthError}</span></div>
          <Button variant="secondary" onClick={retryMonth}>Reintentar detalle</Button>
        </div>
      ) : null}
      {effectiveActivityStatus !== "unknown" && !monthPending && !monthError && monthData ? (
        <div className="stats-month-detail-content">
          {activeDailyPoints.length ? (
            <section className="stats-detail-section" aria-labelledby="statistics-daily-title">
              <div className="stats-detail-heading">
                <div><h3 id="statistics-daily-title">Actividad del intervalo</h3><p>Lectura diaria limitada a {monthData.scope.label}.</p></div>
              </div>
              <dl className="stats-daily-insights">
                <div><dt>Días con actividad</dt><dd>{activeDailyPoints.length}</dd></div>
                {largestExpenseDay?.net_expense > 0 ? <div><dt>Mayor gasto diario</dt><dd>{euro(largestExpenseDay.net_expense)} <span>{formatDay(largestExpenseDay.date)}</span></dd></div> : null}
                {largestIncomeDay?.income > 0 ? <div><dt>Mayor ingreso diario</dt><dd>{euro(largestIncomeDay.income)} <span>{formatDay(largestIncomeDay.date)}</span></dd></div> : null}
              </dl>
            </section>
          ) : <div className="empty-state empty-state--plain">No hay actividad financiera en la parte seleccionada de este mes.</div>}

          {monthData.categories.length ? (
            <section className="stats-detail-section" aria-labelledby="statistics-month-categories-title">
              <div className="stats-detail-heading"><h3 id="statistics-month-categories-title">Categorías del mes</h3></div>
              <div className={`stats-category-layout compact${showDonut ? "" : " without-chart"}`}>
                {showDonut ? <CategoryDonut items={monthData.categories} label="Gasto neto del mes" detail="Sin gasto categorizado." categoryColors={categoryColors} /> : null}
                <CategoryQuickLinks items={monthData.categories} title="Abrir movimientos del mes por familia principal" initialLimit={4} categoryColors={categoryColors} />
              </div>
              <CategoryDataDisclosure items={monthData.categories} title="Distribución del mes por familias principales" categoryColors={categoryColors} />
            </section>
          ) : null}

          {monthData.insights ? <StatisticsInsightsPanel key={selectedMonth} insights={monthData.insights} dailySeries={monthData.daily_series} selectedMonth={selectedMonth} onPrepareBudget={onPrepareBudget} /> : null}

          <div className="stats-detail-actions">
            <ButtonLink variant="primary" href={monthData.movements_url}>Ver movimientos de este intervalo</ButtonLink>
          </div>
        </div>
      ) : null}
    </section>
  );
}
