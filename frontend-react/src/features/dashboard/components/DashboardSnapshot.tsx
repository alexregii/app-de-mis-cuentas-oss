import {useLayoutEffect, useRef, useState} from "react";
import {motion, useReducedMotion} from "motion/react";
import {X} from "lucide-react";
import {dashboardApi as api} from "../api";
import {euro, formatDate, formatMonth} from "../../../format";
import {Panel, SectionHeader} from "../../../shared/components/ui";
import {ConfirmDialog} from "../../../shared/components/ConfirmDialog";
import type {DashboardPreferences, DashboardSnapshot} from "../../../shared/model/dashboard";
import {Button, IconButton, TextButton} from "../../../ui/controls/Button";
import {motionEase} from "../../../shared/lib/motion";

export function DashboardSnapshotPanel({
  visible,
  preferences,
  setPreferences,
  setError,
}: {
  visible: boolean;
  preferences: DashboardPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<DashboardPreferences>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
}) {
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const previewOpenerRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const loadingSnapshotRef = useRef(false);
  const actionAnchorRef = useRef<{element: HTMLElement; top: number} | null>(null);
  const reduceMotion = useReducedMotion();
  const previewTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const snapshotActionPending = saving || loadingSnapshot;

  useLayoutEffect(() => {
    const anchor = actionAnchorRef.current;
    if (anchor?.element.isConnected) {
      const offset = anchor.element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(offset) > 0.5) window.scrollBy(0, offset);
    }
    if (!snapshotActionPending) {
      savingRef.current = false;
      loadingSnapshotRef.current = false;
      actionAnchorRef.current = null;
    }
  }, [snapshotActionPending]);

  const saveSnapshot = async () => {
    if (savingRef.current || loadingSnapshotRef.current) return;
    savingRef.current = true;
    try {
      setError("");
      setSaving(true);
      const result = await api.saveDashboardSnapshot();
      previewOpenerRef.current = saveButtonRef.current;
      setSnapshot(result.snapshot);
      setPreferences((current) => ({
        ...current,
        last_snapshot_month: result.snapshot.month,
      }));
      setSnapshotMessage(result.replaced ? "Cierre reemplazado." : "Cierre guardado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el snapshot.");
    } finally {
      setSaving(false);
    }
  };

  const loadSnapshot = async (month: string, trigger: HTMLElement) => {
    if (savingRef.current || loadingSnapshotRef.current) return;
    loadingSnapshotRef.current = true;
    actionAnchorRef.current = {element: trigger, top: trigger.getBoundingClientRect().top};
    try {
      setLoadingSnapshot(true);
      const result = await api.dashboardSnapshot(month);
      setError("");
      setSnapshot(result.snapshot);
      if (!result.snapshot) setSnapshotMessage("No se encontró el snapshot guardado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el snapshot.");
    } finally {
      setLoadingSnapshot(false);
    }
  };

  if (!visible) return null;

  return (
    <Panel className="snapshot-widget">
      <SectionHeader
        title="Cierre mensual"
        detail={
          preferences.last_snapshot_month
            ? `Guardado para ${preferences.last_snapshot_month}.`
            : "Guarda una referencia del mes sin alterar sus movimientos."
        }
      />
      <div className="inline-actions">
        <Button
          variant="secondary"
          aria-disabled={snapshotActionPending || undefined}
          aria-busy={snapshotActionPending || undefined}
          onClick={(event) => {
            saveButtonRef.current = event.currentTarget;
            event.currentTarget.focus({preventScroll: true});
            if (savingRef.current || loadingSnapshotRef.current) return;
            if (preferences.last_snapshot_month) setConfirmReplacement(true);
            else {
              actionAnchorRef.current = {element: event.currentTarget, top: event.currentTarget.getBoundingClientRect().top};
              void saveSnapshot();
            }
          }}
        >
          {saving ? "Guardando…" : snapshotMessage || "Guardar cierre"}
        </Button>
        {preferences.last_snapshot_month ? (
          <TextButton
            aria-label="Ver cierre"
            aria-disabled={snapshotActionPending || undefined}
            aria-busy={loadingSnapshot || undefined}
            onClick={(event) => {
              event.currentTarget.focus({preventScroll: true});
              if (savingRef.current || loadingSnapshotRef.current) return;
              previewOpenerRef.current = event.currentTarget;
              void loadSnapshot(preferences.last_snapshot_month, event.currentTarget);
            }}
          >
            {loadingSnapshot ? "Cargando…" : "Ver cierre"}
          </TextButton>
        ) : null}
      </div>
      {snapshot ? (
        <motion.div
          className="snapshot-preview"
          role="status"
          initial={reduceMotion ? false : {height: 0, opacity: 0}}
          animate={{height: "auto", opacity: 1}}
          transition={previewTransition}
          style={reduceMotion ? undefined : {overflow: "hidden"}}
        >
          <div>
            <strong>{formatMonth(snapshot.month)}</strong>
            <span>Capturado el {formatDate(snapshot.captured_at)}</span>
          </div>
          <div>
            <span>Saldo</span>
            <b>{euro(snapshot.payload.metrics.total_balance ?? 0)}</b>
          </div>
          <div>
            <span>Ingresos</span>
            <b>{euro(snapshot.payload.metrics.income ?? 0)}</b>
          </div>
          <div>
            <span>Gastos</span>
            <b>{euro(snapshot.payload.metrics.expense ?? 0)}</b>
          </div>
          <IconButton
            variant="subtle"
            aria-label="Cerrar snapshot"
            title="Cerrar snapshot"
            onClick={() => {
              const opener = previewOpenerRef.current;
              if (opener?.isConnected) {
                const {top, bottom} = opener.getBoundingClientRect();
                const visible = top >= 0 && bottom <= window.innerHeight;
                opener.focus({preventScroll: visible});
              }
              setSnapshot(null);
            }}
          >
            <X aria-hidden="true" />
          </IconButton>
        </motion.div>
      ) : null}
      {confirmReplacement ? (
        <ConfirmDialog
          title="¿Reemplazar el cierre mensual?"
          description="Ya existe un cierre para este mes. La nueva referencia sustituirá a la anterior, sin modificar movimientos ni saldos."
          confirmLabel="Reemplazar cierre"
          onConfirm={saveSnapshot}
          onCancel={() => setConfirmReplacement(false)}
        />
      ) : null}
    </Panel>
  );
}
