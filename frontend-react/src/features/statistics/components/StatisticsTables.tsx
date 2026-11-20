import {CalendarDays, ChevronDown, ChevronRight, Table2} from "lucide-react";
import {useId, useState} from "react";
import {euro, formatMonth} from "../../../format";
import {categoryChartColors, formatPercent} from "../statisticsFormatting";
import type {
  StatisticsCategoryFamily,
  StatisticsMonthlyPoint,
} from "../types";
import type {StatisticsCategoryColorMap} from "../statisticsFormatting";
import {Button, ButtonLink, TextButton} from "../../../ui/controls/Button";
import {Select} from "../../../ui/controls/FormField";

export function MonthlySeriesNavigator({
  rows,
  selectedMonth,
  onSelectMonth,
}: {
  rows: StatisticsMonthlyPoint[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}) {
  const selected = rows.find((row) => row.month === selectedMonth) ?? null;
  const reversedRows = [...rows].reverse();

  return (
    <div className="stats-month-navigation">
      <div className="sr-status" role="status" aria-live="polite">{selected ? `${formatMonth(selected.month)} seleccionado.` : ""}</div>
      <div className="stats-month-picker-row">
        <label className="stats-month-picker">
          <span><CalendarDays aria-hidden="true" /></span>
          <span className="stats-month-select">
            <Select aria-label="Mes para profundizar" value={selectedMonth} onChange={(event) => onSelectMonth(event.target.value)}>
              <option value="">Elige mes</option>
              {reversedRows.map((row) => (
                <option
                  key={row.month}
                  value={row.month}
                  aria-label={row.activity_status === "unknown" ? `${formatMonth(row.month)} · cobertura no acreditada` : undefined}
                  title={row.activity_status === "unknown" ? "Mes sin cobertura acreditada" : undefined}
                >
                  {formatMonth(row.month)}{row.activity_status === "unknown" ? " · ?" : row.is_partial || !row.is_complete ? " · parcial" : ""}
                </option>
              ))}
            </Select>
            <ChevronDown className="stats-month-select-chevron" aria-hidden="true" />
          </span>
        </label>
      </div>
    </div>
  );
}

export function MonthlySeriesSummary({rows, selectedMonth}: {rows: StatisticsMonthlyPoint[]; selectedMonth: string}) {
  const selected = rows.find((row) => row.month === selectedMonth);
  if (!selected) return null;

  return (
    <div className="chart-inspector selected stats-month-summary" role="group" aria-label={`Resumen de ${formatMonth(selected.month)}`}>
      <strong>{formatMonth(selected.month)}</strong>
      {selected.activity_status === "unknown" ? <span className="status-chip">Cobertura no acreditada</span> : null}
      {selected.is_partial || !selected.is_complete ? <span className="status-chip">Periodo parcial</span> : null}
      {selected.activity_status === "unknown" ? (
        <span>Sin actividad reportable. El gasto es desconocido, no cero demostrado.</span>
      ) : (
        <>
          <span className="income">Ingresos <b>{euro(selected.income)}</b></span>
          <span className="expense">Gasto <b>{euro(selected.net_expense)}</b></span>
          <span className={selected.analytical_result >= 0 ? "positive" : "negative"}>
            Resultado <b>{euro(selected.analytical_result)}</b>
          </span>
        </>
      )}
    </div>
  );
}

export function MonthlySeriesDisclosure({
  rows,
  selectedMonth,
  onSelectMonth,
}: {
  rows: StatisticsMonthlyPoint[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tableId = useId();

  return (
    <>
      <TextButton
        className="stats-month-table-trigger"
        aria-label={`Tabla mensual completa, ${rows.length} ${rows.length === 1 ? "mes" : "meses"}`}
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Table2 aria-hidden="true" />
        <span className="stats-month-table-label-full" aria-hidden="true">Tabla mensual completa</span>
        <span className="stats-month-table-label-compact" aria-hidden="true">Tabla</span>
        <small aria-hidden="true">{rows.length} {rows.length === 1 ? "mes" : "meses"}</small>
      </TextButton>
      <MonthlySeriesTable id={tableId} hidden={!open} rows={rows} selectedMonth={selectedMonth} onSelectMonth={onSelectMonth} />
    </>
  );
}

export function CategoryQuickLinks({
  items,
  title,
  initialLimit = 5,
  categoryColors,
}: {
  items: StatisticsCategoryFamily[];
  title: string;
  initialLimit?: number;
  categoryColors: StatisticsCategoryColorMap;
}) {
  const rows = items.filter((item) => item.net_expense > 0);
  const colors = categoryChartColors(rows, categoryColors);
  if (!rows.length) return null;
  const visibleRows = rows.slice(0, initialLimit);
  const hiddenRows = rows.slice(initialLimit);
  const renderRows = (subset: StatisticsCategoryFamily[], offset = 0) => (
    <ul>
      {subset.map((item, index) => (
        <li key={`${item.family_id ?? "uncategorized"}-${item.family_name}`}>
          <a href={item.movements_url}>
            <i style={{background: colors[index + offset]}} aria-hidden="true" />
            <span><strong>{item.family_name}</strong><small>{formatPercent(item.percentage)} del gasto neto</small></span>
            <b>{euro(item.net_expense)}</b>
            <ChevronRight aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="stats-category-rank">
      <nav className="stats-category-quick-links" aria-label={title}>{renderRows(visibleRows)}</nav>
      {hiddenRows.length ? (
        <details className="stats-more-categories">
          <summary>Ver {hiddenRows.length} {hiddenRows.length === 1 ? "categoría más" : "categorías más"}<ChevronDown aria-hidden="true" /></summary>
          <nav className="stats-category-quick-links" aria-label={`${title}: categorías restantes`}>{renderRows(hiddenRows, initialLimit)}</nav>
        </details>
      ) : null}
    </div>
  );
}

export function CategoryDataDisclosure({
  items,
  title,
  categoryColors,
}: {
  items: StatisticsCategoryFamily[];
  title: string;
  categoryColors: StatisticsCategoryColorMap;
}) {
  return (
    <details className="stats-data-disclosure stats-category-table-disclosure">
      <summary><Table2 aria-hidden="true" /><span>Importes exactos y subcategorías</span><small>{items.length} {items.length === 1 ? "familia" : "familias"}</small></summary>
      <CategoryFamilyTable items={items} title={title} categoryColors={categoryColors} />
    </details>
  );
}

export function MonthlySeriesTable({
  id,
  hidden,
  rows,
  selectedMonth,
  onSelectMonth,
}: {
  id?: string;
  hidden?: boolean;
  rows: StatisticsMonthlyPoint[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}) {
  return (
    <div id={id} hidden={hidden} className="chart-summary-table responsive-summary-table monthly-series-table">
      <table>
        <caption className="sr-only">Datos de evolución mensual</caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Ingresos</th>
            <th>Gasto neto</th>
            <th>Reembolsos</th>
            <th>Resultado</th>
            <th>Δ gasto</th>
            <th>Δ resultado</th>
            <th>Estado</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.month === selectedMonth;
            const unknown = row.activity_status === "unknown";
            const amount = (value: number) => unknown ? <span title="La cobertura del mes no está acreditada."><span aria-hidden="true">—</span><span className="sr-only">Desconocido; cobertura no acreditada</span></span> : euro(value);
            return (
              <tr className={selected ? "selected" : ""} key={row.month}>
                <th data-label="Mes" scope="row">{formatMonth(row.month)}</th>
                <td data-label="Ingresos" className="positive">{amount(row.income)}</td>
                <td data-label="Gasto neto">{amount(row.net_expense)}</td>
                <td data-label="Reembolsos">{amount(row.refunds_applied)}</td>
                <td data-label="Resultado" className={unknown ? "" : row.analytical_result >= 0 ? "positive" : "negative"}>{amount(row.analytical_result)}</td>
                <td data-label="Variación de gasto" className={row.expense_change === undefined || row.expense_change === null ? "" : row.expense_change > 0 ? "negative" : "positive"}>{unknown || row.expense_change === undefined || row.expense_change === null ? "—" : `${row.expense_change > 0 ? "+" : ""}${euro(row.expense_change)}`}</td>
                <td data-label="Variación de resultado" className={row.result_change === undefined || row.result_change === null ? "" : row.result_change >= 0 ? "positive" : "negative"}>{unknown || row.result_change === undefined || row.result_change === null ? "—" : `${row.result_change > 0 ? "+" : ""}${euro(row.result_change)}`}</td>
                <td data-label="Estado">{unknown ? <span className="status-chip">Cobertura no acreditada</span> : row.is_partial || !row.is_complete ? <span className="status-chip">Parcial</span> : "Completo"}</td>
                <td data-label="Acciones">
                  <div className="stats-table-actions">
                    <Button variant="secondary" aria-pressed={selected} onClick={() => onSelectMonth(row.month)}>
                      {selected ? "Detalle abierto" : "Ver detalle"}
                    </Button>
                    <ButtonLink variant="secondary" href={row.movements_url} aria-label={`Ver movimientos de ${formatMonth(row.month)}`}>Movimientos</ButtonLink>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CategoryFamilyTable({
  items,
  title,
  categoryColors,
}: {
  items: StatisticsCategoryFamily[];
  title: string;
  categoryColors: StatisticsCategoryColorMap;
}) {
  const rows = items.filter((item) => item.net_expense > 0);
  const colors = categoryChartColors(rows, categoryColors);
  if (!rows.length) return null;
  return (
    <div className="category-table-stack">
      <div className="chart-summary-table responsive-summary-table category-summary-table">
        <table>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th>Familia principal</th>
              <th>Porcentaje</th>
              <th>Reembolsos</th>
              <th>Gasto neto</th>
              <th><span className="sr-only">Acción</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.family_id ?? "uncategorized"}-${item.family_name}`}>
                <th data-label="Familia principal" scope="row">
                  <span className="stats-summary-category-label">
                    <i style={{background: colors[index]}} aria-hidden="true" />
                    {item.family_name}
                  </span>
                </th>
                <td data-label="Porcentaje">{formatPercent(item.percentage)}</td>
                <td data-label="Reembolsos">{euro(item.refunds_applied)}</td>
                <td data-label="Gasto neto">{euro(item.net_expense)}</td>
                <td data-label="Acción"><a className="stats-table-link" href={item.movements_url}>Ver movimientos</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((item) => item.subcategories.length) ? (
        <details className="stats-subcategory-detail">
          <summary>Desglosar subcategorías</summary>
          <div className="stats-subcategory-groups">
            {rows.filter((item) => item.subcategories.length).map((family) => {
              const familyIndex = rows.indexOf(family);
              return (
              <section key={`${family.family_id ?? "uncategorized"}-detail`}>
                <h3><i style={{background: colors[familyIndex]}} aria-hidden="true" />{family.family_name}</h3>
                <ul>
                  {family.subcategories.map((subcategory) => (
                    <li key={`${subcategory.category_id ?? "uncategorized"}-${subcategory.name}`}>
                      <a href={subcategory.movements_url}>{subcategory.name}</a>
                      <span>{subcategory.refunds_applied > 0
                        ? `${euro(subcategory.gross_expense)} bruto − ${euro(subcategory.refunds_applied)} reembolsado = ${euro(subcategory.net_expense)} neto`
                        : `${euro(subcategory.net_expense)} · ${formatPercent(subcategory.percentage_of_family)} de la familia`}</span>
                    </li>
                  ))}
                </ul>
              </section>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
