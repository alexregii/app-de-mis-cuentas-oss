import {useCallback, useState} from "react";
import type {Transaction} from "../../shared/model/transactions";

export function useTransactionSelection(items: Transaction[]) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedMovements = items.filter((item) => selectedIds.includes(item.id));
  const canCategorize = selectedMovements.length > 0 && selectedMovements.every((item) => !item.is_transfer && !item.allocations?.length && item.kind === selectedMovements[0].kind);

  const selectId = (id: number, shiftKey: boolean) => setSelectedIds((current) => {
    if (shiftKey && current.length) {
      const start = items.findIndex((item) => item.id === current[current.length - 1]);
      const end = items.findIndex((item) => item.id === id);
      if (start >= 0 && end >= 0) return [...new Set([...current, ...items.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.id)])];
    }
    return current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id];
  });

  const select = (movement: Transaction, shiftKey: boolean) => selectId(movement.id, shiftKey);
  const selectById = (id: number, shiftKey: boolean) => selectId(id, shiftKey);

  const clear = useCallback(() => setSelectedIds([]), []);
  return {selectedIds, selectedMovements, canCategorize, select, selectById, clear};
}
