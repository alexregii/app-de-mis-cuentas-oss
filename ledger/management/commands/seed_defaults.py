from django.core.management.base import BaseCommand

from ledger.models import Category, ImportProfile, SavingsGoal


class Command(BaseCommand):
    help = "Crea categorías, perfil CSV y objetivo de ahorro iniciales sin sobrescribir datos."

    def handle(self, *args, **options):
        def get_or_create_category(name, kind, parent=None, color="#8e8e93"):
            existing = Category.objects.filter(name=name, kind=kind, parent=parent).order_by("id").first()
            if existing:
                return existing
            return Category.objects.create(name=name, kind=kind, parent=parent, color=color)

        expense_categories = {
            "Vivienda": ["Alquiler o hipoteca", "Comunidad", "Electricidad", "Agua", "Gas", "Internet y teléfono", "Mantenimiento", "Muebles y hogar"],
            "Comida": ["Supermercado", "Restaurantes", "Comida a domicilio", "Café y aperitivos"],
            "Transporte": ["Transporte público", "Combustible", "Aparcamiento", "Peajes", "Mantenimiento del vehículo", "Taxi y VTC"],
            "Salud": ["Farmacia", "Médico y dentista", "Seguro médico", "Gimnasio", "Óptica"],
            "Familia": ["Hijos", "Mascotas", "Ayuda familiar", "Regalos"],
            "Educación": ["Cursos", "Libros", "Material", "Matrículas"],
            "Ocio": ["Salidas", "Viajes", "Cine y espectáculos", "Videojuegos", "Aficiones", "Suscripciones"],
            "Compras personales": ["Ropa y calzado", "Tecnología", "Cuidado personal"],
            "Seguros": ["Hogar", "Vehículo", "Vida", "Otros seguros"],
            "Impuestos y tasas": ["Impuestos", "Tasas", "Multas"],
            "Deudas": ["Préstamos", "Tarjetas", "Intereses y comisiones"],
            "Ahorro e inversión": ["Ahorro", "Inversión", "Fondo de emergencia"],
            "Donaciones": [],
            "Efectivo": [],
            "Otros gastos": [],
        }
        income_categories = {
            "Nómina": [],
            "Ingresos profesionales": ["Autónomo", "Proyectos y trabajos extra"],
            "Ingresos pasivos": ["Intereses", "Dividendos", "Alquileres"],
            "Prestaciones": ["Pensión", "Ayudas y subsidios"],
            "Reembolsos": [],
            "Regalos recibidos": [],
            "Venta de artículos": [],
            "Otros ingresos": [],
        }
        colors = ["#ff9f0a", "#af52de", "#3478f6", "#ff375f", "#5e5ce6", "#30d158", "#8e8e93"]
        for kind, groups in [(Category.Kind.EXPENSE, expense_categories), (Category.Kind.INCOME, income_categories)]:
            for index, (name, children) in enumerate(groups.items()):
                parent = get_or_create_category(name, kind, color=colors[index % len(colors)])
                for child in children:
                    get_or_create_category(child, kind, parent=parent, color=parent.color)
        ImportProfile.objects.get_or_create(name="CSV genérico")
        if not SavingsGoal.objects.exists():
            SavingsGoal.objects.create(percentage=20, minimum=300)
        self.stdout.write(self.style.SUCCESS("Datos iniciales disponibles."))
