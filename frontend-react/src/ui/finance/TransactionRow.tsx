import {Archive, FolderSync, Pencil, Tag, type LucideIcon} from "lucide-react";
import {TransactionAmount} from "./TransactionAmount";
import {TransactionCategory} from "./TransactionCategory";
import {TransactionIdentity} from "./TransactionIdentity";
import {TransactionMetadata} from "./TransactionMetadata";
import type {LedgerItem, LedgerItemCapabilities} from "./LedgerItem";
import {OverflowMenu, OverflowMenuItem} from "../controls/OverflowMenu";

export type TransactionRowItem = LedgerItem;
export type TransactionRowAction = "edit" | "archive" | "reopen" | "allocate";

export function TransactionRow({item, capabilities, compact = false, privateAmounts = false, selected = false, onSelect, onAction}: {
  item: TransactionRowItem;
  capabilities: LedgerItemCapabilities;
  compact?: boolean;
  privateAmounts?: boolean;
  selected?: boolean;
  onSelect?: (id: string, shiftKey?: boolean) => void;
  onAction?: (id: string, action: TransactionRowAction) => void;
}) {
  const actions = [
    capabilities.reopen ? {action: "reopen" as const, label: "Reabrir", Icon: FolderSync} : null,
    capabilities.edit ? {action: "edit" as const, label: "Editar", Icon: Pencil} : null,
    capabilities.allocate ? {action: "allocate" as const, label: "Distribuir categorías", Icon: Tag} : null,
    capabilities.archive ? {action: "archive" as const, label: "Archivar", Icon: Archive} : null,
  ].filter((action): action is {action: TransactionRowAction; label: string; Icon: LucideIcon} => Boolean(action));
  const hasActions = Boolean(onAction && actions.length);

  return (
    <article className={`ui-transaction-row ui-transaction-row--${item.kind}${onSelect ? " is-selectable" : ""}${hasActions ? " has-actions" : ""}${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`}>
      {onSelect ? <span className="ui-transaction-row__select"><input type="checkbox" aria-label={`Seleccionar ${item.description}`} checked={selected} onClick={(event) => onSelect(item.id, event.shiftKey)} readOnly /></span> : null}
      <div className="ui-transaction-row__body">
        <div className="ui-transaction-row__headline">
          <TransactionIdentity description={item.description} />
          <TransactionAmount value={item.signedAmount} privateAmounts={privateAmounts} tone={item.kind === "transfer" ? "neutral" : item.kind} label={item.kind === "income" ? "Ingreso" : item.kind === "expense" ? "Gasto" : "Traspaso"} />
        </div>
        <div className="ui-transaction-row__metadata">
          <TransactionIdentity date={item.date} account={item.account} kind={item.kind} sourceLabel={item.sourceLabel} />
          <TransactionCategory category={item.category} />
        </div>
        {!compact ? <div className="ui-transaction-row__detail"><TransactionMetadata isRefund={item.isRefund} isTransfer={item.kind === "transfer"} attachmentCount={item.attachmentCount} /></div> : null}
      </div>
      {hasActions ? <OverflowMenu className="ui-transaction-row__actions" label={`Acciones para ${item.description}`} triggerText="Acciones">
        {actions.map(({action, label, Icon}) => <OverflowMenuItem data-action={action} data-transaction-allocate={action === "allocate" ? "true" : undefined} aria-label={`${label} ${item.description}`} key={action} onClick={() => onAction?.(item.id, action)}><Icon aria-hidden="true" />{label}</OverflowMenuItem>)}
      </OverflowMenu> : null}
    </article>
  );
}
