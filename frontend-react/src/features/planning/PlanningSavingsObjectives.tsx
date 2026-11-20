import {useEffect, useLayoutEffect, useRef, useState, type FormEvent} from "react";
import {euro} from "../../format";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {ApiError} from "../../shared/api/client";
import type {PlanningPayload} from "../../shared/model/planning";
import {planningApi as api} from "./api";
import type {SavingsObjectiveAllocation, SavingsObjectiveCreate, SavingsObjectiveMutation, SavingsObjectiveUpdate} from "./api";
import {Button} from "../../ui/controls/Button";
import {useFocusPlanningRouteTarget} from "./focusPlanningResult";
import {annualReserveDescription, PlanningAnnualReserveOptions} from "./PlanningAnnualReserveOptions";
import {SavingsObjectiveRow} from "./PlanningSavingsObjectiveRow";
import {FormField, Input, Select} from "../../ui/controls/FormField";



type Props = {
  objectives: PlanningPayload["savings_objectives"];
  rules: PlanningPayload["rules"];
  routeKey?: string;
  isActive?: boolean;
  refreshPlan: () => Promise<void>;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
};



const inputPriority = (value: string) => Number(value) as SavingsObjectiveCreate["priority"];
const newIdempotencyKey = () => {
  if (typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "No se pudo guardar la meta. Revisa los datos e inténtalo de nuevo.";
}

export function PlanningSavingsObjectives({objectives, rules, routeKey = "", isActive = true, refreshPlan, setError, setStatus}: Props) {
  useFocusPlanningRouteTarget(routeKey, isActive, true);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState({name: "", target_amount: "", target_date: "", priority: 2 as SavingsObjectiveCreate["priority"]});
  const [saving, setSaving] = useState(false);
  const [linkingRuleId, setLinkingRuleId] = useState<number | null>(null);
  const [pendingAnnualReserveFocusId, setPendingAnnualReserveFocusId] = useState<number | null>(null);
  const savingRef = useRef(false);
  const createKeyRef = useRef<{fingerprint: string; key: string} | null>(null);
  const mountedRef = useRef(true);
  const focusContextRef = useRef({routeKey, isActive});
  focusContextRef.current = {routeKey, isActive};
  const focusGuardRef = useRef<((event: FocusEvent) => void) | null>(null);
  const focusRequestVersionRef = useRef(0);
  const observedFocusContextRef = useRef({routeKey, isActive});
  const pendingAnnualReserveFocusRef = useRef<{
    objectiveId: number;
    requestVersion: number;
    routeKey: string;
    isActive: boolean;
    guardFocus: (event: FocusEvent) => void;
    focusMoved: () => boolean;
    objectivesBefore: Props["objectives"]["items"];
  } | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (focusGuardRef.current) document.removeEventListener("focusin", focusGuardRef.current, true);
    };
  }, []);
  useLayoutEffect(() => {
    const previous = observedFocusContextRef.current;
    observedFocusContextRef.current = {routeKey, isActive};
    if (previous.routeKey === routeKey && previous.isActive === isActive) return;

    focusRequestVersionRef.current += 1;
    const guardFocus = focusGuardRef.current;
    if (guardFocus) document.removeEventListener("focusin", guardFocus, true);
    focusGuardRef.current = null;
    pendingAnnualReserveFocusRef.current = null;
    setPendingAnnualReserveFocusId(null);
  }, [isActive, routeKey]);
  useEffect(() => {
    const pending = pendingAnnualReserveFocusRef.current;
    if (!pending || pending.objectiveId !== pendingAnnualReserveFocusId || saving) return;
    const current = focusContextRef.current;
    const requestIsCurrent = focusRequestVersionRef.current === pending.requestVersion
      && !pending.focusMoved()
      && mountedRef.current
      && pending.isActive
      && current.isActive
      && current.routeKey === pending.routeKey;
    if (!requestIsCurrent) {
      if (current.routeKey !== pending.routeKey || current.isActive !== pending.isActive) focusRequestVersionRef.current += 1;
      pendingAnnualReserveFocusRef.current = null;
      document.removeEventListener("focusin", pending.guardFocus, true);
      if (focusGuardRef.current === pending.guardFocus) focusGuardRef.current = null;
      setPendingAnnualReserveFocusId(null);
      return;
    }
    const target = document.querySelector<HTMLElement>(`[data-objective-id="${pending.objectiveId}"] [data-objective-focus-target]`);
    if (!target) {
      if (objectives.items === pending.objectivesBefore) return;
      pendingAnnualReserveFocusRef.current = null;
      document.removeEventListener("focusin", pending.guardFocus, true);
      if (focusGuardRef.current === pending.guardFocus) focusGuardRef.current = null;
      setPendingAnnualReserveFocusId(null);
      return;
    }

    pendingAnnualReserveFocusRef.current = null;
    document.removeEventListener("focusin", pending.guardFocus, true);
    if (focusGuardRef.current === pending.guardFocus) focusGuardRef.current = null;
    setPendingAnnualReserveFocusId(null);
    target.focus({preventScroll: true});
  }, [isActive, objectives.items, pendingAnnualReserveFocusId, routeKey, saving]);
  const activeCount = objectives.items.filter((item) => !item.archived).length;


  async function runObjectiveMutation<T>(action: () => Promise<T>, successMessage: (result: T) => string) {
    setError("");
    setStatus("");
    try {
      const result = await action();
      await refreshPlan();
      setStatus(successMessage(result));
      return result;
    } catch (reason) {
      if (reason instanceof ApiError && ["stale_revision", "allocation_snapshot_changed"].includes(reason.code || "")) {
        try {
          await refreshPlan();
        } catch {
          // Keep the original conflict visible; the user can retry a fresh Plan load.
        }
      }
      throw reason;
    }
  }

  const updateObjective = (id: number, input: SavingsObjectiveUpdate) => {
    focusRequestVersionRef.current += 1;
    return runObjectiveMutation(
      () => api.updateSavingsObjective(id, input),
      () => "Meta actualizada. No se ha creado un movimiento.",
    );
  };
  const allocateObjective = (id: number, input: SavingsObjectiveAllocation) => {
    focusRequestVersionRef.current += 1;
    return runObjectiveMutation(
      () => api.updateSavingsObjectiveAllocation(id, input),
      () => "Asignación virtual guardada. No se ha movido dinero.",
    );
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    focusRequestVersionRef.current += 1;
    const details = {
      name: draft.name.trim(),
      target_amount: draft.target_amount,
      target_date: draft.target_date,
      priority: draft.priority,
    };
    const fingerprint = JSON.stringify(details);
    if (!createKeyRef.current || createKeyRef.current.fingerprint !== fingerprint) {
      createKeyRef.current = {fingerprint, key: newIdempotencyKey()};
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await runObjectiveMutation(
        () => api.createSavingsObjective({...details, idempotency_key: createKeyRef.current!.key}),
        (result) => result.created ? "Meta creada. La asignación no mueve dinero." : "Esa solicitud ya se había guardado; Plan está actualizado.",
      );
      createKeyRef.current = null;
      setDraft({name: "", target_amount: "", target_date: "", priority: 2});
      setOpen(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const createAnnualReserve = async (ruleId: number, triggerButton: HTMLButtonElement) => {
    if (savingRef.current) return;
    const focusRequestVersion = ++focusRequestVersionRef.current;
    const fingerprint = JSON.stringify({recurring_rule_id: ruleId});
    if (!createKeyRef.current || createKeyRef.current.fingerprint !== fingerprint) {
      createKeyRef.current = {fingerprint, key: newIdempotencyKey()};
    }
    const focusContext = {...focusContextRef.current};
    let focusMoved = false;
    const guardFocus = (event: FocusEvent) => {
      if (event.target !== triggerButton && event.target !== document.body) focusMoved = true;
    };
    if (focusGuardRef.current) document.removeEventListener("focusin", focusGuardRef.current, true);
    focusGuardRef.current = guardFocus;
    document.addEventListener("focusin", guardFocus, true);
    let createdObjectiveId: number | null = null;
    savingRef.current = true;
    setSaving(true);
    setLinkingRuleId(ruleId);
    setError("");
    try {
      const result = await runObjectiveMutation(
        () => api.createSavingsObjective({recurring_rule_id: ruleId, idempotency_key: createKeyRef.current!.key}),
        (response) => response.created ? "Reserva anual preparada. El dinero no se ha movido." : "Esa solicitud ya estaba guardada; Plan está actualizado.",
      );
      createdObjectiveId = result.objective.id;
      pendingAnnualReserveFocusRef.current = {
        objectiveId: createdObjectiveId,
        requestVersion: focusRequestVersion,
        routeKey: focusContext.routeKey,
        isActive: focusContext.isActive,
        guardFocus,
        focusMoved: () => focusMoved,
        objectivesBefore: objectives.items,
      };
      setPendingAnnualReserveFocusId(createdObjectiveId);
      createKeyRef.current = null;
      setOpen(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
      setLinkingRuleId(null);
    }
    if (createdObjectiveId === null) {
      document.removeEventListener("focusin", guardFocus, true);
      if (focusGuardRef.current === guardFocus) focusGuardRef.current = null;
    }
  };
  return <CollapsiblePanel
    title="Metas por propósito"
    detail="Reservas virtuales sobre el saldo contable registrado; no mueven dinero ni cambian el margen o la liquidez."
    summary={<span>{activeCount ? `${activeCount} ${activeCount === 1 ? "meta activa" : "metas activas"}` : "Sin metas activas"} · <span className="money">{euro(objectives.summary.assigned_total)}</span> asignados · <span className="money">{euro(objectives.summary.free_to_assign)}</span> libres</span>}
    open={open}
    onToggle={() => setOpen((value) => !value)}
    className="planning-savings-objectives"
  >
    <div className="planning-objectives-content">
      <dl className="planning-objective-summary">
        <div><dt>Saldo contable registrado</dt><dd className="money">{euro(objectives.summary.ledger_balance)}</dd></div>
        <div><dt>Asignado a metas activas</dt><dd className="money">{euro(objectives.summary.assigned_total)}</dd></div>
        <div><dt>Libre para asignar</dt><dd className="money">{euro(objectives.summary.free_to_assign)}</dd></div>
      </dl>
      <p className="planning-objective-note">El saldo contable no confirma efectivo disponible, saldo bancario actualizado ni pagos futuros. Los traspasos reales se registran aparte.</p>
      {objectives.summary.overallocated ? <div className="planning-objective-warning" role="alert">
        <strong>Las metas activas superan el saldo contable registrado en <span className="money">{euro(objectives.summary.overallocated_by)}</span>.</strong>
        <span>La reserva se conserva para que decidas cómo ajustarla; no cambia cuentas ni movimientos.</span>
      </div> : null}
      {objectives.items.length ? <ol className="planning-objective-list">
        {objectives.items.map((objective) => <SavingsObjectiveRow
          key={objective.id}
          objective={objective}
          setError={setError}
          onUpdate={updateObjective}
          onAllocate={allocateObjective}
        />)}
      </ol> : <p className="planning-objective-empty">Todavía no hay metas. Añade una para asignar saldo contable a un propósito y ver cuánto falta.</p>}
      <PlanningAnnualReserveOptions rules={rules} objectives={objectives.items} saving={saving} linkingRuleId={linkingRuleId} onPrepare={createAnnualReserve} />
      <details id="planning-objective-create" className="planning-objective-create">
        <summary>Añadir una meta de ahorro</summary>
        <form className="entry-form planning-objective-form" aria-busy={saving} onSubmit={create}>
          <FormField label="Propósito"><Input name="name" maxLength={100} required value={draft.name} disabled={saving} onChange={(event) => setDraft((value) => ({...value, name: event.target.value}))} /></FormField>
          <FormField label="Importe objetivo"><Input className="money-input" name="target_amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={draft.target_amount} disabled={saving} onChange={(event) => setDraft((value) => ({...value, target_amount: event.target.value}))} /></FormField>
          <FormField label="Fecha objetivo"><Input name="target_date" type="date" required value={draft.target_date} disabled={saving} onChange={(event) => setDraft((value) => ({...value, target_date: event.target.value}))} /></FormField>
          <FormField label="Prioridad"><Select value={draft.priority} disabled={saving} onChange={(event) => setDraft((value) => ({...value, priority: inputPriority(event.target.value)}))}>
            <option value={1}>Alta</option><option value={2}>Media</option><option value={3}>Baja</option>
          </Select></FormField>
          <div className="planning-objective-form-actions"><Button variant="primary" type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>{saving ? "Guardando meta…" : "Crear meta"}</Button></div>
        </form>
      </details>
    </div>
  </CollapsiblePanel>;
}
