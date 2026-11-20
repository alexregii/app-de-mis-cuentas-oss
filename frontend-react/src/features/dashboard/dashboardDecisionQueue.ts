import {euro, formatDate} from "../../format";
import type {BootstrapPayload} from "../../shared/model/bootstrap";

export type DashboardDecision = {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  action: "review" | "planning" | "transactions";
  href?: string;
  priority?: number;
};

// This is deliberately independent from DashboardWidgetRegistry. The registry
// owns presentation and personalization; this queue owns operational priority
// and actions. A hidden widget therefore cannot silence a financial alert.

const attentionSignalDetail = (signal: BootstrapPayload["signals"][number]) => {
  switch (signal.detail.kind) {
    case "projection_vs_median":
      return `Proyecta ${euro(signal.detail.projected)} frente a una mediana de ${euro(signal.detail.baseline)}.`;
    case "above_historical_median":
      return `Está por encima de tu mediana histórica de ${euro(signal.detail.baseline)}.`;
    case "previous_median":
      return `Pago de ${euro(signal.detail.latest_amount)} el ${formatDate(signal.detail.date)}; mediana anterior ${euro(signal.detail.baseline)}.`;
    case "text":
      return signal.detail.text;
  }
};

export function buildDashboardDecisionQueue(data: BootstrapPayload): DashboardDecision[] {
  if (data.review_queue?.length) {
    return data.review_queue.map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.detail,
      actionLabel: item.href.includes("planning") ? "Abrir plan" : item.href.includes("transactions") ? "Ver movimientos" : "Abrir revisión",
      action: item.href.includes("planning") ? "planning" : item.href.includes("transactions") ? "transactions" : "review",
      href: item.href,
      priority: item.priority,
    }));
  }
  const dashboard = data.dashboard;
  const decisions: DashboardDecision[] = [];

  if (dashboard.bank_errors.length) {
    decisions.push({
      id: "bank-errors",
      title: dashboard.bank_errors.length === 1 ? "Conexión bancaria por revisar" : `${dashboard.bank_errors.length} conexiones bancarias por revisar`,
      detail: dashboard.bank_errors.length === 1 ? dashboard.bank_errors[0].bank_name : "Revisa las conexiones con incidencias antes de tomar decisiones con sus saldos.",
      actionLabel: "Revisar banco",
      action: "review",
    });
  }

  if (data.review.has_pending_review) {
    const count = data.review.total_pending_count;
    decisions.push({
      id: "pending-review",
      title: `${count || "Varios"} ${count === 1 ? "movimiento pendiente de validar" : "movimientos pendientes de validar"}`,
      detail: "Confirma o corrige estos movimientos para que el resumen y las estadísticas sean fiables.",
      actionLabel: "Abrir revisión",
      action: "review",
    });
  } else if (dashboard.priority_tasks.length) {
    const task = dashboard.priority_tasks[0];
    decisions.push({
      id: `priority-${task.id}`,
      title: task.label,
      detail: `${task.count} ${task.count === 1 ? "caso pendiente" : "casos pendientes"}.`,
      actionLabel: "Abrir revisión",
      action: "review",
      href: task.url,
    });
  }

  if (dashboard.budget_risk) {
    const risk = dashboard.budget_risk;
    decisions.push({
      id: "budget-risk",
      title: `${risk.category.display_name} supera el ritmo previsto`,
      detail: `${euro(risk.spent)} de ${euro(risk.limit)} · ${Math.round(Math.max(risk.actual_percent, risk.projected_percent))}% del presupuesto.`,
      actionLabel: "Abrir plan",
      action: "planning",
    });
  }

  if (dashboard.refunds.length) {
    const refund = dashboard.refunds[0];
    decisions.push({
      id: "pending-refunds",
      title: dashboard.refunds.length === 1 ? "1 reembolso pendiente" : `${dashboard.refunds.length} reembolsos pendientes`,
      detail: dashboard.refunds.length === 1 ? `${refund.description} · ${euro(refund.amount)}` : "Consulta los reembolsos pendientes y su estado.",
      actionLabel: "Ver movimientos",
      action: "transactions",
    });
  }

  for (const signal of (data.signals || []).slice(0, 1)) {
    decisions.push({
      id: `signal-${signal.title}-${signal.label}`,
      title: `${signal.title}: ${signal.label}`,
      detail: attentionSignalDetail(signal),
      actionLabel: "Ver movimientos",
      action: "transactions",
      href: signal.url,
    });
  }

  return decisions;
}
