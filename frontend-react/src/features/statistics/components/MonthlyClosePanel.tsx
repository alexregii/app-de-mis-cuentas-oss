import {useEffect, useRef, useState} from "react";
import {formatMonth} from "../../../format";
import {Button, ButtonLink} from "../../../ui/controls/Button";
import {FormField, Textarea} from "../../../ui/controls/FormField";
import {ConfirmDialog} from "../../../shared/components/ConfirmDialog";
import {errorMessage} from "../../../shared/lib/errors";
import {MoneyAmount} from "../../../ui/finance/MoneyAmount";
import {statisticsApi} from "../api";
import type {MonthlyCloseIssue, MonthlyCloseRequest, MonthlyCloseState, MonthlyCloseVerification, StatisticsBasis} from "../types";

const isFinishedMonth = (month: string) => {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) return false;
  const now = new Date();
  return year < now.getFullYear() || year === now.getFullYear() && monthNumber < now.getMonth() + 1;
};

const newIdempotencyKey = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
  const random = Math.floor(Math.random() * 16);
  return (letter === "x" ? random : random & 3 | 8).toString(16);
});

const verificationLabels: Record<MonthlyCloseVerification, string> = {
  current: "Fuentes actuales",
  stale: "Fuentes cambiaron",
  superseded: "Versión sustituida",
  unknown: "Verificación desconocida",
};

const verificationClass: Record<MonthlyCloseVerification, string> = {
  current: "is-current",
  stale: "is-stale",
  superseded: "is-superseded",
  unknown: "is-unknown",
};

const closeStatusLabel = (status: string) => status === "clean" ? "Sin incidencias declaradas" : "Cerrado con incidencias declaradas";

const formatMonthlyCloseMonth = (month: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return formatMonth("invalid");
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return formatMonth("invalid");

  const year = Number(match[1]);
  // Preserve Date(year, month, 1)'s legacy 1900 offset for years 0–99.
  const labelYear = year < 100 ? String(year + 1900).padStart(4, "0") : match[1];
  return formatMonth(`${labelYear}-${match[2]}-01`);
};

function IssueEvidence({issue, privateAmounts}: {issue: MonthlyCloseIssue; privateAmounts: boolean}) {
  const details = issue.details as {
    reasons?: string[];
    rows?: Array<Record<string, unknown>>;
    legs?: Array<Record<string, unknown>>;
  };
  const rows = details.rows ?? details.legs ?? [];
  const reasons = details.reasons ?? [];
  if (!rows.length && !reasons.length) return null;

  return (
    <details className="monthly-close-evidence">
      <summary>Ver evidencia de origen ({rows.length || reasons.length})</summary>
      {reasons.length ? <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      {rows.length ? (
        <ul>
          {rows.map((row, index) => {
            const amount = typeof row.amount === "string" || typeof row.amount === "number" ? Number(row.amount) : null;
            const date = typeof row.date === "string" ? row.date : "";
            const origin = typeof row.filename === "string" ? `${row.filename} · fila ${row.row_number ?? "?"} · ` : "";
            const description = typeof row.description === "string" ? row.description : "Movimiento";
            const account = typeof row.account_name === "string" ? `${row.account_name} · ` : "";
            const flags = [row.possible_duplicate ? "posible duplicado" : "", row.possible_transfer ? "posible traspaso" : ""].filter(Boolean).join(" · ");
            return <li key={`${date}-${index}`}>{account}{date} · {origin}{description}{amount == null ? null : <> · <MoneyAmount value={amount} privateAmounts={privateAmounts} /></>}{flags ? ` · ${flags}` : null}</li>;
          })}
        </ul>
      ) : null}
    </details>
  );
}

function MonthlyCloseReportView({report, privateAmounts}: {report: MonthlyCloseState["preview"]["report"]; privateAmounts: boolean}) {
  const summary = report.summary;
  const daily = report.daily_series.filter((row) => Number(row.income) || Number(row.net_expense) || Number(row.refunds_applied));

  return (
    <div className="monthly-close-report">
      {report.activity_status === "recorded" ? (
        <div className="monthly-close-amounts" aria-label="Resultado guardado del mes">
          <div><span>Ingresos</span><MoneyAmount value={Number(summary.income)} privateAmounts={privateAmounts} tone="income" /></div>
          <div><span>Gasto neto</span><MoneyAmount value={Number(summary.net_expense)} privateAmounts={privateAmounts} tone="expense" /></div>
          <div><span>Reembolsos</span><MoneyAmount value={Number(summary.refunds_applied)} privateAmounts={privateAmounts} /></div>
          <div><span>Resultado</span><MoneyAmount value={Number(summary.analytical_result)} privateAmounts={privateAmounts} /></div>
        </div>
      ) : <p className="monthly-close-unknown" role="status">El gasto del mes es desconocido; una cifra de cero no demuestra ausencia de gastos porque la cobertura no está acreditada.</p>}
      {report.source_movements_url ? <ButtonLink variant="secondary" href={report.source_movements_url}>Abrir movimientos del mes</ButtonLink> : null}
      {daily.length ? (
        <details className="monthly-close-daily-links">
          <summary>Ver días con movimientos ({daily.length})</summary>
          <ul>{daily.map((row) => (
            <li key={row.date}>
              {row.date} · ingresos <MoneyAmount value={Number(row.income)} privateAmounts={privateAmounts} tone="income" /> · gasto <MoneyAmount value={Number(row.net_expense)} privateAmounts={privateAmounts} tone="expense" />
              {row.source_movements_url ? <> · <a href={row.source_movements_url}>movimientos</a></> : null}
            </li>
          ))}</ul>
        </details>
      ) : null}
    </div>
  );
}

export function MonthlyClosePanel({month, basis, privateAmounts = false}: {month: string; basis: StatisticsBasis; privateAmounts?: boolean}) {
  const [state, setState] = useState<MonthlyCloseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reasonByIssue, setReasonByIssue] = useState<Record<string, string>>({});
  const [correctionReason, setCorrectionReason] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);
  const submission = useRef<{payload: MonthlyCloseRequest; generation: number} | null>(null);
  const finished = isFinishedMonth(month);

  useEffect(() => {
    const id = ++requestId.current;
    submission.current = null;
    setConfirmationOpen(false);
    setState(null);
    setReasonByIssue({});
    setCorrectionReason("");
    setError("");
    setAnnouncement("");
    if (!finished) {
      setLoading(false);
      return;
    }
    setLoading(true);
    statisticsApi.monthlyClose(month, basis)
      .then((payload) => {
        if (id !== requestId.current) return;
        setState(payload);
        setReasonByIssue(Object.fromEntries(payload.preview.issues.map((issue) => [issue.key, ""])));
      })
      .catch((reason: unknown) => {
        if (id === requestId.current) setError(errorMessage(reason, "No se pudo cargar el checklist del cierre."));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => {requestId.current += 1;};
  }, [basis, finished, month, reload]);

  if (!month) return null;
  const latest = state?.versions.length ? state.versions[state.versions.length - 1] : null;
  const issues = state?.preview.issues ?? [];
  const missingDeclarations = issues.filter((issue) => !reasonByIssue[issue.key]?.trim()).length;
  const hasNewSourceState = Boolean(state && (!latest || latest.source_digest !== state.preview.source_digest));
  const missingCorrectionReason = Boolean(latest && !correctionReason.trim());
  const canClose = Boolean(state && finished && hasNewSourceState && !missingDeclarations && !missingCorrectionReason && !loading);

  const updateDeclaration = (key: string, reason: string) => {
    submission.current = null;
    setReasonByIssue((current) => ({...current, [key]: reason}));
  };

  const openConfirmation = () => {
    if (!state || !canClose) return;
    submission.current = {
      generation: requestId.current,
      payload: {
        month,
        basis,
        source_digest: state.preview.source_digest,
        idempotency_key: newIdempotencyKey(),
        declarations: Object.fromEntries(issues.map((issue) => [issue.key, reasonByIssue[issue.key]?.trim() ?? ""])),
        correction_reason: correctionReason.trim(),
      },
    };
    setConfirmationOpen(true);
  };

  const submitClose = async () => {
    const pending = submission.current;
    if (!pending) throw new Error("Actualiza la previsualización antes de cerrar el mes.");
    const result = await statisticsApi.createMonthlyClose(pending.payload);
    if (pending.generation !== requestId.current) return;
    submission.current = null;
    setState(result);
    setReasonByIssue(Object.fromEntries(result.preview.issues.map((issue) => [issue.key, ""])));
    setCorrectionReason("");
    setAnnouncement(`Cierre ${result.created ? "guardado" : "recuperado"}: versión ${result.versions[result.versions.length - 1]?.version ?? ""}.`);
  };

  return (
    <section className="monthly-close-panel" aria-labelledby="monthly-close-title" aria-busy={loading}>
      <header className="monthly-close-heading">
        <div>
          <h2 id="monthly-close-title">Cierre del mes · {formatMonthlyCloseMonth(month)}</h2>
          <p>Guarda una versión reproducible del informe y de las incidencias revisadas. Los movimientos seguirán editables.</p>
        </div>
        {state ? <span className="monthly-close-basis">{state.preview.report.scope.basis_label}</span> : null}
      </header>

      {!finished ? <p className="monthly-close-note">Podrás cerrar este mes cuando haya terminado.</p> : null}
      {loading ? <p role="status">Cargando fuentes y versiones…</p> : null}
      {error ? <div className="monthly-close-error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setReload((current) => current + 1)}>Reintentar</Button></div> : null}

      {state ? (
        <>
          <div className="monthly-close-source">
            <span>Fuentes comprobadas hasta <strong>{state.preview.cutoff}</strong></span>
            <code title={state.preview.source_digest}>Huella {state.preview.source_digest.slice(0, 12)}</code>
          </div>

          <MonthlyCloseReportView report={state.preview.report} privateAmounts={privateAmounts} />

          <section className="monthly-close-checklist" aria-labelledby="monthly-close-accounts-title">
            <h3 id="monthly-close-accounts-title">Cuentas y conciliación</h3>
            {state.preview.accounts.length ? <ul className="monthly-close-accounts">
              {state.preview.accounts.map((account) => (
                <li key={account.account_name}>
                  <div><strong>{account.account_name}</strong><span>{account.issue_codes.length ? "Requiere revisión" : account.created_after_cutoff ? "Conciliada · registrada después del corte" : "Conciliada al corte"}</span></div>
                  {account.created_after_cutoff ? <p>Cuenta añadida {new Date(account.created_at).toLocaleDateString("es-ES")}, después del corte del informe.</p> : null}
                  <p>Saldo ledger al corte <MoneyAmount value={Number(account.ledger_balance_at_cut)} privateAmounts={privateAmounts} />{account.reconciliation ? <> · extracto {account.reconciliation.date} · diferencia <MoneyAmount value={Number(account.reconciliation.difference)} privateAmounts={privateAmounts} />{account.reconciliation.stale ? " · saldo contable cambió después del corte" : ""}</> : " · sin conciliación registrada"}</p>
                  {account.bank_source ? <p>Banco {account.bank_source.bank_name} · sincronización {account.bank_source.sync_status}{account.bank_source.last_synced_at ? ` · ${new Date(account.bank_source.last_synced_at).toLocaleString("es-ES")}` : ""}</p> : null}
                </li>
              ))}
            </ul> : <p>No había cuentas creadas antes del corte.</p>}
          </section>

          <section className="monthly-close-checklist" aria-labelledby="monthly-close-issues-title">
            <h3 id="monthly-close-issues-title">Incidencias materiales ({issues.length})</h3>
            {issues.length ? <div className="monthly-close-issues">
              {issues.map((issue) => (
                <article className="monthly-close-issue" key={issue.key}>
                  <div><h4>{issue.title}</h4><p>{issue.description}</p></div>
                  <IssueEvidence issue={issue} privateAmounts={privateAmounts} />
                  <FormField label="Decisión y motivo para cerrar esta incidencia" hint="Se conserva en la versión del cierre.">
                    <Textarea maxLength={1000} rows={3} value={reasonByIssue[issue.key] ?? ""} onChange={(event) => updateDeclaration(issue.key, event.target.value)} />
                  </FormField>
                </article>
              ))}
            </div> : <p>Sin incidencias pendientes conocidas para las fuentes locales revisadas.</p>}
          </section>

          {latest ? (
            <section className="monthly-close-history" aria-labelledby="monthly-close-history-title">
              <h3 id="monthly-close-history-title">Versiones guardadas</h3>
              <p className={`monthly-close-verification ${verificationClass[latest.source_verification]}`} role="status">Versión {latest.version}: {closeStatusLabel(latest.status_at_close)} · {verificationLabels[latest.source_verification]}{latest.origin === "portable_archive" ? " · importada de un archivo" : ""}</p>
              {latest.correction_reason ? <p>Corrección: {latest.correction_reason}</p> : null}
              <details>
                <summary>Consultar historial ({state.versions.length})</summary>
                <ol>{state.versions.map((version) => (
                  <li key={`${version.month}-${version.basis}-${version.version}`}>
                    <strong>Versión {version.version}</strong> · {new Date(version.created_at).toLocaleString("es-ES")} · {closeStatusLabel(version.status_at_close)} · {verificationLabels[version.source_verification]}
                    {version.correction_reason ? <p>{version.correction_reason}</p> : null}
                    <details className="monthly-close-version-detail">
                      <summary>Ver informe y checklist de esta versión · corte {version.report.scope.cutoff}</summary>
                      <MonthlyCloseReportView report={version.report} privateAmounts={privateAmounts} />
                      <div className="monthly-close-version-accounts">
                        <h4>Cuentas incluidas en la versión</h4>
                        {version.accounts.length ? <ul>{version.accounts.map((account) => (
                          <li key={account.account_name}>
                            <strong>{account.account_name}</strong> · saldo ledger al corte <MoneyAmount value={Number(account.ledger_balance_at_cut)} privateAmounts={privateAmounts} /> · {account.reconciliation ? `extracto ${account.reconciliation.date} · diferencia ` : "sin conciliación al corte · diferencia "}
                            {account.reconciliation ? <MoneyAmount value={Number(account.reconciliation.difference)} privateAmounts={privateAmounts} /> : "no disponible"}
                            {account.created_after_cutoff ? <p>Registrada después del corte · {new Date(account.created_at).toLocaleDateString("es-ES")}</p> : null}
                          </li>
                        ))}</ul> : <p>No se registraron cuentas para este corte.</p>}
                      </div>
                      {version.issues.length ? <div className="monthly-close-version-accounts"><h4>Incidencias y decisiones guardadas</h4><ul>{version.issues.map((issue) => {
                        const declaration = version.declarations.find((item) => item.issue_key === issue.key);
                        return <li key={issue.key}><strong>{issue.title}</strong><p>{issue.description}</p><IssueEvidence issue={issue} privateAmounts={privateAmounts} /><p>Decisión: {declaration?.reason ?? "sin declaración"}</p></li>;
                      })}</ul></div> : <p>La versión se guardó sin incidencias declaradas.</p>}
                    </details>
                  </li>
                ))}</ol>
              </details>
            </section>
          ) : null}

          {latest && !hasNewSourceState && latest.source_verification === "current" ? <p className="monthly-close-note">Las fuentes no han cambiado desde la versión actual; no hace falta crear otra.</p> : null}
          {latest && !hasNewSourceState && latest.source_verification === "unknown" ? <p className="monthly-close-note">La huella coincide con las fuentes locales, pero este cierre portable conserva verificación desconocida porque el archivo no incluye todos los orígenes bancarios y CSV.</p> : null}
          {latest && hasNewSourceState ? (
            <FormField label="Motivo de la nueva versión" hint="Obligatorio después de corregir datos ya cerrados.">
              <Textarea maxLength={1000} rows={2} value={correctionReason} onChange={(event) => {submission.current = null; setCorrectionReason(event.target.value);}} />
            </FormField>
          ) : null}

          {announcement ? <p className="monthly-close-success" role="status">{announcement}</p> : null}
          <div className="monthly-close-actions">
            <Button variant="primary" disabled={!canClose} onClick={openConfirmation}>{latest ? "Crear nueva versión" : "Revisar y cerrar mes"}</Button>
            {missingDeclarations ? <span>Falta decisión y motivo en {missingDeclarations} incidencia{missingDeclarations === 1 ? "" : "s"}.</span> : null}
            {missingCorrectionReason ? <span>La nueva versión requiere un motivo de corrección.</span> : null}
          </div>
        </>
      ) : null}

      {confirmationOpen && state ? (
        <ConfirmDialog
          title={`${latest ? "Guardar versión nueva" : "Confirmar cierre"} · ${formatMonthlyCloseMonth(month)}`}
          description={`Se guardará la versión ${latest ? latest.version + 1 : 1} del informe ${state.preview.report.scope.basis_label}. ${issues.length ? `${issues.length} incidencia${issues.length === 1 ? " quedará declarada" : "s quedarán declaradas"} con el motivo indicado.` : "No hay incidencias materiales en la revisión actual."}`}
          confirmLabel={latest ? "Guardar versión" : "Cerrar mes"}
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={submitClose}
        />
      ) : null}
    </section>
  );
}
