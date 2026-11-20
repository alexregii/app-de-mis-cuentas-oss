import {euro} from "../../../format";
import {useState, type CSSProperties} from "react";
import {shortDayLabel, formatPercent} from "../statisticsFormatting";
import type {StatisticsDailyPoint, StatisticsInsights, StatisticsRhythmPoint} from "../types";
import {Button, TextLink} from "../../../ui/controls/Button";

function SelectedDayDetail({point, movementsUrl}: {point: StatisticsDailyPoint; movementsUrl?: string}) {
  const label = shortDayLabel(point.date);
  return (
    <section className="stats-selected-day-detail" aria-label={`Detalle diario · ${label}`} aria-live="polite">
      <h5>Detalle diario · {label}</h5>
      <dl className="stats-selected-day-values">
        <div><dt>Ingresos</dt><dd className="positive">{euro(point.income)}</dd></div>
        <div><dt>Gasto neto</dt><dd>{euro(point.net_expense)}</dd></div>
        <div><dt>Reembolsos</dt><dd>{euro(point.refunds_applied)}</dd></div>
        <div><dt>Resultado</dt><dd className={point.analytical_result >= 0 ? "positive" : "negative"}>{euro(point.analytical_result)}</dd></div>
      </dl>
      {movementsUrl ? <TextLink href={movementsUrl}>Ver movimientos de este día</TextLink> : null}
    </section>
  );
}

function SpendingCalendar({points, dailySeries, selectedDate, onSelectDate}: {
  points: StatisticsRhythmPoint[];
  dailySeries: StatisticsDailyPoint[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const dailyAmounts = points.map((point, index) => Math.max(0, point.net_expense - (points[index - 1]?.net_expense ?? 0)));
  const highest = Math.max(...dailyAmounts, 0);
  const dailyDates = new Set(dailySeries.map((point) => point.date));
  return (
    <div className="stats-spending-calendar" role="group" aria-label="Calendario de gasto neto diario">
      <div className="stats-calendar-heading">
        <div><h4 id="statistics-daily-title">Actividad diaria</h4><span>El tono indica gasto neto. Selecciona un día para ver sus importes.</span></div>
        <div className="stats-calendar-scale" aria-label="Escala de menor a mayor gasto neto">
          <span>Menos</span>
          <i aria-hidden="true" className="stats-calendar-scale__sample stats-calendar-scale__sample--1" />
          <i aria-hidden="true" className="stats-calendar-scale__sample stats-calendar-scale__sample--2" />
          <i aria-hidden="true" className="stats-calendar-scale__sample stats-calendar-scale__sample--3" />
          <i aria-hidden="true" className="stats-calendar-scale__sample stats-calendar-scale__sample--4" />
          <span>Más</span>
        </div>
      </div>
      <div className="stats-calendar-grid">
        {points.map((point, index) => {
          const amount = dailyAmounts[index];
          const intensity = amount && highest ? Math.max(0.16, amount / highest) : 0;
          const amountLabel = amount ? euro(amount) : "sin gasto neto";
          const canSelect = dailyDates.has(point.date);
          const selected = selectedDate === point.date;
          const label = `${shortDayLabel(point.date)}: ${amountLabel} de gasto neto. ${canSelect ? "Seleccionar para ver detalle." : "Sin detalle diario disponible."}`;
          const content = <><b className="stats-calendar-cell__day">{new Date(`${point.date}T00:00:00`).getDate()}</b><small>{amount ? euro(amount) : "—"}</small></>;
          const className = `stats-calendar-cell${canSelect ? " stats-calendar-cell--selectable" : ""}${selected ? " stats-calendar-cell--selected" : ""}`;
          return canSelect ? <button className={className} key={point.date} type="button" aria-label={label} aria-pressed={selected} onClick={() => onSelectDate(selected ? null : point.date)} style={{"--calendar-intensity": intensity} as CSSProperties}>{content}</button>
            : <span className={className} key={point.date} style={{"--calendar-intensity": intensity} as CSSProperties}>{content}</span>;
        })}
      </div>
    </div>
  );
}

function ExpenseSpikes({insights, selectedMonth, onPrepareBudget}: {insights: StatisticsInsights["spikes"]; selectedMonth: string; onPrepareBudget: (categoryId: number, month: string) => void}) {
  if (insights.available_sample_months < insights.minimum_sample_size) {
    return <p className="empty-state empty-state--plain">Muestra insuficiente para evaluar picos de gasto ({insights.available_sample_months} de {insights.minimum_sample_size} meses necesarios).</p>;
  }
  if (!insights.items.length) return <p className="empty-state empty-state--plain">No hay categorías con un gasto neto por encima de su mediana comparable.</p>;
  return (
    <ul className="stats-spike-list">
      {insights.items.map((item) => (
        <li key={`${item.family_id ?? "uncategorized"}-${item.family_name}`}>
          <div className="stats-spike-list__main">
            <div className="stats-spike-list__heading">
              <i className="stats-spike-list__marker" aria-hidden="true" />
              <strong>{item.family_name}</strong>
              <span className="stats-spike-list__delta">+{formatPercent(item.increase_percentage)}</span>
            </div>
            <p><strong>{euro(item.current_net_expense)}</strong> acumulados <span aria-hidden="true">·</span> mediana comparable {euro(item.median_net_expense)}</p>
          </div>
          <div className="stats-spike-list__actions">
            <a href={item.movements_url} aria-label={`Ver movimientos de ${item.family_name}`}>Ver movimientos <span aria-hidden="true">→</span></a>
            {item.family_id !== null ? <Button
              variant="secondary"
              aria-label={`Preparar presupuesto de ${item.family_name}`}
              onClick={() => onPrepareBudget(item.family_id!, selectedMonth)}
            >Preparar presupuesto</Button> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StatisticsInsightsPanel({insights, dailySeries, selectedMonth, onPrepareBudget}: {insights: StatisticsInsights; dailySeries: StatisticsDailyPoint[]; selectedMonth: string; onPrepareBudget: (categoryId: number, month: string) => void}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedDay = dailySeries.find((point) => point.date === selectedDate);
  const selectedRhythmPoint = insights.rhythm.points.find((point) => point.date === selectedDate);
  return (
    <section className="stats-detail-section" aria-labelledby="statistics-insights-title">
      <div className="stats-detail-heading"><h3 id="statistics-insights-title">Actividad y picos del mes</h3></div>
      <section className="stats-daily-activity-section" aria-labelledby="statistics-daily-title">
        {insights.rhythm.points.length ? <>
          <SpendingCalendar points={insights.rhythm.points} dailySeries={dailySeries} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          {selectedDay ? <SelectedDayDetail point={selectedDay} movementsUrl={selectedRhythmPoint?.movements_url} /> : null}
        </> : <p className="empty-state empty-state--plain">No hay actividad diaria disponible para este mes.</p>}
      </section>
      <section aria-labelledby="statistics-spikes-title">
        <h4 id="statistics-spikes-title">Picos de gasto por categoría</h4>
        <ExpenseSpikes insights={insights.spikes} selectedMonth={selectedMonth} onPrepareBudget={onPrepareBudget} />
      </section>
    </section>
  );
}
