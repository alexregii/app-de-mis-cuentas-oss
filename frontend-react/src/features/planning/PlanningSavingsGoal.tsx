import {useLayoutEffect, useRef, useState} from "react";
import {BadgeEuro, RefreshCw} from "lucide-react";
import {euro} from "../../format";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {Button} from "../../ui/controls/Button";
import {FormField, Input} from "../../ui/controls/FormField";
import type {PlanningPayload} from "../../shared/model/planning";
import {planningApi as api} from "./api";

export function PlanningSavingsGoal({goal, refreshMargin, setError, setStatus}: {goal: PlanningPayload["goal"]; refreshMargin: () => Promise<void>; setError: (message: string) => void; setStatus: (message: string) => void}) {
  const [draft, setDraft] = useState({percentage: goal.percentage, minimum: goal.minimum, active: goal.active});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [marginPending, setMarginPending] = useState(false);
  const [refreshingMargin, setRefreshingMargin] = useState(false);
  const refreshingMarginRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusAfterRefreshRef = useRef<"retry" | null>(null);
  const refresh = async () => {
    if (refreshingMarginRef.current) return false;
    refreshingMarginRef.current = true;
    setRefreshingMargin(true);
    setError("");
    try {
      await refreshMargin();
      setMarginPending(false);
      setStatus("Objetivo guardado y margen actualizado.");
      return true;
    } catch {
      setMarginPending(true);
      setStatus("Objetivo guardado; margen pendiente de actualizar.");
      focusAfterRefreshRef.current = "retry";
      return false;
    } finally {
      refreshingMarginRef.current = false;
      setRefreshingMargin(false);
    }
  };
  useLayoutEffect(() => {
    const target = focusAfterRefreshRef.current;
    if (!target) return;
    focusAfterRefreshRef.current = null;
    formRef.current?.querySelector<HTMLButtonElement>("[data-margin-retry]")?.focus({preventScroll: true});
  }, [marginPending, refreshingMargin]);
  return <CollapsiblePanel
    title="Objetivo de ahorro"
    detail={goal.active ? "En el margen se descuenta el mayor valor entre porcentaje y mínimo mensual." : "No se descuenta un objetivo de ahorro mientras esté inactivo."}
    summary={<span>{goal.active ? "Activo · " + goal.percentage + " % · mínimo " + euro(goal.minimum) : goal.configured ? "Inactivo" : "Sin configurar"}</span>}
    open={open}
    onToggle={() => setOpen((value) => !value)}
    className="planning-savings-goal"
  >
    <form ref={formRef} className="entry-form" aria-busy={saving} onSubmit={async (event) => {
      event.preventDefault();
      if (savingRef.current || marginPending) return;
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      if (submitter instanceof HTMLButtonElement) submitter.focus({preventScroll: true});
      savingRef.current = true;
      setError(""); setStatus(""); setSaving(true);
      try {
        await api.updateSavingsGoal({percentage: String(draft.percentage), minimum: String(draft.minimum), active: draft.active});
        setMarginPending(true);
        if (await refresh()) setOpen(false);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudo guardar el objetivo de ahorro.");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }}>
      <FormField label="Porcentaje"><Input type="number" min="0" max="100" step="0.01" disabled={saving || marginPending} value={draft.percentage} onChange={(event) => setDraft((current) => ({...current, percentage: Number(event.target.value)}))} /></FormField>
      <FormField label="Mínimo mensual"><Input type="number" min="0" step="0.01" disabled={saving || marginPending} value={draft.minimum} onChange={(event) => setDraft((current) => ({...current, minimum: Number(event.target.value)}))} /></FormField>
      <label className="check-row"><input type="checkbox" disabled={saving || marginPending} checked={draft.active} onChange={(event) => setDraft((current) => ({...current, active: event.target.checked}))} />Objetivo activo</label>
      <div className="planning-goal-actions"><Button variant="primary" fullWidth type="submit" aria-disabled={saving || marginPending || undefined} aria-busy={saving || undefined}><BadgeEuro aria-hidden="true" />{saving ? "Guardando objetivo…" : "Guardar objetivo"}</Button>{marginPending ? <Button data-margin-retry="true" variant="secondary" type="button" aria-disabled={refreshingMargin || undefined} aria-busy={refreshingMargin || undefined} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void refresh().then((updated) => {if (updated) setOpen(false);});}}><RefreshCw aria-hidden="true" />{refreshingMargin ? "Actualizando margen…" : "Reintentar actualización del margen"}</Button> : null}</div>
    </form>
  </CollapsiblePanel>;
}
