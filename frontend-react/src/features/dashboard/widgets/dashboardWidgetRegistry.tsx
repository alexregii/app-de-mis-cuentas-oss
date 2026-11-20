import {Banknote, CheckCircle2, RefreshCw, WalletCards} from "lucide-react";
import {euro, formatDate} from "../../../format";
import {Panel, SectionHeader} from "../../../shared/components/ui";
import {secondaryDashboardWidgets} from "./secondaryDashboardWidgets";
import type {DashboardWidgetDefinition, DashboardWidgetProps} from "./widgetTypes";
import {TextButton} from "../../../ui/controls/Button";
import {dashboardActivationWidget} from "./dashboardActivationWidget";

export function DashboardQuickActions({
  showReview = true,
  onReview,
  onImport,
  onStats,
}: {
  showReview?: boolean;
  onReview: () => void;
  onImport: () => void;
  onStats: () => void;
}) {
  return <div className="action-band">
    {showReview ? <TextButton className="dashboard-quick-action" onClick={onReview}>
      <RefreshCw aria-hidden="true" />
      <span>Revisar banco</span>
    </TextButton> : null}
    <TextButton className="dashboard-quick-action" onClick={onImport}>
      <Banknote aria-hidden="true" />
      <span>Importar CSV</span>
    </TextButton>
    <TextButton className="dashboard-quick-action" onClick={onStats}>
      <WalletCards aria-hidden="true" />
      <span>Estadísticas</span>
    </TextButton>
  </div>;
}

export const dashboardWidgetRegistry = {
  balance: {
    id: "balance",
    title: "Saldo",
    region: "hero",
    modes: ["full", "balance"],
    hideable: false,
    reorderable: false,
    priority: 0,
    available: () => true,
    render: ({data, compact}) => {
      const {metrics, review} = data;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`balance-panel dashboard-widget critical${density}`}>
          <div className="balance-copy">
            <span>Saldo registrado en cuentas activas</span>
            <p>Entre {data.accounts.filter((item) => item.active).length} cuentas activas.</p>
          </div>
          <strong className="balance-amount">{euro(metrics.total_balance || 0)}</strong>
          <div className="balance-status">
            <CheckCircle2 aria-hidden="true" />
            <small>
              {review.last_bank_imported_date
                ? `Última sincronización: ${formatDate(review.last_bank_imported_date)}`
                : "Sin sincronizaciones bancarias recientes"}
            </small>
          </div>
          <div className="financial-readout" aria-label="Resumen financiero del mes">
            <div><span>Ingresos</span><strong className="positive">{euro(metrics.income)}</strong></div>
            <div><span>Gastos</span><strong className="negative">{euro(metrics.expense)}</strong></div>
            <div><span>Resultado del mes</span><strong className={metrics.net_savings < 0 ? "negative" : "positive"}>{euro(metrics.net_savings)}</strong></div>
          </div>
        </Panel>
      );
    },
  },
  actions: {
    id: "actions",
    title: "Acciones",
    region: "decision",
    modes: ["full"],
    hideable: true,
    reorderable: false,
    priority: 10,
    available: () => true,
    render: ({data, bootstrap, onReview, onImport, onStats}) => (
      <Panel className="dashboard-actions dashboard-widget">
        <SectionHeader title="Acciones" detail="Atajos para mantener el control." />
        <DashboardQuickActions
          showReview={!bootstrap.bank_errors.length && !data.review.has_pending_review && !bootstrap.priority_tasks.length}
          onReview={onReview}
          onImport={onImport}
          onStats={onStats}
        />
      </Panel>
    ),
  },
  priority: {
    id: "priority",
    title: "Revisión pendiente",
    region: "decision",
    modes: ["full", "review"],
    hideable: false,
    reorderable: false,
    priority: 20,
    available: () => true,
    render: ({bootstrap, compact, onReview}) => {
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget priority-widget${density}`}>
          <SectionHeader
            title="Revisión pendiente"
            action={
              <TextButton onClick={onReview}>
                Abrir revisión
              </TextButton>
            }
          />
          {bootstrap.priority_tasks.length ? (
            <div className="priority-list">
              {bootstrap.priority_tasks.map((task) => (
                <a href={task.url} key={task.id}>
                  <span className={`severity-dot ${task.severity}`} aria-hidden="true" />
                  <strong>{task.label}</strong>
                  <small>
                    {task.count} {task.count === 1 ? "caso" : "casos"}
                  </small>
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state--plain">Sin incidencias pendientes.</div>
          )}
        </Panel>
      );
    },
  },
  bank_health: {
    id: "bank_health",
    title: "Salud bancaria",
    region: "decision",
    modes: ["full", "review"],
    hideable: false,
    reorderable: false,
    priority: 30,
    available: ({bootstrap}) => bootstrap.bank_errors.length > 0,
    render: ({bootstrap, compact, onReview}) => {
      if (!bootstrap.bank_errors.length) return null;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget bank-health-widget${density}`}>
          <SectionHeader
            title="Banco con error"
            action={
              <TextButton onClick={onReview}>
                Revisar banco
              </TextButton>
            }
          />
          <div className="stack-list">
            {bootstrap.bank_errors.slice(0, 3).map((connection) => (
              <div className="list-card" key={connection.id}>
                <strong>{connection.bank_name}</strong>
                <span>
                  {connection.last_synced_at
                    ? `Última sincronización: ${formatDate(connection.last_synced_at)}`
                    : "Sin sincronización reciente"}
                </span>
                <small>{connection.last_error || connection.sync_status_display}</small>
              </div>
            ))}
          </div>
        </Panel>
      );
    },
  },
  savings: {
    id: "savings",
    title: "Resultado del mes",
    region: "hero",
    modes: ["full"],
    hideable: true,
    reorderable: false,
    priority: 40,
    available: () => true,
    render: ({data, compact}) => {
      const {metrics} = data;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget metric-widget savings-widget${density}`}>
          <SectionHeader title="Resultado del mes" detail="Ingresos menos gasto neto registrado; no es el saldo de tus cuentas." />
          <strong className={metrics.net_savings < 0 ? "negative" : "positive"}>
            {euro(metrics.net_savings)}
          </strong>
          <p>
            {metrics.savings_rate != null
              ? `${metrics.savings_rate.toFixed(1)}% de tasa de ahorro`
              : "Aún no hay ingresos con los que calcular la tasa."}
          </p>
          <small>Objetivo de ahorro previsto: {euro(metrics.savings_goal || 0)}</small>
        </Panel>
      );
    },
  },
  safe_spend: {
    id: "safe_spend",
    title: "Margen mensual previsto",
    region: "hero",
    modes: ["full"],
    hideable: true,
    reorderable: false,
    priority: 50,
    available: () => true,
    render: ({data, compact, onPlanning}) => {
      const {metrics} = data;
      const density = compact ? " compact" : "";
      const safeToSpend = metrics.safe_to_spend;
      return (
        <Panel className={`dashboard-widget metric-widget${density}`}>
          <SectionHeader title="Margen mensual previsto" />
          <strong className={safeToSpend != null && safeToSpend < 0 ? "negative" : ""}>
            {safeToSpend == null ? "Sin datos" : euro(safeToSpend)}
          </strong>
          <p>
            {safeToSpend != null && safeToSpend < 0
              ? "El margen previsto es negativo."
              : "Es una previsión, no dinero disponible hoy."}
          </p>
          <small>Incluye ingresos recurrentes pendientes. No equivale al saldo ni considera cuándo se cobra o paga o todos los gastos variables futuros.</small>
          <TextButton onClick={onPlanning}>Ver desglose en Plan</TextButton>
        </Panel>
      );
    },
  },
  budget_risk: {
    id: "budget_risk",
    title: "Presupuesto en riesgo",
    region: "decision",
    modes: ["full", "review"],
    hideable: true,
    reorderable: false,
    priority: 60,
    available: ({bootstrap}) => Boolean(bootstrap.budget_risk),
    render: ({bootstrap, compact, onPlanning}) => {
      if (!bootstrap.budget_risk) return null;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget${density}`}>
          <SectionHeader
            title="Presupuesto en riesgo"
            action={
              <TextButton onClick={onPlanning}>
                Abrir plan
              </TextButton>
            }
          />
          <div className="widget-line">
            <div>
              <strong>{bootstrap.budget_risk.category.display_name}</strong>
              <span>
                {euro(bootstrap.budget_risk.spent)} de {euro(bootstrap.budget_risk.limit)}
              </span>
            </div>
            <b>
              {Math.round(
                Math.max(
                  bootstrap.budget_risk.actual_percent,
                  bootstrap.budget_risk.projected_percent,
                ),
              )}
              %
            </b>
          </div>
          <div className="progress">
            <i style={{width: `${Math.min(bootstrap.budget_risk.actual_percent, 100)}%`}} />
          </div>
        </Panel>
      );
    },
  },
  recurring_next: {
    id: "recurring_next",
    title: "Próximo recurrente",
    region: "decision",
    modes: ["full", "review"],
    hideable: true,
    reorderable: false,
    priority: 70,
    available: ({bootstrap}) => Boolean(bootstrap.recurring_next),
    render: ({bootstrap, compact, onPlanning}) => {
      if (!bootstrap.recurring_next) return null;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget${density}`}>
          <SectionHeader
            title="Próximo recurrente"
            action={
              <TextButton onClick={onPlanning}>
                Planificar
              </TextButton>
            }
          />
          <div className="widget-line">
            <div>
              <strong>{bootstrap.recurring_next.name}</strong>
              <span>
                {formatDate(bootstrap.recurring_next.date)} · {bootstrap.recurring_next.account}
              </span>
            </div>
            <b>{euro(bootstrap.recurring_next.amount)}</b>
          </div>
        </Panel>
      );
    },
  },
  refunds: {
    id: "refunds",
    title: "Reembolsos pendientes",
    region: "decision",
    modes: ["full", "review"],
    hideable: true,
    reorderable: false,
    priority: 80,
    available: ({bootstrap}) => bootstrap.refunds.length > 0,
    render: ({bootstrap, compact}) => {
      if (!bootstrap.refunds.length) return null;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget${density}`}>
          <SectionHeader title="Reembolsos pendientes" />
          <div className="stack-list">
            {bootstrap.refunds.map((refund) => (
              <a
                className="list-card"
                href={refund.url}
                key={`${refund.date}-${refund.description}`}
              >
                <strong>{refund.description}</strong>
                <span>
                  {formatDate(refund.date)} · {refund.status}
                </span>
                <b>{euro(refund.amount)}</b>
              </a>
            ))}
          </div>
        </Panel>
      );
    },
  },
  subscriptions: {
    id: "subscriptions",
    title: "Patrones recurrentes",
    region: "more",
    modes: ["full"],
    hideable: true,
    reorderable: true,
    priority: 90,
    available: ({bootstrap}) => bootstrap.subscriptions.length > 0,
    render: ({bootstrap, compact, onPlanning}) => {
      if (!bootstrap.subscriptions.length) return null;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget${density}`}>
          <SectionHeader
            title="Patrones recurrentes detectados"
            action={
              <TextButton onClick={onPlanning}>
                Ir a Plan
              </TextButton>
            }
          />
          <div className="empty-state empty-state--plain">
            {bootstrap.subscriptions.length} {bootstrap.subscriptions.length === 1 ? "patrón pendiente" : "patrones pendientes"} de confirmar. Revísalos y conviértelos en reglas desde Plan.
          </div>
        </Panel>
      );
    },
  },
  ...secondaryDashboardWidgets,
  activation: dashboardActivationWidget,
} satisfies Record<string, DashboardWidgetDefinition>;

export type DashboardWidgetId = keyof typeof dashboardWidgetRegistry;

export const DASHBOARD_WIDGET_IDS = Object.keys(dashboardWidgetRegistry) as DashboardWidgetId[];

function isDashboardWidgetId(id: string): id is DashboardWidgetId {
  return id in dashboardWidgetRegistry;
}

export function dashboardWidgetTitle(id: string): string | undefined {
  return isDashboardWidgetId(id) ? dashboardWidgetRegistry[id].title : undefined;
}

export function dashboardWidgetDefinition(id: string): DashboardWidgetDefinition | undefined {
  return isDashboardWidgetId(id) ? dashboardWidgetRegistry[id] : undefined;
}

export function DashboardWidget({id, ...props}: DashboardWidgetProps & {id: string}) {
  return isDashboardWidgetId(id) ? dashboardWidgetRegistry[id].render(props) : null;
}
