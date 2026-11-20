import {ArrowDownRight, ArrowUpRight, ChevronDown, Repeat2, Store} from "lucide-react";
import {useId, useState, type CSSProperties} from "react";
import {euro, formatMonth} from "../../../format";
import {Panel, SectionHeader} from "../../../shared/components/ui";
import {categoryChartColors, formatPercent, type StatisticsCategoryColorMap} from "../statisticsFormatting";
import type {StatisticsAnalysis, StatisticsComparison} from "../types";
import {Select} from "../../../ui/controls/FormField";
import {ButtonLink} from "../../../ui/controls/Button";

const signedEuro = (amount: number) => `${amount > 0 ? "+" : ""}${euro(amount)}`;
const matrixMonthFormatter = new Intl.DateTimeFormat("es-ES", {month: "short", year: "numeric"});

const matrixFamilyKey = (family: Pick<StatisticsAnalysis["category_matrix"]["rows"][number], "family_id" | "family_name">) => `${family.family_id ?? "uncategorized"}-${family.family_name}`;
const formatMatrixMonth = (month: string) => matrixMonthFormatter.format(new Date(`${month}T00:00:00`));
const matrixIntensity = (amount: number, maximum: number) => maximum > 0 ? Math.sqrt(amount / maximum) : 0;
const matrixLinkLabel = (amount: number, familyName: string, month: string) => `${euro(amount)} · Ver movimientos de ${familyName} en ${formatMonth(month)}`;

export function StatisticsCategoryVariationPanel({comparison, categoryColors}: {comparison: StatisticsComparison; categoryColors: StatisticsCategoryColorMap}) {
  if (!comparison.is_comparable) {
    return <Panel className="stats-analysis-panel"><SectionHeader title="Qué cambió por categoría" detail={`Comparado con ${comparison.scope.label}.`} /><p className="empty-state empty-state--plain">Hay meses sin actividad reportable y cobertura no acreditada en uno de los periodos; no se puede demostrar la variación del gasto.</p></Panel>;
  }
  const rows = comparison.category_variations ?? [];
  if (!rows.length) return null;
  const visible = rows.slice(0, 6);
  const hidden = rows.slice(6);
  const colors = categoryChartColors(rows, categoryColors);
  const renderRows = (items: typeof rows) => (
    <ul className="stats-variation-list">
      {items.map((item) => {
        const increased = item.change > 0;
        const categoryColor = colors[rows.indexOf(item)];
        return (
          <li
            key={`${item.family_id ?? "uncategorized"}-${item.family_name}`}
            className={increased ? "is-increase" : "is-decrease"}
          >
            <div className="stats-variation-category">
              <i style={{background: categoryColor}} aria-hidden="true" />
              <div>
                <strong>{item.family_name}</strong>
                <small>{euro(item.current_net_expense)} ahora · {euro(item.previous_net_expense)} antes</small>
              </div>
            </div>
            <div className={`stats-variation-change ${increased ? "expense" : "income"}`}>
              <span className="stats-variation-amount">{increased ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}{signedEuro(item.change)}</span>
              <small>{item.percentage === null ? "Sin base porcentual" : formatPercent(item.percentage)}</small>
            </div>
            <span className="stats-driver-actions stats-variation-actions"><a href={item.current_movements_url} aria-label={`Ver movimientos del periodo actual de ${item.family_name}`}>Periodo actual</a><a href={item.previous_movements_url} aria-label={`Ver movimientos del periodo anterior de ${item.family_name}`}>Periodo anterior</a></span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <Panel className="stats-analysis-panel">
      <SectionHeader title="Qué cambió por categoría" detail={`Comparado con ${comparison.scope.label}; importes netos después de reembolsos.`} />
      {renderRows(visible)}
      {hidden.length ? <details className="stats-analysis-disclosure"><summary>Ver {hidden.length} variaciones más</summary>{renderRows(hidden)}</details> : null}
    </Panel>
  );
}

function ObservedExpenseList({items, kind}: {items: StatisticsAnalysis["merchants"]; kind: "recurring" | "merchant"}) {
  if (!items.length) return <p className="empty-state empty-state--plain">No hay suficiente historial registrado en este periodo.</p>;
  const visible = items.slice(0, 3);
  const hidden = items.slice(3);
  const list = (subset: StatisticsAnalysis["merchants"]) => (
    <ul className="stats-observed-list">
      {subset.map((item) => (
        <li key={item.description}>
          <div>
            <strong>{item.description}</strong>
            <small>{kind === "recurring"
              ? `${item.active_months} meses observados · típico ${euro(item.typical_monthly_expense)}/mes`
              : `${item.transaction_count} ${item.transaction_count === 1 ? "movimiento" : "movimientos"} · ${formatPercent(item.percentage)} del gasto`}</small>
          </div>
          <div>
            <b>{euro(item.net_expense)}</b>
            <a href={item.movements_url} aria-label={`Ver movimientos de ${item.description}`}>Movimientos</a>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <>{list(visible)}{hidden.length ? <details className="stats-observed-more"><summary>Ver {hidden.length} más</summary>{list(hidden)}</details> : null}</>
  );
}

export function StatisticsObservedPatternsPanel({analysis}: {analysis: StatisticsAnalysis}) {
  return (
    <Panel className="stats-analysis-panel stats-patterns-panel">
      <SectionHeader title="Patrones observados" detail="Describe solo operaciones ya registradas; no anticipa cargos ni gastos futuros." />
      <div className="stats-pattern-grid">
        <section aria-labelledby="statistics-recurring-title">
          <h3 id="statistics-recurring-title"><Repeat2 aria-hidden="true" />Gastos repetidos</h3>
          <ObservedExpenseList items={analysis.recurring} kind="recurring" />
        </section>
        <section aria-labelledby="statistics-merchant-title">
          <h3 id="statistics-merchant-title"><Store aria-hidden="true" />Conceptos que concentran gasto</h3>
          <ObservedExpenseList items={analysis.merchants} kind="merchant" />
        </section>
      </div>
      <ButtonLink variant="secondary" href="/?tab=planning">Revisar suscripciones en Plan</ButtonLink>
    </Panel>
  );
}

export function StatisticsCategoryMatrixPanel({analysis, categoryColors}: {analysis: StatisticsAnalysis; categoryColors: StatisticsCategoryColorMap}) {
  const {months, rows} = analysis.category_matrix;
  if (!rows.length || !months.length) return <p className="empty-state empty-state--plain stats-matrix-empty">No hay gasto categorizado en este periodo.</p>;
  const maximum = Math.max(...rows.flatMap((row) => row.values.map((value) => value.net_expense)), 0);
  const colors = categoryChartColors(rows, categoryColors);
  return <><MatrixMobileExplorer rows={rows} months={months} maximum={maximum} colors={colors} /><div className="stats-matrix-desktop"><StatisticsCategoryMatrixTable rows={rows} months={months} maximum={maximum} colors={colors} /></div></>;
}

function MatrixMobileExplorer({rows, months, maximum, colors}: Pick<StatisticsAnalysis["category_matrix"], "rows" | "months"> & {maximum: number; colors: string[]}) {
  const [selectedFamily, setSelectedFamily] = useState(() => rows[0] ? matrixFamilyKey(rows[0]) : "");
  const row = rows.find((item) => matrixFamilyKey(item) === selectedFamily) ?? rows[0];
  if (!row) return null;
  return (
    <div className="stats-matrix-mobile-explorer">
      <label htmlFor="statistics-matrix-family">Familia para explorar</label>
      <Select id="statistics-matrix-family" value={matrixFamilyKey(row)} onChange={(event) => setSelectedFamily(event.target.value)}>{rows.map((item) => <option key={matrixFamilyKey(item)} value={matrixFamilyKey(item)}>{item.family_name}</option>)}</Select>
      <p className="stats-matrix-family-total" style={{"--stats-category-color": colors[rows.indexOf(row)]} as CSSProperties}><span>{row.family_name}</span><small>Total del periodo</small><b>{euro(row.net_expense)}</b></p>
      <ul>{row.values.map((value) => {
        const month = months.find((item) => item.month === value.month);
        const unknown = month?.activity_status === "unknown";
        return <li key={value.month} data-empty={!unknown && value.net_expense === 0 ? "true" : undefined} data-unknown={unknown ? "true" : undefined} style={{"--matrix-intensity": matrixIntensity(value.net_expense, maximum)} as CSSProperties}><span>{formatMonth(value.month)}{month?.is_partial ? " · parcial" : ""}{unknown ? " · sin cobertura" : ""}</span>{unknown ? <b title="El gasto del mes es desconocido; la cobertura no está acreditada."><span className="sr-only">Gasto desconocido; cobertura no acreditada en {formatMonth(value.month)}</span><span aria-hidden="true">?</span></b> : value.net_expense > 0 ? <a href={value.movements_url} aria-label={matrixLinkLabel(value.net_expense, row.family_name, value.month)}>{euro(value.net_expense)}</a> : <b><span className="sr-only">Sin gasto reportable en {formatMonth(value.month)}</span><span aria-hidden="true">—</span></b>}</li>;
      })}</ul>
    </div>
  );
}

function StatisticsCategoryMatrixTable({rows, months, maximum, colors}: {rows: StatisticsAnalysis["category_matrix"]["rows"]; months: StatisticsAnalysis["category_matrix"]["months"]; maximum: number; colors: string[]}) {
  const matrixId = useId();
  // Six months per table preserve readable exact amounts without lateral scrolling.
  const groups = Array.from({length: Math.ceil(months.length / 6)}, (_, index) => months.slice(index * 6, index * 6 + 6));
  return (
      <div className="stats-matrix-scroll" role="region" aria-label="Matriz de gasto por familia y mes">
        {groups.map((group, groupIndex) => <table className="stats-category-matrix" key={group[0].month}>
          <caption className="sr-only">{groupIndex === 0 ? "Gasto neto de cada familia por mes" : `Gasto neto por familia · ${formatMonth(group[0].month)} – ${formatMonth(group[group.length - 1].month)}`}</caption>
          <thead><tr><th scope="col"><span>Familia</span><small>Total del periodo</small></th>{group.map((month) => <th scope="col" id={`${matrixId}-${month.month}`} key={month.month} title={formatMonth(month.month)}><span aria-hidden="true">{formatMatrixMonth(month.month)}{month.is_partial ? " · parcial" : ""}</span><span className="sr-only">{formatMonth(month.month)}{month.is_partial ? " · parcial" : ""}</span></th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={matrixFamilyKey(row)} style={{"--stats-category-color": colors[index]} as CSSProperties}>
              <th scope="row" id={`${matrixId}-${groupIndex}-${index}`}><span className="stats-matrix-family-label">{row.family_name}</span><small>{euro(row.net_expense)}</small></th>
              {row.values.filter(value => group.some(month => month.month === value.month)).map((value) => {
                const month = group.find((item) => item.month === value.month);
                const unknown = month?.activity_status === "unknown";
                return <td key={value.month} headers={`${matrixId}-${groupIndex}-${index} ${matrixId}-${value.month}`} data-empty={!unknown && value.net_expense === 0 ? "true" : undefined} data-unknown={unknown ? "true" : undefined} style={{"--matrix-intensity": matrixIntensity(value.net_expense, maximum)} as CSSProperties}>
                  {unknown ? <span title="El gasto del mes es desconocido; la cobertura no está acreditada."><span className="sr-only">Gasto desconocido; cobertura no acreditada en {formatMonth(value.month)}</span><span aria-hidden="true">?</span></span> : value.net_expense > 0 ? <a href={value.movements_url} aria-label={matrixLinkLabel(value.net_expense, row.family_name, value.month)}>{euro(value.net_expense)}</a> : <span><span className="sr-only">Sin gasto reportable en {formatMonth(value.month)}</span><span aria-hidden="true">—</span></span>}
                </td>;
              })}
            </tr>)}
          </tbody>
        </table>)}
      </div>
  );
}

export function StatisticsAdvancedAnalysis({analysis, comparison, categoryColors}: {analysis: StatisticsAnalysis; comparison: StatisticsComparison; categoryColors: StatisticsCategoryColorMap}) {
  const hasCategoryMatrix = analysis.category_matrix.rows.length > 0 && analysis.category_matrix.months.length > 0;
  return (
    <details className="stats-advanced-analysis">
      <summary><span>Análisis avanzado</span><small>Cambios, patrones y evolución por categoría</small><ChevronDown aria-hidden="true" /></summary>
      <div className="stats-advanced-analysis-content">
        <StatisticsCategoryVariationPanel comparison={comparison} categoryColors={categoryColors} />
        <StatisticsObservedPatternsPanel analysis={analysis} />
        <Panel className="stats-analysis-panel">
          <SectionHeader title="Categorías a través de los meses" detail="Cada importe abre los movimientos de esa familia y mes." action={hasCategoryMatrix ? <div className="stats-matrix-legend"><span>Menor intensidad</span><span aria-hidden="true"><i /><i /><i /></span><span>Mayor gasto</span></div> : undefined} />
          <StatisticsCategoryMatrixPanel analysis={analysis} categoryColors={categoryColors} />
        </Panel>
      </div>
    </details>
  );
}
