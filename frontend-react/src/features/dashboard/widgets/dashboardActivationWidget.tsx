import {CheckCircle2, Circle} from "lucide-react";
import {Panel, SectionHeader} from "../../../shared/components/ui";
import {Button, TextButton} from "../../../ui/controls/Button";
import type {DashboardWidgetDefinition} from "./widgetTypes";

export const dashboardActivationWidget: DashboardWidgetDefinition = {
  id: "activation",
  title: "Primeros pasos",
  region: "decision",
  modes: ["full", "review"],
  hideable: true,
  reorderable: false,
  priority: 130,
  available: ({data}) => {
    const state = data.activation;
    return Boolean(state && !state.is_mature && (
      !state.has_active_account || !state.has_reviewed_movement || !state.has_savings_objective
    ));
  },
  render: ({data, onAddTransaction, onOpenAccounts, onCreateObjective, onReview, onHideActivation}) => {
    const state = data.activation;
    if (!state) return null;
    const steps = [
      {label: "Cuenta", complete: state.has_active_account, detail: state.has_active_account ? "Cuenta activa" : "Añade o activa una cuenta"},
      {label: "Movimiento", complete: state.has_reviewed_movement, detail: state.has_reviewed_movement
        ? "Primer movimiento registrado"
        : state.pending_review_count
          ? `${state.pending_review_count} ${state.pending_review_count === 1 ? "movimiento pendiente" : "movimientos pendientes"} por revisar`
          : "Registra tu primer ingreso o gasto"},
      {label: "Objetivo", complete: state.has_savings_objective, detail: state.has_savings_objective ? "Meta de ahorro creada" : "Define un objetivo de ahorro"},
    ];
    const completed = steps.filter((step) => step.complete).length;
    const action = !state.has_active_account
      ? {label: "Añadir o activar una cuenta", detail: "Empieza con una cuenta donde registrar tus movimientos.", run: onOpenAccounts}
      : !state.has_reviewed_movement && state.pending_review_count > 0
        ? {label: "Revisar movimientos", detail: "Revisa un movimiento pendiente para incorporarlo al historial.", run: onReview}
        : !state.has_reviewed_movement
          ? {label: "Añadir mi primer movimiento", detail: "Un ingreso o gasto registrado activa el resumen y las estadísticas.", run: onAddTransaction}
          : {label: "Crear un objetivo de ahorro", detail: "Define un propósito y sigue su progreso junto con tus cuentas.", run: onCreateObjective};
    return (
      <Panel className="dashboard-widget dashboard-activation">
        <SectionHeader title="Primeros pasos" detail="El progreso se comprueba en tus cuentas, movimientos y metas." />
        <p className="dashboard-activation-progress">{completed} de 3 pasos completados</p>
        <div className="dashboard-activation-actions">
          <Button variant="primary" onClick={action.run}>{action.label}</Button>
          <TextButton onClick={onHideActivation}>Ocultar guía</TextButton>
        </div>
        <p className="dashboard-activation-detail">{action.detail}</p>
        <ol className="dashboard-decision-queue dashboard-activation-steps">
          {steps.map((step) => (
            <li className={`dashboard-decision-row${step.complete ? " is-complete" : ""}`} key={step.label}>
              <div><strong>{step.label}</strong><span>{step.detail}</span></div>
              {step.complete ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </Panel>
    );
  },
};
