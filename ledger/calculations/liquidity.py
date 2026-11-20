"""Pure daily cash-flow roll-forward for the Plan liquidity forecast."""

from datetime import date, timedelta
from decimal import Decimal

from .ledger import signed_amount

ZERO = Decimal("0.00")
TRANSFER_KINDS = frozenset({"transfer_in", "transfer_out"})


def _decimal(value):
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _event(*, account_id, tx_date, kind, amount, state, description, origin, source_id, transfer_group=None):
    amount = _decimal(amount)
    return {
        "date": tx_date,
        "account_id": account_id,
        "kind": kind,
        "state": state,
        "amount": amount,
        "signed_amount": signed_amount(kind, amount),
        "description": description,
        "origin": origin,
        "source_id": source_id,
        "transfer_group": str(transfer_group) if transfer_group else "",
    }


def _transaction_event(movement):
    return _event(
        account_id=movement.account_id,
        tx_date=movement.date,
        kind=movement.kind,
        amount=movement.amount,
        state="confirmed",
        description=movement.description,
        origin=movement.source,
        source_id=movement.pk,
        transfer_group=movement.transfer_group,
    )


def _occurrence_event(occurrence, *, before_start=False):
    return _event(
        account_id=occurrence.rule.account_id,
        tx_date=occurrence.due_date,
        kind=occurrence.rule.kind,
        amount=occurrence.amount,
        state="forecast_before_start" if before_start else "forecast",
        description=occurrence.rule.name,
        origin="recurring",
        source_id=occurrence.rule.pk,
    )


def _flow_totals(events):
    totals = {
        "confirmed_net_cashflow": ZERO,
        "forecast_net_cashflow": ZERO,
        "confirmed_income": ZERO,
        "confirmed_expense": ZERO,
        "confirmed_transfer_net": ZERO,
        "forecast_income": ZERO,
        "forecast_expense": ZERO,
        "forecast_transfer_net": ZERO,
    }
    for event in events:
        state = event["state"]
        prefix = "confirmed" if state == "confirmed" else "forecast"
        signed = event["signed_amount"]
        totals[f"{prefix}_net_cashflow"] += signed
        if event["kind"] == "income":
            totals[f"{prefix}_income"] += event["amount"]
        elif event["kind"] == "expense":
            totals[f"{prefix}_expense"] += event["amount"]
        elif event["kind"] in TRANSFER_KINDS:
            totals[f"{prefix}_transfer_net"] += signed
    return totals


def calculate_liquidity_forecast(
    accounts,
    *,
    date_from: date,
    date_to: date,
    starting_balances: dict[int, Decimal | None],
    provenance: dict[int, dict],
    unknown_reasons: dict[int, list[str]],
    transactions,
    forecast_occurrences,
    pre_range_occurrences,
):
    """Calculate close-of-day balances without persisting transactions or forecasts."""
    account_ids = [account.pk for account in accounts]
    day_count = (date_to - date_from).days + 1
    days_by_account = {
        account_id: {
            date_from + timedelta(days=offset): []
            for offset in range(day_count)
        }
        for account_id in account_ids
    }
    for movement in transactions:
        if movement.account_id in days_by_account and date_from <= movement.date <= date_to:
            days_by_account[movement.account_id][movement.date].append(_transaction_event(movement))

    for occurrence in forecast_occurrences:
        account_id = occurrence.rule.account_id
        if occurrence.status == "pending" and account_id in days_by_account and date_from <= occurrence.due_date <= date_to:
            days_by_account[account_id][occurrence.due_date].append(_occurrence_event(occurrence))

    starting_adjustments = {account_id: [] for account_id in account_ids}
    for occurrence in pre_range_occurrences:
        account_id = occurrence.rule.account_id
        if occurrence.status != "pending" or account_id not in starting_adjustments:
            continue
        event = _occurrence_event(occurrence, before_start=True)
        starting_adjustments[account_id].append(event)
        if starting_balances.get(account_id) is not None:
            starting_balances[account_id] += event["signed_amount"]

    account_results = []
    account_days_by_date = {day: [] for day in days_by_account[account_ids[0]]}
    for account in accounts:
        account_id = account.pk
        reasons = list(dict.fromkeys(unknown_reasons.get(account_id, [])))
        starting_balance = starting_balances.get(account_id)
        known = starting_balance is not None and not reasons
        account_series = []
        minimum_balance = starting_balance if known else None
        minimum_date = date_from if known else None
        first_deficit_date = date_from if known and starting_balance < ZERO else None
        running = starting_balance if known else None

        for day in days_by_account[account_id]:
            events = days_by_account[account_id][day]
            totals = _flow_totals(events)
            opening_balance = running
            closing_balance = running + totals["confirmed_net_cashflow"] + totals["forecast_net_cashflow"] if known else None
            if known:
                if opening_balance < minimum_balance:
                    minimum_balance, minimum_date = opening_balance, day
                if closing_balance < minimum_balance:
                    minimum_balance, minimum_date = closing_balance, day
                if first_deficit_date is None and (opening_balance < ZERO or closing_balance < ZERO):
                    first_deficit_date = day
                running = closing_balance
            account_day = {
                "date": day,
                "opening_balance": opening_balance,
                "closing_balance": closing_balance,
                **totals,
                "cashflows": events,
            }
            account_series.append(account_day)
            account_days_by_date[day].append({"account_id": account_id, **account_day})

        account_results.append({
            "account_id": account_id,
            "name": account.name,
            "status": "known" if known else "unknown",
            "starting_balance": starting_balance if known else None,
            "provenance": provenance.get(account_id, {}),
            "unknown_reasons": reasons,
            "starting_adjustments": starting_adjustments[account_id],
            "minimum_balance": minimum_balance,
            "minimum_date": minimum_date,
            "first_deficit_date": first_deficit_date,
            "daily_series": account_series,
        })

    all_known = all(account["status"] == "known" for account in account_results)
    aggregate_start = sum((account["starting_balance"] for account in account_results), ZERO) if all_known else None
    aggregate_minimum = aggregate_start
    aggregate_minimum_date = date_from if all_known else None
    aggregate_first_deficit = date_from if all_known and aggregate_start < ZERO else None
    aggregate_series = []
    for day, account_days in account_days_by_date.items():
        all_events = [event for account_day in account_days for event in account_day["cashflows"]]
        totals = _flow_totals(all_events)
        closing_balances = [account_day["closing_balance"] for account_day in account_days]
        aggregate_balance = sum(closing_balances, ZERO) if all_known else None
        opening_balances = [account_day["opening_balance"] for account_day in account_days]
        if all_known:
            aggregate_opening = sum(opening_balances, ZERO)
            if aggregate_opening < aggregate_minimum:
                aggregate_minimum, aggregate_minimum_date = aggregate_opening, day
            if aggregate_balance < aggregate_minimum:
                aggregate_minimum, aggregate_minimum_date = aggregate_balance, day
            if aggregate_first_deficit is None and (aggregate_opening < ZERO or aggregate_balance < ZERO):
                aggregate_first_deficit = day
        aggregate_series.append({
            "date": day,
            "opening_balance": sum(opening_balances, ZERO) if all_known else None,
            "closing_balance": aggregate_balance,
            **totals,
            "accounts": [
                {"account_id": item["account_id"], "status": "known" if all_known else account_results[index]["status"], "balance": item["closing_balance"]}
                for index, item in enumerate(account_days)
            ],
            "cashflows": all_events,
        })

    return {
        "date_from": date_from,
        "date_to": date_to,
        "currency": "EUR",
        "status": "known" if all_known else "unknown",
        "accounts": account_results,
        "starting_balance": aggregate_start,
        "daily_series": aggregate_series,
        "minimum_balance": aggregate_minimum if all_known else None,
        "minimum_date": aggregate_minimum_date if all_known else None,
        "first_deficit_date": aggregate_first_deficit if all_known else None,
        "assumptions": [
            "Los movimientos confirmados anteriores al rango ya están incluidos en el saldo inicial.",
            "Las recurrencias pendientes son supuestos fechados; no crean movimientos.",
            "El objetivo de ahorro no es un flujo; solo un traspaso registrado mueve efectivo.",
            "Los saldos son de cierre diario; no se conoce el orden intradía de cargos y abonos.",
        ],
    }
