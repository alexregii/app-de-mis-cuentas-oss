import {useEffect, useRef, useState, type FormEvent} from "react";
import {Copy, Loader2} from "lucide-react";
import {euro, formatMonth} from "../../format";
import {ApiError} from "../../shared/api/client";
import {ErrorBanner} from "../../shared/components/ui";
import {Button} from "../../ui/controls/Button";
import {FormField, Input} from "../../ui/controls/FormField";
import {planningApi, type BudgetCopyPreview} from "./api";

export function BudgetCopyPanel({
  targetMonth,
  disabled = false,
  onClose,
  onPendingChange,
  onApplied,
}: {
  targetMonth: string;
  disabled?: boolean;
  onClose: (restoreFocus?: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onApplied: (budgetId: number, message: string) => Promise<void>;
}) {
  const [sourceMonth, setSourceMonth] = useState("");
  const [preview, setPreview] = useState<BudgetCopyPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    previewRequestRef.current += 1;
    setPreview(null);
    setSelectedIds([]);
    setPreviewing(false);
    setError("");
  }, [targetMonth]);

  const openPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || previewing || copying) return;
    if (!sourceMonth || sourceMonth === targetMonth) {
      setError("Elige un mes de origen distinto al destino.");
      sourceInputRef.current?.focus({preventScroll: true});
      return;
    }
    const requestId = ++previewRequestRef.current;
    const requestedSourceMonth = sourceMonth;
    const requestedTargetMonth = targetMonth;
    setPreview(null);
    setSelectedIds([]);
    setPreviewing(true);
    setError("");
    try {
      const next = await planningApi.previewBudgetCopy(requestedSourceMonth, requestedTargetMonth);
      if (previewRequestRef.current !== requestId) return;
      setPreview(next);
      setSelectedIds(next.items.filter((item) => item.selected_by_default).map((item) => item.category.id));
    } catch (exception) {
      if (previewRequestRef.current === requestId) {
        setError(exception instanceof Error ? exception.message : "No se pudo crear la vista previa. Inténtalo otra vez.");
      }
    } finally {
      if (previewRequestRef.current === requestId) setPreviewing(false);
    }
  };

  const toggleCategory = (categoryId: number) => {
    if (disabled || copying) return;
    setSelectedIds((current) => current.includes(categoryId)
      ? current.filter((id) => id !== categoryId)
      : [...current, categoryId]);
  };

  const copySelected = async () => {
    if (!preview || !selectedIds.length || disabled || copying) return;
    setCopying(true);
    onPendingChange(true);
    setError("");
    try {
      const result = await planningApi.copyBudgets(preview.preview_token, selectedIds);
      const budgetCount = (count: number, singular: string, plural: string) =>
        `${count} presupuesto${count === 1 ? "" : "s"} ${count === 1 ? singular : plural}`;
      const messages = [
        result.created ? budgetCount(result.created, "nuevo", "nuevos") : "",
        result.updated ? budgetCount(result.updated, "actualizado", "actualizados") : "",
        result.unchanged ? budgetCount(result.unchanged, "ya coincidía con el origen", "ya coincidían con el origen") : "",
      ].filter(Boolean);
      const budgetId = result.budget_ids[0];
      if (!budgetId) throw new Error("No se encontró el resultado de la copia. Actualiza Plan.");
      const message = messages.length
        ? `Copia completada: ${messages.join(", ")}.`
        : "Los límites seleccionados ya estaban actualizados.";
      await onApplied(budgetId, message);
      setPreview(null);
      setSelectedIds([]);
      onClose(false);
    } catch (exception) {
      const stale = exception instanceof ApiError && exception.status === 409;
      setError(stale
        ? `${exception.message} Genera una nueva vista previa antes de reintentar.`
        : exception instanceof Error ? exception.message : "No se pudo completar la copia. Reinténtala.");
      if (stale) {
        setPreview(null);
        setSelectedIds([]);
        window.setTimeout(() => sourceInputRef.current?.focus({preventScroll: true}), 0);
      }
    } finally {
      setCopying(false);
      onPendingChange(false);
    }
  };

  const selectedExisting = preview?.items.filter((item) => item.status === "existing" && selectedIds.includes(item.category.id)).length || 0;
  const copyLabel = selectedIds.length === 0
    ? "Selecciona presupuestos"
    : selectedIds.length === 1 ? "Copiar 1 presupuesto" : `Copiar ${selectedIds.length} presupuestos`;
  const countLabel = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;
  const newCount = preview?.items.filter((item) => item.status === "new").length || 0;
  const existingCount = preview?.items.filter((item) => item.status === "existing").length || 0;
  const inactiveCount = preview?.items.filter((item) => item.status === "inactive").length || 0;
  const previewSummary = preview
    ? `Vista previa: ${countLabel(newCount, "presupuesto nuevo", "presupuestos nuevos")}, ${countLabel(existingCount, "presupuesto existente", "presupuestos existentes")} y ${countLabel(inactiveCount, "categoría inactiva", "categorías inactivas")}.`
    : "";

  return (
    <section id="planning-budget-copy-panel" className="budget-copy-panel" aria-label="Copiar presupuestos de otro mes" aria-busy={previewing || copying}>
      <div className="budget-copy-intro">
        <p>Elige un mes de origen. Los límites existentes solo cambian si marcas su categoría.</p>
        <p>Destino: <strong>{formatMonth(`${targetMonth}-01`)}</strong></p>
      </div>
      <form className="budget-copy-form" onSubmit={(event) => void openPreview(event)}>
        <FormField label="Mes de origen">
          <Input
            ref={sourceInputRef}
            name="budget-copy-source-month"
            type="month"
            required
            readOnly={previewing || copying || undefined}
            value={sourceMonth}
            onChange={(event) => {
              previewRequestRef.current += 1;
              setSourceMonth(event.target.value);
              setPreview(null);
              setSelectedIds([]);
              setError("");
            }}
          />
        </FormField>
        <div className="budget-copy-actions">
          <Button
            variant="secondary"
            type="button"
            aria-disabled={disabled || previewing || copying || undefined}
            onClick={() => {if (!disabled && !previewing && !copying) onClose(true);}}
          >Cancelar</Button>
          <Button
            variant="secondary"
            type="submit"
            aria-disabled={disabled || previewing || copying || !sourceMonth || sourceMonth === targetMonth || undefined}
            aria-busy={previewing || undefined}
          >
            {previewing ? <Loader2 className="spin" aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {previewing ? "Preparando…" : preview ? "Actualizar vista previa" : "Ver vista previa"}
          </Button>
        </div>
      </form>
      {error ? <ErrorBanner message={error} /> : null}
      {preview ? <div className="budget-copy-preview">
        <p role="status">
          {previewSummary}
        </p>
        {preview.items.length ? <fieldset className="budget-copy-list">
          <legend>Selecciona los presupuestos que copiarás</legend>
          <ul>
            {preview.items.map((item) => {
              const categoryId = item.category.id;
              const label = item.status === "existing"
                ? `Sobrescribir presupuesto de ${item.category.display_name}`
                : `Copiar presupuesto de ${item.category.display_name}`;
              const target = item.destination_limit === null ? "Sin presupuesto en el destino" : `Destino: ${euro(Number(item.destination_limit))}`;
              const statusLabel = item.status === "new" ? "Nuevo" : item.status === "existing" ? "Existe" : item.status === "inactive" ? "Inactiva" : "No compatible";
              return <li key={categoryId}>
                <label className={`budget-copy-item${!item.can_copy ? " is-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={selectedIds.includes(categoryId)}
                    disabled={!item.can_copy || copying || disabled}
                    onChange={() => toggleCategory(categoryId)}
                  />
                  <span className="budget-copy-item-copy">
                    <strong>{item.category.display_name}</strong>
                    <small>Origen: {euro(Number(item.source_limit))} · {target}</small>
                  </span>
                  <span className="status-chip">{statusLabel}</span>
                </label>
              </li>;
            })}
          </ul>
        </fieldset> : <p className="budget-copy-empty">No hay presupuestos en el mes de origen.</p>}
        {preview.items.length && !preview.items.some((item) => item.can_copy) ? <p className="budget-copy-empty">No hay categorías activas que se puedan copiar.</p> : null}
        {selectedExisting ? <p className="budget-copy-warning">Se actualizarán {selectedExisting} presupuesto{selectedExisting === 1 ? "" : "s"} existente{selectedExisting === 1 ? "" : "s"}.</p> : null}
        <div className="budget-copy-confirm">
          <Button
            variant="primary"
            type="button"
            aria-disabled={disabled || !selectedIds.length || copying || undefined}
            aria-busy={copying || undefined}
            onClick={() => void copySelected()}
          >
            {copying ? <Loader2 className="spin" aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copying ? "Copiando…" : copyLabel}
          </Button>
        </div>
      </div> : null}
    </section>
  );
}
