import {useEffect, useRef, useState, type FormEvent, type MouseEvent} from "react";
import type {BootstrapPayload} from "../../shared/model/bootstrap";
import {Button} from "../../ui/controls/Button";
import {buildTransactionParams, type TransactionUrlFilters} from "./transactionModel";
import {
  MAX_SAVED_TRANSACTION_VIEWS,
  SAVED_TRANSACTION_VIEWS_KEY,
  localMonthValue,
  readSavedTransactionViews,
  resolveSavedTransactionView,
  savedTransactionViewFilters,
  writeSavedTransactionViews,
  type SavedTransactionView,
  type SavedTransactionViewDateMode,
} from "./savedTransactionViews";

type EditorMode = "save" | "rename" | null;

export function SavedTransactionViewsPanel({filters, bootstrap, canSave, onOpenView, disabled = false}: {
  filters: TransactionUrlFilters;
  bootstrap: BootstrapPayload;
  canSave: boolean;
  onOpenView?: (search: URLSearchParams) => void;
  disabled?: boolean;
}) {
  const [views, setViews] = useState(readSavedTransactionViews);
  const [selectedId, setSelectedId] = useState("");
  const [openedId, setOpenedId] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [dateMode, setDateMode] = useState<SavedTransactionViewDateMode>("fixed");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const selectedView = views.find(({id}) => id === selectedId) || null;
  const currentMonth = localMonthValue(new Date());
  const canSaveCurrentMonthAsRelative = filters.month === currentMonth && !filters.dateFrom && !filters.dateTo;

  useEffect(() => {
    if (editorMode) nameInputRef.current?.focus({preventScroll: true});
  }, [editorMode]);

  useEffect(() => {
    const refreshViews = (event: StorageEvent) => {
      if (event.key !== SAVED_TRANSACTION_VIEWS_KEY) return;
      const next = readSavedTransactionViews();
      setViews(next);
      setSelectedId((current) => next.some(({id}) => id === current) ? current : "");
      setOpenedId((current) => next.some(({id}) => id === current) ? current : "");
    };
    window.addEventListener("storage", refreshViews);
    return () => window.removeEventListener("storage", refreshViews);
  }, []);

  const reportStorageFailure = () => {
    setError("No se pudieron guardar las vistas. Comprueba el almacenamiento del navegador e inténtalo de nuevo.");
    setMessage("");
  };

  const startSave = (event: MouseEvent<HTMLButtonElement>) => {
    if (views.length >= MAX_SAVED_TRANSACTION_VIEWS) {
      setError(`Has llegado al máximo de ${MAX_SAVED_TRANSACTION_VIEWS} vistas. Elimina una para guardar otra.`);
      setMessage("");
      return;
    }
    editorTriggerRef.current = event.currentTarget;
    setEditingViewId(null);
    setEditorName("");
    setDateMode(canSaveCurrentMonthAsRelative ? "current-month" : "fixed");
    setEditorMode("save");
    setError("");
    setMessage("");
  };

  const startRename = (event: MouseEvent<HTMLButtonElement>) => {
    if (!selectedView) return;
    editorTriggerRef.current = event.currentTarget;
    setEditingViewId(selectedView.id);
    setEditorName(selectedView.name);
    setDateMode(selectedView.dateMode);
    setEditorMode("rename");
    setError("");
    setMessage("");
  };

  const closeEditor = () => {
    setEditorMode(null);
    setEditingViewId(null);
    window.requestAnimationFrame(() => editorTriggerRef.current?.focus({preventScroll: true}));
  };

  const saveEditor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = editorName.trim();
    if (!name) {
      setError("Escribe un nombre para la vista.");
      setMessage("");
      nameInputRef.current?.focus({preventScroll: true});
      return;
    }
    const editing = editorMode === "rename" ? views.find(({id}) => id === editingViewId) || null : null;
    if (editorMode === "rename" && !editing) return;
    const id = editing?.id || window.crypto?.randomUUID?.() || `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nextView: SavedTransactionView = {
      id,
      name,
      filters: savedTransactionViewFilters(filters),
      dateMode: editing ? editing.dateMode : dateMode,
    };
    const next = editing
      ? views.map((view) => view.id === editing.id ? {...view, name} : view)
      : [nextView, ...views];
    if (!writeSavedTransactionViews(next)) {
      reportStorageFailure();
      return;
    }
    setViews(next);
    setSelectedId(id);
    setOpenedId("");
    setError("");
    setMessage(editing ? "Nombre actualizado." : "Vista guardada en este dispositivo.");
    closeEditor();
  };

  const removeSelected = () => {
    if (!selectedView) return;
    const next = views.filter(({id}) => id !== selectedView.id);
    if (!writeSavedTransactionViews(next)) {
      reportStorageFailure();
      return;
    }
    setViews(next);
    setSelectedId("");
    setOpenedId("");
    setError("");
    setMessage("Vista eliminada.");
  };

  const openSelected = () => {
    if (!selectedView || !onOpenView) return;
    const nextFilters = resolveSavedTransactionView(selectedView);
    const search = buildTransactionParams(nextFilters, {compact: true});
    if (!search.size) search.set("page", "1");
    onOpenView(search);
    setOpenedId(selectedView.id);
    setError("");
    setMessage(`Vista «${selectedView.name}» abierta.`);
  };

  const unavailableFilters: string[] = [];
  if (selectedView && openedId === selectedView.id) {
    const {account, category, categoryFamily} = selectedView.filters;
    const accountOption = account ? bootstrap.accounts.find((item) => String(item.id) === account) : null;
    if (account && (!accountOption || !accountOption.active)) unavailableFilters.push(`cuenta #${account}`);
    const categoryOption = category ? bootstrap.categories.find((item) => String(item.id) === category) : null;
    if (category && (!categoryOption || !categoryOption.active || categoryOption.merged_into)) unavailableFilters.push(`categoría #${category}`);
    if (categoryFamily && categoryFamily !== "uncategorized") {
      const familyOption = bootstrap.categories.find((item) => String(item.id) === categoryFamily);
      if (!familyOption || !familyOption.active || familyOption.merged_into) unavailableFilters.push(`familia de categoría #${categoryFamily}`);
    }
  }

  return <section className="transactions-saved-views" aria-label="Vistas guardadas">
    <label className="transactions-saved-views__select">Vistas guardadas
      <select className="ui-select" aria-label="Vistas guardadas" value={selectedId} disabled={disabled || Boolean(editorMode) || !views.length} onChange={(event) => {if (editorMode) return; setSelectedId(event.target.value); setOpenedId(""); setMessage(""); setError("");}}>
        <option value="">Selecciona una vista</option>
        {views.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    <Button variant="secondary" disabled={disabled || Boolean(editorMode) || !selectedView || !onOpenView} onClick={openSelected}>Abrir vista</Button>
    <Button variant="secondary" disabled={disabled || Boolean(editorMode) || !selectedView} onClick={startRename}>Renombrar</Button>
    <Button variant="secondary" disabled={disabled || Boolean(editorMode) || !selectedView} onClick={removeSelected}>Eliminar vista</Button>
    <Button variant="secondary" disabled={!canSave || Boolean(editorMode)} onClick={startSave}>Guardar filtros actuales</Button>
    {!canSave ? <span className="transactions-saved-views__hint">Quita el contexto estadístico o la selección para guardar una vista.</span> : null}
    {editorMode ? <form className="transactions-saved-views__editor" aria-label={editorMode === "save" ? "Guardar vista" : "Renombrar vista"} onSubmit={saveEditor}>
      <label>Nombre de la vista
        <input className="ui-input" ref={nameInputRef} autoComplete="off" maxLength={60} required value={editorName} onChange={(event) => setEditorName(event.target.value)} onKeyDown={(event) => {if (event.key === "Escape") {event.preventDefault(); closeEditor();}}} />
      </label>
      {editorMode === "save" && canSaveCurrentMonthAsRelative ? <label className="transactions-saved-views__relative">
        <input type="checkbox" checked={dateMode === "current-month"} onChange={(event) => setDateMode(event.target.checked ? "current-month" : "fixed")} />
        Usar el mes actual cuando abra esta vista
      </label> : null}
      <Button type="submit">{editorMode === "save" ? "Guardar vista" : "Guardar nombre"}</Button>
      <Button type="button" variant="secondary" onClick={closeEditor}>Cancelar</Button>
    </form> : null}
    {error ? <p className="transactions-saved-views__feedback" role="alert">{error}</p> : null}
    {message ? <p className="transactions-saved-views__feedback" role="status" aria-live="polite">{message}</p> : null}
    {unavailableFilters.length ? <p className="transactions-saved-views__feedback" role="alert">La vista conserva filtros de {unavailableFilters.join(" y ")} que ya no están activos. Revisa o quita esos criterios para ampliar los resultados.</p> : null}
  </section>;
}
