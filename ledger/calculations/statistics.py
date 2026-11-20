"""Pure aggregation primitives for analytical reporting.

They accept plain mappings, so the ORM adapter can load facts once and every
statistics surface (summary, series, categories and drill-down) uses the same
financial arithmetic.
"""

from decimal import Decimal

from .ledger import period_totals


ZERO = Decimal("0.00")
ONE_DECIMAL = Decimal("0.1")


def empty_amounts():
    return {"income": ZERO, "gross_expense": ZERO, "refunds_applied": ZERO}


def sum_amounts(rows):
    result = empty_amounts()
    for row in rows:
        for key in result:
            result[key] += row[key]
    return result


def summarize_amounts(amounts):
    """Return exact period totals plus the nullable savings rate."""
    totals = period_totals(
        income=amounts["income"],
        gross_expense=amounts["gross_expense"],
        refunds_applied=amounts["refunds_applied"],
    )
    savings_rate = (
        (totals["analytical_result"] / totals["income"] * Decimal("100")).quantize(ONE_DECIMAL)
        if totals["income"]
        else None
    )
    return {
        "income": totals["income"],
        "net_expense": totals["net_expense"],
        "refunds_applied": totals["refunds_applied"],
        "analytical_result": totals["analytical_result"],
        "savings_rate": savings_rate,
    }


def family_categories(category_rows):
    """Build category families and their exact net-expense proportions."""
    families = {}
    for row in category_rows.values():
        net_expense = row["gross_expense"] - row["refunds_applied"]
        family = families.setdefault(
            row["family_id"],
            {
                "family_id": row["family_id"],
                "family_name": row["family_name"],
                "color": row["color"],
                "gross_expense": ZERO,
                "refunds_applied": ZERO,
                "net_expense": ZERO,
                "subcategories": [],
            },
        )
        family["gross_expense"] += row["gross_expense"]
        family["refunds_applied"] += row["refunds_applied"]
        family["net_expense"] += net_expense
        family["subcategories"].append(
            {
                "category_id": row["category_id"],
                "name": "Sin subcategoría" if row["is_direct_family_expense"] else row["category_name"],
                "gross_expense": row["gross_expense"],
                "refunds_applied": row["refunds_applied"],
                "net_expense": net_expense,
            }
        )

    total = sum((family["net_expense"] for family in families.values()), ZERO)
    result = []
    for family in families.values():
        if family["net_expense"] <= ZERO:
            continue
        family["percentage"] = (
            (family["net_expense"] / total * Decimal("100")).quantize(ONE_DECIMAL)
            if total
            else ZERO
        )
        for subcategory in family["subcategories"]:
            subcategory["percentage_of_family"] = (
                subcategory["net_expense"] / family["net_expense"] * Decimal("100")
            ).quantize(ONE_DECIMAL)
        family["subcategories"].sort(key=lambda item: (-item["net_expense"], item["name"]))
        result.append(family)
    result.sort(key=lambda item: (-item["net_expense"], item["family_name"]))
    return result
