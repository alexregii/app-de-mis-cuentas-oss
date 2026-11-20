import {useEffect, useRef, useState} from "react";
import {bankingApi} from "../../shared/api/banking";
import {ApiError, hasFreshPrefetchedGet} from "../../shared/api/client";
import {importsApi} from "../../shared/api/imports";
import {reviewApi} from "./api";
import type {Connection} from "../../shared/model/accounts";
import type {ImportPayload, ImportRowsPayload} from "../../shared/model/imports";
import {toPreparedCsvReview} from "./adapters/csvReviewAdapter";
import {useBankReviewState} from "./useBankReviewState";
import type {BankReviewAction, BankReviewActionInput, BankReviewBulkInput, CsvReviewActionRequest, CsvReviewBulkInput, ReviewDraft} from "./adapters/reviewAdapterTypes";
import {getDirtyCsvDraftIdsForBatch as findDirtyCsvDraftIdsForBatch, reconcileCsvDrafts} from "./reconcileCsvDrafts";

export type CsvStatusFilter = "pending" | "all";

export type BankReviewMutationResult = Readonly<{
  ok: true;
  removed: readonly number[];
  failed: readonly number[];
}>;

type BankReviewMutationObserver = (result: BankReviewMutationResult) => void;
export type CsvReviewMutationResult = BankReviewMutationResult;
type CsvReviewMutationObserver = (result: CsvReviewMutationResult) => void;
type ReviewActionFeedback = Readonly<{kind: "status" | "error"; message: string}>;

export function useReviewData(connections: Connection[], isActive = true) {
  const [imports, setImports] = useState<ImportPayload | null>(null);
  const [rows, setRows] = useState<ImportRowsPayload | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [csvPage, setCsvPage] = useState(1);
  const [csvStatusFilter, setCsvStatusFilter] = useState<CsvStatusFilter>("pending");
  const [selectedBankRows, setSelectedBankRows] = useState<number[]>([]);
  const [selectedCsvRows, setSelectedCsvRows] = useState<number[]>([]);
  const [bankDraftById, setBankDraftById] = useState<Record<number, ReviewDraft>>({});
  const [csvDraftById, setCsvDraftById] = useState<Record<number, ReviewDraft>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [bankActionFeedback, setBankActionFeedback] = useState<ReviewActionFeedback | null>(null);
  const [csvActionFeedback, setCsvActionFeedback] = useState<ReviewActionFeedback | null>(null);
  const [csvExpanded, setCsvExpanded] = useState(false);
  const [syncingBank, setSyncingBank] = useState(false);
  const [csvBulkBusy, setCsvBulkBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [csvRowsRefreshToken, setCsvRowsRefreshToken] = useState(0);
  const explicitBatchEffectRef = useRef<string | null>(null);
  const csvRowsRequestIdRef = useRef(0);
  const consumedCsvRowsRefreshTokenRef = useRef(0);
  const selectedBatchIntentRef = useRef<number | null>(null);
  const csvBulkBusyRef = useRef(false);
  const preloadedCsvRowsRef = useRef(new Map<string, ImportRowsPayload>());
  const csvDraftBaselineByIdRef = useRef<Record<number, ReviewDraft>>({});
  const csvRowBatchIdByIdRef = useRef<Record<number, number>>({});
  const hasLoadedRef = useRef(false);
  const {bank, loadBank, removeBankRows} = useBankReviewState(connections, setBankDraftById, setSelectedBankRows);

  const beginCsvBulk = () => {
    if (csvBulkBusyRef.current) return false;
    csvBulkBusyRef.current = true;
    setCsvBulkBusy(true);
    return true;
  };

  const endCsvBulk = () => {
    csvBulkBusyRef.current = false;
    setCsvBulkBusy(false);
  };

  const applyCsvRows = (payload: ImportRowsPayload, resetDraftIds: readonly number[] = []) => {
    const resetIds = new Set(resetDraftIds);
    const previousRows = rows?.results || [];
    const previousBatch = rows?.batch;
    const previousBaselines = {...csvDraftBaselineByIdRef.current};
    payload.results.forEach((row) => {
      const prepared = toPreparedCsvReview(row, payload.batch, undefined, payload.categories);
      if (prepared) {
        csvRowBatchIdByIdRef.current[row.id] = payload.batch.id;
        csvDraftBaselineByIdRef.current[row.id] = prepared.draft;
      } else {
        delete csvRowBatchIdByIdRef.current[row.id];
        delete csvDraftBaselineByIdRef.current[row.id];
      }
    });
    resetIds.forEach((id) => {
      delete csvRowBatchIdByIdRef.current[id];
      delete csvDraftBaselineByIdRef.current[id];
    });
    setRows(payload);
    setSelectedCsvRows((current) => current.filter((id) => payload.results.some((row) => row.id === id && row.status === "pending")));
    setCsvDraftById((current) => reconcileCsvDrafts(current, payload, previousRows, previousBatch, previousBaselines, resetIds));
  };

  const removeCsvDraftsForBatch = (batchId: number) => {
    const ids = Object.entries(csvRowBatchIdByIdRef.current)
      .filter(([, currentBatchId]) => currentBatchId === batchId)
      .map(([id]) => Number(id));
    ids.forEach((id) => {
      delete csvRowBatchIdByIdRef.current[id];
      delete csvDraftBaselineByIdRef.current[id];
    });
    if (!ids.length) return;
    const idSet = new Set(ids);
    setCsvDraftById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !idSet.has(Number(id)))));
    setSelectedCsvRows((current) => current.filter((id) => !idSet.has(id)));
  };

  const selectCsvBatch = (batchId: number | null) => {
    if (batchId === selectedBatchId && selectedBatchIntentRef.current === batchId) return;
    selectedBatchIntentRef.current = batchId;
    csvRowsRequestIdRef.current += 1;
    explicitBatchEffectRef.current = null;
    if (batchId === selectedBatchId) setReloadToken((value) => value + 1);
    else setSelectedBatchId(batchId);
  };

  const getDirtyCsvDraftIdsForBatch = (batchId: number) => findDirtyCsvDraftIdsForBatch(csvDraftById, csvRowBatchIdByIdRef.current, csvDraftBaselineByIdRef.current, batchId);

  const load = async () => {
    const [, importPayload] = await Promise.all([loadBank(), importsApi.imports()]);
    setImports(importPayload);
    if (!selectedBatchId && !selectedBatchIntentRef.current && importPayload.batches[0]) {
      selectedBatchIntentRef.current = importPayload.batches[0].id;
      setSelectedBatchId(importPayload.batches[0].id);
    }
  };

  useEffect(() => {
    const rowsPath = selectedBatchId ? `/api/imports/${selectedBatchId}/rows/?page=${csvPage}${csvStatusFilter === "pending" ? "&status=pending" : ""}` : "";
    const fresh = hasFreshPrefetchedGet("/api/bank-review/")
      && hasFreshPrefetchedGet("/api/imports/")
      && (!rowsPath || hasFreshPrefetchedGet(rowsPath));
    const shouldLoad = !hasLoadedRef.current || (isActive && !fresh) || reloadToken > 0;
    if (!shouldLoad) return;
    hasLoadedRef.current = true;
    setError("");
    load().catch((exc) => setError(exc instanceof Error ? exc.message : "No se pudo cargar la revisión."));
  }, [csvPage, csvStatusFilter, isActive, reloadToken, selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId) return;
    const params = new URLSearchParams({page: String(csvPage)});
    if (csvStatusFilter === "pending") params.set("status", "pending");
    const key = `${selectedBatchId}:${params.toString()}`;
    if (explicitBatchEffectRef.current === key) { explicitBatchEffectRef.current = null; return; }
    const path = `/api/imports/${selectedBatchId}/rows/?${params.toString()}`;
    const forceRefresh = csvRowsRefreshToken !== consumedCsvRowsRefreshTokenRef.current;
    if (isActive && rowsRef.current && hasFreshPrefetchedGet(path) && !forceRefresh) return;
    consumedCsvRowsRefreshTokenRef.current = csvRowsRefreshToken;
    const requestId = ++csvRowsRequestIdRef.current;
    importsApi.importRows(selectedBatchId, params)
      .then((payload) => {
        if (requestId !== csvRowsRequestIdRef.current || selectedBatchIntentRef.current !== selectedBatchId) return;
        applyCsvRows(payload);
        setSelectedCsvRows([]);
      })
      .catch((exc) => {
        if (requestId === csvRowsRequestIdRef.current && selectedBatchIntentRef.current === selectedBatchId) setError(exc instanceof Error ? exc.message : "No se pudo cargar el lote CSV.");
      });
  }, [csvPage, csvStatusFilter, csvRowsRefreshToken, isActive, reloadToken, selectedBatchId]);

  const openCsvBatch = async (batchId: number) => {
    selectedBatchIntentRef.current = batchId;
    const requestId = ++csvRowsRequestIdRef.current;
    const params = new URLSearchParams({page: "1", status: "pending"});
    const key = `${batchId}:${params.toString()}`;
    const selectionChanges = selectedBatchId !== batchId || csvPage !== 1 || csvStatusFilter !== "pending";
    setError("");
    try {
      const [importPayload, rowsPayload] = await Promise.all([importsApi.imports(), importsApi.importRows(batchId, params)]);
      if (requestId !== csvRowsRequestIdRef.current || selectedBatchIntentRef.current !== batchId) return;
      if (!importPayload.batches.some((batch) => batch.id === batchId)) throw new Error("No se encontró el lote CSV recién subido.");
      setImports(importPayload);
      if (selectionChanges) explicitBatchEffectRef.current = key;
      setSelectedBatchId(batchId);
      setCsvPage(1);
      setCsvStatusFilter("pending");
      setCsvExpanded(true);
      setSelectedCsvRows([]);
      applyCsvRows(rowsPayload);
    } catch (error) {
      if (requestId === csvRowsRequestIdRef.current) {
        explicitBatchEffectRef.current = null;
        selectedBatchIntentRef.current = selectedBatchId;
        if (selectedBatchId !== null) setCsvRowsRefreshToken((value) => value + 1);
      }
      throw error;
    }
  };

  const refreshAll = async (resetCsvDraftIds: readonly number[] = [], batchId: number | null = selectedBatchId) => {
    if (batchId !== null && selectedBatchIntentRef.current !== batchId) {
      await load();
      return;
    }
    const requestId = ++csvRowsRequestIdRef.current;
    await load();
    if (batchId !== null && requestId === csvRowsRequestIdRef.current && selectedBatchIntentRef.current === batchId) {
      try {
        const params = new URLSearchParams({page: String(csvPage)});
        if (csvStatusFilter === "pending") params.set("status", "pending");
        const payload = await importsApi.importRows(batchId, params);
        if (requestId === csvRowsRequestIdRef.current && selectedBatchIntentRef.current === batchId) applyCsvRows(payload, resetCsvDraftIds);
      } catch (exc) {
        if (requestId !== csvRowsRequestIdRef.current || selectedBatchIntentRef.current !== batchId) return;
        if (exc instanceof ApiError && exc.status === 404) selectCsvBatch(null);
        else throw exc;
      }
    }
  };

  const syncBankConnections = async () => {
    if (!connections.length || syncingBank) return;
    setSyncingBank(true);
    setError("");
    try {
      const results = await Promise.allSettled(connections.map((connection) => bankingApi.syncBank(connection.id)));
      const completed = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - completed;
      if (completed) setStatus(completed === 1 ? "Sincronización bancaria solicitada." : `Sincronización solicitada para ${completed} conexiones.`);
      if (failed) setError(`${failed} ${failed === 1 ? "conexión no pudo" : "conexiones no pudieron"} iniciar la sincronización. Revisa su estado e inténtalo de nuevo.`);
      await refreshAll();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "No se pudo iniciar la sincronización bancaria.");
    } finally {
      setSyncingBank(false);
    }
  };

  const runBankReviewAction = async (id: number, action: BankReviewAction, input: BankReviewActionInput = {}, onResult?: BankReviewMutationObserver) => {
    setError("");
    setBankActionFeedback(null);
    let removed: readonly number[] = [];
    try {
      const response = await reviewApi.bankReviewAction(id, action, input);
      removed = response.removed;
      const message = action === "confirm" ? "Movimiento bancario importado." : action === "force" ? "Movimiento bancario importado igualmente." : action === "transfer" ? "Traspaso bancario enlazado y contabilizado." : "Movimiento bancario omitido.";
      setBankActionFeedback({kind: "status", message});
      onResult?.({ok: true, removed: response.removed, failed: []});
    } catch (exc) {
      setBankActionFeedback({kind: "error", message: exc instanceof Error ? `No se pudo aplicar la acción bancaria: ${exc.message}` : "No se pudo aplicar la acción bancaria."});
      return false;
    }
    try {
      await loadBank();
    } catch (exc) {
      removeBankRows(removed);
      setBankActionFeedback({kind: "error", message: exc instanceof Error ? `La acción bancaria se completó, pero no se pudo actualizar la cola: ${exc.message}. Reintenta.` : "La acción bancaria se completó, pero no se pudo actualizar la cola. Reintenta."});
    }
    return true;
  };

  const runBankBulkAction = async (input: BankReviewBulkInput, onResult?: BankReviewMutationObserver) => {
    setError("");
    let result: Awaited<ReturnType<typeof reviewApi.bankReviewBulk>>;
    try {
      result = await reviewApi.bankReviewBulk(input);
    } catch (exc) {
      setError(exc instanceof Error ? `No se pudo aplicar la acción bancaria masiva: ${exc.message}` : "No se pudo aplicar la acción bancaria masiva.");
      return false;
    }
    if (result.failed.length) setError(result.message);
    else setStatus(result.message);
    onResult?.({ok: true, removed: result.removed, failed: result.failed});
    try {
      await loadBank();
    } catch (exc) {
      removeBankRows(result.removed);
      setError(exc instanceof Error ? `La acción bancaria se completó, pero no se pudo actualizar la cola: ${exc.message}. Reintenta.` : "La acción bancaria se completó, pero no se pudo actualizar la cola. Reintenta.");
    }
    return result.failed.length === 0;
  };

  const runCsvReviewAction = async (id: number, input: CsvReviewActionRequest, onResult?: CsvReviewMutationObserver) => {
    if (csvBulkBusyRef.current) return false;
    setCsvActionFeedback(null);
    let response: Awaited<ReturnType<typeof importsApi.importRowAction>>;
    try {
      response = await importsApi.importRowAction(id, input);
    } catch (exc) {
      setCsvActionFeedback({kind: "error", message: exc instanceof Error ? `No se pudo procesar la fila CSV: ${exc.message}` : "No se pudo procesar la fila CSV."});
      return false;
    }
    onResult?.({ok: true, removed: response.removed || [], failed: []});
    try {
      await refreshAll([id]);
    } catch (exc) {
      setCsvActionFeedback({kind: "error", message: exc instanceof Error ? `La acción CSV se completó, pero no se pudo actualizar la cola: ${exc.message}. Reintenta.` : "La acción CSV se completó, pero no se pudo actualizar la cola. Reintenta."});
      return true;
    }
    setCsvActionFeedback({kind: "status", message: response.message || (input.action === "category" ? "Categoría de fila actualizada." : "Fila CSV procesada.")});
    return true;
  };

  const runCsvBulkAction = async (batchId: number, input: CsvReviewBulkInput, onResult?: CsvReviewMutationObserver) => {
    if (!beginCsvBulk()) return false;
    setCsvActionFeedback(null);
    try {
      const response = await importsApi.importBulk(batchId, input);
      onResult?.({ok: true, removed: response.removed, failed: response.failed});
      setCsvActionFeedback({kind: response.failed.length ? "error" : "status", message: response.message});
      try {
        await refreshAll(response.removed);
      } catch (exc) {
        setCsvActionFeedback({kind: "error", message: exc instanceof Error ? `La acción CSV masiva se completó, pero no se pudo actualizar la cola: ${exc.message}. Reintenta.` : "La acción CSV masiva se completó, pero no se pudo actualizar la cola. Reintenta."});
      }
      return response.failed.length === 0;
    } catch (exc) {
      setCsvActionFeedback({kind: "error", message: exc instanceof Error ? `No se pudo aplicar la acción masiva CSV: ${exc.message}` : "No se pudo aplicar la acción masiva CSV."});
      return false;
    } finally {
      endCsvBulk();
    }
  };

  const runCsvSafeBulkAction = async (batchId: number, dirtyIds: readonly number[], onResult?: CsvReviewMutationObserver) => {
    if (dirtyIds.length) {
      setCsvActionFeedback({kind: "error", message: "Hay cambios locales sin guardar en filas de este lote. Guárdalos antes de confirmar el lote seguro."});
      return false;
    }
    if (!beginCsvBulk()) return false;
    setCsvActionFeedback(null);
    try {
      const response = await importsApi.confirmImportBatch(batchId);
      const removed = response.removed || [];
      onResult?.({ok: true, removed, failed: []});
      setCsvActionFeedback({kind: "status", message: response.message});
      try {
        await refreshAll(removed);
      } catch (exc) {
        setCsvActionFeedback({kind: "error", message: exc instanceof Error ? `El lote CSV se confirmó, pero no se pudo actualizar la cola: ${exc.message}. Reintenta.` : "El lote CSV se confirmó, pero no se pudo actualizar la cola. Reintenta."});
      }
      return true;
    } catch (exc) {
      setCsvActionFeedback({kind: "error", message: exc instanceof Error ? `No se pudo confirmar el lote CSV: ${exc.message}` : "No se pudo confirmar el lote CSV."});
      return false;
    } finally {
      endCsvBulk();
    }
  };

  return {
    bank,
    imports,
    rows,
    setRows,
    selectedBatchId,
    setSelectedBatchId: selectCsvBatch,
    csvPage,
    setCsvPage,
    csvStatusFilter,
    setCsvStatusFilter,
    selectedBankRows,
    setSelectedBankRows,
    removeBankRows,
    selectedCsvRows,
    setSelectedCsvRows,
    bankDraftById,
    setBankDraftById,
    csvDraftById,
    setCsvDraftById,
    error,
    status,
    bankActionFeedback,
    csvActionFeedback,
    setStatus,
    csvExpanded,
    setCsvExpanded,
    syncingBank,
    csvBulkBusy,
    setReloadToken,
    refreshAll,
    openCsvBatch,
    syncBankConnections,
    runBankReviewAction,
    runBankBulkAction,
    runCsvReviewAction,
    runCsvBulkAction,
    runCsvSafeBulkAction,
    getDirtyCsvDraftIdsForBatch,
    removeCsvDraftsForBatch,
  };
}

export type ReviewData = ReturnType<typeof useReviewData>;
