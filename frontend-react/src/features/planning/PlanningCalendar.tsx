import {useLayoutEffect, useState} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {currency, todayInputValue} from "../../format";
import type {PlanningCalendarPayload} from "../../shared/model/planning";
import {TextButton} from "../../ui/controls/Button";
import {motionEase} from "../../shared/lib/motion";

const weekdayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function calendarState(item: {state: string}) {
  return item.state === "confirmed" ? "Confirmado" : "Previsto";
}

function calendarDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-ES", options).format(new Date(`${date}T00:00:00`));
}

function calendarAmount(amount: number, currencyCode: string) {
  return currency(amount, currencyCode, {notation: "compact", maximumFractionDigits: 1});
}

function CalendarItems({items, currency: currencyCode, label}: {items: PlanningCalendarPayload["days"][number]["confirmed"]; currency: string; label: string}) {
  if (!items.length) return null;
  return <ul className="planning-calendar-items" aria-label={label}>{items.map((item) => {
    const state = calendarState(item);
    const amount = currency(item.amount, currencyCode);
    return <li className={`planning-calendar-item ${item.state === "confirmed" ? "confirmed" : "forecast"} ${item.kind}`} key={`${item.state}-${item.id}`}><span className="planning-calendar-item-state">{state}</span><span className="planning-calendar-item-description">{item.description}</span><span className="planning-calendar-item-account">{item.account}</span><strong className="money">{amount}</strong></li>;
  })}</ul>;
}

export function PlanningCalendar({calendar}: {calendar: PlanningCalendarPayload}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [restoreFocusDate, setRestoreFocusDate] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const detailTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const [focusedDate, setFocusedDate] = useState(() => calendar.days.find((day) => day.date === todayInputValue())?.date || calendar.days.find((day) => day.in_month)?.date || calendar.days[0]?.date || "");
  const weeks = Array.from({length: Math.ceil(calendar.days.length / 7)}, (_, index) => calendar.days.slice(index * 7, index * 7 + 7));
  const monthLabel = calendarDate(`${calendar.month}-01`, {month: "long", year: "numeric"});
  const money = (amount: number) => currency(amount, calendar.currency);

  useLayoutEffect(() => {
    if (!restoreFocusDate) return;
    Array.from(document.querySelectorAll<HTMLButtonElement>(".planning-calendar-day[data-date]")).find((button) => button.dataset.date === restoreFocusDate)?.focus({preventScroll: true});
    setRestoreFocusDate(null);
  }, [restoreFocusDate]);

  const moveFocus = (date: string, key: string) => {
    const index = calendar.days.findIndex((day) => day.date === date);
    const delta = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -7 : key === "ArrowDown" ? 7 : 0;
    const nextIndex = key === "Home" ? index - (index % 7) : key === "End" ? Math.min(calendar.days.length - 1, index + (6 - (index % 7))) : Math.min(calendar.days.length - 1, Math.max(0, index + delta));
    const nextDate = calendar.days[nextIndex]?.date;
    if (!nextDate) return;
    setFocusedDate(nextDate);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.planning-calendar-day[data-date="${nextDate}"]`)?.focus());
  };

  return <section className="planning-calendar" aria-labelledby="planning-calendar-title">
    <div className="planning-calendar-heading"><div><h2 id="planning-calendar-title">Calendario financiero</h2><p><strong>{monthLabel}</strong> · selecciona un día para revisar sus movimientos.</p></div><p className="planning-calendar-legend"><span><i className="planning-calendar-marker confirmed" aria-hidden="true" />Confirmado</span><span><i className="planning-calendar-marker forecast" aria-hidden="true" />Previsto</span></p></div>
    <div className="planning-calendar-month" role="group" aria-label={`Calendario de ${monthLabel}`}>
      <div className="planning-calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
      {weeks.map((week) => {
        const selectedDay = week.find((day) => day.date === selectedDate);
        return <div className="planning-calendar-week" key={week[0]?.date}>
          <div className="planning-calendar-grid">{week.map((day) => {
            const selected = day.date === selectedDate;
            const activity = day.confirmed.length + day.forecast.length;
            const dateLabel = calendarDate(day.date, {weekday: "long", day: "numeric", month: "long"});
            const income = day.income > 0 ? day.income : 0;
            const expense = day.expense < 0 ? Math.abs(day.expense) : day.expense;
            const amounts = [income ? `ingresos ${money(income)}` : "", expense ? `gastos ${money(expense)}` : ""].filter(Boolean).join(", ");
            return <button className={`planning-calendar-day${day.in_month ? "" : " outside-month"}${income || expense ? " has-amounts" : ""}${day.date === todayInputValue() ? " today" : ""}${selected ? " selected" : ""}`} type="button" key={day.date} data-date={day.date} tabIndex={day.date === focusedDate ? 0 : -1} aria-expanded={selected} aria-controls={selected ? `planning-calendar-detail-${day.date}` : undefined} aria-label={`${selected ? "Cerrar" : "Abrir"} detalle del ${dateLabel}. ${activity ? `${activity} movimiento${activity === 1 ? "" : "s"}` : "Sin movimientos"}${amounts ? `. ${amounts}.` : ""}`} onFocus={() => setFocusedDate(day.date)} onKeyDown={(event) => {if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {event.preventDefault(); moveFocus(day.date, event.key);}}} onClick={() => {setFocusedDate(day.date); setSelectedDate(selected ? null : day.date);}}><span className="planning-calendar-day-number">{new Date(`${day.date}T00:00:00`).getDate()}</span>{income || expense ? <span className="planning-calendar-day-amounts" aria-hidden="true">{income ? <span className="money income">+{calendarAmount(income, calendar.currency)}</span> : null}{expense ? <span className="money expense">−{calendarAmount(expense, calendar.currency)}</span> : null}</span> : null}{activity ? <span className="planning-calendar-day-signals" aria-hidden="true"><i className={day.confirmed.length ? "confirmed" : ""}>{day.confirmed.length || ""}</i><i className={day.forecast.length ? "forecast" : ""}>{day.forecast.length || ""}</i></span> : null}</button>;
          })}</div>
          <AnimatePresence initial={false}>
            {selectedDay ? <motion.article
              key={selectedDay.date}
              className="planning-calendar-detail"
              id={`planning-calendar-detail-${selectedDay.date}`}
              aria-labelledby={`planning-calendar-detail-title-${selectedDay.date}`}
              initial={reduceMotion ? false : {height: 0, opacity: 0, y: -2}}
              animate={{height: "auto", opacity: 1, y: 0}}
              exit={reduceMotion ? {height: 0, opacity: 0} : {height: 0, opacity: 0, y: -2}}
              transition={detailTransition}
              style={{overflow: "hidden"}}
            >
              <div><h3 id={`planning-calendar-detail-title-${selectedDay.date}`}>Detalle del {calendarDate(selectedDay.date, {day: "numeric", month: "long"})}</h3><p>{selectedDay.confirmed.length + selectedDay.forecast.length ? "Movimientos registrados para este día." : "No hay movimientos registrados para este día."}</p></div>
              <TextButton onClick={() => {setRestoreFocusDate(selectedDay.date); setSelectedDate(null);}}>Cerrar detalle</TextButton>
              <div className="planning-calendar-detail-content"><CalendarItems items={selectedDay.confirmed} currency={calendar.currency} label="Movimientos confirmados" /><CalendarItems items={selectedDay.forecast} currency={calendar.currency} label="Movimientos previstos" /></div>
              <p className="planning-calendar-balance">Saldo de cierre <strong className="money">{money(selectedDay.ending_balance)}</strong></p>
            </motion.article> : null}
          </AnimatePresence>
        </div>;
      })}
    </div>
  </section>;
}
