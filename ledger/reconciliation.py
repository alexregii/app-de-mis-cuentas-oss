from datetime import date
from decimal import Decimal

from .models import Account, Transaction


def reconciliation_ledger_balance(account: Account, statement_date: date) -> Decimal:
    movements = Transaction.objects.filter(account=account, archived=False, date__lte=statement_date).only("kind", "amount")
    return account.opening_balance + sum((movement.signed_amount for movement in movements), Decimal("0"))
