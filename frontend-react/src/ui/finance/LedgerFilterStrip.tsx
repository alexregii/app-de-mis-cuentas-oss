import {useEffect, useId, useRef, useState} from "react";
import {ChevronDown, X} from "lucide-react";
import {formatMonthTitle} from "../formatMonthTitle";

export type LedgerFilterKey = "query" | "month" | "dateFrom" | "dateTo" | "kind" | "account" | "category" | "source" | "analytics";
export type LedgerFilterValues = Readonly<Record<LedgerFilterKey, string>>;
export type LedgerFilterOption = Readonly<{value: string; label: string}>;
export type LedgerActiveFilter = Readonly<{key: LedgerFilterKey; label: string; value: string}>;

function periodLabel(month: string) {
  if (!month) return "Cualquier periodo";
  const value = new Date(`${month}-01T12:00:00`);
  return formatMonthTitle(value);
}

function formatDate(value: string, includeYear = true) {
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {day: "numeric", month: "short", ...(includeYear ? {year: "numeric"} : {})}).format(date).replace(".", "");
}

function activeRange(values: LedgerFilterValues) {
  const {dateFrom, dateTo} = values;
  if (dateFrom && dateTo) {
    const fromYear = dateFrom.slice(0, 4);
    const toYear = dateTo.slice(0, 4);
    const label = fromYear === toYear ? `${formatDate(dateFrom, false)} – ${formatDate(dateTo)}` : `${formatDate(dateFrom)} – ${formatDate(dateTo)}`;
    return {label, accessibleLabel: `Quitar filtro de periodo del ${formatDate(dateFrom)} al ${formatDate(dateTo)}`};
  }
  if (dateFrom) return {label: `Desde ${formatDate(dateFrom)}`, accessibleLabel: `Quitar filtro desde ${formatDate(dateFrom)}`};
  if (dateTo) return {label: `Hasta ${formatDate(dateTo)}`, accessibleLabel: `Quitar filtro hasta ${formatDate(dateTo)}`};
  return null;
}

export function LedgerFilterStrip({values, options, activeFilters, locked = false, onChange, onRemoveFilter, onClear}: {
  values: LedgerFilterValues;
  options: Readonly<{
    kinds: readonly LedgerFilterOption[];
    accounts: readonly LedgerFilterOption[];
    categories: readonly LedgerFilterOption[];
    sources: readonly LedgerFilterOption[];
  }>;
  activeFilters: readonly LedgerActiveFilter[];
  locked?: boolean;
  onChange: (key: LedgerFilterKey, value: string) => void;
  onRemoveFilter: (key: LedgerFilterKey) => void;
  onClear: () => void;
}) {
  const [periodMode, setPeriodMode] = useState<"month" | "range">(() => values.dateFrom || values.dateTo ? "range" : "month");
  const lockedDescriptionId = useId();
  const periodRef = useRef<HTMLDetailsElement>(null);
  const refineRef = useRef<HTMLDetailsElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const periodIntent = useRef<"month" | "range" | null>(null);
  const currentPeriodLabel = periodMode === "range" ? "Rango personalizado" : periodLabel(values.month);
  const refinementCount = activeFilters.filter((filter) => !["query", "month", "dateFrom", "dateTo"].includes(filter.key)).length;
  const range = activeRange(values);
  const visibleActiveFilters = activeFilters.filter((filter) => !["dateFrom", "dateTo"].includes(filter.key) && !(range && filter.key === "month"));
  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (stripRef.current?.contains(event.target as Node)) return;
      periodRef.current?.removeAttribute("open");
      refineRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, []);
  useEffect(() => {
    if (periodIntent.current) {
      setPeriodMode(periodIntent.current);
      periodIntent.current = null;
      return;
    }
    if (values.dateFrom || values.dateTo) setPeriodMode("range");
    else if (values.month) setPeriodMode("month");
    else setPeriodMode("month");
  }, [values.dateFrom, values.dateTo, values.month]);
  useEffect(() => {
    if (!locked) return;
    periodRef.current?.removeAttribute("open");
    refineRef.current?.removeAttribute("open");
  }, [locked]);
  const selectMonth = (value: string) => {
    if (locked) return;
    periodIntent.current = "month";
    setPeriodMode("month");
    onChange("month", value);
    onChange("dateFrom", "");
    onChange("dateTo", "");
  };
  const selectRange = () => {
    if (locked) return;
    periodIntent.current = "range";
    setPeriodMode("range");
    onChange("month", "");
  };
  const clearAll = () => {
    if (locked) return;
    periodIntent.current = "month";
    setPeriodMode("month");
    onClear();
  };
  const clearRange = () => {
    if (locked) return;
    onChange("dateFrom", "");
    onChange("dateTo", "");
  };
  const closeOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    const details = (event.target as HTMLElement).closest("details");
    details?.removeAttribute("open");
    details?.querySelector<HTMLElement>("summary")?.focus({preventScroll: true});
    event.stopPropagation();
  };

  const change = (key: LedgerFilterKey, value: string) => { if (!locked) onChange(key, value); };
  const remove = (key: LedgerFilterKey) => { if (!locked) onRemoveFilter(key); };
  const preventDisclosure = (event: React.MouseEvent<HTMLElement>) => { if (locked) event.preventDefault(); };
  return <section ref={stripRef} className={`ui-ledger-filter-strip${locked ? " is-locked" : ""}`} aria-label="Filtros del ledger" aria-describedby={locked ? lockedDescriptionId : undefined}>
    <div className="ui-ledger-filter-strip__bar">
      <label className="ui-ledger-filter-strip__search">
        <span className="sr-only">Búsqueda</span>
        <span className="ui-ledger-filter-strip__input">
          <input type="search" aria-label="Búsqueda" value={values.query} placeholder="Buscar movimiento…" disabled={locked} onChange={(event) => change("query", event.target.value)} />
          {values.query ? <button type="button" aria-label="Limpiar búsqueda" disabled={locked} onClick={() => change("query", "")}><X aria-hidden="true" /></button> : null}
        </span>
      </label>
      <details ref={periodRef} className="ui-ledger-filter-strip__period" onKeyDown={closeOnEscape} onToggle={(event) => { if (locked) event.currentTarget.removeAttribute("open"); else if (event.currentTarget.open) refineRef.current?.removeAttribute("open"); }}>
        <summary role="button" aria-label={`Periodo: ${currentPeriodLabel}`} aria-disabled={locked || undefined} onClick={(event) => { preventDisclosure(event); refineRef.current?.removeAttribute("open"); }}>{currentPeriodLabel} <ChevronDown className="ui-ledger-filter-strip__chevron" aria-hidden="true" /> </summary>
        <div className="ui-ledger-filter-strip__period-menu">
          <label>Mes<input type="month" value={values.month} disabled={locked} onChange={(event) => selectMonth(event.target.value)} /></label>
          <button type="button" disabled={locked} className={periodMode === "range" ? "is-active" : ""} onClick={selectRange}>Rango personalizado</button>
          {periodMode === "range" ? <div className="ui-ledger-filter-strip__range">
            <label>Desde<input type="date" value={values.dateFrom} disabled={locked} onChange={(event) => change("dateFrom", event.target.value)} /></label>
            <label>Hasta<input type="date" value={values.dateTo} disabled={locked} onChange={(event) => change("dateTo", event.target.value)} /></label>
          </div> : null}
        </div>
      </details>
      <details ref={refineRef} className="ui-ledger-filter-strip__refine" onKeyDown={closeOnEscape} onToggle={(event) => { if (locked) event.currentTarget.removeAttribute("open"); else if (event.currentTarget.open) periodRef.current?.removeAttribute("open"); }}>
        <summary role="button" aria-label={`Filtros${refinementCount ? `, ${refinementCount} aplicados` : ""}`} aria-disabled={locked || undefined} onClick={(event) => { preventDisclosure(event); periodRef.current?.removeAttribute("open"); }}>Filtros{refinementCount ? ` ${refinementCount}` : ""}</summary>
        <div className="ui-ledger-filter-strip__grid">
          <label>Tipo<select value={values.kind} disabled={locked} onChange={(event) => change("kind", event.target.value)}><option value="">Todos</option>{options.kinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Cuenta<select value={values.account} disabled={locked} onChange={(event) => change("account", event.target.value)}><option value="">Todas</option>{options.accounts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Categoría<select value={values.category} disabled={locked} onChange={(event) => change("category", event.target.value)}><option value="">Todas</option>{options.categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Origen<select value={values.source} disabled={locked} onChange={(event) => change("source", event.target.value)}><option value="">Todos</option>{options.sources.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Base estadística<select value={values.analytics} disabled={locked} onChange={(event) => change("analytics", event.target.value)}><option value="all">Todas</option><option value="included">Solo analíticas</option><option value="excluded">Solo excluidas</option></select></label>
        </div>
      </details>
    </div>
    {locked ? <p className="sr-only" id={lockedDescriptionId}>Los filtros se bloquean durante la selección.</p> : null}
    {visibleActiveFilters.length || range ? <div className="ui-ledger-filter-strip__active" aria-live="polite">
      <span className="sr-only">Filtros aplicados</span>
      {visibleActiveFilters.map((filter) => <button type="button" disabled={locked} className="ui-ledger-filter-strip__chip" key={filter.key} aria-label={`Quitar filtro ${filter.label}: ${filter.value}`} title={`${filter.label}: ${filter.value}`} onClick={() => remove(filter.key)}>{filter.label}: <strong>{filter.value}</strong><X aria-hidden="true" /></button>)}
      {range ? <button type="button" disabled={locked} className="ui-ledger-filter-strip__chip ui-ledger-filter-strip__chip--period" aria-label={range.accessibleLabel} onClick={clearRange}>{range.label}<X aria-hidden="true" /></button> : null}
      <button type="button" disabled={locked} className="ui-ledger-filter-strip__clear" onClick={clearAll}>Limpiar</button>
    </div> : null}
  </section>;
}
