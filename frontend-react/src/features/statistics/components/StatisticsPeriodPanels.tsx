import {SectionHeader} from "../../../shared/components/ui";
import type {StatisticsPayload} from "../types";
import {CategoryDonut} from "../charts/CategoryDonut";
import {ChartLegendInline, FinanceLineChart} from "../charts/FinanceLineChart";
import {
  CategoryDataDisclosure,
  CategoryQuickLinks,
  MonthlySeriesDisclosure,
  MonthlySeriesNavigator,
  MonthlySeriesSummary,
} from "./StatisticsTables";
import type {StatisticsCategoryColorMap} from "../statisticsFormatting";

export function StatisticsTrendPanel({
  data,
  selectedMonth,
  selectMonth,
  theme,
}: {
  data: StatisticsPayload;
  selectedMonth: string;
  selectMonth: (month: string) => void;
  theme?: string;
}) {
  const monthlyPoints = data.monthly_series.map((item) => ({
    date: item.month,
    income: item.activity_status === "unknown" ? null : item.income,
    netExpense: item.activity_status === "unknown" ? null : item.net_expense,
    netResult: item.activity_status === "unknown" ? null : item.analytical_result,
    activityStatus: item.activity_status,
    isPartial: item.is_partial || !item.is_complete,
  }));
  const hasPartialMonth = monthlyPoints.some((point) => point.isPartial);
  const hasUnknownMonth = monthlyPoints.some((point) => point.activityStatus === "unknown");

  return (
    <section className="stats-trend-panel" aria-label="Evolución mensual y detalle">
      <SectionHeader
        title="Flujo neto mensual"
        detail={hasUnknownMonth ? "Los huecos corresponden a meses sin actividad reportable y con cobertura no acreditada." : undefined}
        action={<ChartLegendInline hasPartialPeriod={hasPartialMonth} hasUnknownPeriod={hasUnknownMonth} />}
      />
      <FinanceLineChart
        points={monthlyPoints}
        title="Flujo neto mensual: ingresos, gasto neto y resultado"
        height={286}
        onSelectPoint={selectMonth}
        theme={theme}
      />
      <div className="stats-month-controls">
        <MonthlySeriesNavigator rows={data.monthly_series} selectedMonth={selectedMonth} onSelectMonth={selectMonth} />
        <MonthlySeriesDisclosure rows={data.monthly_series} selectedMonth={selectedMonth} onSelectMonth={selectMonth} />
        <MonthlySeriesSummary rows={data.monthly_series} selectedMonth={selectedMonth} />
      </div>
    </section>
  );
}

export function StatisticsCategoryPanel({data, categoryColors}: {data: StatisticsPayload; categoryColors: StatisticsCategoryColorMap}) {
  const chartableCategories = data.categories.filter((item) => item.net_expense > 0);
  const showDonut = chartableCategories.length <= 8;
  return (
    <section className="stats-category-panel">
      <SectionHeader title="Distribución por categorías principales" />
      {data.categories.length ? (
        <>
          <div className={`stats-category-layout${showDonut ? "" : " without-chart"}`}>
            {showDonut ? <CategoryDonut
              items={data.categories}
              label="Gasto neto"
              detail="No hay gasto categorizado en este periodo."
              categoryColors={categoryColors}
            /> : null}
            <CategoryQuickLinks items={data.categories} title="Abrir movimientos por familia principal" initialLimit={5} categoryColors={categoryColors} />
          </div>
          <CategoryDataDisclosure items={data.categories} title="Distribución del periodo por familias principales" categoryColors={categoryColors} />
        </>
      ) : (
        <div className="empty-state empty-state--plain">No hay gasto neto por categorías en este periodo. Si esperabas datos, revisa la base elegida o amplía el rango.</div>
      )}
    </section>
  );
}
