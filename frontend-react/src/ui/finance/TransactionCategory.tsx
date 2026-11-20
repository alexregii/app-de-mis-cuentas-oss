import {EntityMarker} from "./EntityMarker";
import type {LedgerEntity} from "./LedgerItem";

export function TransactionCategory({category, missingLabel = "Sin categoría"}: {
  category: LedgerEntity | null;
  missingLabel?: string;
}) {
  return category
    ? <span className="ui-transaction-category"><EntityMarker entity={category} kind="category" /></span>
    : <span className="ui-transaction-category is-warning">{missingLabel}</span>;
}
