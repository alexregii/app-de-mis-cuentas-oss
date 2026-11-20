"""Read/query helpers for the transaction ledger API."""

from datetime import date
from decimal import Decimal

from django.db.models import Case, Count, DecimalField, Exists, F, OuterRef, Q, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce

from .api_serializers import api_money
from .calculations.ledger import allocate_refunds
from .models import Category, Transaction, TransactionAllocation
from .transaction_allocations import transaction_allocation_parts


def _category_basis_scope(field, analytics_filter):
    if analytics_filter == "included":
        return Q(**{f"{field}__isnull": True}) | Q(**{f"{field}__exclude_from_analytics": False})
    if analytics_filter == "excluded":
        return Q(**{f"{field}__exclude_from_analytics": True})
    return Q()


def _transaction_basis_scope(analytics_filter):
    if analytics_filter not in {"included", "excluded"}:
        return Q()
    legacy = Q(allocations__isnull=True) & _category_basis_scope("category", analytics_filter)
    split = Q(allocations__isnull=False) & _category_basis_scope("allocations__category", analytics_filter)
    return legacy | split


def _refund_target_basis_scope(analytics_filter):
    if analytics_filter not in {"included", "excluded"}:
        return Q()
    legacy = Q(refund_for__allocations__isnull=True) & _category_basis_scope("refund_for__category", analytics_filter)
    split = Q(refund_for__allocations__isnull=False) & _category_basis_scope("refund_for__allocations__category", analytics_filter)
    return legacy | split


def filtered_movements_from_request(request):
    movements = (
        Transaction.objects.filter(archived=False)
        .select_related(
            "account",
            "category",
            "category__parent",
            "refund_for",
            "refund_for__category",
            "refund_for__category__parent",
        )
        .prefetch_related("tags", "attachments", "allocations__category", "allocations__category__parent")
    )
    analytics_filter = request.GET.get("analytics", "all")
    attribution_mode = request.GET.get("statistics_attribution") == "purchase" and (
        request.GET.get("category") or request.GET.get("category_family") or request.GET.get("description")
    )
    basis_on_original_purchase = request.GET.get("statistics_basis") == "original_purchase" or attribution_mode
    if analytics_filter == "included" and basis_on_original_purchase:
        movements = movements.filter(
            Q(refund_for__isnull=True) & _transaction_basis_scope("included")
            | Q(refund_for__isnull=False) & _refund_target_basis_scope("included")
        )
    elif analytics_filter == "excluded" and basis_on_original_purchase:
        movements = movements.filter(
            Q(refund_for__isnull=True) & _transaction_basis_scope("excluded")
            | Q(refund_for__isnull=False) & _refund_target_basis_scope("excluded")
        )
    elif analytics_filter == "included":
        movements = movements.filter(_transaction_basis_scope("included"))
    elif analytics_filter == "excluded":
        movements = movements.filter(_transaction_basis_scope("excluded"))
    query = request.GET.get("q", "").strip()
    if query:
        movements = movements.filter(
            Q(description__icontains=query) | Q(notes__icontains=query) | Q(tags__name__icontains=query)
        ).distinct()
    if request.GET.get("description") and not attribution_mode:
        movements = movements.filter(description__iexact=request.GET["description"].strip())
    if request.GET.get("kind"):
        movements = movements.filter(kind=request.GET["kind"])
    if request.GET.get("account"):
        movements = movements.filter(account_id=request.GET["account"])
    if request.GET.get("category") and not attribution_mode:
        try:
            requested_category_id = int(request.GET["category"])
        except (TypeError, ValueError):
            movements = movements.none()
        else:
            requested_category = Category.objects.filter(pk=requested_category_id).only("pk", "parent_id").first()
            if requested_category and requested_category.parent_id is None:
                movements = movements.filter(
                    Q(category_id=requested_category.pk)
                    | Q(category__parent_id=requested_category.pk)
                    | Q(allocations__category_id=requested_category.pk)
                    | Q(allocations__category__parent_id=requested_category.pk)
                )
            elif requested_category:
                movements = movements.filter(Q(category_id=requested_category.pk) | Q(allocations__category_id=requested_category.pk))
            else:
                movements = movements.none()
    if request.GET.get("category_family") and not attribution_mode:
        family_value = request.GET["category_family"].strip()
        family_query = Q()
        valid_family = False
        for family_token in (token.strip() for token in family_value.split(",")):
            if not family_token:
                continue
            if family_token == "uncategorized":
                family_query |= Q(allocations__isnull=True, category__isnull=True) | Q(allocations__category__isnull=True)
                valid_family = True
                continue
            try:
                requested_id = int(family_token)
            except (TypeError, ValueError):
                continue
            requested = Category.objects.filter(pk=requested_id).only("pk", "parent_id").first()
            if requested:
                family_id = requested.parent_id or requested.pk
                family_query |= (
                    Q(category_id=family_id)
                    | Q(category__parent_id=family_id)
                    | Q(allocations__category_id=family_id)
                    | Q(allocations__category__parent_id=family_id)
                )
                valid_family = True
        movements = movements.filter(family_query) if valid_family else movements.none()
    if request.GET.get("source"):
        movements = movements.filter(source=request.GET["source"])

    if attribution_mode:
        direct_category = None
        refund_category = None
        if request.GET.get("description"):
            description = request.GET["description"].strip()
            direct_category = Q(description__iexact=description)
            refund_category = Q(refund_for__description__iexact=description)
        elif request.GET.get("category"):
            try:
                category_id = int(request.GET["category"])
            except (TypeError, ValueError):
                movements = movements.none()
            else:
                direct_category = Q(category_id=category_id) | Q(allocations__category_id=category_id)
                refund_category = Q(refund_for__category_id=category_id) | Q(refund_for__allocations__category_id=category_id)
        else:
            family_value = request.GET["category_family"].strip()
            if family_value == "uncategorized":
                direct_category = Q(allocations__isnull=True, category__isnull=True) | Q(allocations__category__isnull=True)
                refund_category = (
                    Q(refund_for__allocations__isnull=True, refund_for__category__isnull=True)
                    | Q(refund_for__allocations__category__isnull=True)
                )
            else:
                try:
                    requested_id = int(family_value)
                except (TypeError, ValueError):
                    movements = movements.none()
                else:
                    requested = Category.objects.filter(pk=requested_id).only("pk", "parent_id").first()
                    if requested:
                        family_id = requested.parent_id or requested.pk
                        direct_category = (
                            Q(category_id=family_id)
                            | Q(category__parent_id=family_id)
                            | Q(allocations__category_id=family_id)
                            | Q(allocations__category__parent_id=family_id)
                        )
                        refund_category = (
                            Q(refund_for__category_id=family_id)
                            | Q(refund_for__category__parent_id=family_id)
                            | Q(refund_for__allocations__category_id=family_id)
                            | Q(refund_for__allocations__category__parent_id=family_id)
                        )
                    else:
                        movements = movements.none()

        if direct_category is not None and refund_category is not None:
            direct_scope = Q(kind=Transaction.Kind.EXPENSE) & direct_category
            refund_scope = (
                Q(kind=Transaction.Kind.INCOME, refund_for__isnull=False, refund_for__archived=False)
                & refund_category
            )
            try:
                attributed_start = (
                    date.fromisoformat(request.GET["date_from"])
                    if request.GET.get("date_from")
                    else None
                )
                attributed_end = (
                    date.fromisoformat(request.GET["date_to"])
                    if request.GET.get("date_to")
                    else None
                )
            except ValueError:
                attributed_start = attributed_end = None
            if attributed_start:
                direct_scope &= Q(date__gte=attributed_start)
                refund_scope &= Q(refund_for__date__gte=attributed_start)
            if attributed_end:
                direct_scope &= Q(date__lte=attributed_end)
                refund_scope &= Q(refund_for__date__lte=attributed_end)
            if analytics_filter == "included":
                direct_scope &= _transaction_basis_scope("included")
                refund_scope &= _refund_target_basis_scope("included")
            elif analytics_filter == "excluded":
                direct_scope &= _transaction_basis_scope("excluded")
                refund_scope &= _refund_target_basis_scope("excluded")
            movements = movements.filter(direct_scope | refund_scope)

    if request.GET.get("date_from") and not attribution_mode:
        try:
            movements = movements.filter(date__gte=date.fromisoformat(request.GET["date_from"]))
        except ValueError:
            pass
    if request.GET.get("date_to") and not attribution_mode:
        try:
            movements = movements.filter(date__lte=date.fromisoformat(request.GET["date_to"]))
        except ValueError:
            pass
    if request.GET.get("month"):
        try:
            selected = date.fromisoformat(f"{request.GET['month']}-01")
            movements = movements.filter(date__year=selected.year, date__month=selected.month)
        except ValueError:
            pass
    return movements.distinct()


def transaction_filter_summary(queryset):
    """Summarise the complete filtered set, independently of pagination."""
    if isinstance(queryset, list):
        expenses = [m for m in queryset if m.kind == Transaction.Kind.EXPENSE and not m.transfer_group]
        incomes = [
            m
            for m in queryset
            if m.kind == Transaction.Kind.INCOME and not m.transfer_group and not m.refund_for_id
        ]
        expense_ids = {m.pk for m in expenses}
        refunds = (
            Transaction.objects.filter(archived=False, refund_for_id__in=expense_ids)
            .select_related("refund_for", "category")
            .prefetch_related("allocations__category")
        )
        applied = Decimal("0")
        extra = Decimal("0")
        for allocation in allocate_refunds(refunds):
            applied += allocation.applied
            extra += allocation.extra
        income = sum((m.amount for m in incomes), Decimal("0")) + extra
        gross = sum((m.amount for m in expenses), Decimal("0"))
        excluded = sum(
            (
                part.amount
                for movement in queryset
                for part in transaction_allocation_parts(movement)
                if part.category and part.category.exclude_from_analytics
            ),
            Decimal("0"),
        )
        return {
            "income": api_money(income),
            "expense": api_money(gross - applied),
            "net": api_money(income - gross + applied),
            "excluded": api_money(excluded),
            "count": len(queryset),
        }
    transaction_ids = queryset.order_by().values("pk").distinct()
    base = Transaction.objects.filter(pk__in=transaction_ids)
    allocation_rows = TransactionAllocation.objects.filter(transaction_id=OuterRef("pk"))
    excluded_allocation = (
        allocation_rows.filter(category__exclude_from_analytics=True)
        .order_by()
        .values("transaction_id")
        .annotate(total=Sum("amount"))
        .values("total")[:1]
    )
    summary = base.annotate(
        _has_allocations=Exists(allocation_rows),
        _excluded_allocations=Subquery(excluded_allocation, output_field=DecimalField(max_digits=14, decimal_places=2)),
    ).aggregate(
        count=Count("pk"),
        income=Sum(
            "amount",
            filter=Q(kind=Transaction.Kind.INCOME, transfer_group__isnull=True, refund_for__isnull=True),
        ),
        gross=Sum("amount", filter=Q(kind=Transaction.Kind.EXPENSE, transfer_group__isnull=True)),
        excluded=Sum(
            Case(
                When(_has_allocations=True, then=Coalesce(F("_excluded_allocations"), Value(Decimal("0.00")))),
                When(category_id__isnull=False, category__exclude_from_analytics=True, then=F("amount")),
                default=Value(Decimal("0.00")),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        ),
    )
    expense_ids = base.filter(kind=Transaction.Kind.EXPENSE, transfer_group__isnull=True).values("pk")
    refunds = (
        Transaction.objects.filter(archived=False, refund_for_id__in=expense_ids)
        .select_related("refund_for", "category")
        .prefetch_related("allocations__category")
    )
    applied = Decimal("0")
    extra = Decimal("0")
    for allocation in allocate_refunds(refunds):
        applied += allocation.applied
        extra += allocation.extra
    income = (summary["income"] or Decimal("0")) + extra
    gross = summary["gross"] or Decimal("0")
    excluded = summary["excluded"] or Decimal("0")
    return {
        "income": api_money(income),
        "expense": api_money(gross - applied),
        "net": api_money(income - gross + applied),
        "excluded": api_money(excluded),
        "count": summary["count"],
    }
