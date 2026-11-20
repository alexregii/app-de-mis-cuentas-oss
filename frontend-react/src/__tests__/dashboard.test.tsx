import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {DashboardView} from "../features/dashboard/DashboardView";
import {DashboardCustomizer} from "../features/dashboard/components/DashboardCustomizer";
import {buildDashboardDecisionQueue} from "../features/dashboard/dashboardDecisionQueue";
import {
  DASHBOARD_WIDGET_IDS,
  canMoveDashboardWidget,
  dashboardData,
  dashboardWidgetOrder,
  isDashboardWidgetVisible,
} from "../features/dashboard/dashboardModel";
import {dashboardWidgetRegistry} from "../features/dashboard/widgets/dashboardWidgetRegistry";
import type {BootstrapPayload} from "../shared/model/bootstrap";
import type {DashboardPreferences} from "../shared/model/dashboard";
import {setPrivacyMode} from "../shared/lib/privacy";

const apiMocks = vi.hoisted(() => ({
  updateDashboardPreferences: vi.fn(),
  dashboardPreferences: vi.fn(),
  resetDashboardPreferences: vi.fn(),
}));

vi.mock("../features/dashboard/api", () => ({
  dashboardApi: apiMocks,
}));

it("wraps Tab in both directions inside DashboardCustomizer and returns focus when closed", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const onClose = vi.fn();
  const {unmount} = render(
    <DashboardCustomizer
      order={[]}
      hidden={[]}
      onClose={onClose}
      onMove={vi.fn()}
      canMove={() => false}
      onToggle={vi.fn()}
      onReset={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog", {name: "Personalizar resumen"});
  const close = within(dialog).getByRole("button", {name: "Cerrar personalización"});
  const done = within(dialog).getByRole("button", {name: "Listo"});

  expect(close).toHaveFocus();
  fireEvent.keyDown(document, {key: "Tab", shiftKey: true});
  expect(done).toHaveFocus();
  fireEvent.keyDown(document, {key: "Tab"});
  expect(close).toHaveFocus();
  fireEvent.keyDown(document, {key: "Escape"});
  expect(onClose).toHaveBeenCalledOnce();

  unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

const preferences: DashboardPreferences = {
  widget_order: [...DASHBOARD_WIDGET_IDS],
  hidden_widgets: [],
  density: "normal",
  content_mode: "full",
  created_at: "",
  updated_at: "",
  last_snapshot_month: "",
};

const data = {
  metrics: {
    start: "2026-07-01",
    total_balance: 1000,
    net_savings: 250,
    savings_goal: 300,
    safe_to_spend: 200,
  },
  review: {
    has_pending_review: false,
    total_pending_count: 0,
    last_bank_imported_date: "",
  },
  accounts: [{id: 1, name: "Principal", active: true, balance: 1000, color: "#000"}],
  recent: [],
  preferences,
  dashboard: {
    priority_tasks: [],
    bank_errors: [],
    recurring_next: null,
    budget_risk: null,
    category_rise: null,
    refunds: [],
    subscriptions: [],
    account_balances: [{id: 1, name: "Principal", balance: 1000, color: "#000"}],
  },
} as unknown as BootstrapPayload;

const callbacks = {
  onAddTransaction: vi.fn(),
  onOpenAccounts: vi.fn(),
  onCreateObjective: vi.fn(),
  onOpenTransactions: vi.fn(),
  onOpenReview: vi.fn(),
  onOpenImport: vi.fn(),
  onOpenPlanning: vi.fn(),
  onOpenStatistics: vi.fn(),
};

describe("dashboard architecture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "scrollTo", {value: vi.fn(), writable: true});
    apiMocks.updateDashboardPreferences.mockImplementation(
      async (next: Partial<DashboardPreferences>) => ({
        ok: true,
        preferences: {...preferences, ...next},
      }),
    );
  });

  it("passes the filtered movement intent from an exceptional signal to navigation", () => {
    const signalData = {
      ...data,
      signals: [{title: "Movimiento inusual", label: "Compra", value: 80, value_kind: "money", detail: {kind: "above_historical_median", baseline: 40}, url: "/?tab=transactions&category=14&kind=expense&analytics=included", severity: 80}],
      review: {...data.review, has_pending_review: false, total_pending_count: 0},
      dashboard: {...data.dashboard, bank_errors: [], budget_risk: null, refunds: [], recurring_next: null},
    } as unknown as BootstrapPayload;
    render(<DashboardView data={signalData} {...callbacks} />);

    const signalAction = screen.getByRole("region", {name: "Ahora"}).querySelector<HTMLElement>(".ui-button--primary");
    expect(signalAction).toHaveTextContent("Ver movimientos");
    fireEvent.click(signalAction!);
    expect(callbacks.onOpenTransactions).toHaveBeenCalledExactlyOnceWith("/?tab=transactions&category=14&kind=expense&analytics=included");
  });

  it("registers the 14 widget IDs once and preserves their default order", () => {
    expect(Object.keys(dashboardWidgetRegistry)).toEqual(DASHBOARD_WIDGET_IDS);
    expect(dashboardWidgetOrder(preferences)).toEqual(DASHBOARD_WIDGET_IDS);
    expect(Object.values(dashboardWidgetRegistry).map(({title}) => title)).toEqual([
      "Saldo",
      "Acciones",
      "Revisión pendiente",
      "Salud bancaria",
      "Resultado del mes",
      "Margen mensual previsto",
      "Presupuesto en riesgo",
      "Próximo recurrente",
      "Reembolsos pendientes",
      "Patrones recurrentes",
      "Saldo por cuenta",
      "Categoría con mayor subida",
      "Últimos movimientos",
      "Primeros pasos",
    ]);
    expect(Object.entries(dashboardWidgetRegistry).every(([id, widget]) => widget.id === id)).toBe(true);
  });

  it("only reorders widgets inside their declared region", () => {
    const order = [...DASHBOARD_WIDGET_IDS];
    expect(canMoveDashboardWidget({order, id: "accounts", direction: 1})).toBe(true);
    expect(canMoveDashboardWidget({order, id: "accounts", direction: -1})).toBe(false);
    expect(canMoveDashboardWidget({order: ["accounts", "recent"], id: "accounts", direction: 1})).toBe(true);
  });

  it("muestra la prioridad de la cola de revisión sin alterar su orden", () => {
    const queued = {
      ...data,
      review_queue: [
        {id: "critical", type: "review", priority: 5, title: "Crítica", detail: "Primera", impact: 0, href: "/?tab=review"},
        {id: "high", type: "review", priority: 20, title: "Alta", detail: "Segunda", impact: 0, href: "/?tab=review"},
        {id: "normal", type: "review", priority: 21, title: "Normal", detail: "Tercera", impact: 0, href: "/?tab=review"},
      ],
    } as BootstrapPayload;
    expect(buildDashboardDecisionQueue(queued).map((item) => item.id)).toEqual(["critical", "high", "normal"]);
    render(<DashboardView data={queued} {...callbacks} />);
    expect(screen.getByText("Prioridad Crítica")).toBeInTheDocument();
    expect(screen.getByText("Prioridad Alta")).toBeInTheDocument();
    expect(screen.getByText("Prioridad Normal")).toBeInTheDocument();
  });

  it("no duplica el acceso a Revisión cuando ya encabeza la agenda", () => {
    const withReviewQueue = {
      ...data,
      review: {...data.review, has_pending_review: true, total_pending_count: 2},
    } as BootstrapPayload;

    render(<DashboardView data={withReviewQueue} {...callbacks} />);

    expect(screen.getByRole("heading", {name: "Ahora"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Abrir revisión"})).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Revisar banco"})).not.toBeInTheDocument();
  });

  it("mantiene visible la fecha bancaria junto a una alerta de presupuesto", () => {
    const withBudgetRisk = {
      ...data,
      dashboard: {
        ...data.dashboard,
        budget_risk: {category: {display_name: "Alimentación"}, spent: 120, limit: 100, actual_percent: 120, projected_percent: 140},
      },
    } as unknown as BootstrapPayload;

    render(<DashboardView data={withBudgetRisk} {...callbacks} />);

    expect(screen.getByText("Sin sincronizaciones bancarias recientes")).toBeInTheDocument();
    expect(screen.getByText("Alimentación supera el ritmo previsto")).toBeInTheDocument();
  });

  it("keeps unknown stored IDs in place while appending missing official widgets", () => {
    expect(
      dashboardWidgetOrder({...preferences, widget_order: ["recent", "legacy-widget", "balance"]}),
    ).toEqual([
      "recent",
      "legacy-widget",
      "balance",
      ...DASHBOARD_WIDGET_IDS.filter((id) => id !== "recent" && id !== "balance"),
    ]);
  });

  it("forces critical widgets in full mode and applies the balance/review allowlists", () => {
    const criticalDashboard = {
      ...dashboardData(data),
      priority_tasks: [{id: "review", label: "Pendiente", count: 1, severity: "high", url: "/"}],
      bank_errors: [{id: 1}],
    } as ReturnType<typeof dashboardData>;
    const hidden = [...DASHBOARD_WIDGET_IDS];
    const visible = (mode: DashboardPreferences["content_mode"]) =>
      DASHBOARD_WIDGET_IDS.filter((id) =>
        isDashboardWidgetVisible({id, mode, hidden, data, dashboard: criticalDashboard}),
      );

    expect(visible("full")).toEqual(["balance", "priority", "bank_health"]);
    expect(visible("balance")).toEqual(["balance"]);
    expect(visible("review")).toEqual(["priority", "bank_health"]);
  });

  it("prioritises the decision queue, excludes reminders and never repeats its first item", () => {
    const priorityData = {
      ...data,
      signals: [{title: "Movimiento inusual", label: "Compra", value: 80, value_kind: "money", detail: {kind: "above_historical_median", baseline: 40}, url: "/?tab=transactions&category=14&kind=expense&analytics=included", severity: 80}],
      review: {...data.review, has_pending_review: true, total_pending_count: 2},
      dashboard: {
        ...data.dashboard,
        bank_errors: [{id: 1, bank_name: "Banco principal"}],
        budget_risk: {category: {display_name: "Alimentación"}, spent: 120, limit: 100, actual_percent: 120, projected_percent: 140},
        refunds: [{description: "Pedido", amount: 20}],
        recurring_next: {name: "Nómina", date: "2026-07-28", amount: 1000, account: "Principal"},
      },
    } as unknown as BootstrapPayload;

    expect(buildDashboardDecisionQueue(priorityData).map((item) => item.id)).toEqual([
      "bank-errors",
      "pending-review",
      "budget-risk",
      "pending-refunds",
      "signal-Movimiento inusual-Compra",
    ]);
    expect(buildDashboardDecisionQueue(priorityData).some((item) => item.title.includes("Nómina"))).toBe(false);

    render(<DashboardView data={priorityData} {...callbacks} />);
    expect(screen.getByRole("heading", {name: "Ahora"})).toBeInTheDocument();
    expect(screen.getAllByText("Conexión bancaria por revisar")).toHaveLength(1);
    expect(screen.getByRole("heading", {name: "Pendientes de atención"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Recordatorios"})).toBeInTheDocument();
    expect(screen.getByText("Nómina")).toBeInTheDocument();

  });

  it("keeps an operational alert when its matching presentation widget is hidden", () => {
    const budgetRisk = {
      ...data,
      preferences: {...preferences, hidden_widgets: ["budget_risk"]},
      dashboard: {
        ...data.dashboard,
        budget_risk: {category: {display_name: "Alimentación"}, spent: 120, limit: 100, actual_percent: 120, projected_percent: 140},
      },
    } as unknown as BootstrapPayload;

    expect(isDashboardWidgetVisible({
      id: "budget_risk",
      mode: "review",
      hidden: ["budget_risk"],
      data: budgetRisk,
      dashboard: dashboardData(budgetRisk),
    })).toBe(false);
    expect(buildDashboardDecisionQueue(budgetRisk).map((item) => item.id)).toContain("budget-risk");

    render(<DashboardView data={budgetRisk} {...callbacks} />);
    expect(screen.getByText("Alimentación supera el ritmo previsto")).toBeInTheDocument();
  });

  it("updates the content mode optimistically and persists the preference", async () => {
    render(<DashboardView data={data} {...callbacks} />);

    fireEvent.click(screen.getByRole("button", {name: "Saldos"}));

    expect(screen.getByRole("heading", {name: "Estado del mes"})).toBeInTheDocument();
    expect(screen.getByText("Saldo por cuenta")).toBeInTheDocument();
    expect(screen.queryByText("Revisión pendiente")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.updateDashboardPreferences).toHaveBeenCalledWith({content_mode: "balance"}),
    );
  });

  it("mantiene enfocado el control de orden al mover un módulo", async () => {
    render(<DashboardView data={data} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", {name: "Personalizar"}));

    const dialog = screen.getByRole("dialog", {name: "Personalizar resumen"});
    const order = () => Array.from(dialog.querySelectorAll(".editor-row strong"), (item) => item.textContent);
    const before = order();
    const move = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button[aria-label^='Subir '], button[aria-label^='Bajar ']"))
      .find((button) => !button.disabled);
    expect(move).toBeDefined();
    move!.focus();
    await act(async () => {
      fireEvent.click(move!);
      await waitFor(() => expect(apiMocks.updateDashboardPreferences).toHaveBeenCalledWith({widget_order: expect.any(Array)}));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(move!.closest(".editor-row")?.contains(document.activeElement)).toBe(true);
    expect(order()).not.toEqual(before);
  });

  it("does not invent activation state when bootstrap data is absent", () => {
    render(<DashboardView data={data} {...callbacks} />);
    expect(screen.queryByRole("heading", {name: "Primeros pasos"})).not.toBeInTheDocument();
  });

  it("derives the next activation action from backend facts and does not complete on click", () => {
    const empty = {
      ...data,
      activation: {
        has_active_account: false,
        has_reviewed_movement: false,
        pending_review_count: 0,
        has_savings_objective: false,
        distinct_activity_months: 0,
        is_mature: false,
        time_to_first_reviewed_movement_seconds: null,
      },
    } as BootstrapPayload;
    render(<DashboardView data={empty} {...callbacks} />);

    const heading = screen.getByRole("heading", {name: "Primeros pasos"});
    expect(heading).toBeInTheDocument();
    expect(heading.closest(".dashboard-activation")?.textContent).not.toMatch(/\d+(?:[,.]\d+)?\s*€/);
    expect(screen.getByText("0 de 3 pasos completados")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Añadir o activar una cuenta"}));
    expect(callbacks.onOpenAccounts).toHaveBeenCalledOnce();
    expect(screen.getByText("0 de 3 pasos completados")).toBeInTheDocument();
  });

  it("routes a pending first transaction to Review instead of counting it as reviewed", () => {
    const partial = {
      ...data,
      activation: {
        has_active_account: true,
        has_reviewed_movement: false,
        pending_review_count: 2,
        has_savings_objective: false,
        distinct_activity_months: 0,
        is_mature: false,
        time_to_first_reviewed_movement_seconds: null,
      },
    } as BootstrapPayload;
    render(<DashboardView data={partial} {...callbacks} />);

    expect(screen.getByText("2 movimientos pendientes por revisar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Revisar movimientos"}));
    expect(callbacks.onOpenReview).toHaveBeenCalledOnce();
    expect(callbacks.onAddTransaction).not.toHaveBeenCalled();
  });

  it("opens the first movement or savings objective and stays quiet for mature/completed installs", () => {
    const movementNeeded = {
      ...data,
      activation: {
        has_active_account: true,
        has_reviewed_movement: false,
        pending_review_count: 0,
        has_savings_objective: false,
        distinct_activity_months: 0,
        is_mature: false,
        time_to_first_reviewed_movement_seconds: null,
      },
    } as BootstrapPayload;
    const {rerender} = render(<DashboardView data={movementNeeded} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", {name: "Añadir mi primer movimiento"}));
    expect(callbacks.onAddTransaction).toHaveBeenCalledOnce();

    const objectiveNeeded = {
      ...movementNeeded,
      activation: {...movementNeeded.activation!, has_reviewed_movement: true, distinct_activity_months: 1, time_to_first_reviewed_movement_seconds: 18},
    } as BootstrapPayload;
    rerender(<DashboardView data={objectiveNeeded} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", {name: "Crear un objetivo de ahorro"}));
    expect(callbacks.onCreateObjective).toHaveBeenCalledOnce();
    expect(screen.getByText("2 de 3 pasos completados")).toBeInTheDocument();

    const mature = {...objectiveNeeded, activation: {...objectiveNeeded.activation!, is_mature: true, distinct_activity_months: 3}};
    rerender(<DashboardView data={mature} {...callbacks} />);
    expect(screen.queryByRole("heading", {name: "Primeros pasos"})).not.toBeInTheDocument();
    const completed = {...objectiveNeeded, activation: {...objectiveNeeded.activation!, has_savings_objective: true}};
    rerender(<DashboardView data={completed} {...callbacks} />);
    expect(screen.queryByRole("heading", {name: "Primeros pasos"})).not.toBeInTheDocument();
  });

  it("persists guide dismissal through existing dashboard preferences", async () => {
    const incomplete = {
      ...data,
      activation: {has_active_account: true, has_reviewed_movement: false, pending_review_count: 0, has_savings_objective: false, distinct_activity_months: 0, is_mature: false, time_to_first_reviewed_movement_seconds: null},
    } as BootstrapPayload;
    render(<DashboardView data={incomplete} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", {name: "Ocultar guía"}));
    await waitFor(() => expect(apiMocks.updateDashboardPreferences).toHaveBeenCalledWith({hidden_widgets: ["activation"]}));
    await waitFor(() => expect(screen.getByRole("button", {name: "Personalizar"})).toHaveFocus());
    expect(screen.queryByRole("heading", {name: "Primeros pasos"})).not.toBeInTheDocument();
  });

  it("mounts the customizer at document level and keeps fixed controls aligned", () => {
    render(<DashboardView data={data} {...callbacks} />);

    fireEvent.click(screen.getByRole("button", {name: "Personalizar"}));

    const dialog = screen.getByRole("dialog", {name: "Personalizar resumen"});
    const backdrop = dialog.parentElement;
    expect(backdrop).toHaveClass("dashboard-editor-backdrop");
    expect(backdrop?.parentElement).toBe(document.body);
    expect(screen.getAllByText("Fijo", {exact: true})).not.toHaveLength(0);
    expect(screen.getByRole("button", {name: "Cerrar personalización"})).toHaveClass("ui-icon-button");
    expect(screen.getByRole("button", {name: "Restaurar orden inicial"})).toHaveClass("ui-button--secondary");
    expect(screen.getByRole("button", {name: "Listo"})).toHaveClass("ui-button--primary");
  });

  it("oculta saldo y cuentas con la privacidad explícita de la vista", () => {
    setPrivacyMode(true);
    try {
      render(<DashboardView data={data} {...callbacks} privateAmounts />);

      expect(screen.queryAllByText("1000,00 €")).toHaveLength(0);
      expect(screen.getAllByText("•••• €").length).toBeGreaterThan(0);
      expect(screen.getByRole("region", {name: "Estado del mes"})).toHaveTextContent("•••• €");
    } finally {
      setPrivacyMode(false);
    }
  });

  it("distingue saldo registrado, resultado mensual y margen previsto con ingresos pendientes", () => {
    const futureIncome = {
      ...data,
      metrics: {...data.metrics, total_balance: 0, income: 0, expense: 0, net_savings: 0, expected_income: 3000, commitments: 0, savings_goal: 0, safe_to_spend: 3000},
      accounts: [{id: 1, name: "Principal", active: true, balance: 0, color: "#000"}],
      dashboard: {...data.dashboard, account_balances: [{id: 1, name: "Principal", balance: 0, color: "#000"}]},
    } as unknown as BootstrapPayload;
    render(<DashboardView data={futureIncome} {...callbacks} />);

    const month = screen.getByRole("region", {name: "Estado del mes"});
    expect(month).toHaveTextContent("Saldo registrado");
    expect(month.querySelector(".financial-balance > strong")).toHaveTextContent(/0,00/);
    expect(month).toHaveTextContent("Resultado del mes");
    expect(month).toHaveTextContent("Margen mensual previsto");
    expect(month).toHaveTextContent(/3\.?000,00/);

    const margin = month.querySelector(".dashboard-safe-spend-note") as HTMLElement;
    expect(margin).toHaveTextContent(/3\.?000,00/);
    expect(margin).toHaveTextContent("Incluye ingresos recurrentes pendientes; no es saldo.");
    expect(month).not.toHaveTextContent("Gasto seguro");
    expect(month).not.toHaveTextContent("Disponible hasta final de mes");
    fireEvent.click(within(month).getByRole("button", {name: "Ver desglose en Plan"}));
    expect(callbacks.onOpenPlanning).toHaveBeenCalledOnce();
  });

  it("marca un margen negativo y deja explícito cuando el dato opcional falta", () => {
    const negative = {...data, metrics: {...data.metrics, safe_to_spend: -250}} as unknown as BootstrapPayload;
    const view = render(<DashboardView data={negative} {...callbacks} />);
    const month = screen.getByRole("region", {name: "Estado del mes"});
    let margin = month.querySelector(".dashboard-safe-spend-note") as HTMLElement;
    expect(margin.querySelector("strong")).toHaveClass("negative");
    expect(margin).toHaveTextContent(/-250,00/);

    view.rerender(<DashboardView data={{...data, metrics: {...data.metrics, safe_to_spend: undefined}} as BootstrapPayload} {...callbacks} />);
    margin = screen.getByRole("region", {name: "Estado del mes"}).querySelector(".dashboard-safe-spend-note") as HTMLElement;
    expect(margin).toHaveTextContent("Sin datos");
    expect(margin).not.toHaveTextContent("0,00 €");
  });

  it("oculta el margen previsto también en texto accesible", () => {
    setPrivacyMode(true);
    try {
      const futureIncome = {...data, metrics: {...data.metrics, total_balance: 0, expected_income: 3000, safe_to_spend: 3000}} as BootstrapPayload;
      const {container} = render(<DashboardView data={futureIncome} {...callbacks} privateAmounts />);
      expect(container).not.toHaveTextContent(/3\.?000,00/);
      expect(container.querySelector('[aria-label*="3000"], [title*="3000"]')).toBeNull();
      expect(screen.getByRole("region", {name: "Estado del mes"}).querySelector(".dashboard-safe-spend-note")).toHaveTextContent("•••• €");
    } finally {
      setPrivacyMode(false);
    }
  });

  it("no confunde la fecha de un movimiento importado con una sincronización", () => {
    render(<DashboardView data={{...data, review: {...data.review, last_bank_sync_at: "", last_bank_imported_date: "2026-07-19"}}} {...callbacks} />);

    expect(screen.getByText("Sin sincronizaciones bancarias recientes")).toBeInTheDocument();
    expect(screen.queryByText(/Última sincronización: 19\/07\/2026/)).not.toBeInTheDocument();
  });

  it("keeps real savings in Summary and reduces detected subscriptions to a Planning notice", async () => {
    const withPlanningOnlyDetails = {
      ...data,
      metrics: {
        ...data.metrics,
        savings_rate: 25,
        projection: {
          normalized_savings: 999,
          expense_delta_vs_pace: 120,
        },
      },
      dashboard: {
        ...data.dashboard,
        subscriptions: [{
          description: "Servicio que no debe listarse",
          median_amount: 49,
          months_seen: 5,
          typical_day: 2,
        }],
      },
    } as unknown as BootstrapPayload;

    render(<DashboardView data={withPlanningOnlyDetails} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", {name: "Más información"}));

    expect(screen.getByText(/Ahorro mensual/)).toBeInTheDocument();
    expect(screen.getByText(/Ahorro mensual 25\.0%/)).toBeInTheDocument();
    expect(screen.queryByText("Servicio que no debe listarse")).not.toBeInTheDocument();
    expect(screen.getByText("200,00 €")).toBeInTheDocument();
    expect(screen.getByText(/Incluye ingresos recurrentes pendientes/)).toBeInTheDocument();
    expect(screen.getByText(/1 patrón pendiente de confirmar/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", {name: "Ir a Plan"}));
    expect(callbacks.onOpenPlanning).toHaveBeenCalledOnce();
  });
});
