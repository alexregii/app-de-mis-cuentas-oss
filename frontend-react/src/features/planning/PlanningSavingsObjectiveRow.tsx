import {useEffect, useRef, useState, type FormEvent} from "react";
import {euro, formatDate} from "../../format";
import {ApiError} from "../../shared/api/client";
import type {SavingsObjective, SavingsObjectiveSummary} from "../../shared/model/planning";
import {Button} from "../../ui/controls/Button";
import {annualReserveDescription} from "./PlanningAnnualReserveOptions";
import {FormField, Input, Select} from "../../ui/controls/FormField";
import type {SavingsObjectiveAllocation, SavingsObjectiveCreate, SavingsObjectiveMutation, SavingsObjectiveUpdate} from "./api";

type PendingConfirmation = {
  kind: "allocation" | "reactivation";
  amount: string;
  summary: SavingsObjectiveSummary;
};

type RowProps = {
  setError: (message: string) => void;
  onUpdate: (id: number, input: SavingsObjectiveUpdate) => Promise<SavingsObjectiveMutation>;
  onAllocate: (id: number, input: SavingsObjectiveAllocation) => Promise<SavingsObjectiveMutation>;
};

const priorityLabel = (priority: number) => priority === 1 ? "Alta" : priority === 2 ? "Media" : "Baja";
const inputPriority = (value: string) => Number(value) as SavingsObjectiveCreate["priority"];

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "No se pudo guardar la meta. Revisa los datos e inténtalo de nuevo.";
}

function confirmationSummary(reason: unknown): SavingsObjectiveSummary | null {
  if (!(reason instanceof ApiError) || !reason.payload || typeof reason.payload !== "object") return null;
  const summary = (reason.payload as {summary?: unknown}).summary;
  if (!summary || typeof summary !== "object") return null;
  const candidate = summary as Partial<SavingsObjectiveSummary>;
  return typeof candidate.confirmation_token === "string"
    && typeof candidate.assigned_total === "number"
    && typeof candidate.eligible_balance === "number"
    && typeof candidate.overallocated_by === "number"
    && typeof candidate.overallocated === "boolean"
    ? candidate as SavingsObjectiveSummary
    : null;
}

function confirmationReason(reason: unknown) {
  return reason instanceof ApiError && ["over_allocation_confirmation_required", "allocation_snapshot_changed"].includes(reason.code || "");
}
export function SavingsObjectiveRow({objective, setError, onUpdate, onAllocate}: {
  objective: SavingsObjective;
} & RowProps) {
  const [assignedDraft, setAssignedDraft] = useState(objective.assigned_amount.toFixed(2));
  const [editOpen, setEditOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [details, setDetails] = useState({name: objective.name, target_amount: objective.target_amount.toFixed(2), target_date: objective.target_date, priority: objective.priority as SavingsObjectiveCreate["priority"]});
  const serverDetailsRef = useRef({id: objective.id, name: objective.name, target_amount: objective.target_amount, target_date: objective.target_date, priority: objective.priority});
  const serverAssignmentRef = useRef({id: objective.id, assigned_amount: objective.assigned_amount});
  const rowRef = useRef<HTMLLIElement>(null);
  const previousArchivedRef = useRef(objective.archived);
  const archiveFocusIntentRef = useRef(false);
  const archiveFocusCleanupRef = useRef<(() => void) | null>(null);
  const stopArchiveFocusTracking = () => {
    archiveFocusCleanupRef.current?.();
    archiveFocusCleanupRef.current = null;
  };
  const startArchiveFocusTracking = (button: HTMLButtonElement) => {
    stopArchiveFocusTracking();
    archiveFocusIntentRef.current = document.activeElement === button;
    if (!archiveFocusIntentRef.current) return;
    const movedFocus = () => {
      archiveFocusIntentRef.current = false;
      stopArchiveFocusTracking();
    };
    document.addEventListener("focusin", movedFocus, {once: true});
    archiveFocusCleanupRef.current = () => document.removeEventListener("focusin", movedFocus);
  };

  useEffect(() => {
    setPendingConfirmation(null);
    const nextAssignment = {id: objective.id, assigned_amount: objective.assigned_amount};
    const previousAssignment = serverAssignmentRef.current;
    if (nextAssignment.id !== previousAssignment.id || nextAssignment.assigned_amount !== previousAssignment.assigned_amount) {
      setAssignedDraft(objective.assigned_amount.toFixed(2));
    }
    serverAssignmentRef.current = nextAssignment;
    const nextDetails = {id: objective.id, name: objective.name, target_amount: objective.target_amount, target_date: objective.target_date, priority: objective.priority};
    const previousDetails = serverDetailsRef.current;
    if (nextDetails.id !== previousDetails.id
      || nextDetails.name !== previousDetails.name
      || nextDetails.target_amount !== previousDetails.target_amount
      || nextDetails.target_date !== previousDetails.target_date
      || nextDetails.priority !== previousDetails.priority) {
      setDetails({name: objective.name, target_amount: objective.target_amount.toFixed(2), target_date: objective.target_date, priority: objective.priority});
      setEditOpen(false);
    }
    serverDetailsRef.current = nextDetails;
  }, [objective.id, objective.revision, objective.assigned_amount, objective.name, objective.target_amount, objective.target_date, objective.priority]);

  useEffect(() => {
    if (!previousArchivedRef.current && objective.archived && archiveFocusIntentRef.current) {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || !activeElement.isConnected) {
        rowRef.current?.querySelector<HTMLButtonElement>("[data-objective-reactivate]")?.focus();
      }
    }
    previousArchivedRef.current = objective.archived;
    archiveFocusIntentRef.current = false;
    stopArchiveFocusTracking();
  }, [objective.archived]);

  useEffect(() => () => archiveFocusCleanupRef.current?.(), []);

  const run = async (action: () => Promise<SavingsObjectiveMutation>, kind?: PendingConfirmation["kind"], amount = "") => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await action();
      setPendingConfirmation(null);
      setArchiveConfirm(false);
      return true;
    } catch (reason) {
      if (kind && confirmationReason(reason)) {
        const summary = confirmationSummary(reason);
        if (summary?.overallocated) {
          setPendingConfirmation({kind, amount, summary});
          return false;
        }
        setPendingConfirmation(null);
      }
      setError(errorMessage(reason));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const allocate = (confirm?: PendingConfirmation) => run(
    () => onAllocate(objective.id, {
      expected_revision: objective.revision,
      assigned_amount: confirm?.amount ?? assignedDraft,
      ...(confirm ? {confirm_overallocation: true, confirmed_snapshot: confirm.summary.confirmation_token} : {}),
    }),
    "allocation",
    confirm?.amount ?? assignedDraft,
  );

  const reactivate = (confirm?: PendingConfirmation) => run(
    () => onUpdate(objective.id, {
      expected_revision: objective.revision,
      archived: false,
      ...(confirm ? {confirm_overallocation: true, confirmed_snapshot: confirm.summary.confirmation_token} : {}),
    }),
    "reactivation",
  );

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const savedDetails = {...details, name: details.name.trim()};
    const editableDetails = objective.recurring_rule_id
      ? {name: savedDetails.name, priority: savedDetails.priority}
      : savedDetails;
    const saved = await run(() => onUpdate(objective.id, {
      expected_revision: objective.revision,
      ...editableDetails,
    }));
    if (saved) {
      setDetails(savedDetails);
      setEditOpen(false);
    }
  };

  const cancelDetailsEdit = () => {
    setDetails({name: objective.name, target_amount: objective.target_amount.toFixed(2), target_date: objective.target_date, priority: objective.priority});
    setEditOpen(false);
  };

  const status = objective.archived ? "Archivada" : objective.achieved ? "Meta alcanzada" : "En curso";
  const editFormId = `planning-objective-edit-${objective.id}`;

  return <li ref={rowRef} className="planning-objective-row" data-objective-id={objective.id}>
    <div className="planning-objective-heading">
      <h3>{objective.name}</h3><span>{status}</span>
    </div>
    <dl className="planning-objective-facts">
      <div><dt>Objetivo</dt><dd className="money">{euro(objective.target_amount)}</dd></div>
      <div><dt>Asignado</dt><dd className="money">{euro(objective.assigned_amount)}</dd></div>
      <div><dt>Falta</dt><dd className="money">{euro(objective.remaining_amount)}</dd></div>
      <div><dt>Fecha objetivo</dt><dd>{formatDate(objective.target_date)}</dd></div>
      <div><dt>Prioridad</dt><dd>{priorityLabel(objective.priority)}</dd></div>
    </dl>
    {objective.annual_reserve ? <p className="planning-objective-note" data-annual-reserve-status={objective.annual_reserve.status}>{annualReserveDescription(objective)}</p> : null}

    {objective.archived ? <div className="planning-objective-actions">
      <p>La meta está archivada; su importe asignado ya no cuenta en la reserva activa.</p>
      <Button data-objective-reactivate="true" variant="secondary" aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void reactivate()}>Reactivar meta</Button>
    </div> : <>
      <form className="entry-form planning-objective-allocation" aria-busy={saving} onSubmit={(event) => {event.preventDefault(); void allocate();}}>
        <FormField label="Importe asignado"><Input data-objective-focus-target="true" className="money-input" type="number" inputMode="decimal" min="0" step="0.01" required value={assignedDraft} disabled={saving} onChange={(event) => setAssignedDraft(event.target.value)} /></FormField>
        <Button variant="primary" type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>{saving ? "Guardando…" : "Guardar asignación"}</Button>
      </form>
      <div className="planning-objective-actions">
        <Button variant="secondary" aria-expanded={editOpen} aria-controls={editOpen ? editFormId : undefined} onClick={() => editOpen ? cancelDetailsEdit() : setEditOpen(true)}>{editOpen ? "Cerrar edición" : "Editar detalles"}</Button>
        {objective.recurring_rule_id ? <Button variant="secondary" aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void run(() => onUpdate(objective.id, {expected_revision: objective.revision, recurring_rule_id: null}))}>Desvincular pago anual</Button> : null}
        {editOpen ? (
          <form id={editFormId} className="entry-form planning-objective-form" aria-busy={saving} onSubmit={(event) => void saveDetails(event)}>
            <FormField label="Propósito"><Input maxLength={100} required value={details.name} disabled={saving} onChange={(event) => setDetails((value) => ({...value, name: event.target.value}))} /></FormField>
{objective.recurring_rule_id ? <p className="planning-objective-note">El importe y el vencimiento los controla el pago anual. Desvincúlalo para editar estos datos.</p> : <>
            <FormField label="Importe objetivo"><Input className="money-input" type="number" inputMode="decimal" min="0.01" step="0.01" required value={details.target_amount} disabled={saving} onChange={(event) => setDetails((value) => ({...value, target_amount: event.target.value}))} /></FormField>
            <FormField label="Fecha objetivo"><Input type="date" required value={details.target_date} disabled={saving} onChange={(event) => setDetails((value) => ({...value, target_date: event.target.value}))} /></FormField>
</>}
            <FormField label="Prioridad"><Select value={details.priority} disabled={saving} onChange={(event) => setDetails((value) => ({...value, priority: inputPriority(event.target.value)}))}>
              <option value={1}>Alta</option><option value={2}>Media</option><option value={3}>Baja</option>
            </Select></FormField>
            <div className="planning-objective-form-actions"><Button variant="primary" type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>{saving ? "Guardando…" : "Guardar detalles"}</Button></div>
          </form>
        ) : null}
        {!archiveConfirm ? <Button variant="secondary" aria-disabled={saving || undefined} onClick={() => setArchiveConfirm(true)}>Archivar meta</Button> : <div className="planning-objective-archive-confirm" role="group" aria-label={`Confirmar archivo de ${objective.name}`}>
          <p>Archivar libera <span className="money">{euro(objective.assigned_amount)}</span> de la reserva activa; los datos de la meta se conservan.</p>
          <Button variant="danger" aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={(event) => {
            startArchiveFocusTracking(event.currentTarget);
            void run(() => onUpdate(objective.id, {expected_revision: objective.revision, archived: true})).then((saved) => {
              if (!saved) archiveFocusIntentRef.current = false;
              stopArchiveFocusTracking();
            });
          }}>{saving ? "Archivando…" : "Confirmar archivo"}</Button>
          <Button variant="secondary" onClick={() => setArchiveConfirm(false)}>Cancelar</Button>
        </div>}
      </div>
    </>}

    {pendingConfirmation ? <div className="planning-objective-confirmation" role="alert">
      <p>Con este cambio quedarían asignados <span className="money">{euro(pendingConfirmation.summary.assigned_total)}</span> frente a un saldo contable de <span className="money">{euro(pendingConfirmation.summary.eligible_balance)}</span>; supera la base en <span className="money">{euro(pendingConfirmation.summary.overallocated_by)}</span>. Confirma solo si has revisado el saldo contable.</p>
      <Button variant="primary" aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void (pendingConfirmation.kind === "allocation" ? allocate(pendingConfirmation) : reactivate(pendingConfirmation))}>{pendingConfirmation.kind === "allocation" ? "Confirmar asignación" : "Reactivar de todos modos"}</Button>
      <Button variant="secondary" onClick={() => setPendingConfirmation(null)}>Cancelar</Button>
    </div> : null}
  </li>;
}
