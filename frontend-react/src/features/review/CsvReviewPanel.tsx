import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {ArrowDownRight, ArrowUpRight, ChevronDown, Trash2} from "lucide-react";
import {importsApi as api} from "../../shared/api/imports";
import {displayEuro, formatDate} from "../../format";
import {LoadingPanel, SectionHeader} from "../../shared/components/ui";
import {ConfirmDialog} from "../../shared/components/ConfirmDialog";
import {motionEase} from "../../shared/lib/motion";
import type {CsvReviewMutationResult, ReviewData} from "./useReviewData";
import type {ImportBatch, ImportRow} from "../../shared/model/imports";
import {PreparedReviewCard} from "./PreparedReviewCard";
import {usePreparedReviewFields} from "./PreparedReviewFields";
import {toPreparedCsvReview} from "./adapters/csvReviewAdapter";
import {prepareReviewEditorOptions} from "./adapters/reviewEditorAdapter";
import type {CsvReviewActionRequest, PreparedReview, ReviewDraft} from "./adapters/reviewAdapterTypes";
import {useReviewExitQueue} from "./useReviewExitQueue";
import {useCsvReviewUpload} from "./useCsvReviewUpload";
import {reviewBatchSelectable, reviewMatchesFilter, usePruneReviewSelection, type ReviewQueueFilter} from "./reviewQueueFilter";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {Button, IconButton} from "../../ui/controls/Button";
import {CsvReviewActionFeedback, CsvReviewActions, CsvReviewDetails, useCsvDisclosureAnchor, useCsvExitScrollAnchor} from "./CsvReviewControls";
import {CsvReviewRuleGroups} from "./CsvReviewRuleGroups";

type CsvDisplayEntry = Readonly<{order: number; prepared: PreparedReview}> | Readonly<{order: number; row: ImportRow}>;
function CsvReviewPreparedItem({prepared, selected, editorOptions, exiting, bulkBusy, privateAmounts, selectionMode, onExitComplete, onSelect, onDraftChange, onRun}: {
  prepared: PreparedReview;
  selected: boolean;
  editorOptions: ReturnType<typeof prepareReviewEditorOptions>;
  exiting: boolean;
  bulkBusy: boolean;
  privateAmounts: boolean;
  selectionMode: boolean;
  onExitComplete: () => void;
  onSelect: (selected: boolean) => void;
  onDraftChange: (field: keyof ReviewDraft, value: string) => void;
  onRun: (input: CsvReviewActionRequest) => Promise<boolean>;
}) {
  const fields = usePreparedReviewFields({prepared, accounts: editorOptions.accounts, categoriesByKind: editorOptions.categoriesByKind, onDraftChange, disabled: bulkBusy, privateAmounts});
  const canSelect = selectionMode && reviewBatchSelectable(prepared);
  return <PreparedReviewCard
    prepared={prepared}
    privateAmounts={privateAmounts}
    inlineAmount={fields.inlineAmount}
    inlineContent={fields.inlineContent}
    inlineIssues={fields.inlineIssues}
    selectionControl={canSelect ? <label className="select-row prepared-review-select"><input type="checkbox" aria-label={`Seleccionar ${prepared.item.description}`} checked={selected} disabled={bulkBusy} onChange={(event) => onSelect(event.target.checked)} /><span className="sr-only">Seleccionar para incorporación</span></label> : null}
    details={prepared.capabilities.canPersistStandaloneEdit || prepared.preservedAllocationLabels?.length || prepared.preservedRefundDescription ? <CsvReviewDetails prepared={prepared} onDraftChange={onDraftChange} disabled={bulkBusy} /> : null}
    actions={<CsvReviewActions prepared={prepared} onRun={onRun} disabled={bulkBusy} />}
    selectionMode={selectionMode}
    selected={canSelect && selected}
    onSelect={canSelect ? () => onSelect(!selected) : undefined}
    suppressActions={selectionMode}
    exiting={exiting}
    onExitComplete={onExitComplete}
  />;
}

export function CsvReviewPanel({review, privateAmounts = false, filter, selectionMode, selectionActionsTarget, onExitSelectionMode, onShowAllFilter = () => undefined, navigateToSettings = () => undefined, routeKey = ""}: {review: ReviewData; privateAmounts?: boolean; filter: ReviewQueueFilter; selectionMode: boolean; selectionActionsTarget?: HTMLElement | null; onExitSelectionMode: () => void; onShowAllFilter?: () => void; navigateToSettings?: (search: URLSearchParams) => void; routeKey?: string}) {
  const {
    imports,
    rows,
    setRows,
    selectedBatchId,
    setSelectedBatchId: selectCsvBatch,
    csvPage,
    setCsvPage,
    csvStatusFilter,
    setCsvStatusFilter,
    selectedCsvRows,
    setSelectedCsvRows,
    csvBulkBusy,
    csvDraftById,
    setCsvDraftById,
    csvActionFeedback,
    csvExpanded,
    setCsvExpanded,
    setStatus,
    refreshAll,
    runCsvReviewAction,
    runCsvBulkAction,
    runCsvSafeBulkAction,
    getDirtyCsvDraftIdsForBatch,
    removeCsvDraftsForBatch,
    openCsvBatch,
  } = review;
  const [pendingDeletion, setPendingDeletion] = useState<ImportBatch | null>(null);
  const [emptyDetailMinHeight, setEmptyDetailMinHeight] = useState<number>();
  const csvDetailRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const csvPendingCount = imports?.batches.reduce((sum, batch) => sum + batch.pending_count, 0) || 0, csvDisclosureTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const toggleCsvDisclosure = useCsvDisclosureAnchor(csvExpanded, () => setCsvExpanded((value) => !value));
  const allPreparedRows = rows ? rows.results.map((row) => toPreparedCsvReview(row, rows.batch, csvDraftById[row.id], rows.categories)).filter((value): value is PreparedReview => Boolean(value)) : [];
  const exitQueue = useReviewExitQueue({source: "csv", preparedRows: allPreparedRows, activeIds: rows?.results.filter((row) => row.status === "pending").map((row) => row.id) || [], emptyElementId: "csv-review-empty"});
  const preparedRows = exitQueue.visibleRows;
  const preparedById = new Map(preparedRows.map((prepared) => [prepared.sourceId, prepared]));
  const selectableCsvRows = preparedRows.filter(reviewBatchSelectable).map((prepared) => prepared.sourceId);
  const safeCsvRows = rows?.results.filter((row) => row.status === "pending" && !row.possible_duplicate).map((row) => row.id) || [];
  const dirtyCsvDraftIds = selectedBatchId ? getDirtyCsvDraftIdsForBatch(selectedBatchId) : [];
  const csvExitResetKey = `${selectedBatchId}:${csvPage}:${csvStatusFilter}`;
  const displayEntries: CsvDisplayEntry[] = [];
  rows?.results.forEach((row, order) => {
    const prepared = exitQueue.exitingById[row.id]?.prepared || preparedById.get(row.id);
    if (prepared) displayEntries.push({order, prepared});
    else if (row.status !== "pending") displayEntries.push({order, row});
  });
  if (rows) {
    const currentIds = new Set(rows.results.map((row) => row.id));
    Object.values(exitQueue.exitingById).forEach((exit) => {
      if (!currentIds.has(exit.prepared.sourceId)) displayEntries.push({order: exit.order, prepared: exit.prepared});
    });
    displayEntries.sort((left, right) => left.order - right.order);
  }
  const filteredDisplayEntries = displayEntries.filter((entry) => "prepared" in entry ? Boolean(exitQueue.exitingById[entry.prepared.sourceId]) || reviewMatchesFilter(entry.prepared, filter) : filter === "all");
  const hasNonExitingVisibleEntries = filteredDisplayEntries.some((entry) => !("prepared" in entry) || !exitQueue.exitingById[entry.prepared.sourceId]), exitCount = Object.keys(exitQueue.exitingById).length;
  const recordCsvExitScroll = useCsvExitScrollAnchor(csvDetailRef, exitCount, filteredDisplayEntries.length, setEmptyDetailMinHeight, emptyDetailMinHeight, csvExitResetKey);
  const editorOptions = rows ? prepareReviewEditorOptions([rows.batch.account], rows.categories, []) : {accounts: [], categoriesByKind: {income: [], expense: []}, refundCandidates: []};

  const upload = useCsvReviewUpload({
    imports, routeKey, selectionMode, csvBulkBusy, navigateToSettings,
    setCsvExpanded, onShowAllFilter, onExitSelectionMode, openCsvBatch,
    focusBatchDetails: () => requestAnimationFrame(() => {
      const target = csvDetailRef.current;
      target?.focus({preventScroll: true});
      if (!target) return;
      const {top, bottom} = target.getBoundingClientRect();
      if (top < 0 || bottom > window.innerHeight) target.scrollIntoView({block: "nearest", behavior: reduceMotion ? "auto" : "smooth"});
    }),
  });

  useEffect(() => { setEmptyDetailMinHeight(undefined); exitQueue.reset(); }, [selectedBatchId, csvPage, csvStatusFilter]);

  useEffect(() => { if (hasNonExitingVisibleEntries) setEmptyDetailMinHeight(undefined); }, [hasNonExitingVisibleEntries]);

  usePruneReviewSelection(selectableCsvRows, setSelectedCsvRows);

  const handleCsvMutationResult = (candidateIds: readonly number[], result: CsvReviewMutationResult) => {
    const removedIds = new Set(result.removed.filter((id) => candidateIds.includes(id)));
    const leavesEmptyList = filteredDisplayEntries.length > 0 && filteredDisplayEntries.every((entry) => "prepared" in entry && (removedIds.has(entry.prepared.sourceId) || Boolean(exitQueue.exitingById[entry.prepared.sourceId])));
    if (leavesEmptyList) recordCsvExitScroll();
    onExitSelectionMode();
    const removed = new Set(exitQueue.beginExit(candidateIds, result.removed));
    setSelectedCsvRows((current) => current.filter((id) => !removed.has(id)));
  };
  const csvSelectionActions = <>
    <Button variant="secondary" aria-disabled={csvBulkBusy || undefined} aria-busy={csvBulkBusy || undefined} onClick={async () => {
      if (csvBulkBusy || !selectedBatchId) return;
      const selectedRows = selectedCsvRows.filter((id) => selectableCsvRows.includes(id));
      await runCsvBulkAction(selectedBatchId, {
        action: "confirm", rows: selectedRows,
        categories: Object.fromEntries(selectedRows.map((id) => [id, csvDraftById[id]?.category || preparedById.get(id)?.draft.category || ""])),
      }, (result) => handleCsvMutationResult(selectedRows, result));
    }}>Importar seleccionadas</Button>
    <Button variant="secondary" aria-disabled={csvBulkBusy || undefined} aria-busy={csvBulkBusy || undefined} onClick={async () => {
      if (csvBulkBusy || !selectedBatchId) return;
      const selectedRows = selectedCsvRows.filter((id) => selectableCsvRows.includes(id));
      await runCsvBulkAction(selectedBatchId, {action: "skip", rows: selectedRows}, (result) => handleCsvMutationResult(selectedRows, result));
    }}>Omitir seleccionadas</Button>
  </>;

  return (
    <div className="csv-review-panel">
      <SectionHeader
        title="CSV e importaciones manuales"
        detail={`${csvPendingCount} filas pendientes en lotes CSV. Úsalo como bandeja secundaria frente a la banca sincronizada.`}
        action={
          <div className="inline-actions">
            {upload.trigger}
            <Button variant="secondary" className="disclosure-button" aria-expanded={csvExpanded} disabled={csvBulkBusy} onClick={(event) => toggleCsvDisclosure(event.currentTarget)}>
              <ChevronDown aria-hidden="true" /> {csvExpanded ? "Comprimir CSV" : "Expandir CSV"}
            </Button>
          {csvExpanded && selectableCsvRows.length && !selectionMode && filter !== "attention" ? (
            <div className="inline-actions">
              <Button
                variant="secondary"
                aria-disabled={csvBulkBusy || undefined}
                aria-busy={csvBulkBusy || undefined}
                onClick={async () => {
                  if (csvBulkBusy || !selectedBatchId) return;
                  await runCsvSafeBulkAction(selectedBatchId, dirtyCsvDraftIds, (result) => handleCsvMutationResult(safeCsvRows, result));
                }}
              >
                Confirmar lote seguro
              </Button>
            </div>
          ) : null}
          </div>
        }
      />
      {upload.form}
      <AnimatePresence initial={false}>
        {csvExpanded && selectionMode && selectedCsvRows.length && !selectionActionsTarget ? (
          <motion.div
            key="csv-selection-toolbar"
            className="collapsible-content"
            initial={{height: 0, opacity: 0, y: -4}}
            animate={{height: "auto", opacity: 1, y: 0}}
            exit={{height: 0, opacity: 0, y: -4}}
            transition={csvDisclosureTransition}
          >
            <div className="bulk-toolbar csv-selection-toolbar">
              <span>{selectedCsvRows.length} seleccionadas</span>
              <div className="inline-actions">{csvSelectionActions}</div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {csvExpanded && selectionMode && selectedCsvRows.length && selectionActionsTarget
        ? createPortal(csvSelectionActions, selectionActionsTarget)
        : null}
      {!imports ? <LoadingPanel /> : (
        <>
          {imports.batches.length ? (
            <div className={`stack-list compact-stack csv-batch-stack ${csvExpanded ? "expanded" : "compressed"}`}>
              {imports.batches.map((batch) => (
                <div
                  key={batch.id}
                  className={`list-card batch-card ${selectedBatchId === batch.id ? "selected" : ""}`}
                >
                  <button
                    type="button"
                    className="batch-select-button"
                    disabled={csvBulkBusy}
                    onClick={() => {
                      selectCsvBatch(batch.id);
                      setCsvPage(1);
                      setCsvStatusFilter("pending");
                      setCsvExpanded(true);
                    }}
                  >
                    <strong>{batch.filename}</strong>
                    <span>{batch.pending_count} pendientes · {batch.account.name}</span>
                    <small>{formatDate(batch.created_at.slice(0, 10))}</small>
                  </button>
                  <IconButton
                    variant="subtle"
                    aria-label={`Eliminar lote CSV ${batch.filename}`}
                    title={`Eliminar lote CSV ${batch.filename}`}
                    disabled={csvBulkBusy}
                    onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setPendingDeletion(batch);}}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : <div className="empty-state empty-state--plain">No hay lotes CSV en revisión.</div>}

          <AnimatePresence initial={false} mode="sync">
          {csvExpanded && rows ? (
            <motion.div
              key="csv-expanded-rows"
              ref={csvDetailRef}
        tabIndex={-1}
              className="collapsible-content csv-detail-motion"
              style={!filteredDisplayEntries.length && emptyDetailMinHeight ? {minHeight: emptyDetailMinHeight} : undefined}
              initial={{height: 0, opacity: 0, y: -6}}
              animate={{height: "auto", opacity: 1, y: 0}}
              exit={{height: 0, opacity: 0, y: -6}}
              transition={csvDisclosureTransition}
            >
              <div className="bulk-toolbar">
                <div className="csv-filter-summary">
                  <SegmentedControl aria-label="Filtrar filas CSV">
                    <SegmentedItem
                      selected={csvStatusFilter === "pending"}
                      disabled={csvBulkBusy}
                      onClick={() => {
                        setCsvPage(1);
                        setSelectedCsvRows([]);
                        setCsvStatusFilter("pending");
                      }}
                    >
                      Pendientes ({rows.batch.pending_count})
                    </SegmentedItem>
                    <SegmentedItem
                      selected={csvStatusFilter === "all"}
                      disabled={csvBulkBusy}
                      onClick={() => {
                        setCsvPage(1);
                        setSelectedCsvRows([]);
                        setCsvStatusFilter("all");
                      }}
                    >
                      Todas ({rows.batch.row_count})
                    </SegmentedItem>
                  </SegmentedControl>
                  <span>
                    {rows.count
                      ? `Mostrando ${Math.max(1, (rows.page - 1) * 100 + 1)}-${Math.min(rows.page * 100, rows.count)} de ${rows.count} filas`
                      : "No hay filas pendientes en este lote"}
                  </span>
                </div>
                <small>{rows.batch.profile ? rows.batch.profile.name : "Sin perfil"} · {rows.batch.status_display}</small>
              </div>
              <CsvReviewRuleGroups rows={allPreparedRows} filter={filter} isExiting={(id) => Boolean(exitQueue.exitingById[id])} privateAmounts={privateAmounts} selectionMode={selectionMode} selectedBatchId={selectedBatchId} runBulkAction={runCsvBulkAction} onResult={handleCsvMutationResult} />
              <div className="import-row-list">
                {filteredDisplayEntries.map((entry) => {
                  if ("prepared" in entry) {
                    const prepared = entry.prepared;
                    return <CsvReviewPreparedItem
                      key={prepared.item.id}
                      prepared={prepared}
                      privateAmounts={privateAmounts}
                      selectionMode={selectionMode}
                      selected={selectedCsvRows.includes(prepared.sourceId)}
                      editorOptions={editorOptions}
                      exiting={Boolean(exitQueue.exitingById[prepared.sourceId])}
                      bulkBusy={csvBulkBusy}
                      onExitComplete={() => exitQueue.completeExit(prepared.sourceId)}
                       onSelect={(selected) => {
                         if (csvBulkBusy) return;
                         setSelectedCsvRows((current) => selected
                           ? [...new Set([...current, prepared.sourceId])]
                           : current.filter((value) => value !== prepared.sourceId));
                       }}
                       onDraftChange={(field, value) => {
                         if (csvBulkBusy) return;
                         setCsvDraftById((current) => ({
                           ...current,
                           [prepared.sourceId]: {...(current[prepared.sourceId] || prepared.draft), [field]: value},
                         }));
                       }}
                      onRun={(input) => runCsvReviewAction(prepared.sourceId, input, (result) => handleCsvMutationResult([prepared.sourceId], result))}
                    />;
                  }
                  const row = entry.row;
                  return <div className="list-card review-card" key={`csv:${row.id}`}>
                    <div className="review-head">
                      <strong>{row.description}</strong>
                      <b className={row.kind === "expense" ? "negative" : "positive"}>{displayEuro(row.kind === "expense" ? -row.amount : row.amount, privateAmounts)}</b>
                    </div>
                    <span>Fila {row.row_number} · {formatDate(row.date)}</span>
                    <small>{row.category?.display_name || "Sin categoría"} · {row.status_display}</small>
                  </div>;
                })}
                {!filteredDisplayEntries.length ? (
                  <div id="csv-review-empty" className="empty-state" tabIndex={-1}>
                    {displayEntries.length
                      ? "No hay filas CSV en este filtro de revisión."
                      : csvStatusFilter === "pending"
                        ? "Este lote no tiene filas pendientes. Puedes consultar todas las filas para ver las ya procesadas."
                        : "Este lote CSV no contiene filas."}
                  </div>
                ) : null}
              </div>
              {rows.num_pages > 1 ? (
                <div className="pager">
                  <IconButton aria-label="Página anterior CSV" title="Página anterior CSV" disabled={csvBulkBusy || !rows.has_previous} onClick={() => setCsvPage((current) => Math.max(1, current - 1))}>
                    <ArrowDownRight aria-hidden="true" className="pager-left" />
                  </IconButton>
                  <span>Página {rows.page} de {rows.num_pages}</span>
                  <IconButton aria-label="Página siguiente CSV" title="Página siguiente CSV" disabled={csvBulkBusy || !rows.has_next} onClick={() => setCsvPage((current) => current + 1)}>
                    <ArrowUpRight aria-hidden="true" className="pager-right" />
                  </IconButton>
                </div>
              ) : null}
              <CsvReviewActionFeedback feedback={csvActionFeedback} reduceMotion={Boolean(reduceMotion)} />
            </motion.div>
          ) : (
            <motion.div
              key="csv-compressed-summary"
              className="collapsed-summary csv-compressed-summary"
              initial={{height: 0, opacity: 0, y: -2}}
              animate={{height: "auto", opacity: 1, y: 0}}
              exit={{height: 0, opacity: 0, y: -2}}
              transition={csvDisclosureTransition}
            >
              <span>{imports.batches.length ? "Lotes visibles en modo compacto. Expande para ver grupos por regla, revisar filas e importar." : "No hay lotes CSV para revisar."}</span>
            </motion.div>
          )}
          </AnimatePresence>
        </>
      )}
      {pendingDeletion ? (
        <ConfirmDialog
          title={`¿Eliminar el lote CSV “${pendingDeletion.filename}”?`}
          description="Solo se eliminará si no ha creado movimientos. Esta acción no modifica cuentas ni movimientos ya registrados."
          confirmLabel="Eliminar lote"
          onCancel={() => setPendingDeletion(null)}
          onConfirm={async () => {
            const payload = await api.deleteImportBatch(pendingDeletion.id);
            removeCsvDraftsForBatch(pendingDeletion.id);
            setStatus(payload.message);
            setSelectedCsvRows([]);
            let nextBatchId = selectedBatchId;
            if (selectedBatchId === pendingDeletion.id) {
              const nextBatch = imports?.batches.find((item) => item.id !== pendingDeletion.id);
              nextBatchId = nextBatch?.id || null;
              selectCsvBatch(nextBatchId);
              setRows(null);
            }
            await refreshAll([], nextBatchId);
          }}
        />
      ) : null}
    </div>
  );
}
