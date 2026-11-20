import {useEffect, useLayoutEffect, useRef, useState} from "react";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";

type FocusTarget = number | "empty";
type ReviewExit = Readonly<{prepared: PreparedReview; order: number; groupId: string}>;
type ReviewExitGroup = Readonly<{ids: readonly number[]; focusTarget: FocusTarget}>;

export function useReviewExitQueue({source, preparedRows, activeIds, emptyElementId}: {
  source: "bank" | "csv";
  preparedRows: readonly PreparedReview[];
  activeIds: readonly number[];
  emptyElementId: string;
}) {
  const [exitingById, setExitingById] = useState<Record<number, ReviewExit>>({});
  const [exitGroups, setExitGroups] = useState<Record<string, ReviewExitGroup>>({});
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const exitSequence = useRef(0);
  const visibleRows = preparedRows.filter((prepared) => !removedIds.has(prepared.sourceId));
  const displayRows = (() => {
    const rows = new Map<number, {prepared: PreparedReview; order: number}>();
    visibleRows.forEach((prepared, order) => rows.set(prepared.sourceId, {prepared, order}));
    Object.values(exitingById).forEach((exit) => rows.set(exit.prepared.sourceId, {prepared: exit.prepared, order: exit.order}));
    return [...rows.values()].sort((left, right) => left.order - right.order).map(({prepared}) => prepared);
  })();
  const activeIdsKey = activeIds.join(",");

  useEffect(() => {
    const active = new Set(activeIds);
    setRemovedIds((current) => {
      const next = new Set([...current].filter((id) => active.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [activeIdsKey]);

  useLayoutEffect(() => {
    if (focusTarget === null) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusTarget === "empty") document.getElementById(emptyElementId)?.focus({preventScroll: true});
      else document.querySelector<HTMLElement>(`[data-review-item="${source}:${focusTarget}"]`)?.querySelector<HTMLElement>("[data-review-decision-action], button, input, [tabindex]")?.focus({preventScroll: true});
      setFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayRows.length, emptyElementId, exitingById, focusTarget, source]);

  const focusAfterRemoval = (targetIds: ReadonlySet<number>): FocusTarget | null => {
    const ids = visibleRows.map((prepared) => prepared.sourceId);
    const indices = ids.map((id, index) => targetIds.has(id) ? index : -1).filter((index) => index >= 0);
    if (!indices.length) return null;
    if (indices.length === ids.length) return "empty";
    const first = indices[0];
    const next = ids.slice(first + 1).find((id) => !targetIds.has(id));
    if (next !== undefined) return next;
    const previous = ids.slice(0, first).reverse().find((id) => !targetIds.has(id));
    return previous ?? "empty";
  };

  const beginExit = (candidateIds: readonly number[], removedResultIds: readonly number[]) => {
    const candidates = new Set(candidateIds);
    const removed = removedResultIds.filter((id) => candidates.has(id));
    const removedSet = new Set(removed);
    if (!removedSet.size) return removed;
    const removedPrepared = visibleRows.filter((prepared) => removedSet.has(prepared.sourceId) && !exitingById[prepared.sourceId]);
    setRemovedIds((current) => new Set([...current, ...removedSet]));
    if (!removedPrepared.length) return removed;
    const focus = focusAfterRemoval(new Set(removedPrepared.map((prepared) => prepared.sourceId)));
    if (focus === null) return removed;
    const groupId = `${source}-exit-${++exitSequence.current}`;
    const exits = Object.fromEntries(removedPrepared.map((prepared) => [prepared.sourceId, {
      prepared,
      order: visibleRows.findIndex((candidate) => candidate.sourceId === prepared.sourceId),
      groupId,
    }]));
    setExitingById((current) => ({...current, ...exits}));
    setExitGroups((current) => ({...current, [groupId]: {ids: removedPrepared.map((prepared) => prepared.sourceId), focusTarget: focus}}));
    return removed;
  };

  const completeExit = (sourceId: number) => {
    const groupEntry = Object.entries(exitGroups).find(([, group]) => group.ids.includes(sourceId));
    setExitingById((current) => {
      const next = {...current};
      delete next[sourceId];
      return next;
    });
    if (!groupEntry) return;
    const [groupId, group] = groupEntry;
    const remaining = group.ids.filter((id) => id !== sourceId);
    setExitGroups((current) => {
      const next = {...current};
      if (remaining.length) next[groupId] = {...group, ids: remaining};
      else delete next[groupId];
      return next;
    });
    if (!remaining.length) setFocusTarget(group.focusTarget);
  };

  const reset = () => {
    setExitingById({});
    setExitGroups({});
    setRemovedIds(new Set());
    setFocusTarget(null);
  };

  return {visibleRows, displayRows, exitingById, removedIds, beginExit, completeExit, reset};
}
