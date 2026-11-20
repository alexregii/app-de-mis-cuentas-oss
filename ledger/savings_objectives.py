"""Virtual savings objectives and their non-ledger allocation rules."""

import hashlib
import hmac
import json
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, transaction

from .models import RecurringOccurrence, RecurringRule, SavingsObjective
from .calculations.annual_reserve import next_annual_due_date, reserve_progress
from django.utils import timezone
from .services import total_balance

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
MAX_MONEY = Decimal("999999999999.99")


class SavingsObjectiveConflict(Exception):
    def __init__(self, code, message, *, status=409):
        super().__init__(message)
        self.code = code
        self.status = status


class SavingsObjectiveConfirmationRequired(SavingsObjectiveConflict):
    def __init__(self, summary, *, code="over_allocation_confirmation_required", message="La asignación supera el saldo contable registrado."):
        super().__init__(code, message)
        self.summary = summary


def _money(value, *, field, positive=False):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{field}: introduce un importe válido.") from exc
    if not amount.is_finite() or amount.as_tuple().exponent < -2 or abs(amount) > MAX_MONEY:
        raise ValueError(f"{field}: el importe admite como máximo dos decimales.")
    if positive and amount <= ZERO:
        raise ValueError(f"{field}: debe ser mayor que cero.")
    if not positive and amount < ZERO:
        raise ValueError(f"{field}: no puede ser negativo.")
    return amount.quantize(CENT)


def _name(value):
    if not isinstance(value, str):
        raise ValueError("name: introduce un nombre.")
    result = value.strip()
    if not result or len(result) > 100:
        raise ValueError("name: debe contener entre 1 y 100 caracteres.")
    return result


def _target_date(value):
    if not isinstance(value, str):
        raise ValueError("target_date: introduce una fecha válida.")
    try:
        result = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("target_date: introduce una fecha válida en formato AAAA-MM-DD.") from exc
    if value != result.isoformat():
        raise ValueError("target_date: usa el formato AAAA-MM-DD.")
    return result


def _priority(value):
    if type(value) is not int or value not in {1, 2, 3}:
        raise ValueError("priority: elige una prioridad de 1 a 3.")
    return value


def _revision(value):
    if type(value) is not int or value < 0:
        raise ValueError("expected_revision: la revisión debe ser un entero no negativo.")
    return value


def _confirmation(value):
    if not isinstance(value, bool):
        raise ValueError("confirm_overallocation: debe ser verdadero o falso.")
    return value


def _idempotency_key(value):
    if not isinstance(value, str):
        raise ValueError("idempotency_key: se requiere un UUID.")
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise ValueError("idempotency_key: se requiere un UUID válido.") from exc


def _ledger_balance(value=None):
    return total_balance() if value is None else Decimal(str(value))


def allocation_summary(objectives, *, ledger_balance=None):
    ledger_balance = _ledger_balance(ledger_balance)
    active = [item for item in objectives if not item.archived]
    assigned = sum((item.assigned_amount for item in active), ZERO)
    eligible = max(ledger_balance, ZERO)
    snapshot = {
        "ledger_balance": str(ledger_balance),
        "objectives": [
            {"id": item.pk, "revision": item.revision, "archived": item.archived, "assigned": str(item.assigned_amount)}
            for item in sorted(objectives, key=lambda value: value.pk)
        ],
    }
    confirmation_token = hashlib.sha256(
        json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "ledger_balance": ledger_balance,
        "eligible_balance": eligible,
        "assigned_total": assigned,
        "free_to_assign": max(eligible - assigned, ZERO),
        "overallocated": assigned > eligible,
        "overallocated_by": max(assigned - eligible, ZERO),
        "confirmation_token": confirmation_token,
    }


def _allocation_summary_for_total(objectives, *, assigned_total, ledger_balance):
    summary = allocation_summary(objectives, ledger_balance=ledger_balance)
    assigned_total = Decimal(str(assigned_total))
    eligible = summary["eligible_balance"]
    summary.update(
        assigned_total=assigned_total,
        free_to_assign=max(eligible - assigned_total, ZERO),
        overallocated=assigned_total > eligible,
        overallocated_by=max(assigned_total - eligible, ZERO),
    )
    return summary


def _require_current_confirmation(payload, summary):
    token = payload.get("confirmed_snapshot")
    if not isinstance(token, str) or not token:
        raise ValueError("confirmed_snapshot es obligatorio al confirmar una sobreasignación.")
    if not hmac.compare_digest(token, summary["confirmation_token"]):
        raise SavingsObjectiveConfirmationRequired(
            summary,
            code="allocation_snapshot_changed",
            message="El saldo o las metas cambiaron; revisa el resumen actualizado antes de confirmar.",
        )


def annual_reserve_details(objective, *, as_of=None):
    rule = getattr(objective, "recurring_rule", None)
    if rule is None:
        return None
    today = as_of or timezone.localdate()
    target_amount = objective.target_amount
    due_date = objective.target_date
    if objective.archived:
        status = "archived"
    elif rule.frequency != RecurringRule.Frequency.YEARLY or rule.kind != "expense":
        status = "suspended"
    elif not rule.active:
        status = "paused"
    else:
        pending = RecurringOccurrence.objects.filter(
            rule=rule, status=RecurringOccurrence.Status.PENDING
        ).order_by("due_date", "pk").first()
        if pending:
            due_date = pending.due_date
            target_amount = pending.amount
        else:
            due_date = objective.target_date
            target_amount = objective.target_amount if due_date < today else rule.amount
            if due_date <= today and next_annual_due_date(rule, today, strictly_after=True) is None:
                return {
                    "rule_id": rule.pk, "rule_name": rule.name, "status": "ended",
                    "target_amount": objective.target_amount, "due_date": None,
                    "months_remaining": None, "remaining_amount": max(objective.target_amount - objective.assigned_amount, ZERO),
                    "monthly_amount": None,
                }
        progress = reserve_progress(target_amount, objective.assigned_amount, due_date, as_of=today)
        status = progress["status"]
        return {
            "rule_id": rule.pk,
            "rule_name": rule.name,
            "status": status,
            "target_amount": target_amount,
            "due_date": due_date,
            **progress,
        }
    return {
        "rule_id": rule.pk,
        "rule_name": rule.name,
        "status": status,
        "target_amount": target_amount,
        "due_date": due_date,
        "months_remaining": None,
        "remaining_amount": max(target_amount - objective.assigned_amount, ZERO),
        "monthly_amount": None,
    }


def sync_annual_reserve(rule, *, as_of=None, after=None, strictly_after=False):
    """Keep linked goal metadata on the current or next annual payment cycle."""
    today = as_of or timezone.localdate()
    objective = SavingsObjective.objects.select_for_update().filter(recurring_rule=rule).first()
    if objective is None or not rule.active or rule.frequency != RecurringRule.Frequency.YEARLY or rule.kind != "expense":
        return objective
    pending = RecurringOccurrence.objects.filter(
        rule=rule, status=RecurringOccurrence.Status.PENDING
    ).order_by("due_date", "pk").first()
    if pending:
        target_date, target_amount = pending.due_date, pending.amount
    else:
        target_date = next_annual_due_date(rule, after or today, strictly_after=strictly_after)
        if target_date is None:
            return objective
        target_amount = rule.amount
    if objective.target_date != target_date or objective.target_amount != target_amount:
        objective.target_date = target_date
        objective.target_amount = target_amount
        objective.revision += 1
        objective.save(update_fields=["target_date", "target_amount", "revision"])
    return objective


def consume_annual_reserve(occurrence):
    rule = occurrence.rule
    if rule.frequency != RecurringRule.Frequency.YEARLY or rule.kind != "expense":
        return
    objective = SavingsObjective.objects.select_for_update().filter(recurring_rule=rule).first()
    if objective and objective.archived:
        objective = None
    consumed = min(objective.assigned_amount, occurrence.amount) if objective else ZERO
    if objective and consumed:
        objective.assigned_amount -= consumed
        objective.revision += 1
        objective.save(update_fields=["assigned_amount", "revision"])
    occurrence.reserve_consumed_amount = consumed
    occurrence.reserve_objective = objective if consumed else None
    occurrence.save(update_fields=["reserve_consumed_amount", "reserve_objective"])
    sync_annual_reserve(rule, after=occurrence.due_date, strictly_after=True)


def restore_annual_reserve(occurrence):
    if occurrence.reserve_consumed_amount:
        objective = occurrence.reserve_objective or SavingsObjective.objects.select_for_update().filter(recurring_rule=occurrence.rule).first()
        if objective:
            objective.assigned_amount += occurrence.reserve_consumed_amount
            objective.revision += 1
            objective.save(update_fields=["assigned_amount", "revision"])
        occurrence.reserve_consumed_amount = ZERO
        occurrence.reserve_objective = None
    occurrence.status = RecurringOccurrence.Status.PENDING
    occurrence.save(update_fields=["reserve_consumed_amount", "reserve_objective", "status"])
    sync_annual_reserve(occurrence.rule, as_of=timezone.localdate())

def planning_objectives_payload(*, ledger_balance=None):
    objectives = list(SavingsObjective.objects.select_related("recurring_rule").order_by("archived", "priority", "target_date", "pk"))
    return {
        "items": objectives,
        "summary": allocation_summary(objectives, ledger_balance=ledger_balance),
    }


def _clean_and_save(objective, *, fields):
    try:
        objective.full_clean(validate_unique=False)
    except ValidationError as exc:
        raise ValueError("Los datos de la meta no son válidos.") from exc
    objective.save(update_fields=fields)


def create_objective(payload):
    normal_fields = {"name", "target_amount", "target_date", "priority", "idempotency_key"}
    annual_fields = {"recurring_rule_id", "idempotency_key"}
    if not isinstance(payload, dict):
        raise ValueError("El cuerpo debe ser un objeto JSON.")
    key = _idempotency_key(payload.get("idempotency_key"))
    linked_rule = None
    if set(payload) == annual_fields:
        rule_id = payload["recurring_rule_id"]
        if type(rule_id) is not int or rule_id <= 0:
            raise ValueError("recurring_rule_id: elige un pago anual válido.")
        annual_digest = hashlib.sha256(json.dumps(
            {"kind": "annual_reserve", "recurring_rule_id": rule_id},
            sort_keys=True, separators=(",", ":")
        ).encode("utf-8")).hexdigest()
        existing = SavingsObjective.objects.filter(idempotency_key=key).first()
        if existing:
            if existing.create_digest == annual_digest:
                return existing, False
            raise SavingsObjectiveConflict("idempotency_key_reused", "La clave de creación ya se usó con otros datos.")
        try:
            with transaction.atomic():
                linked_rule = RecurringRule.objects.select_for_update().get(pk=rule_id)
                existing = SavingsObjective.objects.select_for_update().filter(idempotency_key=key).first()
                if existing:
                    if existing.create_digest == annual_digest:
                        return existing, False
                    raise SavingsObjectiveConflict("idempotency_key_reused", "La clave de creación ya se usó con otros datos.")
                if not linked_rule.active or linked_rule.kind != "expense" or linked_rule.frequency != RecurringRule.Frequency.YEARLY:
                    raise ValueError("Solo se puede preparar una reserva para un gasto anual activo.")
                pending = RecurringOccurrence.objects.filter(
                    rule=linked_rule, status=RecurringOccurrence.Status.PENDING
                ).order_by("due_date", "pk").first()
                due_date = pending.due_date if pending else next_annual_due_date(linked_rule, timezone.localdate())
                target_amount = pending.amount if pending else linked_rule.amount
                if due_date is None:
                    raise ValueError("El pago anual no tiene un vencimiento futuro disponible.")
                requested = {
                    "name": _name(linked_rule.name),
                    "target_amount": target_amount,
                    "target_date": due_date,
                    "priority": 2,
                }
                create_digest = annual_digest
                if SavingsObjective.objects.filter(recurring_rule=linked_rule).exists():
                    raise SavingsObjectiveConflict("annual_rule_already_linked", "Ese pago anual ya tiene una meta vinculada.")
                objective = SavingsObjective(
                    idempotency_key=key,
                    create_digest=create_digest,
                    recurring_rule=linked_rule,
                    **requested,
                )
                objective.full_clean(validate_unique=False)
                objective.save(force_insert=True)
                RecurringOccurrence.objects.get_or_create(
                    rule=linked_rule, due_date=due_date, defaults={"amount": target_amount}
                )
                return objective, True
        except RecurringRule.DoesNotExist as exc:
            raise ValueError("Ese pago recurrente ya no existe.") from exc
        except IntegrityError as exc:
            existing = SavingsObjective.objects.filter(idempotency_key=key).first()
            if existing and existing.create_digest == annual_digest:
                return existing, False
            if existing:
                raise SavingsObjectiveConflict("idempotency_key_reused", "La clave de creación ya se usó.") from exc
            raise SavingsObjectiveConflict("annual_rule_already_linked", "Ese pago anual ya tiene una meta vinculada.") from exc

    if set(payload) != normal_fields:
        raise ValueError("El cuerpo debe incluir nombre, importe, fecha, prioridad y clave idempotente.")
    requested = {
        "name": _name(payload["name"]),
        "target_amount": _money(payload["target_amount"], field="target_amount", positive=True),
        "target_date": _target_date(payload["target_date"]),
        "priority": _priority(payload["priority"]),
    }
    create_digest = hashlib.sha256(json.dumps({
        "name": requested["name"],
        "target_amount": format(requested["target_amount"], ".2f"),
        "target_date": requested["target_date"].isoformat(),
        "priority": requested["priority"],
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    existing = SavingsObjective.objects.filter(idempotency_key=key).first()
    if existing:
        if existing.create_digest == create_digest:
            return existing, False
        raise SavingsObjectiveConflict("idempotency_key_reused", "La clave de creación ya se usó con otros datos.")

    objective = SavingsObjective(idempotency_key=key, create_digest=create_digest, **requested)
    try:
        objective.full_clean(validate_unique=False)
    except ValidationError as exc:
        raise ValueError("Los datos de la meta no son válidos.") from exc
    try:
        with transaction.atomic():
            objective.save(force_insert=True)
    except IntegrityError as exc:
        existing = SavingsObjective.objects.filter(idempotency_key=key).first()
        if existing and existing.create_digest == create_digest:
            return existing, False
        if existing:
            raise SavingsObjectiveConflict("idempotency_key_reused", "La clave de creación ya se usó con otros datos.") from exc
        raise
    return objective, True

def _requested_details(objective, payload):
    allowed = {"expected_revision", "confirm_overallocation", "confirmed_snapshot", "name", "target_amount", "target_date", "priority", "archived", "recurring_rule_id"}
    if set(payload) - allowed or not (set(payload) & (allowed - {"expected_revision", "confirm_overallocation"})):
        raise ValueError("La actualización contiene campos no permitidos o está vacía.")
    unlinking = objective.recurring_rule_id and payload.get("recurring_rule_id", objective.recurring_rule_id) is None
    if "recurring_rule_id" in payload and payload["recurring_rule_id"] is not None:
        raise ValueError("Para vincular una meta nueva, prepara la reserva desde el pago anual.")
    if objective.recurring_rule_id and not unlinking and ({"target_amount", "target_date"} & set(payload)):
        raise ValueError("El importe y el vencimiento de una meta anual los controla su regla recurrente.")
    desired = {
        "name": objective.name,
        "recurring_rule": objective.recurring_rule,
        "target_amount": objective.target_amount,
        "target_date": objective.target_date,
        "priority": objective.priority,
        "archived": objective.archived,
    }
    if "recurring_rule_id" in payload:
        desired["recurring_rule"] = None
    if "name" in payload:
        desired["name"] = _name(payload["name"])
    if "target_amount" in payload:
        desired["target_amount"] = _money(payload["target_amount"], field="target_amount", positive=True)
    if "target_date" in payload:
        desired["target_date"] = _target_date(payload["target_date"])
    if "priority" in payload:
        desired["priority"] = _priority(payload["priority"])
    if "archived" in payload:
        if not isinstance(payload["archived"], bool):
            raise ValueError("archived: debe ser verdadero o falso.")
        desired["archived"] = payload["archived"]
    if "confirm_overallocation" in payload:
        _confirmation(payload["confirm_overallocation"])
    if "confirmed_snapshot" in payload and not isinstance(payload["confirmed_snapshot"], str):
        raise ValueError("confirmed_snapshot no es válido.")
    return desired


def _same_details(objective, desired):
    return all(getattr(objective, field) == value for field, value in desired.items())


def update_objective(objective_id, payload):
    if not isinstance(payload, dict) or "expected_revision" not in payload:
        raise ValueError("expected_revision es obligatorio.")
    expected = _revision(payload["expected_revision"])
    confirm = _confirmation(payload.get("confirm_overallocation", False))
    try:
        with transaction.atomic():
            objectives = list(SavingsObjective.objects.select_for_update().order_by("pk"))
            current = next((item for item in objectives if item.pk == objective_id), None)
            if current is None:
                raise SavingsObjectiveConflict("not_found", "La meta ya no existe.", status=404)
            desired = _requested_details(current, payload)
            if current.revision != expected:
                if current.revision == expected + 1 and _same_details(current, desired):
                    return current, False
                raise SavingsObjectiveConflict("stale_revision", "La meta cambió; recarga antes de guardar.")
            if _same_details(current, desired):
                return current, False

            if current.archived and not desired["archived"]:
                other_assigned = sum(
                    (item.assigned_amount for item in objectives if item.pk != current.pk and not item.archived),
                    ZERO,
                )
                next_total = other_assigned + current.assigned_amount
                ledger_balance = _ledger_balance()
                base = max(ledger_balance, ZERO)
                if next_total > base and not confirm:
                    summary = _allocation_summary_for_total(
                        objectives,
                        assigned_total=next_total,
                        ledger_balance=ledger_balance,
                    )
                    raise SavingsObjectiveConfirmationRequired(summary)
                if next_total > base and confirm:
                    summary = _allocation_summary_for_total(
                        objectives,
                        assigned_total=next_total,
                        ledger_balance=ledger_balance,
                    )
                    _require_current_confirmation(payload, summary)

            for field, value in desired.items():
                setattr(current, field, value)
            current.revision += 1
            _clean_and_save(current, fields=[*desired, "revision"])
            return current, True
    except OperationalError:
        raise


def set_objective_allocation(objective_id, payload):
    allowed = {"expected_revision", "assigned_amount", "confirm_overallocation", "confirmed_snapshot"}
    if not isinstance(payload, dict) or set(payload) - allowed or not {"expected_revision", "assigned_amount"}.issubset(payload):
        raise ValueError("Se requieren importe asignado y revisión esperada.")
    expected = _revision(payload["expected_revision"])
    amount = _money(payload["assigned_amount"], field="assigned_amount")
    confirm = _confirmation(payload.get("confirm_overallocation", False))
    if "confirmed_snapshot" in payload and not isinstance(payload["confirmed_snapshot"], str):
        raise ValueError("confirmed_snapshot no es válido.")

    with transaction.atomic():
        objectives = list(SavingsObjective.objects.select_for_update().order_by("pk"))
        current = next((item for item in objectives if item.pk == objective_id), None)
        if current is None:
            raise SavingsObjectiveConflict("not_found", "La meta ya no existe.", status=404)
        if current.archived:
            raise SavingsObjectiveConflict("archived", "Reactiva la meta antes de cambiar su asignación.")
        if current.revision != expected:
            if current.revision == expected + 1 and current.assigned_amount == amount:
                return current, False
            raise SavingsObjectiveConflict("stale_revision", "La meta cambió; recarga antes de asignar.")
        if current.assigned_amount == amount:
            return current, False

        other_assigned = sum(
            (item.assigned_amount for item in objectives if item.pk != current.pk and not item.archived),
            ZERO,
        )
        next_total = other_assigned + amount
        ledger_balance = _ledger_balance()
        base = max(ledger_balance, ZERO)
        increases_reserved = amount > current.assigned_amount
        if increases_reserved and next_total > base and not confirm:
            summary = _allocation_summary_for_total(
                objectives,
                assigned_total=next_total,
                ledger_balance=ledger_balance,
            )
            raise SavingsObjectiveConfirmationRequired(summary)
        if increases_reserved and next_total > base and confirm:
            summary = _allocation_summary_for_total(
                objectives,
                assigned_total=next_total,
                ledger_balance=ledger_balance,
            )
            _require_current_confirmation(payload, summary)

        current.assigned_amount = amount
        current.revision += 1
        _clean_and_save(current, fields=["assigned_amount", "revision"])
        return current, True
