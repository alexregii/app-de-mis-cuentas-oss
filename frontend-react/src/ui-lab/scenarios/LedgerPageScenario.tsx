import {useMemo, useRef, useState} from "react";
import {formatMonthTitle} from "../../ui/formatMonthTitle";
import {LedgerFilterStrip, type LedgerActiveFilter, type LedgerFilterKey, type LedgerFilterValues} from "../../ui/finance/LedgerFilterStrip";
import {LedgerArchetype} from "../../ui/finance/LedgerArchetype";
import {LedgerHeader, type LedgerHeaderSummary} from "../../ui/finance/LedgerHeader";
import type {LedgerItem} from "../../ui/finance/LedgerItem";
import {LedgerPagination} from "../../ui/finance/LedgerPagination";
import {SelectionToolbar, type SelectionToolbarAction} from "../../ui/finance/SelectionToolbar";
import {StatementLedger} from "../../ui/finance/StatementLedger";
import {LedgerEmptyState, LedgerErrorState, LedgerLoadingState} from "../../ui/finance/LedgerStates";
import {LabSection} from "../components/LabSection";
import {ledgerFixtures, ledgerFixtureCapabilities} from "../fixtures/ledger";

type LedgerScenarioState = "many" | "few" | "empty" | "loading" | "error";

const PAGE_SIZE = 8;
const emptyFilters: LedgerFilterValues = {query: "", month: "", dateFrom: "", dateTo: "", kind: "", account: "", category: "", source: "", analytics: "all"};

export function LedgerPageScenario() {
  const [privateAmounts, setPrivateAmounts] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [ledgerState, setLedgerState] = useState<LedgerScenarioState>("many");
  const [filters, setFilters] = useState<LedgerFilterValues>(emptyFilters);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionAvailability, setActionAvailability] = useState<"ready" | "mixed" | "blocked">("ready");
  const [mobileStress, setMobileStress] = useState(false);
  const [paginationStress, setPaginationStress] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const ledgerBodyRef = useRef<HTMLDivElement>(null);
  const sourceItems = ledgerFixtures;
  const options = useMemo(() => ({
    kinds: [{value: "income", label: "Ingreso"}, {value: "expense", label: "Gasto"}, {value: "transfer", label: "Traspaso"}],
    accounts: [...new Map(sourceItems.map((item) => [item.account.name, {value: item.account.name, label: item.account.name}])).values()],
    categories: [...new Map(sourceItems.filter((item) => item.category).map((item) => [item.category!.name, {value: item.category!.name, label: item.category!.name}])).values()],
    sources: [...new Map(sourceItems.filter((item) => item.sourceLabel).map((item) => [item.sourceLabel!, {value: item.sourceLabel!, label: item.sourceLabel!}])).values()],
  }), [sourceItems]);
  const activeValue = (key: LedgerFilterKey, value: string) => {
    if (key === "month") {
      const date = new Date(`${value}-01T12:00:00`);
      return formatMonthTitle(date);
    }
    if (key === "dateFrom" || key === "dateTo") return value.split("-").reverse().join("/");
    if (key === "analytics") return value === "included" ? "Solo analíticas" : "Solo excluidas";
    const source = key === "kind" ? options.kinds : key === "account" ? options.accounts : key === "category" ? options.categories : key === "source" ? options.sources : [];
    return source.find((option) => option.value === value)?.label ?? value;
  };
  const activeFilters = useMemo<LedgerActiveFilter[]>(() => {
    const labels: Record<LedgerFilterKey, string> = {query: "Búsqueda", month: "Mes", dateFrom: "Desde", dateTo: "Hasta", kind: "Tipo", account: "Cuenta", category: "Categoría", source: "Origen", analytics: "Base estadística"};
    return (Object.entries(filters) as Array<[LedgerFilterKey, string]>).filter(([key, value]) => Boolean(value) && !(key === "analytics" && value === "all")).map(([key, value]) => ({key, label: labels[key], value: activeValue(key, value)}));
  }, [filters, options]);
  const filtered = useMemo(() => {
    const query = filters.query.toLocaleLowerCase("es");
    return sourceItems.filter((item) => {
      if (query && !`${item.description} ${item.sourceLabel ?? ""}`.toLocaleLowerCase("es").includes(query)) return false;
      if (filters.month && !item.date.startsWith(filters.month)) return false;
      if (filters.dateFrom && item.date < filters.dateFrom) return false;
      if (filters.dateTo && item.date > filters.dateTo) return false;
      if (filters.kind && item.kind !== filters.kind) return false;
      if (filters.account && item.account.name !== filters.account) return false;
      if (filters.category && item.category?.name !== filters.category) return false;
      if (filters.source && item.sourceLabel !== filters.source) return false;
      if (filters.analytics === "included" && !item.category) return false;
      if (filters.analytics === "excluded" && item.category) return false;
      return true;
    });
  }, [filters, sourceItems]);
  const scenarioItems = useMemo(() => ledgerState === "few" ? filtered.slice(0, 3) : filtered, [filtered, ledgerState]);
  const paginationTotalItems = paginationStress ? 1_000_000 : scenarioItems.length;
  const numPages = Math.max(1, Math.ceil(paginationTotalItems / PAGE_SIZE));
  const currentPage = Math.min(page, numPages);
  const pageItems = useMemo(() => {
    if (ledgerState !== "many") return scenarioItems;
    if (!paginationStress) return scenarioItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    return scenarioItems.length ? Array.from({length: Math.min(PAGE_SIZE, paginationTotalItems - (currentPage - 1) * PAGE_SIZE)}, (_, index) => scenarioItems[index % scenarioItems.length]) : [];
  }, [currentPage, ledgerState, paginationStress, paginationTotalItems, scenarioItems]);
  const displayItems = useMemo(() => pageItems.map((item, index) => {
    if (!mobileStress || index > 1) return item;
    return index === 0
      ? {...item, description: "Ingreso extraordinario con una descripción deliberadamente extensa para comprobar la lectura móvil", account: {name: "Cuenta principal de operaciones cotidianas", color: item.account.color}, category: {name: "Ingresos extraordinarios y ajustes de regularización", color: item.category?.color ?? "var(--entity-2)"}, signedAmount: 1234567.89}
      : {...item, description: "Gasto con descripción extensa para comprobar que el importe negativo conserva su columna", account: {name: "Tarjeta diaria de gastos personales", color: item.account.color}, category: {name: "Servicios domésticos y suministros recurrentes", color: item.category?.color ?? "var(--entity-3)"}, signedAmount: -987654.32};
  }), [mobileStress, pageItems]);
  const hasResultState = ledgerState === "many" || ledgerState === "few";
  const selectionAvailable = hasResultState && displayItems.length > 0;
  const showPagination = ledgerState === "many" && numPages > 1;
  const itemFrom = (currentPage - 1) * PAGE_SIZE + 1;
  const itemTo = Math.min(currentPage * PAGE_SIZE, paginationTotalItems);
  const filtersContext = activeFilters.length
    ? activeFilters.slice(0, 2).map((filter) => `${filter.label.toLocaleLowerCase("es")}: ${filter.value}`).join(" · ") + (activeFilters.length > 2 ? ` · ${activeFilters.length - 2} más` : "")
    : "el extracto completo";
  const toggleSelection = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const setBrowseMode = () => { setSelectionMode(false); setSelectedIds([]); };
  const changeLedgerState = (nextState: LedgerScenarioState) => {
    setLedgerState(nextState);
    setPage(1);
    setBrowseMode();
    setStatus("");
  };
  const changeFilter = (key: LedgerFilterKey, value: string) => {
    setFilters((current) => ({...current, [key]: value}));
    setLedgerState("many");
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(emptyFilters);
    setLedgerState("many");
    setPage(1);
  };
  const focusLedgerBody = () => window.requestAnimationFrame(() => ledgerBodyRef.current?.focus());
  const capabilitiesFor = (item: LedgerItem) => ledgerFixtureCapabilities[item.id];
  const summary = useMemo<LedgerHeaderSummary>(() => {
    // Synthetic Lab totals only. Production supplies its own prepared summary.
    let incomeCents = 0;
    let expenseCents = 0;
    for (const item of ledgerState === "empty" ? [] : scenarioItems) {
      if (item.kind === "income") incomeCents += Math.round(item.signedAmount * 100);
      if (item.kind === "expense") expenseCents += Math.round(item.signedAmount * 100);
    }
    const period = filters.month ? activeValue("month", filters.month)
      : filters.dateFrom || filters.dateTo ? `${filters.dateFrom ? "Desde " + activeValue("dateFrom", filters.dateFrom) : "Sin fecha inicial"}${filters.dateTo ? " hasta " + activeValue("dateTo", filters.dateTo) : " · sin fecha final"}`
        : "Todos los periodos";
    return {period: period[0].toUpperCase() + period.slice(1), income: incomeCents / 100, expense: expenseCents / 100, net: (incomeCents + expenseCents) / 100};
  }, [scenarioItems, ledgerState, filters.month, filters.dateFrom, filters.dateTo]);
  const selectionActions = useMemo<SelectionToolbarAction[]>(() => {
    const hasSelection = selectedIds.length > 0;
    const unavailable = (reason: string) => ({available: false, reason});
    const categorise = actionAvailability === "blocked" ? unavailable("La regla del flujo no permite categorizar esta selección.") : actionAvailability === "mixed" ? unavailable("La selección contiene movimientos no compatibles.") : hasSelection ? {available: true} : unavailable("Selecciona movimientos para categorizar.");
    const exportItems = actionAvailability === "blocked" ? unavailable("La exportación no está disponible para esta selección.") : hasSelection ? {available: true} : unavailable("Selecciona movimientos para exportar.");
    const archive = actionAvailability === "blocked" ? unavailable("No hay movimientos archivables en esta selección.") : hasSelection ? {available: true} : unavailable("Selecciona movimientos para archivar.");
    return [
      {id: "categorise", label: "Categorizar", ...categorise, onAction: () => setStatus("Categorizar se evaluaría en el flujo real.")},
      {id: "export", label: "Exportar", ...exportItems, onAction: () => setStatus("Exportar se evaluaría en el flujo real.")},
      {id: "archive", label: "Archivar", ...archive, onAction: () => setStatus("Archivar se evaluaría en el flujo real.")},
    ];
  }, [actionAvailability, selectedIds.length]);

  const ledgerBody = ledgerState === "loading"
    ? <LedgerLoadingState />
    : ledgerState === "error"
      ? <LedgerErrorState message={`La conexión se ha interrumpido. Se mantiene el contexto: ${filtersContext}. Reintenta para continuar donde estabas.`} onRetry={() => { changeLedgerState("many"); setStatus("Los movimientos se han cargado de nuevo."); focusLedgerBody(); }} />
      : ledgerState === "empty" || !displayItems.length
        ? <LedgerEmptyState title="No hay movimientos con estos filtros" detail={`0 movimientos en ${filtersContext}. Ajusta los criterios o limpia los filtros para volver al extracto completo.`} action={{label: "Limpiar filtros", onAction: () => { clearFilters(); focusLedgerBody(); }}} />
        : <StatementLedger items={displayItems} capabilitiesFor={capabilitiesFor} privateAmounts={privateAmounts} selectionMode={selectionMode} selectedIds={selectedIds} onSelect={toggleSelection} onAction={(id, action) => setStatus(`${action === "archive" ? "Archivar" : action === "reopen" ? "Reabrir" : "Editar"} ${id} se probaría sin modificar datos.`)} />;

  return <LabSection title="Ledger archetype" detail="Un extracto financiero personal: fecha como gutter, movimiento como lectura principal e importes en una columna estable.">
    <details className="ui-lab-controls">
      <summary>Herramientas de prueba</summary>
      <div className="ui-lab-controls__body" role="region" aria-label="Controles del Lab">
        <div className="ui-lab-data-group">
          <button type="button" aria-pressed={privateAmounts} onClick={() => setPrivateAmounts((current) => !current)}>{privateAmounts ? "Mostrar importes" : "Ocultar importes"}</button>
          <label>Estado del ledger<select value={ledgerState} onChange={(event) => changeLedgerState(event.target.value as LedgerScenarioState)}><option value="many">Muchos resultados</option><option value="few">Pocos resultados</option><option value="empty">Vacío</option><option value="loading">Cargando</option><option value="error">Error</option></select></label>
          <button type="button" aria-pressed={mobileStress} disabled={!hasResultState} onClick={() => setMobileStress((current) => !current)}>{mobileStress ? "Restablecer contenido" : "Probar contenido largo"}</button>
          <button type="button" aria-pressed={paginationStress} disabled={!hasResultState} onClick={() => { setPaginationStress((current) => !current); setPage(1); }}>{paginationStress ? "Restablecer paginación" : "Probar paginación larga"}</button>
          <label>Disponibilidad masiva<select value={actionAvailability} onChange={(event) => setActionAvailability(event.target.value as "ready" | "mixed" | "blocked")}><option value="ready">Acciones disponibles</option><option value="mixed">Una acción no disponible</option><option value="blocked">Ninguna acción disponible</option></select></label>
        </div>
        {mobileStress ? <p>Stress de presentación: textos e importes ilustrativos en las filas; filtros y resumen conservan el dataset original.</p> : null}
      </div>
    </details>
    <LedgerArchetype
      ariaLabel="Escenario de ledger archetype"
      header={<LedgerHeader summary={summary} privateAmounts={privateAmounts} />}
      selection={selectionMode || selectionAvailable ? <SelectionToolbar selectionMode={selectionMode} selectionAvailable={selectionAvailable} onToggleSelection={() => selectionMode ? setBrowseMode() : setSelectionMode(true)} selectedCount={selectedIds.length} actions={selectionActions} /> : null}
      filterSlot={<LedgerFilterStrip values={filters} options={options} activeFilters={activeFilters} locked={selectionMode} onChange={changeFilter} onRemoveFilter={(key) => changeFilter(key, key === "analytics" ? "all" : "")} onClear={clearFilters} />}
      results={<>{ledgerBody}{status ? <p className="ui-lab-note" role="status">{status}</p> : null}</>}
      pagination={showPagination ? <LedgerPagination page={currentPage} numPages={numPages} itemFrom={itemFrom} itemTo={itemTo} totalItems={paginationTotalItems} hasPrevious={currentPage > 1} hasNext={currentPage < numPages} onPrevious={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(numPages, value + 1))} onPageChange={setPage} /> : null}
      resultsRef={ledgerBodyRef}
    />
  </LabSection>;
}
