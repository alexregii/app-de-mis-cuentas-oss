import {useCallback, useEffect, useRef, useState} from "react";
import {Activity, AlertTriangle, CheckCircle2, CircleHelp, Clock3} from "lucide-react";
import {SectionHeader} from "../../shared/components/ui";
import type {Connection} from "../../shared/model/accounts";
import {Button} from "../../ui/controls/Button";
import {settingsApi} from "./api";

function bankingFreshness(connections: Connection[]) {
  const active = connections.filter((connection) => connection.status !== "disconnected");
  if (!active.length) {
    return {state: "neutral", title: "Sin conexiones bancarias activas", detail: "No hay una sincronización bancaria que evaluar."};
  }

  const attentionCount = active.filter((connection) => (
    Boolean(connection.last_error)
      || connection.status === "needs_reconnect"
      || connection.sync_status === "error"
  )).length;
  const latest = active
    .filter((connection) => connection.last_synced_at && Number.isFinite(Date.parse(connection.last_synced_at)))
    .sort((a, b) => Date.parse(b.last_synced_at) - Date.parse(a.last_synced_at))[0];

  if (attentionCount) {
    return {
      state: "attention",
      title: attentionCount === 1 ? "Una conexión requiere revisión" : attentionCount + " conexiones requieren revisión",
      detail: latest ? "Última sincronización completada: " + latest.last_synced_at_display + ". Revisa la conexión en Cuentas." : "No hay una sincronización completada. Revisa la conexión en Cuentas.",
    };
  }
  if (active.some((connection) => connection.sync_status === "syncing")) {
    return {
      state: "checking",
      title: "Sincronización bancaria en curso",
      detail: latest ? "Último éxito: " + latest.last_synced_at_display + "." : "La primera sincronización todavía no ha terminado.",
    };
  }
  if (!latest) {
    return {state: "missing", title: "Sin sincronizaciones completadas", detail: "No hay una fecha de actualización bancaria confirmada."};
  }
  return {state: "current", title: "Última sincronización completada", detail: latest.last_synced_at_display};
}

export function OperationalStatusPanel({connections}: {connections: Connection[]}) {
  const [httpState, setHttpState] = useState<"checking" | "available" | "unavailable">("checking");
  const checkingRequest = useRef(false);
  const mounted = useRef(true);
  const checkHttp = useCallback(async () => {
    if (checkingRequest.current) return;
    checkingRequest.current = true;
    setHttpState("checking");
    try {
      const result = await settingsApi.runtimeHealth();
      if (mounted.current) setHttpState(result.status === "ok" ? "available" : "unavailable");
    } catch {
      if (mounted.current) setHttpState("unavailable");
    } finally {
      checkingRequest.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void checkHttp();
    return () => {mounted.current = false;};
  }, [checkHttp]);

  const freshness = bankingFreshness(connections);
  const HttpIcon = httpState === "available" ? CheckCircle2 : httpState === "unavailable" ? AlertTriangle : Activity;
  const FreshnessIcon = freshness.state === "current"
    ? CheckCircle2
    : freshness.state === "attention" ? AlertTriangle : freshness.state === "checking" ? Activity : freshness.state === "neutral" ? CircleHelp : Clock3;
  return <section className="settings-operational-status" aria-label="Salud HTTP y frescura bancaria">
    <SectionHeader title="Servicio y datos bancarios" detail="La respuesta HTTP y la última sincronización son señales distintas." />
    <div className="settings-operational-status__list">
      <div className="settings-operational-status__row" data-state={httpState} role="status" aria-live="polite" aria-busy={httpState === "checking" || undefined}>
        <HttpIcon aria-hidden="true" />
        <div className="settings-operational-status__body">
          <strong>Servicio HTTP</strong>
          <span>{httpState === "checking" ? "Comprobando disponibilidad…" : httpState === "available" ? "Disponible" : "No se pudo comprobar"}</span>
          <small>{httpState === "available" ? "El endpoint de salud responde; esto no confirma la actualización de los bancos." : httpState === "checking" ? "Comprobando la ruta pública de salud." : "Vuelve a comprobar el endpoint. La frescura bancaria se muestra por separado."}</small>
        </div>
        {httpState === "unavailable" ? <Button variant="secondary" onClick={() => void checkHttp()}>Reintentar comprobación</Button> : null}
      </div>
      <div className="settings-operational-status__row" data-state={freshness.state} role="status" aria-live="polite">
        <FreshnessIcon aria-hidden="true" />
        <div className="settings-operational-status__body">
          <strong>Frescura bancaria</strong>
          <span>{freshness.title}</span>
          <small>{freshness.detail}</small>
        </div>
      </div>
    </div>
  </section>;
}
