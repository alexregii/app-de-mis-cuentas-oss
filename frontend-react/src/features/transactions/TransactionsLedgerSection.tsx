import {CategoryCombobox, type CategoryComboboxOption} from "../../ui/finance/CategoryCombobox";
import {SectionHeader} from "../../shared/components/ui";
import type {TransactionListPayload} from "./types";
import {LedgerFilterStrip, type LedgerActiveFilter, type LedgerFilterKey, type LedgerFilterOption, type LedgerFilterValues} from "../../ui/finance/LedgerFilterStrip";
import {LedgerArchetype} from "../../ui/finance/LedgerArchetype";
import {LedgerHeader} from "../../ui/finance/LedgerHeader";
import {LedgerEmptyState, LedgerErrorState, LedgerLoadingState} from "../../ui/finance/LedgerStates";
import {LedgerPagination} from "../../ui/finance/LedgerPagination";
import {SelectionToolbar, type SelectionToolbarAction} from "../../ui/finance/SelectionToolbar";
import {StatementLedger} from "../../ui/finance/StatementLedger";
import type {LedgerItem, LedgerItemCapabilities} from "../../ui/finance/LedgerItem";
import type {TransactionRowAction} from "../../ui/finance/TransactionRow";
import {Button} from "../../ui/controls/Button";
import {useLayoutEffect, useRef, type ReactNode, type RefObject} from "react";

export function TransactionsLedgerSection({
  statisticsAttribution,
  savedViewsSlot,
  privateAmounts,
  filterValues,
  filterOptions,
  activeFilters,
  onChange,
  onRemoveFilter,
  onClear,
  onClearEmpty,
  emptyActionLabel,
  hasClearableFilters,
  selectionMode,
  selectionAvailable,
  onToggleSelection,
  selectionToggleRef,
  selectedCount,
  selectionActions,
  bulkCategoryOpen,
  bulkCategories,
  bulkCategory,
  setBulkCategory,
  applyBulkCategory,
  bulkCategoryFeedback,
  bulkCategoryPending,
  actionFeedback,
  pendingActionIds,
  ledgerSummary,
  loadError,
  onRetry,
  payload,
  ledgerItems,
  contextDetailFor,
  capabilitiesFor,
  selectedLedgerIds,
  onSelect,
  onAction,
  onOpenAttachments,
  itemFrom,
  itemTo,
  onPrevious,
  onNext,
  onPageChange,
}: {
  statisticsAttribution: string;
  savedViewsSlot?: ReactNode;
  privateAmounts: boolean;
  filterValues: LedgerFilterValues;
  filterOptions: Readonly<{
    kinds: readonly LedgerFilterOption[];
    accounts: readonly LedgerFilterOption[];
    categories: readonly LedgerFilterOption[];
    sources: readonly LedgerFilterOption[];
  }>;
  activeFilters: readonly LedgerActiveFilter[];
  onChange: (key: LedgerFilterKey, value: string) => void;
  onRemoveFilter: (key: LedgerFilterKey) => void;
  onClear: () => void;
  onClearEmpty: () => void;
  emptyActionLabel: string;
  hasClearableFilters: boolean;
  selectionMode: boolean;
  selectionAvailable: boolean;
  onToggleSelection: () => void;
  selectionToggleRef: RefObject<HTMLButtonElement | null>;
  selectedCount: number;
  selectionActions: readonly SelectionToolbarAction[];
  bulkCategoryOpen: boolean;
  bulkCategories: readonly CategoryComboboxOption[];
  bulkCategory: string;
  setBulkCategory: (value: string) => void;
  applyBulkCategory: (value: string) => Promise<boolean>;
  bulkCategoryFeedback: {kind: "status" | "error"; message: string} | null;
  bulkCategoryPending: boolean;
  actionFeedback: {id: string; kind: "status" | "error"; message: string} | null;
  pendingActionIds: ReadonlySet<string>;
  ledgerSummary: {period: string; income: number; expense: number; net: number; excluded?: number};
  loadError: string;
  onRetry: () => void;
  payload: TransactionListPayload | null;
  ledgerItems: readonly LedgerItem[];
  contextDetailFor: (item: LedgerItem) => string | undefined;
  capabilitiesFor: (item: LedgerItem) => LedgerItemCapabilities;
  selectedLedgerIds: readonly string[];
  onSelect: (id: string, shiftKey?: boolean) => void;
  onAction: (id: string, action: TransactionRowAction) => void;
  onOpenAttachments: (id: string) => void;
  itemFrom: number;
  itemTo: number;
  onPrevious: () => void;
  onNext: () => void;
  onPageChange: (page: number) => void;
}) {
  const resultsRef = useRef<HTMLDivElement>(null);
  const bulkCategoryAnchorTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (selectionMode || !bulkCategoryFeedback || bulkCategoryAnchorTop.current === null) return;
    const firstRow = resultsRef.current?.querySelector<HTMLElement>(".ui-statement-ledger__row");
    if (firstRow) {
      const {top, height} = firstRow.getBoundingClientRect();
      const delta = top - bulkCategoryAnchorTop.current;
      if (height > 0 && Math.abs(delta) > 1) window.scrollBy(0, delta);
    }
    bulkCategoryAnchorTop.current = null;
  }, [bulkCategoryFeedback, selectionMode]);
  const filterSlot = <>
    {savedViewsSlot}
    {statisticsAttribution ? <div className="transactions-report-filter-lock">
      <SectionHeader title="Filtros fijados por Estadísticas" detail="Este conjunto conserva exactamente la atribución mostrada. Quita el criterio estadístico para usar búsqueda, cuenta, tipo, origen o categorías normales." />
    </div> : <LedgerFilterStrip
      values={filterValues}
      options={filterOptions}
      activeFilters={activeFilters}
      locked={selectionMode}
      onChange={onChange}
      onRemoveFilter={onRemoveFilter}
      onClear={onClear}
    />}
  </>;
  const selectionSlot = selectionMode || selectionAvailable || payload ? <SelectionToolbar
    selectionMode={selectionMode}
    selectionAvailable={selectionAvailable}
    onToggleSelection={onToggleSelection}
    selectionToggleRef={selectionToggleRef}
    selectedCount={selectedCount}
    actions={selectionActions}
    feedback={bulkCategoryFeedback}
  >
    {bulkCategoryOpen ? <div className="ui-selection-toolbar__bulk-control" role="group" aria-label="Categorizar selección">
      <CategoryCombobox categories={bulkCategories} value={bulkCategory} onChange={setBulkCategory} />
      <Button variant="secondary" aria-disabled={!bulkCategory || bulkCategoryPending || undefined} aria-busy={bulkCategoryPending || undefined} onClick={(event) => {
        event.currentTarget.focus({preventScroll: true});
        if (bulkCategory && !bulkCategoryPending) {
          bulkCategoryAnchorTop.current = resultsRef.current?.querySelector<HTMLElement>(".ui-statement-ledger__row")?.getBoundingClientRect().top ?? null;
          void applyBulkCategory(bulkCategory);
        }
      }}>Aplicar categoría</Button>
    </div> : null}
  </SelectionToolbar> : null;
  const results = (
    <>
      {!payload && loadError ? <LedgerErrorState message={loadError} onRetry={onRetry} /> : null}
      {!payload && !loadError ? <LedgerLoadingState /> : null}
      {payload && !ledgerItems.length ? <LedgerEmptyState title="No hay movimientos para mostrar." action={hasClearableFilters ? {label: emptyActionLabel, onAction: onClearEmpty} : undefined} /> : null}
      {pendingActionIds.size ? <div className="sr-status" role="status" aria-live="polite" aria-atomic="true">Actualizando el movimiento. La fila permanece disponible mientras se completa la acción.</div> : null}
      {payload && ledgerItems.length ? <StatementLedger
        items={ledgerItems}
        pendingActionIds={pendingActionIds}
        actionFeedback={actionFeedback}
        keepActionMenuOpen
        capabilitiesFor={capabilitiesFor}
        privateAmounts={privateAmounts}
        selectionMode={selectionMode}
        selectedIds={selectedLedgerIds}
        onSelect={onSelect}
        onAction={onAction}
        onOpenAttachments={onOpenAttachments}
        contextDetailFor={contextDetailFor}
      /> : null}
      {payload && loadError ? <LedgerErrorState message={`${loadError} Se muestran los resultados anteriores.`} onRetry={onRetry} /> : null}
    </>
  );
  const pagination = payload && ledgerItems.length > 0 && payload.num_pages > 1 ? <LedgerPagination
    page={payload.page}
    numPages={payload.num_pages}
    itemFrom={itemFrom}
    itemTo={itemTo}
    totalItems={payload.count}
    hasPrevious={payload.has_previous}
    hasNext={payload.has_next}
    onPrevious={onPrevious}
    onNext={onNext}
    onPageChange={onPageChange}
  /> : null;

  return <LedgerArchetype
    header={payload ? <LedgerHeader summary={ledgerSummary} privateAmounts={privateAmounts} /> : null}
    selection={selectionSlot}
    filterSlot={filterSlot}
    results={results}
    resultsRef={resultsRef}
    pagination={pagination}
  />;
}
