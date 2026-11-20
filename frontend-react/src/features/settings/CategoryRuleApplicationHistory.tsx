import {useCallback, useEffect, useState} from "react";
import {formatDate} from "../../format";
import {settingsApi as api} from "./api";
import type {CategoryRuleApplication} from "./types";
import {Button} from "../../ui/controls/Button";
import {ErrorBanner, Panel, SectionHeader} from "../../shared/components/ui";

const statusLabel: Record<CategoryRuleApplication["status"], string> = {
  completed: "Aplicada",
  undone: "Deshecha",
  partial: "Deshecha parcialmente",
};

export function CategoryRuleApplicationHistory({refreshToken, setStatus}: {refreshToken: number; setStatus: (message: string) => void}) {
  const [applications, setApplications] = useState<CategoryRuleApplication[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (offset = 0, append = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await api.categoryRuleApplications(offset);
      setApplications((current) => append ? [...current, ...response.applications] : response.applications);
      setNextOffset(response.next_offset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el historial de aplicaciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {void load();}, [load, refreshToken]);

  const undo = async (application: CategoryRuleApplication) => {
    if (undoingId !== null || !application.rule_id || !application.reversible || application.status !== "completed") return;
    setUndoingId(application.id);
    setError("");
    try {
      const response = await api.undoCategoryRule(application.rule_id, application.id);
      setStatus(response.partial ? "Deshecha parcialmente: algunos registros habían cambiado después." : "Aplicación deshecha.");
      setApplications((current) => current.map((item) => item.id === application.id ? {
        ...item,
        status: response.partial ? "partial" : "undone",
        reversible: false,
      } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo deshacer la aplicación.");
    } finally {
      setUndoingId(null);
    }
  };

  return <Panel className="rule-application-history">
    <SectionHeader title="Historial de aplicaciones" detail="Las aplicaciones quedan registradas aunque salgas de esta pantalla; deshacer conserva la auditoría." />
    {error ? <ErrorBanner message={error} /> : null}
    {!applications.length && !loading ? <p className="empty-state empty-state--plain">Todavía no hay aplicaciones históricas de reglas.</p> : null}
    {applications.length ? <div className="stack-list compact-stack">
      {applications.map((application) => {
        const canUndo = Boolean(application.rule_id && application.reversible && application.status === "completed");
        const label = undoingId === application.id ? "Deshaciendo…" : canUndo ? "Deshacer aplicación" : statusLabel[application.status];
        return <div className="list-card" key={application.id}>
          <strong>{application.rule_description}</strong>
          <span>{formatDate(application.applied_at)} · {statusLabel[application.status]} · {application.total} registros</span>
          <small>{application.transactions} movimientos · {application.bank_rows} banco · {application.csv_rows} CSV</small>
          {application.rule_id ? <Button variant="secondary" aria-disabled={!canUndo || undoingId === application.id || undefined} aria-busy={undoingId === application.id || undefined} onClick={() => void undo(application)}>{label}</Button> : null}
        </div>;
      })}
    </div> : null}
    {nextOffset !== null ? <Button variant="secondary" aria-disabled={loading || undefined} aria-busy={loading || undefined} onClick={() => {if (!loading && nextOffset !== null) void load(nextOffset, true);}}>{loading && applications.length ? "Cargando…" : "Cargar más aplicaciones"}</Button> : null}
    {loading && !applications.length ? <p role="status">Cargando historial…</p> : null}
  </Panel>;
}
