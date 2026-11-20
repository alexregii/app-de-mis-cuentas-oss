import {useRef, useState} from "react";
import type {Dispatch, SetStateAction} from "react";
import {reviewApi} from "./api";
import {toPreparedBankReview} from "./adapters/bankReviewAdapter";
import {reviewDraftEquals} from "./adapters/reviewDraft";
import type {ReviewDraft} from "./adapters/reviewAdapterTypes";
import type {Connection} from "../../shared/model/accounts";
import type {BankReviewPayload} from "./types";

export function useBankReviewState(
  connections: Connection[],
  setDrafts: Dispatch<SetStateAction<Record<number, ReviewDraft>>>,
  setSelectedRows: Dispatch<SetStateAction<number[]>>,
) {
  const [bank, setBank] = useState<BankReviewPayload | null>(null);
  const payloadRef = useRef<BankReviewPayload | null>(null);
  const requestIdRef = useRef(0);

  const applyPayload = (payload: BankReviewPayload) => {
    const previousRows = payloadRef.current?.rows || [];
    const accounts = connections.flatMap((connection) => connection.accounts);
    setBank(payload);
    payloadRef.current = payload;
    setDrafts((current) => Object.fromEntries(payload.rows.map((row) => {
      const prepared = toPreparedBankReview(row, undefined, payload.categories, accounts);
      const previousRow = previousRows.find((candidate) => candidate.id === row.id);
      const previousBaseline = previousRow ? toPreparedBankReview(previousRow, undefined, payload.categories, accounts)?.draft : undefined;
      const localDraft = current[row.id];
      const preserveDirtyDraft = Boolean(localDraft && previousBaseline && !reviewDraftEquals(localDraft, previousBaseline));
      return [row.id, preserveDirtyDraft ? localDraft : prepared?.draft];
    }).filter((entry): entry is [number, ReviewDraft] => Boolean(entry[1]))));
    setSelectedRows((current) => current.filter((id) => payload.rows.some((row) => row.id === id && row.status === "pending")));
  };

  const loadBank = async () => {
    const requestId = ++requestIdRef.current;
    const payload = await reviewApi.bankReview();
    if (requestId === requestIdRef.current) applyPayload(payload);
  };

  const removeBankRows = (ids: readonly number[]) => {
    const removed = new Set(ids);
    if (!removed.size) return;
    setBank((current) => current ? {
      ...current,
      rows: current.rows.filter((row) => !removed.has(row.id)),
      unlinked_transfers: current.unlinked_transfers?.filter((row) => !removed.has(row.id)),
    } : current);
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(Number(id)))));
    setSelectedRows((current) => current.filter((id) => !removed.has(id)));
  };

  return {bank, loadBank, removeBankRows};
}
