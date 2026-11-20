import {useRef, useState} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {Loader2} from "lucide-react";
import {ApiError} from "../../shared/api/client";
import {euro} from "../../format";
import {Panel, SectionHeader} from "../../shared/components/ui";
import {storeCategoryRuleDraftHandoff} from "../../shared/lib/categoryRuleDraftHandoff";
import {transactionIntentHref} from "../../shared/lib/transactionIntent";
import type {CategoryRuleDraftInput} from "../../shared/model/categories";
import type {PlanningPayload, SubscriptionCandidate} from "../../shared/model/planning";
import {planningApi} from "./api";
import {Button, ButtonLink} from "../../ui/controls/Button";

export function PlanningProjectionPanel({planning}: {planning: PlanningPayload}) {
  const projection = planning.projection;
  const hasForecast = projection?.sufficient;
  return (
    <Panel className={`planning-projection-panel${hasForecast ? "" : " is-empty"}`}>
      <SectionHeader title={planning.period.status === "past" ? "Cierre del mes" : "Cierre previsto"} detail={hasForecast ? projection.method : undefined} />
      {projection && hasForecast ? (
        <>
          <dl className="planning-projection-strip">
            <div><dt>Gasto al cierre</dt><dd className="money">{euro(projection.projected_expense)}</dd></div>
            <div><dt>Ahorro al cierre</dt><dd className={`money ${projection.projected_savings < 0 ? "negative" : projection.projected_savings > 0 ? "positive" : ""}`}>{euro(projection.projected_savings)}</dd></div>
            <div><dt>Frente al gasto habitual</dt><dd className={`money ${projection.delta_vs_median > 0 ? "negative" : projection.delta_vs_median < 0 ? "positive" : ""}`}>{euro(projection.delta_vs_median)}</dd></div>
          </dl>
          {projection.category_watchlist.length ? (
            <div className="planning-watchlist">
              {projection.category_watchlist.slice(0, 4).map((item) => (
                <a key={item.label} href={transactionIntentHref(item.filters)}>
                  <strong>{item.label}</strong><span><span className="money">{euro(item.projected)}</span> previsto · <span className="money">{euro(item.difference)}</span> sobre la referencia</span>
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="planning-empty">
          <strong>La previsión aún no es fiable.</strong>
          <span>Añade recurrentes o espera a tener actividad del mes. La app no mostrará un cero como previsión.</span>
        </div>
      )}
    </Panel>
  );
}

export function PlanningAutomationPanel({planning, load, setError, setStatus, navigateToSettings}: {
  planning: PlanningPayload;
  load: (month?: string, fresh?: boolean) => Promise<void>;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
  navigateToSettings: (search: URLSearchParams, ruleDraft?: CategoryRuleDraftInput) => void;
}) {
  const [pendingAction, setPendingAction] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, {date: string; annualCost: string; monthlyConfirmed: boolean}>>({});
  const [todayDate] = useState(() => {
    const value = new Date();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  });
  const [defaultReviewDate] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 90);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const focusAfterRefreshRef = useRef<{candidateKey: string; candidateIndex: number; initiator: HTMLElement} | null>(null);
  const reduceMotion = useReducedMotion();
  const candidateTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: "easeOut" as const};
  const pendingCandidates = planning.subscription_candidates.filter((candidate) => candidate.review_status === "pending");
  const reviewedCandidates = planning.subscription_candidates.filter((candidate) => candidate.review_status !== "pending");
  const loadRef = useRef(load);
  loadRef.current = load;
  const reviewDraftFor = (candidate: SubscriptionCandidate) => reviewDrafts[candidate.key] ?? {
    date: defaultReviewDate,
    annualCost: "",
    monthlyConfirmed: candidate.monthly_periodicity_confirmed,
  };
  const updateReviewDraft = (candidate: SubscriptionCandidate, patch: Partial<{date: string; annualCost: string; monthlyConfirmed: boolean}>) => {
    setReviewDrafts((current) => ({
      ...current,
      [candidate.key]: {
        date: current[candidate.key]?.date ?? defaultReviewDate,
        annualCost: current[candidate.key]?.annualCost ?? "",
        monthlyConfirmed: current[candidate.key]?.monthlyConfirmed ?? candidate.monthly_periodicity_confirmed,
        ...patch,
      },
    }));
  };
  const restoreFocusAfterCandidateExit = () => {
    const request = focusAfterRefreshRef.current;
    if (!request || pendingCandidates.some((candidate) => candidate.key === request.candidateKey)) return;
    focusAfterRefreshRef.current = null;
    if (document.activeElement !== request.initiator && document.activeElement !== document.body) return;
    const nextCandidate = pendingCandidates[Math.min(request.candidateIndex, pendingCandidates.length - 1)];
    const nextAction = nextCandidate && Array.from(document.querySelectorAll<HTMLButtonElement>(".planning-candidates-panel button[data-candidate-action]"))
      .find((button) => button.dataset.candidateKey === nextCandidate.key && button.dataset.candidateAction === "accept");
    const nextCard = nextCandidate && Array.from(document.querySelectorAll<HTMLElement>(".planning-candidate[data-candidate-key]"))
      .find((article) => article.dataset.candidateKey === nextCandidate.key);
    const inViewport = (element: HTMLElement | null | undefined) => {
      const bounds = element?.getBoundingClientRect();
      return Boolean(bounds && bounds.top < window.innerHeight && bounds.bottom > 0);
    };
    const focusTarget = inViewport(nextAction) ? nextAction
      : inViewport(nextCard) ? nextCard
      : inViewport(emptyRef.current) ? emptyRef.current
      : inViewport(headingRef.current) ? headingRef.current
      : null;
    focusTarget?.focus({preventScroll: true});
  };
  const reviewCandidate = async (candidate: SubscriptionCandidate, action: "accept" | "dismiss") => {
    if (pendingAction) return;
    const actionKey = `${candidate.key}:${action}`;
    const candidateIndex = pendingCandidates.findIndex((item) => item.key === candidate.key);
    const initiator = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const draft = reviewDraftFor(candidate);
    setPendingAction(actionKey);
    setError("");
    try {
      await planningApi.reviewSubscription({
        account_id: candidate.account.id,
        normalized_description: candidate.normalized_description,
        evidence_signature: candidate.evidence_signature,
        expected_revision: candidate.review_revision,
        action,
        next_review_date: action === "accept" ? draft.date : null,
        monthly_periodicity_confirmed: action === "accept" && draft.monthlyConfirmed,
        confirmed_annual_cost: action === "accept" && draft.annualCost.trim() ? draft.annualCost.trim() : null,
      });
      setStatus(action === "accept" ? `Seguimiento guardado para ${candidate.description}.` : `Sugerencia descartada para ${candidate.description}.`);
      if (initiator) focusAfterRefreshRef.current = {candidateKey: candidate.key, candidateIndex, initiator};
      await loadRef.current(undefined, true);
    } catch (exception) {
      if (focusAfterRefreshRef.current?.candidateKey === candidate.key) focusAfterRefreshRef.current = null;
      if (exception instanceof ApiError && exception.status === 409) {
        try { await loadRef.current(undefined, true); } catch { /* Keep the conflict visible if refresh also fails. */ }
      }
      setError(exception instanceof Error ? exception.message : "No se pudo guardar la revisión.");
    } finally {
      setPendingAction("");
    }
  };
  const createRecurringFromCandidate = async (candidate: SubscriptionCandidate) => {
    if (pendingAction) return;
    const key = `${candidate.key}:recurring`;
    const candidateIndex = pendingCandidates.findIndex((item) => item.key === candidate.key);
    const initiator = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingAction(key);
    setError("");
    try {
      await planningApi.createRecurringRule(candidate.recurring_rule_input);
      setStatus(`Recurrente creado para ${candidate.description}.`);
      if (initiator) focusAfterRefreshRef.current = {candidateKey: candidate.key, candidateIndex, initiator};
      await loadRef.current(undefined, true);
    } catch (exception) {
      if (focusAfterRefreshRef.current?.candidateKey === candidate.key) focusAfterRefreshRef.current = null;
      setError(exception instanceof Error ? exception.message : "No se pudo crear la automatización.");
    } finally {
      setPendingAction("");
    }
  };
  const hasCandidates = pendingCandidates.length > 0;
  const hasReviewedCandidates = reviewedCandidates.length > 0;
  return (
    <Panel className={`planning-candidates-panel${hasCandidates || hasReviewedCandidates ? "" : " is-empty"}`}>
      <div className="section-header">
        <div className="section-heading">
          <h2 id="planning-candidates-heading" ref={headingRef} tabIndex={-1}>Suscripciones por revisar</h2>
          {hasCandidates ? <p>Son patrones observados, no contratos confirmados. Revisarlos no crea movimientos ni automatizaciones.</p> : null}
        </div>
      </div>
      <div className="planning-candidate-list">
        <AnimatePresence initial={false} onExitComplete={restoreFocusAfterCandidateExit}>
          {pendingCandidates.map((candidate) => {
            const draft = reviewDraftFor(candidate);
            const fieldKey = encodeURIComponent(candidate.key);
            const decisionPending = pendingAction.startsWith(`${candidate.key}:`);
            return (
            <motion.article
              className="planning-candidate"
              key={candidate.key}
              data-candidate-key={candidate.key}
              tabIndex={-1}
              layout
              aria-busy={decisionPending || undefined}
              initial={{opacity: 0, height: 0}}
              animate={{opacity: 1, height: "auto"}}
              exit={reduceMotion ? {opacity: 0} : {opacity: 0, height: 0}}
              transition={candidateTransition}
              style={{overflow: "hidden"}}
            >
              <div className="planning-candidate-copy">
                <strong>{candidate.description}</strong>
                <span>{candidate.account.name} · {candidate.category.display_name}</span>
                <span>Mediana observada <span className="money">{euro(candidate.median_amount)}</span>/mes · estimación anualizada <span className="money">{euro(candidate.annual_cost)}</span>.</span>
                <small>Último cargo: <span className="money">{euro(candidate.latest_amount)}</span> el {candidate.last_date}; referencia previa <span className="money">{euro(candidate.previous_median)}</span>. Detectado en {candidate.months_seen} meses.</small>
                {candidate.confirmed_annual_cost !== null ? <small>Coste anual indicado por ti en la revisión anterior: <span className="money">{euro(candidate.confirmed_annual_cost)}</span>.</small> : null}
                {candidate.exceptional_charge ? <small className="planning-candidate-warning">El último cargo destaca frente al historial y se trata como posible extraordinario, no como subida recurrente confirmada.</small> : null}
                {candidate.review_reason === "material_change" ? <small className="planning-candidate-warning">Los movimientos cambiaron materialmente desde la última revisión.</small> : null}
                {candidate.review_reason === "review_due" ? <small>Ha llegado la fecha de revisión que indicaste.</small> : null}
              </div>
              <div className="planning-candidate-review-fields planning-candidate-date">
                <label htmlFor={`subscription-review-date-${fieldKey}`}>Próxima revisión
                  <input id={`subscription-review-date-${fieldKey}`} className="ui-input" type="date" min={todayDate} value={draft.date} disabled={decisionPending} onChange={(event) => updateReviewDraft(candidate, {date: event.target.value})} />
                </label>
              </div>
              <details className="planning-candidate-options">
                <summary>Confirmar coste o periodicidad (opcional)</summary>
                <div className="planning-candidate-review-fields">
                <label htmlFor={`subscription-review-cost-${fieldKey}`}>Coste anual confirmado (opcional)
                  <input id={`subscription-review-cost-${fieldKey}`} className="ui-input" type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.annualCost} placeholder="Sin confirmar" disabled={decisionPending} onChange={(event) => updateReviewDraft(candidate, {annualCost: event.target.value})} />
                </label>
                <label className="planning-candidate-periodicity" htmlFor={`subscription-review-periodicity-${fieldKey}`}>
                  <input id={`subscription-review-periodicity-${fieldKey}`} type="checkbox" checked={draft.monthlyConfirmed} disabled={decisionPending} onChange={(event) => updateReviewDraft(candidate, {monthlyConfirmed: event.target.checked})} />
                  Confirmo periodicidad mensual
                </label>
                </div>
              </details>
              <div className="inline-actions planning-candidate-main-actions">
                <ButtonLink variant="secondary" href={candidate.movements_url}>Revisar movimientos</ButtonLink>
                <Button
                  variant="secondary"
                  aria-disabled={Boolean(pendingAction) || undefined}
                  data-candidate-key={candidate.key}
                  data-candidate-action="dismiss"
                  onClick={() => void reviewCandidate(candidate, "dismiss")}
                >{decisionPending && pendingAction.endsWith(":dismiss") ? <><Loader2 className="spin" aria-hidden="true" /> Guardando…</> : "Descartar sugerencia"}</Button>
                <Button
                  variant="primary"
                  aria-disabled={Boolean(pendingAction) || undefined}
                  data-candidate-key={candidate.key}
                  data-candidate-action="accept"
                  onClick={() => void reviewCandidate(candidate, "accept")}
                >{decisionPending && pendingAction.endsWith(":accept") ? <><Loader2 className="spin" aria-hidden="true" /> Guardando…</> : "Aceptar y revisar después"}</Button>
              </div>
              <details className="planning-candidate-automation">
                <summary>Reglas automáticas (opcional)</summary>
                <div className="inline-actions">
                <Button
                  variant="secondary"
                  aria-disabled={Boolean(pendingAction) || candidate.has_category_rule || undefined}
                  aria-busy={pendingAction === `${candidate.key}:category` || undefined}
                  data-candidate-key={candidate.key}
                  data-candidate-action="category"
                  onClick={() => {
                    if (pendingAction || candidate.has_category_rule) return;
                    if (!storeCategoryRuleDraftHandoff(candidate.category_rule_input)) {
                      setError("No se pudo preparar la regla sugerida. Puedes abrir Clasificación desde Ajustes.");
                      return;
                    }
                    navigateToSettings(new URLSearchParams([["settings_section", "classification"], ["focus", "new-rule"]]));
                  }}
                >{candidate.has_category_rule ? "Regla de clasificación activa" : "Crear regla en Clasificación"}</Button>
                <Button
                  variant="primary"
                  aria-disabled={Boolean(pendingAction) || candidate.has_recurring_rule || undefined}
                  aria-busy={pendingAction === `${candidate.key}:recurring` || undefined}
                  data-candidate-key={candidate.key}
                  data-candidate-action="recurring"
                  onClick={() => { if (!candidate.has_recurring_rule) void createRecurringFromCandidate(candidate); }}
                >{pendingAction === `${candidate.key}:recurring` ? <><Loader2 className="spin" aria-hidden="true" /> Creando recurrente…</> : candidate.has_recurring_rule ? "Regla recurrente activa" : "Automatizar como recurrente"}</Button>
                </div>
              </details>
            </motion.article>
            );
          })}
          {!hasCandidates ? <motion.div key="empty" ref={emptyRef} tabIndex={-1} className="planning-candidate-empty" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={candidateTransition}>No hay sugerencias pendientes.</motion.div> : null}
        </AnimatePresence>
      </div>
      {hasReviewedCandidates ? <details className="planning-candidate-reviewed">
        <summary>Decisiones guardadas ({reviewedCandidates.length})</summary>
        <ul>{reviewedCandidates.map((candidate) => (
          <li key={candidate.key}>
            <div><strong>{candidate.description}</strong><small>{candidate.account.name} · {candidate.review_status === "accepted" ? `En seguimiento hasta ${candidate.next_review_date ?? "revisión manual"}` : "Descartada mientras no haya un cambio material"}{candidate.monthly_periodicity_confirmed ? " · Periodicidad mensual confirmada" : ""}{candidate.confirmed_annual_cost !== null ? ` · Coste anual confirmado: ${euro(candidate.confirmed_annual_cost)}` : ""}</small></div>
            <span className={`planning-candidate-status is-${candidate.review_status}`}>{candidate.review_status === "accepted" ? "Aceptada" : "Descartada"}</span>
            <ButtonLink variant="secondary" href={candidate.movements_url}>Movimientos</ButtonLink>
          </li>
        ))}</ul>
      </details> : null}
    </Panel>
  );
}
