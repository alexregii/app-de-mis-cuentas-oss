import {euro, formatDate} from "../../format";
import type {PlanningPayload, SavingsObjective} from "../../shared/model/planning";
import {Button} from "../../ui/controls/Button";

type Props = {
  rules: PlanningPayload["rules"];
  objectives: SavingsObjective[];
  saving: boolean;
  linkingRuleId: number | null;
  onPrepare: (ruleId: number, triggerButton: HTMLButtonElement) => void;
};

export function annualReserveDescription(objective: SavingsObjective) {
  const reserve = objective.annual_reserve;
  if (!reserve) return null;
  if (reserve.status === "active") {
    if (reserve.remaining_amount <= 0 || reserve.monthly_amount === 0) {
      return "Reserva cubierta para " + formatDate(reserve.due_date) + ".";
    }
    return "Ahorro sugerido: " + euro(reserve.monthly_amount ?? 0) + " al mes durante "
      + (reserve.months_remaining ?? 0) + " meses; quedan " + euro(reserve.remaining_amount)
      + " hasta " + formatDate(reserve.due_date) + ".";
  }
  if (reserve.status === "overdue") return "Vencido: faltan " + euro(reserve.remaining_amount) + ". La cuota mensual ya no aplica.";
  if (reserve.status === "paused") return "Pago anual pausado. La meta y lo asignado se conservan.";
  if (reserve.status === "suspended") return "La regla ya no es un gasto anual; la meta se conserva sin cuota sugerida.";
  if (reserve.status === "archived") return "Meta archivada; no se recomienda una cuota anual.";
  return "No hay otro vencimiento anual configurado.";
}

export function PlanningAnnualReserveOptions({rules, objectives, saving, linkingRuleId, onPrepare}: Props) {
  const linkedRuleIds = new Set(objectives.flatMap((item) => item.recurring_rule_id === null ? [] : [item.recurring_rule_id]));
  const annualRules = rules.filter((rule) => rule.active && rule.kind === "expense" && rule.frequency === "yearly" && !linkedRuleIds.has(rule.id));
  if (!annualRules.length) return null;

  return <section className="planning-annual-reserve-options" aria-labelledby="planning-annual-reserve-title">
    <h3 id="planning-annual-reserve-title">Gastos anuales</h3>
    <p className="planning-objective-note">Vincula un seguro o impuesto anual a una meta para ver cuánto queda y qué cuota mensual necesitarías.</p>
    <ul className="stack-list">
      {annualRules.map((rule) => <li key={rule.id} className="review-card">
        <strong>{rule.name}</strong><span className="money">{euro(rule.amount)}</span>
        <small>{rule.account.name} · vencimiento anual · día {rule.day_of_month}</small>
        <Button variant="secondary" aria-disabled={saving || undefined} aria-busy={linkingRuleId === rule.id || undefined} onClick={(event) => onPrepare(rule.id, event.currentTarget)}>
          {linkingRuleId === rule.id ? "Preparando…" : "Preparar reserva anual"}
        </Button>
      </li>)}
    </ul>
  </section>;
}