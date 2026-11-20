import {useEffect, useState} from "react";
import {motion, useReducedMotion} from "motion/react";
import {Archive, FolderSync, Paperclip, Pencil, Tag} from "lucide-react";
import {formatDate} from "../../format";
import {TransactionAmount} from "./TransactionAmount";
import {TransactionCategory} from "./TransactionCategory";
import {TransactionIdentity} from "./TransactionIdentity";
import {TransactionMetadata} from "./TransactionMetadata";
import type {LedgerItem, LedgerItemCapabilities} from "./LedgerItem";
import type {TransactionRowAction} from "./TransactionRow";
import {OverflowMenu, OverflowMenuItem} from "../controls/OverflowMenu";

function actionLabel(action: TransactionRowAction) {
  return action === "edit" ? "Editar" : action === "reopen" ? "Reabrir" : action === "allocate" ? "Distribuir categorías" : "Archivar";
}

function actionIcon(action: TransactionRowAction) {
  return action === "edit" ? Pencil : action === "reopen" ? FolderSync : action === "allocate" ? Tag : Archive;
}

function StatementRow({item, capabilities, privateAmounts, selectionMode, selected, onSelect, onAction, onOpenAttachments, contextDetail, menuOpen, onMenuChange, actionPending, actionFeedback, keepActionMenuOpen, reduceMotion}: {
  menuOpen: boolean;
  onMenuChange: (id: string | null) => void;
  item: LedgerItem;
  capabilities: LedgerItemCapabilities;
  privateAmounts: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelect: (id: string, shiftKey?: boolean) => void;
  onAction?: (id: string, action: TransactionRowAction) => void;
  onOpenAttachments?: (id: string) => void;
  contextDetail?: string;
  actionPending: boolean;
  actionFeedback?: {kind: "status" | "error"; message: string};
  keepActionMenuOpen: boolean;
  reduceMotion: boolean;
}) {
  const actions = (["edit", "archive", "reopen", "allocate"] as const).filter((action) => capabilities[action]);
  const hasAttachmentAction = item.attachmentCount > 0 && Boolean(onOpenAttachments);
  return <motion.li layout="position" transition={reduceMotion ? {layout: {duration: 0}} : {layout: {duration: 0.18, ease: "easeOut"}}} data-ledger-item-id={item.id} aria-busy={actionPending || undefined} tabIndex={-1} className={`ui-statement-ledger__row${selectionMode ? " is-selection-mode" : ""}${selected ? " is-selected" : ""}${!item.category && item.kind !== "transfer" ? " is-uncategorized" : ""}`}>
    <label className="ui-statement-ledger__selection" aria-hidden={!selectionMode || undefined}><input type="checkbox" aria-label={`Seleccionar ${item.description}`} checked={selected} disabled={!selectionMode} tabIndex={selectionMode ? 0 : -1} onClick={(event) => onSelect(item.id, event.shiftKey)} readOnly /></label>
    <time dateTime={item.date}>{formatDate(item.date)}</time>
    <div className="ui-statement-ledger__content">
      <TransactionIdentity description={item.description} account={item.account} kind={item.kind} />
      <span><TransactionCategory category={item.category} /></span>
      <TransactionMetadata sourceLabel={item.sourceLabel} isRefund={item.isRefund} isTransfer={item.kind === "transfer"} attachmentCount={item.attachmentCount} contextDetail={contextDetail} />
    </div>
    <span className="ui-statement-ledger__amount"><TransactionAmount value={item.signedAmount} privateAmounts={privateAmounts} tone="neutral" label="Importe" /></span>
    {(actions.length && onAction || hasAttachmentAction) ? <OverflowMenu
      className="ui-statement-ledger__menu"
      label={`Acciones para ${item.description}`}
      compact
      open={!selectionMode && menuOpen}
      onOpenChange={(isOpen) => onMenuChange(isOpen ? item.id : null)}
      suspended={selectionMode}
    >
      {actions.map((action) => { const Icon = actionIcon(action); const keepOpen = keepActionMenuOpen && action !== "edit" && action !== "allocate"; return <OverflowMenuItem key={action} keepOpen={keepOpen} aria-label={`${actionLabel(action)} ${item.description}`} aria-disabled={actionPending || undefined} onClick={(event) => {if (keepOpen) event.currentTarget.focus({preventScroll: true}); onAction?.(item.id, action);}}><Icon aria-hidden="true" />{actionLabel(action)}</OverflowMenuItem>; })}
      {hasAttachmentAction ? <OverflowMenuItem keepOpen aria-label={`Ver adjuntos de ${item.description}`} onClick={(event) => { event.currentTarget.closest(".ui-overflow-menu")?.querySelector<HTMLButtonElement>(".ui-overflow-menu__trigger")?.focus({preventScroll: true}); onOpenAttachments?.(item.id); }}><Paperclip aria-hidden="true" />Ver adjuntos</OverflowMenuItem> : null}
      {actionFeedback ? <div className={`message ${actionFeedback.kind === "error" ? "error" : "success"}`} role={actionFeedback.kind === "error" ? "alert" : "status"} aria-atomic="true">{actionFeedback.message}</div> : null}
    </OverflowMenu> : null}
  </motion.li>;
}

type StatementLedgerProps = {
  items: readonly LedgerItem[];
  pendingActionIds?: ReadonlySet<string>;
  actionFeedback?: {id: string; kind: "status" | "error"; message: string} | null;
  keepActionMenuOpen?: boolean;
  capabilitiesFor: (item: LedgerItem) => LedgerItemCapabilities;
  privateAmounts: boolean;
  selectionMode: boolean;
  selectedIds: readonly string[];
  onSelect: (id: string, shiftKey?: boolean) => void;
  onAction?: (id: string, action: TransactionRowAction) => void;
  onOpenAttachments?: (id: string) => void;
  contextDetailFor?: (item: LedgerItem) => string | undefined;
};

export function StatementLedger(props: StatementLedgerProps) {
  return <StatementLedgerContent {...props} />;
}

function StatementLedgerContent({items, pendingActionIds, actionFeedback, keepActionMenuOpen = false, capabilitiesFor, privateAmounts, selectionMode, selectedIds, onSelect, onAction, onOpenAttachments, contextDetailFor}: StatementLedgerProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (selectionMode || (menuId && !items.some((item) => item.id === menuId))) setMenuId(null);
  }, [items, menuId, selectionMode]);
  return <ol className="ui-statement-ledger" aria-label="Movimientos del ledger">
    {items.map((item) => <StatementRow menuOpen={menuId === item.id} onMenuChange={setMenuId} key={item.id} item={item} capabilities={capabilitiesFor(item)} privateAmounts={privateAmounts} selectionMode={selectionMode} selected={selectedIds.includes(item.id)} onSelect={onSelect} onAction={onAction} onOpenAttachments={onOpenAttachments} contextDetail={contextDetailFor?.(item)} actionPending={pendingActionIds?.has(item.id) || false} actionFeedback={actionFeedback?.id === item.id ? actionFeedback : undefined} keepActionMenuOpen={keepActionMenuOpen} reduceMotion={Boolean(reduceMotion)} />)}
  </ol>;
}
