import {useEffect, useLayoutEffect, useRef, useState, useTransition, type FocusEvent} from "react";
import {useReducedMotion} from "motion/react";
import {ApiError, hasFreshPrefetchedGet} from "../../shared/api/client";
import {transactionsApi as api} from "./api";
import {StatusBanner} from "../../shared/components/ui";
import type {BootstrapPayload, OptionsPayload} from "../../shared/model/bootstrap";
import type {Transaction} from "../../shared/model/transactions";
import type {TransactionListPayload} from "./types";
import {TransactionComposers} from "./TransactionComposers";
import {TransactionsStatisticsContext} from "./TransactionsStatisticsContext";
import {buildTransactionParams, transactionFormData} from "./transactionModel";
import {useTransactionSelection} from "./useTransactionSelection";
import {useTransactionsLedger} from "./useTransactionsLedger";
import {useTransactionFilters} from "./useTransactionFilters";
import {TransactionsLedgerSection} from "./TransactionsLedgerSection";
import {SavedTransactionViewsPanel} from "./SavedTransactionViewsPanel";
import {TransactionAttachmentsDialog} from "./TransactionAttachmentsDialog";
import {PageHeader} from "../../ui/layout/PageHeader";

export function TransactionsView({
  options,
  bootstrap,
  onChanged,
  openComposerToken = 0,
  privateAmounts = false,
  isActive = true,
  routeKey = "",
  onOpenSavedView,
}: {
  options: OptionsPayload;
  bootstrap: BootstrapPayload;
  onChanged: () => Promise<void>;
  openComposerToken?: number;
  privateAmounts?: boolean;
  isActive?: boolean;
  routeKey?: string;
  onOpenSavedView?: (search: URLSearchParams) => void;
}) {
  const [payload, setPayload] = useState<TransactionListPayload | null>(null);
  const {
    query, effectiveQuery, month, dateFrom, dateTo, kind, account, category,
    categoryFamily, source, analytics, statisticsAttribution, page,
    setMonth, setDateFrom, setDateTo, setKind, setAccount, setCategory,
    setCategoryFamily, setSource, setAnalytics, setStatisticsAttribution, setPage,
    currentFilters, changeFilter, clearFilters, clearStatisticsContext,
  } = useTransactionFilters({isActive, routeKey});
  const [reloadToken, setReloadToken] = useState(0);
  const [showManual, setShowManual] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [attachmentMovement, setAttachmentMovement] = useState<Transaction | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string[]> | undefined>();
  const [transferErrors, setTransferErrors] = useState<Record<string, string[]> | undefined>();
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();
  const [isLoading, setIsLoading] = useState(true);
  const transactionRequest = useRef(0);
  const lastSuccessfulRequestKey = useRef("");
  const ledgerViewRef = useRef<HTMLDivElement>(null);
  const selectionToggleRef = useRef<HTMLButtonElement>(null);
  const focusedLedgerId = useRef<string | null>(null);
  const previousLedgerIds = useRef<string[]>([]);

  useEffect(() => {
    const requestId = ++transactionRequest.current;
    const params = buildTransactionParams(currentFilters());
    const requestKey = params.toString();
    if (isActive && lastSuccessfulRequestKey.current === requestKey && hasFreshPrefetchedGet(`/api/transactions/?${requestKey}`)) {
      setIsLoading(false);
      return;
    }
    setLoadError("");
    setIsLoading(true);
    api.transactions(params)
      .then((data) => {
        if (requestId === transactionRequest.current) {
          lastSuccessfulRequestKey.current = requestKey;
          startTransition(() => setPayload(data));
        }
      })
      .catch((exc) => {
        if (requestId === transactionRequest.current) setLoadError(exc instanceof Error ? exc.message : "No se pudieron cargar los movimientos.");
      })
      .finally(() => {
        if (requestId === transactionRequest.current) setIsLoading(false);
      });
  }, [account, analytics, category, categoryFamily, dateFrom, dateTo, effectiveQuery, isActive, kind, month, page, reloadToken, source, statisticsAttribution]);
  useEffect(() => {
    if (!openComposerToken) return;
    setEditing(null);
    setShowManual(true);
  }, [openComposerToken]);
  const refresh = async () => {
    const params = buildTransactionParams(currentFilters());
    const requestKey = params.toString();
    const requestId = ++transactionRequest.current;
    setIsLoading(true);
    setLoadError("");
    try {
      const data = await api.transactions(params);
      if (requestId === transactionRequest.current) {
        lastSuccessfulRequestKey.current = requestKey;
        setPayload(data);
      }
    } catch (exc) {
      if (requestId === transactionRequest.current) setLoadError(exc instanceof Error ? exc.message : "No se pudieron actualizar los movimientos.");
      throw exc;
    } finally {
      if (requestId === transactionRequest.current) setIsLoading(false);
    }
  };
  const {selectedIds, selectedMovements, canCategorize: selectionCanCategorize, selectById, clear} = useTransactionSelection(payload?.results || []);

  useEffect(() => {
    clear();
    setSelectionMode(false);
    setBulkCategory("");
    setBulkCategoryOpen(false);
  }, [account, analytics, category, categoryFamily, dateFrom, dateTo, effectiveQuery, kind, month, page, source, statisticsAttribution, clear]);
  const familyCategory = categoryFamily && categoryFamily !== "uncategorized"
    ? bootstrap.categories.find((item) => item.id === Number(categoryFamily))
    : null;
  const directCategory = category ? bootstrap.categories.find((item) => item.id === Number(category)) : null;
  const statisticalContext = Boolean(statisticsAttribution) || Boolean(categoryFamily);
  const contextScope = categoryFamily
    ? categoryFamily === "uncategorized" ? "Sin categoría" : familyCategory?.display_name || `#${categoryFamily}`
    : directCategory ? directCategory.display_name : null;
  const ledger = useTransactionsLedger({
    payload,
    bootstrap,
    query,
    month,
    dateFrom,
    dateTo,
    kind,
    account,
    category,
    source,
    analytics,
    categoryFamily,
    statisticsAttribution,
    privateAmounts,
    selectedIds,
    selectedMovements,
    selectionCanCategorize,
    clear,
    setBulkCategory,
    setBulkCategoryOpen,
    setEditing,
    setSelectionMode,
    setShowManual,
    setShowTransfer,
    setAttachmentMovement,
    refresh,
    setStatus,
    onChanged,
  });
  useEffect(() => {
    if (!showManual && !showTransfer && !ledger.allocationEditing) return;
    const frame = window.requestAnimationFrame(() => ledgerViewRef.current?.querySelector<HTMLElement>(".transaction-composer-open")?.scrollIntoView?.({block: "nearest", behavior: reduceMotion ? "auto" : "smooth"}));
    return () => window.cancelAnimationFrame(frame);
  }, [editing, ledger.allocationEditing, reduceMotion, showManual, showTransfer]);
  const actionFeedbackVisible = Boolean(ledger.actionFeedback && ledger.ledgerItems.some((item) => item.id === ledger.actionFeedback?.id));
  const actionAnnouncement = ledger.actionFeedback && !actionFeedbackVisible ? ledger.actionFeedback : null;
  const trackLedgerFocus = (event: FocusEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-ledger-item-id]");
    focusedLedgerId.current = row?.dataset.ledgerItemId || null;
  };
  const trackLedgerBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof HTMLElement) || nextTarget === document.body) return;
    if (!event.currentTarget.contains(nextTarget)) {
      focusedLedgerId.current = null;
      return;
    }
    const row = nextTarget.closest<HTMLElement>("[data-ledger-item-id]");
    focusedLedgerId.current = row?.dataset.ledgerItemId || null;
  };
  useLayoutEffect(() => {
    const currentIds = ledger.ledgerItems.map(({id}) => String(id));
    const focusedId = focusedLedgerId.current;
    const activeRow = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-ledger-item-id]")
      : null;
    if (focusedId && (!currentIds.includes(focusedId) || activeRow?.dataset.ledgerItemId !== focusedId)) {
      const previousIndex = previousLedgerIds.current.indexOf(focusedId);
      const nextId = currentIds[Math.min(Math.max(previousIndex, 0), currentIds.length - 1)] || currentIds[previousIndex - 1] || null;
      const rows = Array.from(ledgerViewRef.current?.querySelectorAll<HTMLElement>("[data-ledger-item-id]") || []);
      const nextRow = rows.find((row) => row.dataset.ledgerItemId === nextId);
      const target = nextRow || ledgerViewRef.current?.querySelector<HTMLElement>(".ui-ledger-state--empty");
      target?.focus({preventScroll: true});
      focusedLedgerId.current = nextRow?.dataset.ledgerItemId || null;
    }
    previousLedgerIds.current = currentIds;
  }, [ledger.ledgerItems]);
  return (
    <div ref={ledgerViewRef} onFocusCapture={trackLedgerFocus} onBlurCapture={trackLedgerBlur} className="view-stack transactions-page" aria-busy={isLoading || isPending} data-screen-ready={payload ? "true" : "false"}>
      <PageHeader title="Movimientos" description={loadError && payload ? "No se pudo actualizar el listado; se mantienen los resultados anteriores." : isLoading && payload ? "Actualizando resultados…" : payload ? `${payload.count} resultados en el registro` : "Consulta, filtra y registra movimientos."} />
      <div className="sr-status" role={actionAnnouncement?.kind === "error" ? "alert" : "status"} aria-live={actionAnnouncement?.kind === "error" ? "assertive" : "polite"} aria-atomic="true">{ledger.pendingActionIds.size ? "Actualizando el movimiento. La fila permanece disponible mientras se completa la acción." : actionAnnouncement?.message || (isLoading && payload ? "Actualizando movimientos. Los resultados anteriores permanecen visibles." : loadError && payload ? "No se pudieron actualizar los movimientos. Se mantienen los resultados anteriores." : "")}</div>
      {status ? <StatusBanner message={status} /> : null}
      {statisticalContext ? (
        <TransactionsStatisticsContext
          payload={payload}
          privateAmounts={privateAmounts}
          statisticsAttribution={statisticsAttribution}
          contextScope={contextScope}
          onClear={() => {
            setPage(1);
            setCategoryFamily("");
            setStatisticsAttribution("");
          }}
        />
      ) : null}
      <TransactionComposers
        options={options}
        accounts={bootstrap.accounts}
        categories={bootstrap.categories}
        editing={editing}
        allocationEditing={ledger.allocationEditing}
        allocationSessionId={ledger.allocationSessionId}
        showManual={showManual}
        showTransfer={showTransfer}
        formErrors={formErrors}
        transferErrors={transferErrors}
        onToggleManual={() => {setShowManual((value) => !value); setEditing(null);}}
        onToggleTransfer={() => setShowTransfer((value) => !value)}
        onCloseAllocation={ledger.closeAllocationEditor}
        onSaveAllocations={ledger.saveAllocationParts}
        onSubmitTransaction={async (input) => {
          try {
            setFormErrors(undefined);
            if (editing) {
              await api.updateTransaction(editing.id, input);
              setStatus("Movimiento actualizado.");
            } else {
              if (input.attachment) {
                await api.createTransactionWithAttachment(transactionFormData(input));
              } else {
                await api.createTransaction(input);
              }
              setStatus("Movimiento creado.");
            }
            setEditing(null);
            setShowManual(false);
            await Promise.all([refresh(), onChanged()]);
          } catch (exc) {
            if (exc instanceof ApiError) setFormErrors(exc.errors);
            throw exc;
          }
        }}
        onSubmitTransfer={async (input) => {
          try {
            setTransferErrors(undefined);
            await api.createTransfer(input);
            setStatus("Traspaso registrado.");
            setShowTransfer(false);
            await Promise.all([refresh(), onChanged()]);
          } catch (exc) {
            if (exc instanceof ApiError) setTransferErrors(exc.errors);
            throw exc;
          }
        }}
      />
      <TransactionAttachmentsDialog movement={attachmentMovement} onClose={() => setAttachmentMovement(null)} />
      <TransactionsLedgerSection
        statisticsAttribution={statisticsAttribution}
        savedViewsSlot={<SavedTransactionViewsPanel filters={{...currentFilters(), query}} bootstrap={bootstrap} canSave={!statisticalContext && !selectionMode} onOpenView={onOpenSavedView} disabled={selectionMode} />}
        privateAmounts={privateAmounts} filterValues={ledger.filterValues} filterOptions={ledger.filterOptions} activeFilters={ledger.activeFilters}
        onChange={changeFilter} onRemoveFilter={(key) => changeFilter(key, key === "analytics" ? "all" : "")} onClear={clearFilters}
        onClearEmpty={statisticalContext ? clearStatisticsContext : clearFilters}
        emptyActionLabel={statisticalContext ? "Quitar filtro de Estadísticas" : "Limpiar filtros"}
        hasClearableFilters={ledger.hasClearableFilters}
        selectionMode={selectionMode && Boolean(payload)} selectionAvailable={Boolean(payload?.count)} selectionToggleRef={selectionToggleRef} onToggleSelection={() => {
          ledger.clearBulkCategoryFeedback();
          selectionMode ? ledger.leaveSelection() : setSelectionMode(true);
        }}
        selectedCount={selectedIds.length} selectionActions={ledger.selectionActions} bulkCategoryOpen={bulkCategoryOpen} bulkCategories={ledger.bulkCategories}
        bulkCategory={bulkCategory} setBulkCategory={setBulkCategory} applyBulkCategory={ledger.applyBulkCategory} bulkCategoryFeedback={ledger.bulkCategoryFeedback} bulkCategoryPending={ledger.bulkCategoryPending} ledgerSummary={ledger.ledgerSummary}
        actionFeedback={ledger.actionFeedback} pendingActionIds={ledger.pendingActionIds}
        loadError={loadError} onRetry={() => setReloadToken((value) => value + 1)} payload={payload} ledgerItems={ledger.ledgerItems}
        capabilitiesFor={ledger.capabilitiesFor} selectedLedgerIds={ledger.selectedLedgerIds} onSelect={(id, shiftKey = false) => selectById(Number(id), shiftKey)}
        onAction={ledger.handleLedgerAction} onOpenAttachments={ledger.handleOpenAttachments} contextDetailFor={ledger.contextDetailFor} itemFrom={ledger.itemFrom} itemTo={ledger.itemTo}
        onPrevious={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(payload?.num_pages || 1, value + 1))} onPageChange={setPage}
      />
    </div>
  );
}
