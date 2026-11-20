import {Fragment, useRef, useState, type ReactNode} from "react";
import {createPortal} from "react-dom";
import {RefreshCw} from "lucide-react";
import {displayEuro} from "../../format";
import {LoadingPanel, SectionHeader} from "../../shared/components/ui";
import {PreparedReviewCard} from "./PreparedReviewCard";
import {BankTransferLinkPanel, UnlinkedTransferRows} from "./BankTransferLinkPanel";
import {usePreparedReviewFields} from "./PreparedReviewFields";
import {toPreparedBankReview} from "./adapters/bankReviewAdapter";
import {prepareReviewEditorOptions} from "./adapters/reviewEditorAdapter";
import {changeReviewDraftKind} from "./adapters/reviewDraft";
import type {Connection} from "../../shared/model/accounts";
import type {TransactionEditorField} from "../../ui/finance/TransactionEditor";
import type {BankReviewActionInput, PreparedReview, ReviewDraftKind} from "./adapters/reviewAdapterTypes";
import type {BankReviewMutationResult, ReviewData} from "./useReviewData";
import {useReviewExitQueue} from "./useReviewExitQueue";
import {reviewBatchSelectable, reviewMatchesFilter, usePruneReviewSelection, type ReviewQueueFilter} from "./reviewQueueFilter";
import {Button} from "../../ui/controls/Button";
import {BankReviewDetails} from "./BankReviewDetails";
import {ReviewRuleGroups} from "./ReviewRuleGroups";
import {buildReviewRuleGroups} from "./reviewRuleModel";

function isReviewDraftKind(value: string): value is ReviewDraftKind {
  return value === "income" || value === "expense" || value === "transfer";
}

function bankConfirmInput(prepared: PreparedReview, action: "confirm" | "force"): BankReviewActionInput {
  const preparedAction = prepared.actions[action];
  return preparedAction?.source === "bank" ? preparedAction.input : {};
}

function BankReviewActions({prepared, transferOpen, onConfirm, onForce, onTransfer, onSkip}: {
  prepared: PreparedReview;
  transferOpen: boolean;
  onConfirm: () => Promise<boolean>;
  onForce: () => Promise<boolean>;
  onTransfer: () => Promise<boolean>;
  onSkip: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    void action().finally(() => setBusy(false));
  };
  const actionUnavailable = busy || undefined;
  return <>
    {prepared.actions.confirm ? <Button variant="primary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={() => run(onConfirm)}>{prepared.preservedAllocationLabels?.length ? "Reconfirmar reparto" : "Incorporar"}</Button> : null}
    {prepared.actions.force ? <Button variant="primary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={() => run(onForce)}>{prepared.preservedAllocationLabels?.length ? "Reconfirmar reparto igualmente" : "Incorporar igualmente"}</Button> : null}
    {prepared.actions.transfer ? <Button id={`bank-transfer-open-${prepared.sourceId}`} data-bank-transfer-open variant="secondary" aria-expanded={transferOpen} aria-controls={transferOpen ? `bank-transfer-link-panel-${prepared.sourceId}` : undefined} aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={() => run(onTransfer)}>Vincular traspaso</Button> : null}
    {prepared.actions.skip ? <Button variant="secondary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={() => run(onSkip)}>Omitir</Button> : null}
  </>;
}

function BankReviewPreparedItem({prepared, selected, transferOpen, editorOptions, exiting, privateAmounts, selectionMode, onExitComplete, onSelect, onDraftChange, onRememberCategoryChange, onConfirm, onForce, onTransfer, onSkip}: {
  prepared: PreparedReview;
  selected: boolean;
  transferOpen: boolean;
  editorOptions: ReturnType<typeof prepareReviewEditorOptions>;
  exiting: boolean;
  privateAmounts: boolean;
  selectionMode: boolean;
  onExitComplete: () => void;
  onSelect: (selected: boolean) => void;
  onDraftChange: (field: TransactionEditorField, value: string) => void;
  onRememberCategoryChange: (value: boolean) => void;
  onConfirm: () => Promise<boolean>;
  onForce: () => Promise<boolean>;
  onTransfer: () => Promise<boolean>;
  onSkip: () => Promise<boolean>;
}) {
  const fields = usePreparedReviewFields({prepared, accounts: editorOptions.accounts, categoriesByKind: editorOptions.categoriesByKind, onDraftChange, privateAmounts});
  const detailsAvailable = prepared.capabilities.canChooseRefund || prepared.capabilities.canRememberCategory || Boolean(prepared.suggestion?.reason) || Boolean(prepared.preservedAllocationLabels?.length) || Boolean(prepared.preservedRefundDescription);
  const canSelect = selectionMode && reviewBatchSelectable(prepared);
  return <PreparedReviewCard
    prepared={prepared}
    privateAmounts={privateAmounts}
    inlineAmount={fields.inlineAmount}
    inlineContent={fields.inlineContent}
    inlineIssues={fields.inlineIssues}
    selectionControl={canSelect ? <label className="select-row prepared-review-select"><input type="checkbox" aria-label={`Seleccionar ${prepared.item.description}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} /><span className="sr-only">Seleccionar para incorporación</span></label> : null}
    details={detailsAvailable ? <BankReviewDetails prepared={prepared} refundCandidates={editorOptions.refundCandidates} onDraftChange={onDraftChange} onRememberCategoryChange={onRememberCategoryChange} /> : null}
    actions={<BankReviewActions prepared={prepared} transferOpen={transferOpen} onConfirm={onConfirm} onForce={onForce} onTransfer={onTransfer} onSkip={onSkip} />}
    selectionMode={selectionMode}
    selected={canSelect && selected}
    onSelect={canSelect ? () => onSelect(!selected) : undefined}
    suppressActions={selectionMode}
    exiting={exiting}
    onExitComplete={onExitComplete}
  />;
}

export function BankReviewPanel({connections, review, privateAmounts = false, filter, selectionMode, selectionActionsTarget, onExitSelectionMode, connectionStatus}: {connections: Connection[]; review: ReviewData; privateAmounts?: boolean; filter: ReviewQueueFilter; selectionMode: boolean; selectionActionsTarget?: HTMLElement | null; onExitSelectionMode: () => void; connectionStatus?: ReactNode}) {
  const {
    bank,
    selectedBankRows,
    setSelectedBankRows,
    bankDraftById,
    setBankDraftById,
    syncingBank,
    syncBankConnections,
    runBankReviewAction,
    runBankBulkAction,
    bankActionFeedback,
  } = review;
  const [transferOriginId, setTransferOriginId] = useState<number | null>(null);
  const transferOriginIdRef = useRef<number | null>(null);
  const transferFocusGenerationRef = useRef(0);
  const allBankRows = bank?.rows.filter((row) => row.status === "pending") || [];
  const availableAccounts = connections.flatMap((connection) => connection.accounts);
  const allPreparedRows = allBankRows.map((row) => toPreparedBankReview(row, bankDraftById[row.id], bank?.categories || [], availableAccounts)).filter((value): value is PreparedReview => Boolean(value));
  const exitQueue = useReviewExitQueue({source: "bank", preparedRows: allPreparedRows, activeIds: allBankRows.map((row) => row.id), emptyElementId: "bank-review-empty"});
  const bankRows = allBankRows.filter((row) => !exitQueue.removedIds.has(row.id));
  const preparedRows = exitQueue.visibleRows;
  const displayRows = exitQueue.displayRows;
  const selectableBankRows = preparedRows.filter(reviewBatchSelectable).map((prepared) => prepared.sourceId);
  const filteredDisplayRows = displayRows.filter((prepared) => Boolean(exitQueue.exitingById[prepared.sourceId]) || reviewMatchesFilter(prepared, filter));
  const ruleGroupModel = buildReviewRuleGroups(preparedRows.filter((prepared) => !exitQueue.exitingById[prepared.sourceId] && reviewMatchesFilter(prepared, filter)));
  const visibleRuleGroups = filter === "attention" ? [] : ruleGroupModel.groups;
  const visibleRuleConflicts = ruleGroupModel.conflicts.filter(({prepared}) => reviewMatchesFilter(prepared, filter));
  const editorOptions = bank ? prepareReviewEditorOptions(availableAccounts, bank.categories, bank.refund_candidates) : {accounts: [], categoriesByKind: {income: [], expense: []}, refundCandidates: []};
  const bankPendingAmount = bankRows.reduce((sum, row) => sum + (row.kind === "expense" ? -row.amount : row.amount), 0);
  const bankDuplicateCount = bankRows.filter((row) => row.possible_duplicate).length;
  const bankTransferCount = bankRows.filter((row) => row.possible_transfer).length + (bank?.unlinked_transfers?.length || 0);
  const bankSuggestedCount = bankRows.filter((row) => row.suggested_category || row.prediction).length;

  usePruneReviewSelection(selectableBankRows, setSelectedBankRows);

  const handleBankMutationResult = (candidateIds: readonly number[], result: BankReviewMutationResult) => {
    onExitSelectionMode();
    const removed = new Set(exitQueue.beginExit(candidateIds, result.removed));
    setSelectedBankRows((current) => current.filter((id) => !removed.has(id)));
  };
  const openTransferLink = (originId: number) => {
    transferFocusGenerationRef.current += 1;
    transferOriginIdRef.current = originId;
    setTransferOriginId(originId);
  };
  const closeTransferLink = (originId: number) => {
    if (transferOriginIdRef.current !== originId) return;
    transferOriginIdRef.current = null;
    const focusGeneration = ++transferFocusGenerationRef.current;
    const openerId = `bank-transfer-open-${originId}`;
    setTransferOriginId(null);
    requestAnimationFrame(() => {
      if (transferFocusGenerationRef.current !== focusGeneration || transferOriginIdRef.current !== null || document.activeElement !== document.body) return;
      const opener = openerId ? document.getElementById(openerId) : null;
      const fallback = opener || document.querySelector<HTMLElement>("[data-bank-transfer-open]") || document.getElementById("main-content");
      fallback?.focus({preventScroll: true});
    });
  };
  const transferOrigin = transferOriginId === null
    ? undefined
    : [...(bank?.rows || []), ...(bank?.unlinked_transfers || [])].find((row) => row.id === transferOriginId);
  return (
    <>
      <div className="bank-review-summary">
        <SectionHeader title="Cola bancaria" />
        <dl className="review-summary-strip" aria-label="Resumen de cola bancaria">
          <div>
            <dt>Pendientes</dt>
            <dd>{bank ? bankRows.length : "—"}</dd>
          </div>
          <div>
            <dt>Impacto neto</dt>
            <dd>{bank ? displayEuro(bankPendingAmount, privateAmounts) : "—"}</dd>
          </div>
          <div>
            <dt>Sugerencias</dt>
            <dd>{bank ? bankSuggestedCount : "—"}</dd>
          </div>
          <div>
            <dt>Alertas</dt>
            <dd>{bank ? bankDuplicateCount + bankTransferCount : "—"}
              {bank ? <span className="sr-only">: {bankDuplicateCount} posibles duplicados; {bankTransferCount} posibles traspasos</span> : null}
            </dd>
          </div>
        </dl>
        {connectionStatus}
      </div>

      <div className="bank-review-panel">
        <SectionHeader
          title="Pendientes bancarios"
          detail="Confirma categorías, reembolsos y traspasos antes de moverlos al libro."
          action={
            <div className="inline-actions">
              {connections.length ? (
                <Button
                  variant="primary"
                  className="bank-sync-action"
                  aria-disabled={syncingBank || undefined}
                  aria-busy={syncingBank || undefined}
                  onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void syncBankConnections();}}
                >
                  <RefreshCw aria-hidden="true" className={syncingBank ? "spin" : undefined} />
                  Sincronizar banco
                </Button>
              ) : null}
              {bankRows.length && !selectionMode && filter !== "attention" ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await runBankBulkAction({action: "import_safe"}, (result) => handleBankMutationResult(bankRows.map((row) => row.id), result));
                    }}
                  >
                    Confirmar seguros
                  </Button>
                </>
              ) : null}
            </div>
          }
        />
        {bank && !selectionMode ? <ReviewRuleGroups
          groups={visibleRuleGroups}
          conflicts={visibleRuleConflicts}
          privateAmounts={privateAmounts}
          focusTargetId="review-bank-workspace"
          onApply={async (group, rows) => {
            const ids = rows.map((row) => row.sourceId);
            if (group.source !== "bank") return false;
            return runBankBulkAction({
              action: "confirm",
              rows: ids,
              categories: Object.fromEntries(ids.map((id) => [id, String(group.rule.category.id)])),
            }, (result) => handleBankMutationResult(ids, result));
          }}
        /> : null}
        {selectionMode && selectedBankRows.length ? (
          selectionActionsTarget ? createPortal(
            <>
              <Button variant="secondary" onClick={async () => {
                const rows = selectedBankRows;
                await runBankBulkAction({
                  action: "confirm",
                  rows,
                  categories: Object.fromEntries(rows.map((id) => [id, bankDraftById[id]?.category || ""])),
                }, (result) => handleBankMutationResult(rows, result));
              }}>Importar seleccionados</Button>
              <Button variant="secondary" onClick={async () => {
                const rows = selectedBankRows;
                await runBankBulkAction({action: "skip", rows}, (result) => handleBankMutationResult(rows, result));
              }}>Omitir seleccionados</Button>
            </>,
            selectionActionsTarget,
          ) : (
            <div className="bulk-toolbar">
              <span>{selectedBankRows.length} seleccionados</span>
              <div className="inline-actions">
                <Button variant="secondary" onClick={async () => {
                  const rows = selectedBankRows;
                  await runBankBulkAction({
                    action: "confirm",
                    rows,
                    categories: Object.fromEntries(rows.map((id) => [id, bankDraftById[id]?.category || ""])),
                  }, (result) => handleBankMutationResult(rows, result));
                }}>Importar seleccionados</Button>
                <Button variant="secondary" onClick={async () => {
                  const rows = selectedBankRows;
                  await runBankBulkAction({action: "skip", rows}, (result) => handleBankMutationResult(rows, result));
                }}>Omitir seleccionados</Button>
              </div>
            </div>
          )
        ) : null}
        {!bank ? <LoadingPanel /> : filteredDisplayRows.length ? (
          <div className="stack-list bank-review-list">
            {filteredDisplayRows.map((prepared) => <Fragment key={prepared.item.id}><BankReviewPreparedItem
              prepared={prepared}
              transferOpen={transferOriginId === prepared.sourceId}
              privateAmounts={privateAmounts}
              selectionMode={selectionMode}
              exiting={Boolean(exitQueue.exitingById[prepared.sourceId])}
              onExitComplete={() => exitQueue.completeExit(prepared.sourceId)}
              selected={selectedBankRows.includes(prepared.sourceId)}
              editorOptions={editorOptions}
              onSelect={(selected) => setSelectedBankRows((current) => selected ? [...new Set([...current, prepared.sourceId])] : current.filter((value) => value !== prepared.sourceId))}
              onDraftChange={(field: TransactionEditorField, value) => setBankDraftById((current) => {
                const draft = current[prepared.sourceId] || prepared.draft;
                const next = field === "kind" && isReviewDraftKind(value) ? changeReviewDraftKind(draft, value) : {...draft, [field]: value};
                return {...current, [prepared.sourceId]: next};
              })}
              onRememberCategoryChange={(value) => setBankDraftById((current) => ({...current, [prepared.sourceId]: {...(current[prepared.sourceId] || prepared.draft), remember_category: value}}))}
              onConfirm={() => runBankReviewAction(prepared.sourceId, "confirm", bankConfirmInput(prepared, "confirm"), (result) => handleBankMutationResult([prepared.sourceId], result))}
              onForce={() => runBankReviewAction(prepared.sourceId, "force", bankConfirmInput(prepared, "force"), (result) => handleBankMutationResult([prepared.sourceId], result))}
              onTransfer={async () => {openTransferLink(prepared.sourceId); return true;}}
              onSkip={() => runBankReviewAction(prepared.sourceId, "skip", {}, (result) => handleBankMutationResult([prepared.sourceId], result))}
            />{transferOriginId === prepared.sourceId && transferOrigin ? <BankTransferLinkPanel
              key={transferOrigin.id}
              origin={transferOrigin}
              privateAmounts={privateAmounts}
              onConfirm={(input) => runBankReviewAction(transferOrigin.id, "transfer", input, (result) => handleBankMutationResult(result.removed, result))}
              onCancel={() => closeTransferLink(transferOrigin.id)}
            /> : null}</Fragment>)}
          </div>
        ) : <div id="bank-review-empty" className="empty-state empty-state--plain" tabIndex={-1}>
          {displayRows.length ? "No hay movimientos bancarios en este filtro." : "No hay movimientos bancarios pendientes. Puedes revisar CSV si tienes lotes manuales esperando."}
        </div>}
        <UnlinkedTransferRows rows={bank?.unlinked_transfers || []} activeId={transferOriginId} privateAmounts={privateAmounts} onLink={(id) => openTransferLink(id)} />
        {transferOrigin && bank?.unlinked_transfers?.some((row) => row.id === transferOrigin.id) ? <BankTransferLinkPanel
          key={transferOrigin.id}
          origin={transferOrigin}
          privateAmounts={privateAmounts}
          onConfirm={(input) => runBankReviewAction(transferOrigin.id, "transfer", input, (result) => handleBankMutationResult(result.removed, result))}
          onCancel={() => closeTransferLink(transferOrigin.id)}
        /> : null}
        {bankActionFeedback ? <div className="bank-review-action-feedback">
          <div className={`message ${bankActionFeedback.kind === "error" ? "error" : "success"}`} role={bankActionFeedback.kind === "error" ? "alert" : "status"} aria-atomic="true">{bankActionFeedback.message}</div>
        </div> : null}
      </div>
    </>
  );
}
