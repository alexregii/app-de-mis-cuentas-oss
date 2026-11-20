from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .models import Account, Attachment, Budget, RecurringRule, Transaction
from .services import account_balance, dashboard_metrics


def excel_safe(value):
    text = str(value or "")
    return f"'{text}" if text.startswith(("=", "+", "-", "@")) else text


def export_excel(request):
    selected_ids = request.GET.get("transaction_ids", "")
    if selected_ids:
        try:
            transaction_ids = list(dict.fromkeys(int(value) for value in selected_ids.split(",") if value))
        except ValueError:
            return JsonResponse({"ok": False, "error": "La selección de movimientos no es válida."}, status=400)
        if not transaction_ids or len(transaction_ids) > 100:
            return JsonResponse({"ok": False, "error": "Selecciona entre 1 y 100 movimientos para exportar."}, status=400)
        selected_movements = (
            Transaction.objects.filter(pk__in=transaction_ids, archived=False)
            .select_related("account", "category", "category__parent")
            .prefetch_related("tags")
        )
        if selected_movements.count() != len(transaction_ids):
            return JsonResponse({"ok": False, "error": "Uno de los movimientos seleccionados ya no está disponible."}, status=400)
    else:
        selected_movements = (
            Transaction.objects.filter(archived=False)
            .select_related("account", "category", "category__parent")
            .prefetch_related("tags")
        )
    workbook = Workbook()
    summary = workbook.active
    summary.title = "Resumen"
    metrics = dashboard_metrics()
    summary.append(["Métrica", "Valor"])
    for key, label in [
        ("total_balance", "Saldo registrado"),
        ("income", "Ingresos del mes"),
        ("expense", "Gastos del mes"),
        ("net_savings", "Resultado del mes"),
        ("savings_contributions", "Aportes a ahorro"),
        ("commitments", "Compromisos pendientes"),
        ("safe_to_spend", "Margen mensual previsto"),
    ]:
        summary.append([label, float(metrics[key])])

    movements_rows = [
        [
            movement.date.isoformat(),
            excel_safe(movement.account.name),
            movement.get_kind_display(),
            excel_safe(movement.description),
            excel_safe(movement.category),
            float(movement.signed_amount),
            excel_safe(movement.notes),
            excel_safe(", ".join(movement.tags.values_list("name", flat=True))),
        ]
        for movement in selected_movements
    ]
    sheets = {
        "Movimientos": (
            ["Fecha", "Cuenta", "Tipo", "Concepto", "Categoría", "Importe", "Notas", "Etiquetas"],
            movements_rows,
        ),
        "Cuentas": (
            ["Cuenta", "Tipo", "Saldo inicial", "Saldo actual", "Activa"],
            [
                [
                    excel_safe(account.name),
                    account.get_kind_display(),
                    float(account.opening_balance),
                    float(account_balance(account)),
                    account.active,
                ]
                for account in Account.objects.all()
            ],
        ),
        "Presupuestos": (
            ["Mes", "Categoría", "Límite"],
            [
                [item.month.isoformat(), excel_safe(item.category), float(item.limit)]
                for item in Budget.objects.select_related("category", "category__parent")
            ],
        ),
        "Recurrentes": (
            ["Nombre", "Tipo", "Importe", "Cuenta", "Categoría", "Frecuencia", "Activo"],
            [
                [
                    excel_safe(rule.name),
                    rule.get_kind_display(),
                    float(rule.amount),
                    excel_safe(rule.account.name),
                    excel_safe(rule.category),
                    rule.get_frequency_display(),
                    rule.active,
                ]
                for rule in RecurringRule.objects.select_related("account", "category")
            ],
        ),
    }
    if selected_ids:
        summary.delete_rows(2, summary.max_row)
        summary.append(["Movimientos seleccionados", len(movements_rows)])
        summary.append(["Importe neto seleccionado", sum(row[5] for row in movements_rows)])
        sheets = {"Movimientos": sheets["Movimientos"]}
    for title, (headers, rows) in sheets.items():
        sheet = workbook.create_sheet(title)
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
    for sheet in workbook.worksheets:
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="3478F6")
        sheet.freeze_panes = "A2"
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = min(
                max(len(str(cell.value or "")) for cell in column) + 2,
                45,
            )
    response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response["Content-Disposition"] = f'attachment; filename="mis-cuentas-{timezone.localdate():%Y-%m-%d}.xlsx"'
    workbook.save(response)
    return response


def attachment_download(request, pk):
    attachment = get_object_or_404(Attachment, pk=pk)
    return FileResponse(attachment.file.open("rb"), as_attachment=False, filename=attachment.original_name)


@require_GET
def health(request):
    return JsonResponse({"status": "ok", "date": timezone.localdate().isoformat()})
