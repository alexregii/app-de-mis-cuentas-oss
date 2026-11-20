import {useCallback, useEffect, useId, useRef, useState} from "react";
import {AlertTriangle, ChevronDown, List, WandSparkles} from "lucide-react";
import {ViewLoadError} from "../../shared/components/ViewLoadError";
import {ErrorBanner} from "../../shared/components/ui";
import type {Connection} from "../../shared/model/accounts";
import {BankReviewPanel} from "./BankReviewPanel";
import {CsvReviewPanel} from "./CsvReviewPanel";
import {useReviewData} from "./useReviewData";
import type {ReviewQueueFilter} from "./reviewQueueFilter";
import {PageHeader} from "../../ui/layout/PageHeader";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {Button} from "../../ui/controls/Button";
import {OverflowMenu, OverflowMenuItem} from "../../ui/controls/OverflowMenu";

type ReviewSyncState = "synced" | "syncing" | "error" | "idle";

function getReviewSyncState(connections: Connection[], syncingBank: boolean): ReviewSyncState {
  if (syncingBank || connections.some((connection) => connection.sync_status === "syncing")) return "syncing";
  const hasConnectionError = connections.some((connection) => (
    Boolean(connection.last_error)
    || connection.sync_status === "error"
    || connection.sync_status === "failed"
    || connection.status === "needs_reconnect"
    || connection.status === "reconnect_required"
    || connection.status === "disconnected"
  ));
  if (hasConnectionError) return "error";
  return connections.some((connection) => !connection.last_synced_at) ? "idle" : "synced";
}

export function ReviewView({connections, privateAmounts = false, isActive = true, routeKey = "", onOpenBankConnections, navigateToSettings = () => undefined}: {connections: Connection[]; privateAmounts?: boolean; isActive?: boolean; routeKey?: string; onOpenBankConnections?: () => void; navigateToSettings?: (search: URLSearchParams) => void}) {
  const review = useReviewData(connections, isActive);
  const [filter, setFilter] = useState<ReviewQueueFilter>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [selectionActionsTarget, setSelectionActionsTarget] = useState<HTMLDivElement | null>(null);
  const clearSelection = useCallback(() => {
    review.setSelectedBankRows([]);
    review.setSelectedCsvRows([]);
  }, [review.setSelectedBankRows, review.setSelectedCsvRows]);
  const changeFilter = useCallback((next: ReviewQueueFilter) => {
    setFilter(next);
    setSelectionMenuOpen(false);
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);
  useEffect(() => {
    if (!isActive) return;
    const focus = new URL(routeKey || window.location.href).searchParams.get("focus");
    if (focus === "csv-import") {
      review.setCsvExpanded(true);
      return;
    }
    if (focus === "bank-review") changeFilter("all");
    else if (focus === "csv-review") {
      changeFilter("all");
      review.setCsvExpanded(true);
    } else if (focus === "review-attention") {
      changeFilter("attention");
      review.setCsvExpanded(true);
    }

    const targetId = focus === "bank-review"
      ? "review-bank-workspace"
      : focus === "csv-review"
        ? "review-csv-workspace"
        : focus === "review-attention" ? "review-workspace" : "";
    if (!targetId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.focus({preventScroll: true});
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({block: "start"});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [changeFilter, isActive, routeKey, review.setCsvExpanded]);
  const selectionTriggerRef = useRef<HTMLSpanElement>(null);
  const selectionControlsRef = useRef<HTMLDivElement>(null);
  const selectionMenuId = useId();
  const exitSelection = () => {
    setSelectionMenuOpen(false);
    clearSelection();
    setSelectionMode(false);
  };
  const toggleSelection = () => {
    if (selectionMode) exitSelection();
    else {
      clearSelection();
      setSelectionMode(true);
    }
  };
  const cancelSelection = () => {
    exitSelection();
    selectionTriggerRef.current?.querySelector("button")?.focus({preventScroll: true});
  };
  const selectedCount = review.selectedBankRows.length + review.selectedCsvRows.length;
  const selectedLabel = `${selectedCount} ${selectedCount === 1 ? "seleccionado" : "seleccionados"}`;
  useEffect(() => {
    if (!selectedCount) setSelectionMenuOpen(false);
  }, [selectedCount]);
  useEffect(() => {
    if (!selectionMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!selectionControlsRef.current?.contains(event.target as Node)) setSelectionMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [selectionMenuOpen]);
  const syncState = getReviewSyncState(connections, review.syncingBank);
  const needsReconnect = connections.some((connection) => ["needs_reconnect", "reconnect_required", "disconnected"].includes(connection.status));
  const syncLabel = syncState === "syncing"
    ? "Sincronizando banco"
    : syncState === "error"
      ? needsReconnect ? "Conexión interrumpida" : "Problema de sincronización"
      : syncState === "idle" ? "Sin sincronizar" : "Banco sincronizado";
  const soleConnection = connections.length === 1 ? connections[0] : null;
  const syncMeta = connections.length > 1
    ? `${connections.length} conexiones bancarias`
    : soleConnection?.bank_name || "";

  if (review.error && !review.bank && !review.imports) {
    return (
      <ViewLoadError
        title="Revisión bancaria"
        message={review.error}
        onRetry={() => review.setReloadToken((value) => value + 1)}
      />
    );
  }

  const categoryRulesMenu = (
    <OverflowMenu label="Reglas de categoría" triggerText="Reglas" compact align="start">
      <OverflowMenuItem onClick={() => navigateToSettings(new URLSearchParams("focus=new-rule"))}><WandSparkles aria-hidden="true" />Nueva regla</OverflowMenuItem>
      <OverflowMenuItem onClick={() => navigateToSettings(new URLSearchParams("focus=rules"))}><List aria-hidden="true" />Gestionar reglas</OverflowMenuItem>
    </OverflowMenu>
  );

  return (
    <div className="view-stack review-page" data-review-bank-ready={review.bank ? "true" : "false"} data-review-imports-ready={review.imports ? "true" : "false"} data-review-rows-ready={review.rows ? "true" : "false"}>
      <PageHeader title="Revisión">
        <div className="review-controls">
          <SegmentedControl className="review-filter-control" aria-label="Filtrar revisión">
            {([["all", "Todos"], ["attention", "Necesitan atención"], ["prepared", "Preparados"]] as const).map(([value, label]) => (
              <SegmentedItem key={value} selected={filter === value} onClick={() => changeFilter(value)}>{label}</SegmentedItem>
            ))}
          </SegmentedControl>
          <div className={selectionMode ? "review-selection-controls is-selecting" : "review-selection-controls"} ref={selectionControlsRef}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSelectionMenuOpen(false); }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !selectionMenuOpen) return;
              event.preventDefault();
              event.stopPropagation();
              setSelectionMenuOpen(false);
              selectionControlsRef.current?.querySelector<HTMLButtonElement>("[aria-controls]")?.focus({preventScroll: true});
            }}>
            {categoryRulesMenu}
            {selectionMode ? <Button variant="secondary" disabled={!selectedCount}
              aria-expanded={selectionMenuOpen} aria-controls={selectionMenuId}
              aria-label={`Acciones de selección, ${selectedLabel}`}
              onClick={() => setSelectionMenuOpen((open) => !open)}>
              Acciones ({selectedCount}) <ChevronDown aria-hidden="true" />
            </Button> : null}
            <span className="review-selection-toggle" ref={selectionTriggerRef}>
              <Button variant="secondary" aria-pressed={selectionMode} onClick={toggleSelection}>
                {selectionMode ? "Cancelar selección" : "Seleccionar"}
              </Button>
            </span>
            <div id={selectionMenuId} className="review-selection-menu" role="group" aria-label="Acciones de selección" hidden={!selectionMode || !selectionMenuOpen}>
              <span aria-live="polite">{selectedLabel}</span>
              <div className="review-selection-actions" ref={setSelectionActionsTarget} />
              <Button variant="secondary" onClick={cancelSelection}>Cancelar</Button>
            </div>
          </div>
        </div>
      </PageHeader>
      {review.error ? <ErrorBanner message={review.error} /> : null}
      {review.status ? (
        <div className="ui-review-archetype__status" role="status" aria-live="polite" aria-atomic="true">
          {review.status}
        </div>
      ) : null}

      <div className="review-workspace" id="review-workspace" tabIndex={-1}>
        <section className="review-bank-workspace" id="review-bank-workspace" tabIndex={-1} aria-label="Cola bancaria">
          <BankReviewPanel connections={connections} review={review} privateAmounts={privateAmounts} filter={filter} selectionMode={selectionMode} selectionActionsTarget={selectionActionsTarget} onExitSelectionMode={exitSelection}
            connectionStatus={connections.length ? (
              <div className="review-sync-bar" data-review-sync-state={syncState} aria-live="polite">
                <span className="review-sync-state">
                  {syncState === "error" ? <AlertTriangle aria-hidden="true" /> : <i aria-hidden="true" />}
                  <span><strong>{syncMeta} · {syncLabel}</strong>
                    <small>Última sincronización: {soleConnection?.last_synced_at_display || "sin datos"}</small>
                  </span>
                </span>
                {syncState === "error" && onOpenBankConnections ? <Button variant="secondary" onClick={onOpenBankConnections}>Revisar conexión</Button> : null}
              </div>
            ) : <span className="review-sync-meta">Sin conexiones bancarias</span>}
          />
        </section>
        <section className="review-csv-workspace" id="review-csv-workspace" tabIndex={-1} aria-label="Importaciones CSV">
          <CsvReviewPanel review={review} privateAmounts={privateAmounts} filter={filter} selectionMode={selectionMode} selectionActionsTarget={selectionActionsTarget} onExitSelectionMode={exitSelection} onShowAllFilter={() => changeFilter("all")} navigateToSettings={navigateToSettings} routeKey={routeKey} />
        </section>
      </div>
    </div>
  );
}
