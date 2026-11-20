import {useCallback, useEffect, useId, useState, type MouseEvent, type ReactNode} from "react";
import {motion, useReducedMotion} from "motion/react";
import {AlertTriangle, CheckCircle2, ChevronDown, CircleAlert, Clock3, Settings2} from "lucide-react";
import {euro, formatDate, formatMonth} from "../../format";
import {ErrorBanner} from "../../shared/components/ui";
import type {BootstrapPayload} from "../../shared/model/bootstrap";
import type {DashboardContentMode} from "../../shared/model/dashboard";
import {DashboardCustomizer} from "./components/DashboardCustomizer";
import {DashboardSnapshotPanel} from "./components/DashboardSnapshot";
import {useDashboardPreferences} from "./useDashboardPreferences";
import {dashboardWidgetDefinition, DashboardQuickActions, DashboardWidget} from "./widgets/dashboardWidgetRegistry";
import {buildDashboardDecisionQueue, type DashboardDecision} from "./dashboardDecisionQueue";
import {Button, ButtonLink, TextButton, TextLink} from "../../ui/controls/Button";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {PageHeader} from "../../ui/layout/PageHeader";
import {motionEase} from "../../shared/lib/motion";

function DashboardMoreContent({id, labelledBy, open, reduceMotion, children}: {id: string; labelledBy: string; open: boolean; reduceMotion: boolean; children: ReactNode}) {
  const [interactive, setInteractive] = useState(false);
  const transition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  useEffect(() => {
    if (!open || reduceMotion) setInteractive(open);
  }, [open, reduceMotion]);
  return <motion.div
    id={id}
    className="dashboard-more-transition"
    role="region"
    aria-labelledby={labelledBy}
    aria-hidden={open && interactive ? undefined : true}
    inert={!open || !interactive}
    initial={false}
    animate={{height: open ? "auto" : 0, opacity: open ? 1 : 0, y: open || reduceMotion ? 0 : -2}}
    transition={transition}
    style={{overflow: "hidden"}}
    onAnimationComplete={() => {if (open) setInteractive(true);}}
  >
    <div className="dashboard-more-content">{children}</div>
  </motion.div>;
}

export interface DashboardViewProps {
  data: BootstrapPayload;
  privateAmounts?: boolean;
  onAddTransaction: () => void;
  onOpenAccounts: () => void;
  onCreateObjective: () => void;
  onOpenTransactions: (href?: string) => void;
  onOpenReview: () => void;
  onOpenImport: () => void;
  onOpenPlanning: () => void;
  onOpenStatistics: () => void;
}

const priorityLabel = (priority?: number) => priority == null ? null : priority <= 5 ? {label: "Crítica", tone: "critical"} : priority <= 20 ? {label: "Alta", tone: "high"} : {label: "Normal", tone: "normal"};

export function DashboardView({data, privateAmounts = false, onAddTransaction, onOpenAccounts, onCreateObjective, onOpenTransactions, onOpenReview, onOpenImport, onOpenPlanning, onOpenStatistics}: DashboardViewProps) {
  const [editing, setEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeCustomizer = useCallback(() => setEditing(false), []);
  const reduceMotion = useReducedMotion();
  const moreTriggerId = useId();
  const moreContentId = useId();
  const layoutTransition = reduceMotion ? {duration: 0} : {layout: {duration: 0.18, ease: motionEase}};
  const {dashboard, canMove, error, hidden, mode, move, order, preferences, reset, setError, setMode, setPreferences, toggle, visible} = useDashboardPreferences(data);
  const [restoreActivationFocus, setRestoreActivationFocus] = useState(false);
  useEffect(() => {
    if (!restoreActivationFocus || visible.includes("activation")) return;
    document.querySelector<HTMLButtonElement>(".dashboard-customize-trigger")?.focus({preventScroll: true});
    setRestoreActivationFocus(false);
  }, [restoreActivationFocus, visible]);
  const hideActivation = () => {
    setRestoreActivationFocus(true);
    toggle("activation");
  };
  const decisionQueue = buildDashboardDecisionQueue(data);
  const currentDecision = decisionQueue[0];
  const remainingDecisions = decisionQueue.slice(1, 4);
  const hasAttention = decisionQueue.length > 0;
  const activityWidgets = visible.filter((id) => dashboardWidgetDefinition(id)?.region === "activity");
  const displayedActivityWidgets = mode === "balance" ? activityWidgets.filter((id) => id === "accounts") : activityWidgets;
  const moreWidgets = visible.filter((id) => dashboardWidgetDefinition(id)?.region === "more");
  const showFull = mode === "full";
  const showReview = mode !== "balance";
  const showActivity = showFull || mode === "balance";
  const syncState = dashboard.bank_errors.length
    ? {label: "Hay una incidencia bancaria que revisar", Icon: AlertTriangle, tone: "attention"}
    : data.review.has_pending_review
      ? {label: "Hay movimientos pendientes de validar", Icon: Clock3, tone: "attention"}
      : data.review.last_bank_sync_at
        ? {label: `Última sincronización: ${formatDate(data.review.last_bank_sync_at)}`, Icon: CheckCircle2, tone: "ready"}
        : {label: "Sin sincronizaciones bancarias recientes", Icon: Clock3, tone: "quiet"};
  const safeToSpend = data.metrics.safe_to_spend;

  const decisionAction = (decision: DashboardDecision, emphasis: "text" | "primary" = "text") => {
    if (decision.href && decision.action === "transactions") {
      const props = {href: decision.href, onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onOpenTransactions(decision.href);
      }};
      return emphasis === "primary"
        ? <ButtonLink {...props} variant="primary">{decision.actionLabel}</ButtonLink>
        : <TextLink {...props}>{decision.actionLabel}</TextLink>;
    }
    if (decision.href) return emphasis === "primary"
      ? <ButtonLink variant="primary" href={decision.href}>{decision.actionLabel}</ButtonLink>
      : <TextLink href={decision.href}>{decision.actionLabel}</TextLink>;
    const onClick = decision.action === "review" ? onOpenReview : decision.action === "planning" ? onOpenPlanning : () => onOpenTransactions();
    return emphasis === "primary"
      ? <Button variant="primary" onClick={onClick}>{decision.actionLabel}</Button>
      : <TextButton onClick={onClick}>{decision.actionLabel}</TextButton>;
  };
  const prioritySignal = (decision: DashboardDecision) => {
    const priority = priorityLabel(decision.priority);
    return priority ? <span className={`decision-priority ${priority.tone}`}><CircleAlert aria-hidden="true" /> Prioridad {priority.label}</span> : null;
  };
  const renderWidget = (id: string) => <motion.div key={id} className="dashboard-widget-layout" layout="position" transition={layoutTransition}>
    <DashboardWidget
      id={id} data={data} bootstrap={dashboard} privateAmounts={privateAmounts}
      compact={preferences.density === "compact"}
      onAddTransaction={onAddTransaction} onOpenAccounts={onOpenAccounts} onCreateObjective={onCreateObjective}
      onHideActivation={hideActivation} onOpenTransactions={onOpenTransactions} onReview={onOpenReview} onImport={onOpenImport}
      onPlanning={onOpenPlanning} onStats={onOpenStatistics}
    />
  </motion.div>;

  return (
    <div className={`view-stack dashboard-shell mode-${mode}`}>
      {error ? <ErrorBanner message={error} /> : null}
      <PageHeader className="dashboard-operational-header" title="Resumen" description={formatMonth(data.metrics.start)} actions={
        <Button variant="secondary" className="dashboard-customize-trigger" onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setEditing(true);}}>
          <Settings2 aria-hidden="true" /> Personalizar
        </Button>
      }>
        <div className="dashboard-view-controls">
          <SegmentedControl className="mode-switcher" aria-label="Vista del resumen">
            {(["full", "balance", "review"] as DashboardContentMode[]).map((item) => (
              <SegmentedItem key={item} selected={mode === item} onClick={() => setMode(item)}>
                {item === "full" ? "Completo" : item === "balance" ? "Saldos" : "Revisión"}
              </SegmentedItem>
            ))}
          </SegmentedControl>
        </div>
      </PageHeader>

      {editing ? <DashboardCustomizer order={order} hidden={hidden} onClose={closeCustomizer} onMove={move} canMove={canMove} onToggle={toggle} onReset={reset} /> : null}

      <section className="dashboard-financial-summary" aria-labelledby="dashboard-financial-title">
        <h2 id="dashboard-financial-title">Estado del mes</h2>
        <div className="financial-overview">
          <div className="financial-balance">
            <span className="financial-balance-label">Saldo registrado</span>
            <strong>{euro(data.metrics.total_balance || 0)}</strong>
            <small>{data.accounts.filter((item) => item.active).length} cuentas activas</small>
          </div>
          <dl className="financial-readout" aria-label="Ingresos, gastos y resultado del mes">
            <div><dt>Ingresos</dt><dd className="positive">{euro(data.metrics.income || 0)}</dd></div>
            <div><dt>Gastos</dt><dd className="negative">{euro(data.metrics.expense || 0)}</dd></div>
            <div><dt>Resultado del mes</dt><dd className={data.metrics.net_savings < 0 ? "negative" : "positive"}>{euro(data.metrics.net_savings || 0)}</dd></div>
          </dl>
        </div>
        {visible.includes("safe_spend") || visible.includes("savings") ? <div className="dashboard-month-notes">
          {visible.includes("safe_spend") ? <>
            <span className="dashboard-safe-spend-note">
              <span>Margen mensual previsto <strong className={safeToSpend == null ? "" : safeToSpend < 0 ? "negative" : "positive"}>{safeToSpend == null ? "Sin datos" : euro(safeToSpend)}</strong></span>
              <span>Incluye ingresos recurrentes pendientes; no es saldo.</span>
            </span>
            <TextButton onClick={onOpenPlanning}>Ver desglose en Plan</TextButton>
          </> : null}
          {visible.includes("savings") && data.metrics.savings_rate != null ? <span>Ahorro mensual {data.metrics.savings_rate.toFixed(1)}%</span> : null}
        </div> : null}
        {!showReview || (!dashboard.bank_errors.length && !data.review.has_pending_review) ? <div className={`financial-sync ${syncState.tone}`}>
          <syncState.Icon aria-hidden="true" /><span>{syncState.label}</span>
        </div> : null}
      </section>

      {visible.includes("activation") ? renderWidget("activation") : null}

      <motion.div className={`dashboard-body-grid${showActivity && showReview ? " with-agenda" : ""}`} layout transition={layoutTransition}>
        {showReview ? <motion.aside className="dashboard-agenda" aria-label="Agenda del resumen" layout transition={layoutTransition}>
          <section className={`dashboard-now ${hasAttention ? "has-attention" : "is-clear"}`} aria-labelledby="dashboard-now-title">
            <div className="dashboard-now-heading">
              <h2 id="dashboard-now-title">{hasAttention ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}Ahora</h2>
              {hasAttention ? <span className="dashboard-context">{decisionQueue.length} {decisionQueue.length === 1 ? "asunto" : "asuntos"}</span> : null}
            </div>
            <h3>{currentDecision?.title || "Sin acciones pendientes"}</h3>
            {currentDecision ? prioritySignal(currentDecision) : null}
            <p>{currentDecision?.detail || "No hay incidencias pendientes."}</p>
            {currentDecision ? decisionAction(currentDecision, "primary") : null}
          </section>
          {remainingDecisions.length ? <section className="dashboard-next" aria-labelledby="dashboard-next-title">
            <h2 id="dashboard-next-title">Pendientes de atención</h2>
            <ol className="dashboard-decision-queue">
              {remainingDecisions.map((decision) => <li key={decision.id} className="dashboard-decision-row">
                <div><strong>{decision.title}</strong>{prioritySignal(decision)}<span>{decision.detail}</span></div>
                {decisionAction(decision)}
              </li>)}
            </ol>
          </section> : null}
          {dashboard.recurring_next ? <section className="dashboard-reminders" aria-labelledby="dashboard-reminders-title">
            <h2 id="dashboard-reminders-title">Recordatorios</h2>
            <div className="dashboard-reminder-detail">
              <strong>{dashboard.recurring_next.name}</strong>
              {euro(dashboard.recurring_next.amount)}
              <span>{formatDate(dashboard.recurring_next.date)} · {dashboard.recurring_next.account}</span>
            </div>
            <TextButton onClick={onOpenPlanning}>Ver plan</TextButton>
          </section> : null}
        </motion.aside> : null}

        {showActivity ? <motion.section className="dashboard-activity" aria-labelledby="dashboard-activity-title" layout transition={layoutTransition}>
          <h2 id="dashboard-activity-title">Actividad</h2>
          {displayedActivityWidgets.length ? <div className="dashboard-activity-grid">
            {displayedActivityWidgets.map(renderWidget)}
          </div> : <div className="dashboard-activity-empty">
            <p>{mode === "balance" ? "No hay cuentas visibles en este resumen." : "No hay actividad visible en este resumen."}</p>
            <TextButton onClick={() => setEditing(true)}>Elegir módulos</TextButton>
          </div>}
        </motion.section> : null}
      </motion.div>

      {showFull && visible.includes("actions") ? <nav className="dashboard-quick-actions" aria-label="Acciones rápidas">
        <DashboardQuickActions showReview={!decisionQueue.some((decision) => decision.action === "review")} onReview={onOpenReview} onImport={onOpenImport} onStats={onOpenStatistics} />
      </nav> : null}

      {showFull ? <div className="dashboard-more">
        <TextButton
          id={moreTriggerId}
          className="dashboard-more-trigger"
          aria-expanded={moreOpen}
          aria-controls={moreContentId}
          onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setMoreOpen((current) => !current);}}
        >
          Más información <ChevronDown aria-hidden="true" />
        </TextButton>
        <DashboardMoreContent id={moreContentId} labelledBy={moreTriggerId} open={moreOpen} reduceMotion={reduceMotion !== false}>
          {moreWidgets.map(renderWidget)}
          <DashboardSnapshotPanel visible preferences={preferences} setPreferences={setPreferences} setError={setError} />
        </DashboardMoreContent>
      </div> : null}
    </div>
  );
}
