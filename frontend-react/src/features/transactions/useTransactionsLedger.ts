import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {displayEuro, formatDate, formatMonth} from "../../format";
import type {BootstrapPayload} from "../../shared/model/bootstrap";
import type {Transaction} from "../../shared/model/transactions";
import {transactionsApi as api} from "./api";
import type {LedgerActiveFilter, LedgerFilterOption} from "../../ui/finance/LedgerFilterStrip";
import type {LedgerItem, LedgerItemCapabilities} from "../../ui/finance/LedgerItem";
import type {SelectionToolbarAction} from "../../ui/finance/SelectionToolbar";
import type {TransactionRowAction} from "../../ui/finance/TransactionRow";
import type {CategoryComboboxOption} from "../../ui/finance/CategoryCombobox";
import {toLedgerCapabilities, toLedgerItem} from "./ledgerAdapter";
import type {TransactionListPayload} from "./types";
import type {AllocationPayload} from "./TransactionAllocationEditor";

function periodLabel(month: string, dateFrom: string, dateTo: string) {
  if (month) return formatMonth(month).replace(/^./, (letter) => letter.toUpperCase());
  if (dateFrom || dateTo) return `${dateFrom ? formatDate(dateFrom) : "Inicio"} – ${dateTo ? formatDate(dateTo) : "Hoy"}`;
  return "Todos los periodos";
}

export function useTransactionsLedger({
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
}: {
  payload: TransactionListPayload | null;
  bootstrap: BootstrapPayload;
  query: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  kind: string;
  account: string;
  category: string;
  source: string;
  analytics: string;
  categoryFamily: string;
  statisticsAttribution: string;
  privateAmounts: boolean;
  selectedIds: number[];
  selectedMovements: Transaction[];
  selectionCanCategorize: boolean;
  clear: () => void;
  setBulkCategory: (value: string) => void;
  setBulkCategoryOpen: (value: boolean) => void;
  setEditing: (value: Transaction | null) => void;
  setSelectionMode: (value: boolean) => void;
  setShowManual: (value: boolean) => void;
  setShowTransfer: (value: boolean) => void;
  setAttachmentMovement: (value: Transaction | null) => void;
  refresh: () => Promise<void>;
  setStatus: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [actionFeedback, setActionFeedback] = useState<{id: string; kind: "status" | "error"; message: string} | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<ReadonlySet<string>>(new Set());
  const pendingActionIdsRef = useRef(new Set<string>());
  const [bulkCategoryFeedback, setBulkCategoryFeedback] = useState<{kind: "status" | "error"; message: string} | null>(null);
  const [bulkCategoryPending, setBulkCategoryPending] = useState(false);
  const bulkCategoryPendingRef = useRef(false);
  const [allocationEditing, setAllocationEditing] = useState<Transaction | null>(null);
  const allocationSessionRef = useRef(0);
  const allocationFocusReturnRef = useRef<{movementId: number; session: number} | null>(null);
  const allocationMountedRef = useRef(false);
  const allocationSession = allocationSessionRef.current;
  useEffect(() => {
    allocationMountedRef.current = true;
    return () => {
      allocationMountedRef.current = false;
      allocationSessionRef.current += 1;
    };
  }, []);
  useLayoutEffect(() => {
    const pending = allocationFocusReturnRef.current;
    if (allocationEditing || !pending) return;
    allocationFocusReturnRef.current = null;
    if (!allocationMountedRef.current || allocationSessionRef.current !== pending.session) return;
    const current = document.activeElement;
    if (current !== document.body && current instanceof HTMLElement && current.isConnected && current.id !== "main-content") return;
    const row = document.querySelector<HTMLElement>(`[data-ledger-item-id="${pending.movementId}"]`);
    const opener = row?.querySelector<HTMLElement>("[data-transaction-allocate]") || row?.querySelector<HTMLElement>(".ui-overflow-menu__trigger");
    const fallback = opener || document.querySelector<HTMLElement>("[data-transaction-allocate]") || document.querySelector<HTMLElement>(".ui-overflow-menu__trigger") || document.getElementById("main-content");
    fallback?.focus({preventScroll: true});
  }, [allocationEditing]);
  const filterValues = {query, month, dateFrom, dateTo, kind, account, category, source, analytics};
  const filterOptions: Readonly<{
    kinds: readonly LedgerFilterOption[];
    accounts: readonly LedgerFilterOption[];
    categories: readonly LedgerFilterOption[];
    sources: readonly LedgerFilterOption[];
  }> = {
    kinds: payload?.filters.kinds || [],
    accounts: bootstrap.accounts.map((item) => ({value: String(item.id), label: item.name})),
    categories: bootstrap.categories.map((item) => ({value: String(item.id), label: item.display_name})),
    sources: payload?.filters.sources || [],
  };
  const activeFilters = useMemo<LedgerActiveFilter[]>(() => {
    const kindLabel = payload?.filters.kinds.find((item) => item.value === kind)?.label || kind;
    const accountLabel = bootstrap.accounts.find((item) => String(item.id) === account)?.name || account;
    const categoryLabel = bootstrap.categories.find((item) => String(item.id) === category)?.display_name || category;
    const sourceLabel = payload?.filters.sources.find((item) => item.value === source)?.label || source;
    return [
      query ? {key: "query", label: "Búsqueda", value: query} : null,
      month ? {key: "month", label: "Mes", value: periodLabel(month, "", "")} : null,
      dateFrom ? {key: "dateFrom", label: "Desde", value: formatDate(dateFrom)} : null,
      dateTo ? {key: "dateTo", label: "Hasta", value: formatDate(dateTo)} : null,
      kind ? {key: "kind", label: "Tipo", value: kindLabel} : null,
      account ? {key: "account", label: "Cuenta", value: accountLabel} : null,
      category ? {key: "category", label: "Categoría", value: categoryLabel} : null,
      source ? {key: "source", label: "Origen", value: sourceLabel} : null,
      analytics !== "all" ? {key: "analytics", label: "Base", value: analytics === "included" ? "Solo analíticas" : "Solo excluidas"} : null,
    ].filter((item): item is LedgerActiveFilter => Boolean(item));
  }, [account, analytics, bootstrap.accounts, bootstrap.categories, category, dateFrom, dateTo, kind, month, payload?.filters.kinds, payload?.filters.sources, query, source]);

  const ledgerItems = useMemo(() => payload?.results.map(toLedgerItem) || [], [payload]);
  const contextDetailsById = useMemo(() => new Map((payload?.results || []).map((transaction) => {
    const attribution = transaction.statistics_attribution;
    const contextDetail = statisticsAttribution && attribution
      ? [
        `${displayEuro(attribution.applied_amount, privateAmounts)} aplicado al gasto original`,
        attribution.extra_income ? `${displayEuro(attribution.extra_income, privateAmounts)} tratado como ingreso` : "",
      ].filter(Boolean).join(" · ")
      : undefined;
    return [String(transaction.id), contextDetail] as const;
  })), [payload, privateAmounts, statisticsAttribution]);
  const contextDetailFor = (item: LedgerItem) => contextDetailsById.get(item.id);
  const transactionsById = useMemo(() => new Map((payload?.results || []).map((item) => [String(item.id), item])), [payload]);
  const selectedLedgerIds = selectedIds.map(String);
  const bulkCategories: readonly CategoryComboboxOption[] = selectedMovements.length
    ? bootstrap.categories.filter((item) => item.kind === selectedMovements[0].kind).map((item) => ({id: item.id, label: item.display_name}))
    : [];
  const summary = payload?.summary || {income: 0, expense: 0, net: 0, excluded: 0, count: 0};
  const ledgerSummary = {
    period: periodLabel(month, dateFrom, dateTo),
    income: summary.income,
    expense: -Math.abs(summary.expense),
    net: summary.net,
    excluded: summary.excluded,
  };
  const hasClearableFilters = Boolean(
    query || month || dateFrom || dateTo || kind || account || category || categoryFamily || source ||
    analytics !== "all" || statisticsAttribution,
  );
  const itemFrom = payload?.count ? (payload.page - 1) * payload.page_size + 1 : 0;
  const itemTo = payload?.count ? Math.min(payload.page * payload.page_size, payload.count) : 0;
  const selectionActions = useMemo<SelectionToolbarAction[]>(() => {
    if (!selectedIds.length) return [];
    return [
      {
        id: "categorise",
        label: "Categorizar",
        available: selectionCanCategorize,
        reason: "La selección contiene un traspaso, una compra repartida o tipos incompatibles.",
        onAction: () => setBulkCategoryOpen(true),
      },
      {
        id: "export",
        label: "Exportar",
        available: true,
        onAction: () => { window.location.href = `/exportar/excel/?transaction_ids=${selectedIds.join(",")}`; },
      },
    ];
  }, [selectedIds, selectionCanCategorize, setBulkCategoryOpen]);

  const leaveSelection = () => {
    clear();
    setSelectionMode(false);
    setBulkCategory("");
    setBulkCategoryOpen(false);
  };

  const closeAllocationEditor = () => {
    if (allocationSessionRef.current !== allocationSession) return;
    const movementId = allocationEditing?.id;
    const activeElement = document.activeElement;
    const shouldRestoreFocus = activeElement === document.body ||
      activeElement === document.getElementById("main-content") ||
      !(activeElement instanceof HTMLElement) ||
      !activeElement.isConnected ||
      Boolean(activeElement.closest(".transaction-allocation-form"));
    allocationSessionRef.current += 1;
    const closedSession = allocationSessionRef.current;
    allocationFocusReturnRef.current = shouldRestoreFocus && movementId !== undefined ? {movementId, session: closedSession} : null;
    setAllocationEditing(null);
  };

  const saveAllocationParts = async (movement: Transaction, allocations: AllocationPayload, expectedRevision: number) => {
    const isCurrentSession = () => allocationMountedRef.current && allocationSessionRef.current === allocationSession && allocationEditing?.id === movement.id;
    if (!isCurrentSession()) throw new Error("La distribución cambió; vuelve a abrir el movimiento.");
    await api.updateTransaction(movement.id, {
      allocations,
      expected_allocation_revision: expectedRevision,
    });
    if (!isCurrentSession()) {
      if (allocationMountedRef.current) await Promise.allSettled([refresh(), onChanged()]);
      return;
    }
    setStatus("Distribución actualizada.");
    try {
      await Promise.all([refresh(), onChanged()]);
    } catch {
      if (isCurrentSession()) setStatus("La distribución se guardó, pero no se pudieron actualizar todos los resultados.");
    }
    if (isCurrentSession()) closeAllocationEditor();
  };

  const applyBulkCategory = async (bulkCategory: string): Promise<boolean> => {
    if (!bulkCategory || !selectionCanCategorize || bulkCategoryPendingRef.current) return false;
    const transactionIds = [...selectedIds];
    bulkCategoryPendingRef.current = true;
    setBulkCategoryPending(true);
    setBulkCategoryFeedback(null);
    try {
      await api.bulkCategory(transactionIds, Number(bulkCategory));
    } catch (exc) {
      setBulkCategoryFeedback({kind: "error", message: exc instanceof Error ? exc.message : "No se pudieron categorizar los movimientos."});
      bulkCategoryPendingRef.current = false;
      setBulkCategoryPending(false);
      return false;
    }
    setBulkCategoryFeedback({kind: "status", message: `${transactionIds.length} movimientos recategorizados.`});
    leaveSelection();
    try {
      await Promise.all([refresh(), onChanged()]);
    } catch {
      setBulkCategoryFeedback({kind: "error", message: "Los movimientos se recategorizaron, pero no se pudieron actualizar todos los datos."});
    } finally {
      bulkCategoryPendingRef.current = false;
      setBulkCategoryPending(false);
    }
    return true;
  };

  const handleLedgerAction = async (id: string, action: TransactionRowAction) => {
    const movement = transactionsById.get(id);
    if (!movement) return;
    if (action === "edit") {
      setEditing(movement);
      setShowManual(true);
      return;
    }
    if (action === "allocate") {
      setEditing(null);
      setShowManual(false);
      setShowTransfer(false);
      allocationFocusReturnRef.current = null;
      allocationSessionRef.current += 1;
      setAllocationEditing(movement);
      return;
    }
    if (pendingActionIdsRef.current.has(id)) return;
    pendingActionIdsRef.current.add(id);
    setPendingActionIds((current) => new Set(current).add(id));
    setActionFeedback(null);
    try {
      if (action === "archive") {
        await api.archiveTransaction(movement.id);
        setActionFeedback({id, kind: "status", message: "Movimiento archivado."});
      } else {
        await api.reopenTransaction(movement.id);
        setActionFeedback({id, kind: "status", message: "Movimiento reabierto para revisión."});
      }
      try {
        await Promise.all([refresh(), onChanged()]);
      } catch {
        setActionFeedback({id, kind: "error", message: action === "archive"
          ? "Movimiento archivado, pero no se pudieron actualizar los resultados."
          : "Movimiento reabierto, pero no se pudieron actualizar los resultados."});
      }
    } catch (exc) {
      setActionFeedback({id, kind: "error", message: exc instanceof Error ? exc.message : action === "archive" ? "No se pudo archivar el movimiento." : "No se pudo reabrir el movimiento."});
    } finally {
      pendingActionIdsRef.current.delete(id);
      setPendingActionIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const capabilitiesFor = (item: LedgerItem): LedgerItemCapabilities => {
    const movement = transactionsById.get(item.id);
    return movement ? toLedgerCapabilities(movement) : {edit: false, archive: false, reopen: false, allocate: false};
  };

  const handleOpenAttachments = (id: string) => {
    const movement = transactionsById.get(id);
    if (movement?.attachments.length) setAttachmentMovement(movement);
  };

  return {
    filterValues,
    filterOptions,
    activeFilters,
    ledgerItems,
    contextDetailFor,
    selectedLedgerIds,
    bulkCategories,
    ledgerSummary,
    hasClearableFilters,
    itemFrom,
    itemTo,
    selectionActions,
    leaveSelection,
    applyBulkCategory,
    bulkCategoryFeedback,
    clearBulkCategoryFeedback: () => setBulkCategoryFeedback(null),
    bulkCategoryPending,
    capabilitiesFor,
    actionFeedback,
    pendingActionIds,
    allocationEditing,
    allocationSessionId: allocationSession,
    closeAllocationEditor,
    saveAllocationParts,
    handleLedgerAction,
    handleOpenAttachments,
  };
}
