import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {ArchiveRestore, CheckCircle2, CircleAlert, Download, HardDriveDownload} from "lucide-react";
import {settingsApi as api, type RecoveryPayload, type ScheduledBackupStatus} from "./api";
import {ErrorBanner, SectionHeader} from "../../shared/components/ui";
import {Button, ButtonLink} from "../../ui/controls/Button";
import {FormField, Input} from "../../ui/controls/FormField";
import {motionEase} from "../../shared/lib/motion";

const bytes = (value: number) => value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const terminalRestoreStates = new Set(["completed", "failed"]);

function formatBackupDate(value: string | null) {
  if (!value) return "sin registro";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "fecha desconocida" : date.toLocaleString("es-ES");
}

function backupStatusCopy(status: ScheduledBackupStatus) {
  const lastSuccess = formatBackupDate(status.last_success_at);
  if (status.worker === "stale") {
    const scheduleDetail = status.schedule === "failed"
      ? "Último intento fallido: " + formatBackupDate(status.last_failure_at) + "."
      : status.schedule === "missing"
        ? "Todavía no hay una copia programada."
        : "Última copia programada: " + lastSuccess + ".";
    return {
      title: "El worker de copias no informa actividad",
      detail: "Última señal: " + formatBackupDate(status.heartbeat_at) + ". " + scheduleDetail,
      action: "Comprueba que el servicio backup esté activo en tu instalación.",
    };
  }
  if (status.schedule === "failed") {
    return {
      title: "Falló la última copia programada",
      detail: "Último fallo: " + formatBackupDate(status.last_failure_at) + ". Última copia válida: " + lastSuccess + ".",
      action: "El worker reintentará automáticamente. Revisa sus registros si vuelve a fallar.",
    };
  }
  if (status.schedule === "missing") {
    return {
      title: "Todavía no hay una copia programada",
      detail: "El worker responde, pero aún no ha publicado su primera copia.",
      action: "Espera la primera ejecución o crea una copia manual ahora.",
    };
  }
  if (status.schedule === "stale") {
    return {
      title: "La última copia programada está desactualizada",
      detail: "Última copia: " + lastSuccess + ". El objetivo de la aplicación es una copia diaria.",
      action: "Crea una copia manual y comprueba los registros del worker.",
    };
  }
  return {
    title: "Copias programadas al día",
    detail: "Última copia programada: " + lastSuccess + ".",
    action: "",
  };
}

function RecoveryAlert({message, reduceMotion}: {message: string; reduceMotion: boolean | null}) {
  return <AnimatePresence initial={false}>
    {message ? <motion.div
      key={message}
      className="top-gap-small"
      initial={reduceMotion ? false : {height: 0, opacity: 0, y: -2}}
      animate={{height: "auto", opacity: 1, y: 0}}
      exit={reduceMotion ? {height: 0, opacity: 0} : {height: 0, opacity: 0, y: -2}}
      transition={reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase}}
      style={{overflow: "hidden"}}
    ><ErrorBanner message={message} /></motion.div> : null}
  </AnimatePresence>;
}

export function RecoveryPanel() {
  const reduceMotion = useReducedMotion();
  const recoveryTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const [data, setData] = useState<RecoveryPayload | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [recoveryRetrying, setRecoveryRetrying] = useState(false);
  const [busyAction, setBusyAction] = useState<"backup" | "restore" | null>(null);
  const [backupError, setBackupError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [token, setToken] = useState("");
  const [impact, setImpact] = useState<{files: number; media_files: number; size: number} | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [restoreSubmitted, setRestoreSubmitted] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const actionRequest = useRef<"backup" | "restore" | null>(null);
  const backupRequest = useRef(false);
  const previewRequest = useRef(false);
  const previewFile = useRef<File | null>(null);
  const recoveryStatusRef = useRef<HTMLDivElement>(null);
  const recoveryLoadRequest = useRef(false);
  const recoveryRequest = useRef(false);
  const focusRecoveryStatus = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const previewFocusTarget = useRef<"confirmation" | "file" | null>(null);
  const previewScroll = useRef<number | null>(null);
  const busy = busyAction !== null;

  const refreshRecovery = useCallback(async () => {
    if (recoveryLoadRequest.current) return;
    recoveryLoadRequest.current = true;
    setLoadState("loading");
    try {
      const result = await api.recovery();
      setData(result);
      setLoadError("");
      setLoadState("ready");
    } catch {
      setLoadError("No se pudo consultar el estado de las copias.");
      setLoadState("error");
    } finally {
      recoveryLoadRequest.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshRecovery();
  }, [refreshRecovery]);

  useLayoutEffect(() => {
    if (loadState !== "ready" || recoveryRetrying || !focusRecoveryStatus.current) return;
    recoveryStatusRef.current?.focus({preventScroll: true});
    focusRecoveryStatus.current = false;
  }, [loadState, recoveryRetrying]);

  const retryRecovery = async (trigger: HTMLButtonElement) => {
    if (recoveryRequest.current) return;
    recoveryRequest.current = true;
    focusRecoveryStatus.current = true;
    trigger.focus({preventScroll: true});
    setRecoveryRetrying(true);
    await refreshRecovery();
    recoveryRequest.current = false;
    setRecoveryRetrying(false);
  };

  const restoreAvailable = data?.restore.available === true;
  const restoreDisabled = loadState === "ready" && !restoreAvailable;
  const restoreStatus = restoreAvailable ? data?.restore.status?.status : undefined;
  useEffect(() => {
    if (!restoreStatus || terminalRestoreStates.has(restoreStatus)) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await api.recovery();
        if (disposed) return;
        setData((current) => !result.restore.status && current?.restore.status
          ? {...result, restore: {...result.restore, status: current.restore.status}}
          : result);
        if (result.restore.status?.status === "failed") setRestoreSubmitted(false);
      } catch {
        // A temporary outage must not stop polling an in-progress restore.
      }
      if (!disposed && !terminalRestoreStates.has(restoreStatus)) timer = window.setTimeout(() => void poll(), 3000);
    };
    timer = window.setTimeout(() => void poll(), 3000);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [restoreStatus, restoreSubmitted]);

  const restorePreviewViewport = () => {
    const target = previewFocusTarget.current === "confirmation"
      ? confirmationInputRef.current
      : previewFocusTarget.current === "file" ? fileInputRef.current : null;
    if (!target) return;
    const originalScroll = previewScroll.current;
    const bounds = target.getBoundingClientRect();
    const topAtOriginalScroll = bounds.top + window.scrollY - (originalScroll ?? window.scrollY);
    const visibleAtOriginalScroll = topAtOriginalScroll >= 0 && topAtOriginalScroll + bounds.height <= window.innerHeight;
    if (visibleAtOriginalScroll && originalScroll !== null && Math.abs(window.scrollY - originalScroll) > 0.5) {
      window.scrollTo({top: originalScroll, behavior: reduceMotion ? "auto" : "smooth"});
    } else if (!visibleAtOriginalScroll) {
      target.scrollIntoView({block: "nearest", behavior: reduceMotion ? "auto" : "smooth"});
    }
    previewFocusTarget.current = null;
  };

  useLayoutEffect(() => {
    const target = previewFocusTarget.current === "confirmation" && token
      ? confirmationInputRef.current
      : previewFocusTarget.current === "file" && !token ? fileInputRef.current : null;
    if (!target) return;
    target.focus({preventScroll: true});
    if (reduceMotion) window.requestAnimationFrame(restorePreviewViewport);
  }, [reduceMotion, token]);

  const createBackup = async () => {
    if (busy || previewBusy || previewRequest.current || actionRequest.current || backupRequest.current) return;
    backupRequest.current = true;
    actionRequest.current = "backup";
    setBackupError("");
    setBusyAction("backup");
    try {
      const result = await api.createBackup();
      setData(result);
      setLoadState("ready");
    } catch {
      setBackupError("No se pudo crear la copia de seguridad. Inténtalo otra vez.");
    } finally {
      backupRequest.current = false;
      actionRequest.current = null;
      setBusyAction(null);
    }
  };

  const previewRestore = async (file: File) => {
    if (previewRequest.current || busy || restoreSubmitted) return;
    previewRequest.current = true;
    previewFile.current = file;
    setPreviewBusy(true);
    try {
      const preview = await api.previewRestore(file);
      previewFocusTarget.current = "confirmation";
      setToken(preview.token);
      setImpact(preview.impact);
      setConfirmation("");
      setPreviewError("");
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "No se pudo validar la copia.");
    } finally {
      previewRequest.current = false;
      setPreviewBusy(false);
    }
  };

  const retryPreview = (trigger: HTMLButtonElement) => {
    if (previewRequest.current || busy || restoreSubmitted || !previewFile.current) return;
    trigger.focus({preventScroll: true});
    void previewRestore(previewFile.current);
  };

  const chooseAnotherCopy = (trigger: HTMLButtonElement) => {
    trigger.focus({preventScroll: true});
    previewFocusTarget.current = "file";
    previewFile.current = null;
    setToken("");
    setImpact(null);
    setConfirmation("");
    setPreviewError("");
  };

  const restore = async () => {
    if (!token || confirmation !== "RESTAURAR" || busy || previewBusy || restoreSubmitted || actionRequest.current || previewRequest.current || backupRequest.current) return;
    actionRequest.current = "restore";
    setRestoreError("");
    setBusyAction("restore");
    try {
      const result = await api.restore(token, confirmation);
      setRestoreSubmitted(true);
      setData((current) => current ? {
        ...current,
        restore: {available: current.restore.available, status: {status: "staged", message: result.message}},
      } : current);
    } catch {
      setRestoreError("No se pudo solicitar la restauración. Inténtalo otra vez.");
    } finally {
      actionRequest.current = null;
      setBusyAction(null);
    }
  };

  const backup = data?.latest_backup;
  const scheduledStatus = data?.backup_status;
  const backupStatus = scheduledStatus ? backupStatusCopy(scheduledStatus) : null;
  const backupAttention = !!scheduledStatus && (scheduledStatus.worker !== "healthy" || scheduledStatus.schedule !== "healthy");
  const StatusIcon = loadState === "ready" ? backupAttention ? CircleAlert : CheckCircle2 : HardDriveDownload;
  return <section className="recovery-panel">
    <SectionHeader title="Datos y recuperación" detail="Copias locales y una exportación portable para conservar tus datos fuera del servidor." />
    <div ref={recoveryStatusRef} className="recovery-status" data-attention={backupAttention ? "true" : "false"} role="status" tabIndex={-1} aria-live="polite" aria-busy={loadState === "loading" || undefined}>
      <StatusIcon aria-hidden="true" />
      <div>
        <strong>{loadState === "loading" ? "Consultando copias…" : loadState === "error" ? "No se pudo consultar el estado de las copias." : backupStatus?.title ?? "No se pudo verificar la copia programada."}</strong>
        <span>{loadState === "loading" ? "Consultando el worker y el almacenamiento de copias." : loadState === "error" ? "Comprueba la conexión y vuelve a intentarlo." : backupStatus?.detail ?? "Actualiza el estado para volver a intentarlo."}</span>
        {loadState === "ready" && backupStatus?.action ? <span className="recovery-status__action">{backupStatus.action}</span> : null}
        {loadState === "ready" ? <span>{backup ? "Último archivo disponible: " + new Date(backup.created_at).toLocaleString("es-ES") + " · " + bytes(backup.size) + " · " + backup.name : "No hay archivos de copia disponibles."}</span> : null}
      </div>
    </div>
    <RecoveryAlert message={loadError} reduceMotion={reduceMotion} />
    {loadState === "error" || recoveryRetrying ? <Button variant="secondary" aria-disabled={recoveryRetrying || undefined} aria-busy={recoveryRetrying || undefined} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void retryRecovery(event.currentTarget);}}>{recoveryRetrying ? "Consultando copias…" : "Reintentar consulta"}</Button> : null}
    <div className="recovery-actions">
      <Button variant="secondary" disabled={loadState === "loading" || restoreSubmitted} aria-disabled={busy || previewBusy || undefined} aria-busy={busyAction === "backup" || undefined} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void createBackup();}}><ArchiveRestore aria-hidden="true" /> {busyAction === "backup" ? "Creando copia…" : "Crear copia ahora"}</Button>
      <ButtonLink variant="secondary" href="/exportar/excel/"><Download aria-hidden="true" /> Descargar Excel</ButtonLink>
      <ButtonLink variant="secondary" href="/api/recovery/export/"><Download aria-hidden="true" /> Descargar exportación portable</ButtonLink>
    </div>
    <RecoveryAlert message={backupError} reduceMotion={reduceMotion} />
    {restoreAvailable ? <p className="recovery-note" aria-live="polite">{restoreStatus ? data?.restore.status?.message : "La restauración no está en curso."}</p> : restoreDisabled ? <p className="recovery-note" role="status">Esta instalación no ejecuta el coordinador automático de restauración. Sigue la guía manual en docs/self-hosted-recovery.md desde el host, con los servicios detenidos.</p> : null}
    {restoreAvailable ? <motion.details className="recovery-restore" layout={!reduceMotion} transition={recoveryTransition} onLayoutAnimationComplete={restorePreviewViewport}>
      <summary>Restaurar una copia</summary>
      <p>Se creará una copia previa y la aplicación se reiniciará. Revisa el archivo antes de continuar.</p>
      {!token ? <div className="recovery-preview-stage">
          <label>Archivo ZIP de copia<input ref={fileInputRef} type="file" accept=".zip,application/zip" disabled={busy || restoreSubmitted} aria-disabled={previewBusy || busy || restoreSubmitted || undefined} aria-busy={previewBusy || undefined} onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (file) {
              previewScroll.current = window.scrollY;
              input.focus({preventScroll: true});
              void previewRestore(file);
            }
          }} /></label>
          {previewBusy ? <p role="status">Validando copia…</p> : null}
          <RecoveryAlert message={previewError} reduceMotion={reduceMotion} />
          {previewError && previewFile.current ? <Button variant="secondary" aria-disabled={previewBusy || undefined} aria-busy={previewBusy || undefined} onClick={(event) => retryPreview(event.currentTarget)}>{previewBusy ? "Validando copia…" : "Reintentar validación"}</Button> : null}
        </div> : <div className="recovery-preview-stage">
          <p><strong>Copia validada:</strong> {impact?.files} archivos, {impact?.media_files} adjuntos, {impact ? bytes(impact.size) : ""}.</p>
          <FormField label="Escribe RESTAURAR para confirmar"><Input ref={confirmationInputRef} value={confirmation} disabled={busy || restoreSubmitted} onChange={(event) => setConfirmation(event.target.value)} /></FormField>
          <div className="inline-actions">
            <Button variant="secondary" disabled={restoreSubmitted} aria-disabled={busy || undefined} onClick={(event) => chooseAnotherCopy(event.currentTarget)}>Elegir otra copia</Button>
            <Button variant="danger" disabled={confirmation !== "RESTAURAR"} aria-disabled={busy || restoreSubmitted || undefined} aria-busy={busyAction === "restore" || undefined} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void restore();}}>{restoreSubmitted ? "Restauración solicitada" : busyAction === "restore" ? "Restaurando…" : "Restaurar copia"}</Button>
          </div>
          <RecoveryAlert message={restoreError} reduceMotion={reduceMotion} />
        </div>}
    </motion.details> : null}
  </section>;
}
