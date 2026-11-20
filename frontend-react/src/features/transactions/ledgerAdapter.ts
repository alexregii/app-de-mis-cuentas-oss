import type {Transaction} from "../../shared/model/transactions";
import {toLedgerItem} from "../../shared/adapters/transactionLedgerItem";
import type {LedgerItemCapabilities} from "../../ui/finance/LedgerItem";

export {toLedgerItem} from "../../shared/adapters/transactionLedgerItem";

export type LedgerAdapterContext = Readonly<{
  actionPolicy?: Partial<LedgerItemCapabilities>;
}>;

function isTransfer(transaction: Transaction) {
  return transaction.is_transfer || transaction.kind === "transfer_in" || transaction.kind === "transfer_out";
}

export function toLedgerCapabilities(transaction: Transaction, context: LedgerAdapterContext = {}): LedgerItemCapabilities {
  const canAllocate = transaction.can_allocate !== false && !isTransfer(transaction);
  let base: LedgerItemCapabilities = {edit: false, archive: true, reopen: false, allocate: canAllocate};
  if (isTransfer(transaction)) {
    base = {edit: false, archive: true, reopen: transaction.can_reopen === true, allocate: false};
  } else {
    switch (transaction.source) {
      case "manual":
        base = {edit: true, archive: true, reopen: false, allocate: canAllocate};
        break;
      case "csv":
      case "enable_banking":
        base = {edit: false, archive: true, reopen: true, allocate: canAllocate};
        break;
      default:
        base = {edit: false, archive: true, reopen: false, allocate: canAllocate};
    }
  }
  const policy = context.actionPolicy;
  return {
    edit: base.edit && policy?.edit !== false,
    archive: base.archive && policy?.archive !== false,
    reopen: base.reopen && policy?.reopen !== false,
    allocate: base.allocate && policy?.allocate !== false,
  };
}
