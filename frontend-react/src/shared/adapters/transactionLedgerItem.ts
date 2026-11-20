import type {Transaction} from "../model/transactions";
import type {LedgerItem} from "../../ui/finance/LedgerItem";

function isTransfer(transaction: Transaction) {
  return transaction.is_transfer || transaction.kind === "transfer_in" || transaction.kind === "transfer_out";
}

/**
 * Neutral preparation boundary from the shared transaction domain contract to
 * stable ledger props. It contains no actions, fetching or feature policy.
 */
export function toLedgerItem(transaction: Transaction): LedgerItem {
  const transfer = isTransfer(transaction);
  const allocations = transaction.allocations || [];
  const allocationCategoryNames = allocations.map((item) => item.category?.display_name || "Sin categoría");
  const allocationCategoryLabel = allocationCategoryNames.length
    ? allocationCategoryNames.length > 2
      ? `${allocationCategoryNames.slice(0, 2).join(" · ")} +${allocationCategoryNames.length - 2}`
      : allocationCategoryNames.join(" · ")
    : "";
  return {
    id: String(transaction.id),
    date: transaction.date,
    description: transaction.description,
    signedAmount: Number(transaction.signed_amount),
    kind: transfer ? "transfer" : transaction.kind === "income" ? "income" : "expense",
    account: {name: transaction.account.name, color: transaction.account.color},
    category: allocationCategoryLabel
      ? {name: allocationCategoryLabel, color: allocations[0]?.category?.color || "#8e8e93"}
      : transaction.category ? {name: transaction.category.display_name, color: transaction.category.color} : null,
    ...(transaction.source === "manual" || !transaction.source_display ? {} : {sourceLabel: transaction.source_display}),
    isRefund: transaction.is_refund,
    attachmentCount: transaction.attachments.length,
  };
}
