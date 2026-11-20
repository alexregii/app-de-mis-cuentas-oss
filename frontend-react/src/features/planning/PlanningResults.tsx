import {useLayoutEffect, useRef, useState} from "react";
import {motion, useReducedMotion} from "motion/react";
import {AlertTriangle, CircleAlert, Loader2, Pause, Pencil, Play, Trash2} from "lucide-react";
import {euro, formatDate, formatMonth} from "../../format";
import {Panel, SectionHeader} from "../../shared/components/ui";
import type {ReactNode} from "react";
import {ConfirmDialog} from "../../shared/components/ConfirmDialog";
import type {Budget, PlanningPayload, RecurringRule} from "../../shared/model/planning";
import {planningApi as api} from "./api";
import {PlanningProjectionPanel} from "./PlanningForecastPanels";
import {Button, IconButton} from "../../ui/controls/Button";
import {motionEase} from "../../shared/lib/motion";
import {BudgetCopyPanel} from "./BudgetCopyPanel";

type ComposerKind = "budget" | "recurring";
type SavedResult = {kind: ComposerKind; id: number} | null;
type EmptyListKind = "budget" | "occurrence";
type PendingPlanningConfirmation = {title: string; description: string; confirmLabel: string; action: () => Promise<void>};

export function PlanningResults({planning}: {planning: PlanningPayload}) {
  const overdue = planning.occurrences.filter((item) => item.due_date < planning.period.as_of);
  const overPace = planning.budget_progress.filter((item) => item.projected_percent > 100);
  const decisions = [
    ...(planning.margin.available < 0 ? [{tone: "critical", title: "El mes no cubre todos los compromisos", detail: "El margen previsto es negativo después de descontar el objetivo de ahorro. Revisa primero recurrentes y presupuestos.", href: "#planning-recurring-rules", action: "Revisar recurrentes"}] : []),
    ...(overdue.length ? [{tone: "warning", title: `${overdue.length} ${overdue.length === 1 ? "previsión vencida" : "previsiones vencidas"}`, detail: "Confirma el movimiento real o descarta la previsión si no ocurrió.", href: "#planning-occurrences", action: "Revisar previsiones"}] : []),
    ...(overPace.length ? [{tone: "warning", title: `${overPace.length} ${overPace.length === 1 ? "presupuesto va" : "presupuestos van"} por encima del ritmo`, detail: "Revisa las categorías antes de decidir nuevo gasto disponible.", href: "#planning-budgets", action: "Revisar presupuestos"}] : []),
  ];

  return (
    <>
      <Panel className={`planning-margin-panel ${planning.margin.available < 0 ? "is-negative" : ""}`}>
        <div className="planning-margin-lead">
          <span>Margen mensual previsto</span>
          <strong className={`money ${planning.margin.available < 0 ? "negative" : planning.margin.available > 0 ? "positive" : ""}`}>{euro(planning.margin.available)}</strong>
          <small>{planning.goal.active ? <>Descuenta <span className="money">{euro(planning.margin.savings_goal)}</span> del objetivo de ahorro previsto.</> : "Sin descuento por objetivo de ahorro."} Incluye ingresos recurrentes pendientes. No equivale al saldo ni considera cuándo se cobra o paga o todos los gastos variables futuros.</small>
        </div>
        <dl className="planning-margin-breakdown">
          <div><dt>Ingresos esperados, incluidos pendientes</dt><dd className="money">{euro(planning.margin.expected_income)}</dd></div>
          <div><dt>Gasto confirmado</dt><dd className="money">− {euro(planning.margin.confirmed_expense)}</dd></div>
          <div><dt>Recurrentes pendientes</dt><dd className="money">− {euro(planning.margin.pending_recurring)}</dd></div>
          <div><dt>Objetivo de ahorro</dt><dd className="money">− {euro(planning.margin.savings_goal)}</dd></div>
        </dl>
      </Panel>

      {decisions.length ? <section className="planning-decisions-section" aria-label="Acciones que requieren atención">
        <ol className="planning-decision-list">{decisions.map((decision) => {
          const DecisionIcon = decision.tone === "critical" ? CircleAlert : AlertTriangle;
          return <li className={decision.tone} key={decision.title}><div><strong>{decision.title}</strong><p>{decision.detail}</p><a href={decision.href}>{decision.action}</a></div><DecisionIcon aria-hidden="true" /></li>;
        })}</ol>
      </section> : null}

      <PlanningProjectionPanel planning={planning} />
    </>
  );
}

export function PlanningTracking({planning, selectedMonth, load, loading, setError, setStatus, onEditBudget, onEditRule, savedResult, onEntryComplete, onBudgetCopyPendingChange, onBudgetCopySaved, setup, isActive}: {
  planning: PlanningPayload;
  selectedMonth: string;
  load: () => Promise<void>;
  loading: boolean;
  setError: (error: string) => void;
  setStatus: (status: string) => void;
  onEditBudget: (budget: Budget) => void;
  onEditRule: (rule: RecurringRule) => void;
  savedResult: SavedResult;
  onEntryComplete: (kind: ComposerKind, id: number) => void;
  onBudgetCopyPendingChange: (pending: boolean) => void;
  onBudgetCopySaved: (budgetId: number, message: string) => Promise<void>;
  setup?: ReactNode;
  isActive: boolean;
}) {
  const [pendingAction, setPendingAction] = useState("");
  const [budgetCopyOpen, setBudgetCopyOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingPlanningConfirmation | null>(null);
  const [movingRule, setMovingRule] = useState<{id: number; active: boolean} | null>(null);
  const lifecycleFocusRef = useRef<{ruleId: number; initiator: HTMLElement} | null>(null);
  const focusAfterEmptyActionRef = useRef<EmptyListKind | null>(null);
  const focusAfterDialogCloseRef = useRef<EmptyListKind | null>(null);
  const pendingEmptyTransitionRef = useRef<{kind: EmptyListKind; resolve: () => void; previousPlanning: PlanningPayload; refreshComplete: boolean} | null>(null);
  const [emptyTransitionRefreshVersion, setEmptyTransitionRefreshVersion] = useState(0);
  const reduceMotion = useReducedMotion();
  const resultEntryTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const budgetById = new Map(planning.budgets.map((budget) => [budget.id, budget]));

  useLayoutEffect(() => {
    const request = lifecycleFocusRef.current;
    if (!request || pendingAction) return;
    lifecycleFocusRef.current = null;
    if (document.activeElement !== request.initiator && document.activeElement !== document.body) return;
    const row = document.getElementById(`planning-recurring-${request.ruleId}`);
    const action = row?.querySelector<HTMLButtonElement>("[data-rule-lifecycle-toggle]") ?? null;
    const trackingHeading = document.getElementById("planning-tracking-title");
    const inViewport = (element: HTMLElement | null) => {
      const bounds = element?.getBoundingClientRect();
      return Boolean(bounds && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight);
    };
    (inViewport(action) ? action : inViewport(trackingHeading) ? trackingHeading : action ?? trackingHeading)?.focus({preventScroll: true});
  }, [planning.rules, pendingAction]);

  const finishEmptyTransition = (kind?: EmptyListKind, expectedResolve?: () => void) => {
    const transition = pendingEmptyTransitionRef.current;
    if (!transition || (kind && transition.kind !== kind) || (expectedResolve && transition.resolve !== expectedResolve)) return;
    pendingEmptyTransitionRef.current = null;
    transition.resolve();
  };

  useLayoutEffect(() => {
    const transition = pendingEmptyTransitionRef.current;
    if (!transition?.refreshComplete || loading || transition.previousPlanning === planning) return;
    const remainingCount = transition.kind === "budget" ? planning.budget_progress.length : planning.occurrences.length;
    if (remainingCount) finishEmptyTransition(transition.kind, transition.resolve);
  }, [emptyTransitionRefreshVersion, loading, planning]);

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    success: string,
    lifecycleRequest?: {ruleId: number; initiator: HTMLElement},
    emptyListKind?: EmptyListKind,
  ) => {
    if (pendingAction) return;
    if (lifecycleRequest) lifecycleFocusRef.current = lifecycleRequest;
    let resolveEmptyTransition: (() => void) | null = null;
    const isLastInList = emptyListKind === "budget"
      ? planning.budget_progress.length === 1
      : emptyListKind === "occurrence" ? planning.occurrences.length === 1 : false;
    const emptyTransition = isLastInList ? new Promise<void>((resolve) => {
      resolveEmptyTransition = resolve;
      pendingEmptyTransitionRef.current = {kind: emptyListKind!, resolve, previousPlanning: planning, refreshComplete: false};
    }) : null;
    const releaseEmptyTransition = () => {
      if (!resolveEmptyTransition) return;
      finishEmptyTransition(undefined, resolveEmptyTransition);
      resolveEmptyTransition = null;
    };
    setPendingAction(key);
    setError("");
    try {
      await action();
      setStatus(success);
      await load();
      if (emptyTransition) {
        const transition = pendingEmptyTransitionRef.current;
        if (transition?.resolve === resolveEmptyTransition) {
          transition.refreshComplete = true;
          setEmptyTransitionRefreshVersion((version) => version + 1);
        }
        await emptyTransition;
        if (emptyListKind) focusAfterEmptyActionRef.current = emptyListKind;
      }
    } catch (exception) {
      releaseEmptyTransition();
      if (lifecycleRequest) {
        lifecycleFocusRef.current = null;
        setMovingRule(null);
      }
      setError(exception instanceof Error ? exception.message : "No se pudo completar la acción.");
    } finally {
      setPendingAction("");
    }
  };

  const ruleGroups = (["active", "paused", "expired"] as const).map((lifecycle) => ({
    lifecycle,
    label: lifecycle === "active" ? "Activos" : lifecycle === "paused" ? "Pausados" : "Caducados",
    rules: planning.rules.filter((rule) => rule.lifecycle === lifecycle),
  })).filter((group) => group.rules.length);
  const budgetEmptyEntering = pendingEmptyTransitionRef.current?.kind === "budget" && !planning.budget_progress.length;
  const occurrenceEmptyEntering = pendingEmptyTransitionRef.current?.kind === "occurrence" && !planning.occurrences.length;
  const completeEmptyTransition = (kind: EmptyListKind) => {
    finishEmptyTransition(kind);
  };
  const closeConfirmation = () => {
    focusAfterDialogCloseRef.current = focusAfterEmptyActionRef.current;
    focusAfterEmptyActionRef.current = null;
    setPendingConfirmation(null);
  };

  const returnFocusTarget = () => {
    const emptyListKind = focusAfterDialogCloseRef.current;
    focusAfterDialogCloseRef.current = null;
    if (!isActive || !emptyListKind) return null;
    return emptyListKind === "budget"
      ? document.querySelector<HTMLButtonElement>("#planning-occurrences .review-card button")
      : document.querySelector<HTMLButtonElement>("#planning-recurring-rules .list-card .inline-actions button");
  };
  const closeBudgetCopy = (restoreFocus = true) => {
    setBudgetCopyOpen(false);
    if (restoreFocus) window.setTimeout(() => document.getElementById("planning-budget-copy-trigger")?.focus({preventScroll: true}), 0);
  };

  return (
    <section className="planning-tracking" aria-labelledby="planning-tracking-title">
      <div className="section-heading planning-tracking-heading">
        <h2 id="planning-tracking-title" tabIndex={-1}>Seguimiento</h2>
      </div>
      <p className="planning-tracking-intro">Controla límites de gasto y compromisos que se repiten.</p>
      {setup}
      <Panel id="planning-budgets" className={!planning.budget_progress.length ? "planning-empty-panel" : undefined}>
        <SectionHeader
          title={`Presupuestos de ${formatMonth(planning.period.start)}`}
          action={<Button
            id="planning-budget-copy-trigger"
            variant="secondary"
            aria-expanded={budgetCopyOpen}
            aria-controls={budgetCopyOpen ? "planning-budget-copy-panel" : undefined}
            disabled={Boolean(pendingAction)}
            onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setBudgetCopyOpen((current) => !current);}}
          >{budgetCopyOpen ? "Cerrar copia" : "Copiar de otro mes"}</Button>}
        />
        {budgetCopyOpen ? <BudgetCopyPanel
          targetMonth={selectedMonth}
          disabled={Boolean(pendingAction && pendingAction !== "budget-copy")}
          onClose={closeBudgetCopy}
          onPendingChange={(pending) => {
            setPendingAction(pending ? "budget-copy" : "");
            onBudgetCopyPendingChange(pending);
          }}
          onApplied={onBudgetCopySaved}
        /> : null}
        {planning.budget_progress.length ? planning.budget_progress.map((item) => {
          const budget = budgetById.get(item.id);
          const isSavedResult = savedResult?.kind === "budget" && savedResult.id === item.id;
          const animateEntry = isSavedResult && !reduceMotion;
          return <motion.article
            className="budget-row"
            id={`planning-budget-${item.id}`}
            tabIndex={-1}
            key={item.id}
            layout
            initial={animateEntry ? {opacity: 0, height: 0} : false}
            animate={{opacity: 1, height: "auto"}}
            transition={resultEntryTransition}
            onAnimationComplete={() => {if (isSavedResult) onEntryComplete("budget", item.id);}}
            style={animateEntry ? {overflow: "hidden"} : undefined}
          >
            <div><strong>{item.category.display_name}</strong><span><span className="money">{euro(item.spent)}</span> de <span className="money">{euro(item.limit)}</span></span></div>
            <div className="progress" role="progressbar" aria-label={`Presupuesto usado de ${item.category.display_name}`} aria-valuemin={0} aria-valuemax={Math.max(100, item.actual_percent)} aria-valuenow={item.actual_percent} aria-valuetext={`${item.actual_percent}% usado`}><i className={item.actual_percent > 100 ? "over" : ""} style={{width: `${Math.min(item.percent, 100)}%`}} /></div>
            <div className="row-footer"><small>{item.actual_percent > 100 ? <>Excedido en <span className="money">{euro(Math.abs(item.remaining))}</span></> : <><span className="money">{euro(item.remaining)}</span> disponibles</>} · cierre estimado {item.projected_percent}%</small><div className="inline-actions">{budget ? <IconButton variant="subtle" aria-label={`Editar presupuesto ${item.category.display_name}`} title={`Editar presupuesto ${item.category.display_name}`} onClick={() => onEditBudget(budget)}><Pencil aria-hidden="true" /></IconButton> : null}<IconButton variant="subtle" disabled={Boolean(pendingAction)} aria-label={`Eliminar presupuesto ${item.category.display_name}`} title={`Eliminar presupuesto ${item.category.display_name}`} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setPendingConfirmation({title: `¿Eliminar el presupuesto de ${item.category.display_name}?`, description: "Dejarás de ver este límite mensual. Los movimientos y sus métricas no cambiarán.", confirmLabel: "Eliminar presupuesto", action: () => runAction(`budget:${item.id}`, () => api.deleteBudget(item.id), "Presupuesto eliminado.", undefined, "budget")});}}><Trash2 aria-hidden="true" /></IconButton></div></div>
          </motion.article>;
        }) : <motion.div
          id="planning-budgets-empty"
          className="planning-empty"
          initial={budgetEmptyEntering ? {opacity: 0, height: 0} : false}
          animate={{opacity: 1, height: "auto"}}
          transition={resultEntryTransition}
          onAnimationComplete={() => {if (budgetEmptyEntering) completeEmptyTransition("budget");}}
          style={budgetEmptyEntering ? {overflow: "hidden"} : undefined}
        ><span>Aún no hay presupuestos este mes.</span></motion.div>}
      </Panel>

      <Panel id="planning-occurrences" className={!planning.occurrences.length ? "planning-empty-panel" : undefined}>
        <SectionHeader title="Movimientos previstos" detail="No cuentan como gasto o ingreso hasta que se concilian con un movimiento real." />
        {planning.occurrences.length ? <div className="stack-list">{planning.occurrences.map((occurrence) => <motion.article className="list-card review-card" layout transition={resultEntryTransition} key={occurrence.id}><div className="review-head"><strong>{occurrence.rule.name}</strong><b className={`money ${occurrence.rule.kind === "expense" ? "negative" : "positive"}`}>{euro(occurrence.rule.kind === "expense" ? -occurrence.amount : occurrence.amount)}</b></div><span>{formatDate(occurrence.due_date)} · {occurrence.rule.account.name}</span><small>{occurrence.rule.category.display_name}</small><div className="inline-actions"><span className={`status-chip ${occurrence.due_date < planning.period.as_of ? "warning" : ""}`}>{occurrence.due_date < planning.period.as_of ? "Vencido" : "Pendiente"}</span><Button variant="secondary" disabled={Boolean(pendingAction)} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setPendingConfirmation({title: `¿Omitir la previsión “${occurrence.rule.name}”?`, description: "La previsión dejará de aparecer en este mes. Esta acción no se puede deshacer y no modifica movimientos reales.", confirmLabel: "Omitir previsión", action: () => runAction(`occurrence:${occurrence.id}`, () => api.occurrenceAction(occurrence.id, "skip"), "Previsión omitida.", undefined, "occurrence")});}}>Omitir</Button></div></motion.article>)}</div> : <motion.div
          id="planning-occurrences-empty"
          className="planning-empty"
          initial={occurrenceEmptyEntering ? {opacity: 0, height: 0} : false}
          animate={{opacity: 1, height: "auto"}}
          transition={resultEntryTransition}
          onAnimationComplete={() => {if (occurrenceEmptyEntering) completeEmptyTransition("occurrence");}}
          style={occurrenceEmptyEntering ? {overflow: "hidden"} : undefined}
        ><span>No hay movimientos previstos para este mes.</span></motion.div>}
      </Panel>

      <Panel id="planning-recurring-rules" className={!ruleGroups.length ? "planning-empty-panel" : undefined}>
        <SectionHeader title="Recurrentes configurados" />
        {ruleGroups.length ? (
          <div className="planning-rule-groups">
            {ruleGroups.map((group) => (
              <section key={group.lifecycle} aria-labelledby={`rules-${group.lifecycle}`}>
                <h3 id={`rules-${group.lifecycle}`}>{group.label} <span>{group.rules.length}</span></h3>
                <div className="stack-list compact-stack">
                  {group.rules.map((rule) => {
                    const isSavedResult = savedResult?.kind === "recurring" && savedResult.id === rule.id;
                    const isMovedRule = movingRule?.id === rule.id && movingRule.active === rule.active;
                    const animateEntry = (isSavedResult || isMovedRule) && !reduceMotion;
                    return <motion.article
                      className="list-card"
                      id={`planning-recurring-${rule.id}`}
                      tabIndex={-1}
                      key={rule.id}
                      aria-busy={pendingAction === `rule:${rule.id}` || undefined}
                      initial={animateEntry ? {opacity: 0, height: 0} : false}
                      animate={{opacity: 1, height: "auto"}}
                      transition={resultEntryTransition}
                      onAnimationComplete={() => {
                        if (isSavedResult) onEntryComplete("recurring", rule.id);
                        if (isMovedRule) setMovingRule((current) => current?.id === rule.id ? null : current);
                      }}
                      style={animateEntry ? {overflow: "hidden"} : undefined}
                    >
                      <div className="review-head">
                        <strong>{rule.name}</strong>
                        <span className={`status-chip ${rule.lifecycle}`}>{group.label.slice(0, -1)}</span>
                      </div>
                      <span>{rule.frequency_display} · día {rule.day_of_month} · {rule.account.name}</span>
                      <small>{rule.category.display_name} · <span className="money">{euro(rule.kind === "expense" ? -rule.amount : rule.amount)}</span>{rule.end_date ? ` · hasta ${formatDate(rule.end_date)}` : ""}</small>
                      <div className="inline-actions top-gap-small">
                        <Button variant="secondary" onClick={() => onEditRule(rule)}>Editar</Button>
                        {rule.lifecycle !== "expired" ? <Button
                          variant="secondary"
                          aria-disabled={Boolean(pendingAction) || undefined}
                          aria-busy={pendingAction === `rule:${rule.id}` || undefined}
                          data-rule-lifecycle-toggle
                          onClick={(event) => {
                            if (pendingAction) return;
                            event.currentTarget.focus({preventScroll: true});
                            setMovingRule({id: rule.id, active: !rule.active});
                            void runAction(`rule:${rule.id}`, () => api.setRecurringRuleActive(rule.id, !rule.active), rule.active ? "Recurrente pausado." : "Recurrente reactivado.", {ruleId: rule.id, initiator: event.currentTarget});
                          }}
                        >{pendingAction === `rule:${rule.id}` ? <><Loader2 aria-hidden="true" className="spin" /> Actualizando recurrente…</> : <>{rule.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{rule.active ? "Pausar" : "Reactivar"}</>}</Button> : null}
                      </div>
                    </motion.article>;
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : <div className="planning-empty"><span>No hay recurrentes configurados.</span></div>}
      </Panel>
      {pendingConfirmation ? <ConfirmDialog {...pendingConfirmation} onConfirm={pendingConfirmation.action} onCancel={closeConfirmation} returnFocusTarget={returnFocusTarget} /> : null}
    </section>
  );
}
