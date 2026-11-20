import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {AccountsView} from "../features/accounts/AccountsView";
import {AccountDetailView} from "../features/accounts/AccountDetailView";
import {PlanningView} from "../features/planning/PlanningView";
import {PlanningResults} from "../features/planning/PlanningResults";
import {setPrivacyMode} from "../shared/lib/privacy";
import {ApiError} from "../shared/api/client";
import type {Account, AccountDetail} from "../shared/model/accounts";
import type {Category} from "../shared/model/categories";
import type {LiquidityForecast, PlanningCalendarPayload, PlanningPayload, RecurringRule} from "../shared/model/planning";
import type {Transaction} from "../shared/model/transactions";
import {consumeCategoryRuleDraftHandoff} from "../shared/lib/categoryRuleDraftHandoff";

const apiMock = vi.hoisted(() => ({
  bankConnectOptions: vi.fn(),
  accountDetail: vi.fn(),
  createAccount: vi.fn(),
  createBudget: vi.fn(),
  copyBudgets: vi.fn(),
  deleteAccount: vi.fn(),
  deleteBudget: vi.fn(),
  updateSavingsGoal: vi.fn(),
  disconnectBank: vi.fn(),
  occurrenceAction: vi.fn(),
  planning: vi.fn(),
  previewBudgetCopy: vi.fn(),
  saveReconciliation: vi.fn(),
  prepare: vi.fn(),
  startBankConnect: vi.fn(),
  syncBank: vi.fn(),
  updateAccount: vi.fn(),
  updateBudget: vi.fn(),
  createRecurringRule: vi.fn(),
  reviewSubscription: vi.fn(),
  createCategoryRuleFromCandidate: vi.fn(),
  calendar: vi.fn(),
  liquidity: vi.fn(),
  updateRecurringRule: vi.fn(),
  setRecurringRuleActive: vi.fn(),
}));

vi.mock("../features/accounts/api", () => ({accountsApi: apiMock}));
vi.mock("../features/planning/api", () => ({planningApi: apiMock}));
vi.mock("../shared/api/banking", () => ({bankingApi: apiMock}));

Object.defineProperty(window, "scrollTo", {value: vi.fn(), writable: true});

const account: Account = {
  id: 1,
  name: "Cuenta diaria",
  kind: "checking",
  kind_display: "Cuenta corriente",
  balance: 1250,
  opening_balance: 1000,
  color: "#3478f6",
  active: true,
  bank_link: null,
};

const category: Category = {
  id: 2,
  name: "Comida",
  display_name: "Comida",
  kind: "expense",
  color: "#ff9500",
  icon: "",
  active: true,
  parent_id: null,
  exclude_from_analytics: false,
  sort_order: 1,
  is_favorite: false,
};

const recentTransaction: Transaction = {
  id: 44,
  kind: "expense",
  kind_display: "Gasto",
  amount: 12.5,
  signed_amount: -12.5,
  date: "2026-07-15",
  description: "Compra reciente",
  notes: "",
  account,
  category,
  source: "manual",
  source_display: "Manual",
  refund_for_id: null,
  is_refund: false,
  is_transfer: false,
  tags: [],
  attachments: [],
};

const planningPayload: PlanningPayload = {
  period: {month: "2026-07", start: "2026-07-01", end: "2026-07-31", as_of: "2026-07-16", status: "current", partial: true},
  goal: {configured: false, active: false, percentage: 0, minimum: 0, target: 0},
  savings_objectives: {
    items: [],
    summary: {ledger_balance: 0, eligible_balance: 0, assigned_total: 0, free_to_assign: 0, overallocated: false, overallocated_by: 0, confirmation_token: "empty"},
  },
  margin: {expected_income: 0, confirmed_expense: 0, pending_recurring: 0, savings_goal: 0, available: 0},
  metrics: {start: "2026-07-01", end: "2026-07-31", income: 0, expense: 0, net_savings: 0},
  projection: null,
  subscription_candidates: [],
  budget_progress: [],
  budgets: [],
  rules: [],
  occurrences: [],
  accounts: [account],
  categories: [category],
};

const createdRecurringRule: RecurringRule = {
  id: 12,
  name: "Servicio de vídeo",
  kind: "expense",
  amount: 12,
  account,
  category,
  frequency: "monthly",
  frequency_display: "Mensual",
  day_of_month: 3,
  start_date: "2026-07-03",
  end_date: "",
  notes: "Detectado como patrón",
  active: true,
  lifecycle: "active",
  affects_selected_month: true,
};

const planningWithRecurringRule = (planning: PlanningPayload): PlanningPayload => ({
  ...planning,
  rules: [createdRecurringRule],
  subscription_candidates: [],
});

const planningWithBudget = (planning: PlanningPayload, id: number, limit: number): PlanningPayload => {
  const budget = {id, month: "2026-07", category, limit};
  return {
    ...planning,
    budgets: [budget],
    budget_progress: [{id, category, limit, spent: 0, remaining: limit, percent: 0, actual_percent: 0, projected_percent: 0, pace: "normal"}],
  };
};

const videoCandidate: PlanningPayload["subscription_candidates"][number] = {
  key: "video-1",
  normalized_description: "servicio de vídeo",
  evidence_signature: "a".repeat(64),
  description: "Servicio de vídeo",
  median_amount: 12,
  annual_cost: 144,
  confirmed_annual_cost: null,
  monthly_periodicity_confirmed: false,
  months_seen: 4,
  typical_day: 3,
  last_date: "2026-07-03",
  latest_amount: 12,
  latest_month_median: 12,
  previous_median: 12,
  exceptional_charge: false,
  confirmed_step_change: false,
  has_category_rule: false,
  has_recurring_rule: false,
  review_status: "pending",
  review_reason: "new",
  reviewed_status: null,
  review_revision: 0,
  next_review_date: null,
  reviewed_at: null,
  account: {id: account.id, name: account.name},
  category: {id: category.id, name: category.name, display_name: category.display_name},
  movements_url: "/?tab=transactions&category_family=2",
  category_rule_input: {
    description: "Servicio de vídeo",
    kind: "expense",
    category: category.id,
    priority: 100,
    match_mode: "contains",
    account: account.id,
    amount_min: null,
    amount_max: null,
    active: true,
  },
  recurring_rule_input: {
    name: "Servicio de vídeo",
    kind: "expense",
    amount: 12,
    account: account.id,
    category: category.id,
    frequency: "monthly",
    day_of_month: 3,
    start_date: "2026-07-03",
    end_date: "",
    notes: "Detectado como patrón",
    active: true,
  },
};

const calendarPayload: PlanningCalendarPayload = {
  month: "2026-07", currency: "EUR", period: planningPayload.period, confirmed_count: 1, forecast_count: 1, warning: "",
  days: [{date: "2026-07-01", in_month: true, confirmed: [{id: "1", date: "2026-07-01", description: "Nómina", amount: 1200, kind: "income", state: "confirmed", account: "Cuenta diaria", is_transfer: false}], forecast: [{id: "2", date: "2026-07-01", description: "Alquiler", amount: -700, kind: "expense", state: "forecast", account: "Cuenta diaria", is_transfer: false}], income: 1200, expense: -700, transfer_net: 0, actual_income: 1200, actual_expense: 0, actual_transfer_net: 0, projected_income: 0, projected_expense: -700, projected_transfer_net: 0, actual_count: 1, projected_count: 1, has_income: true, has_expense: true, has_transfer: false, ending_balance: 1750}],
};

const liquidityForecastPayload: LiquidityForecast = {
  date_from: "2026-07-16",
  date_to: "2026-07-16",
  currency: "EUR",
  status: "known",
  accounts: [{
    account_id: account.id,
    name: account.name,
    status: "known",
    starting_balance: 100,
    provenance: {kind: "ledger", cut_date: "2026-07-15"},
    unknown_reasons: [],
    starting_adjustments: [],
    minimum_balance: 100,
    minimum_date: "2026-07-16",
    first_deficit_date: null,
    daily_series: [{
      date: "2026-07-16",
      opening_balance: 100,
      closing_balance: 100,
      confirmed_net_cashflow: 0,
      forecast_net_cashflow: 0,
      confirmed_income: 0,
      confirmed_expense: 0,
      confirmed_transfer_net: 0,
      forecast_income: 0,
      forecast_expense: 0,
      forecast_transfer_net: 0,
      cashflows: [],
    }],
  }],
  starting_balance: 100,
  daily_series: [],
  minimum_balance: 100,
  minimum_date: "2026-07-16",
  first_deficit_date: null,
  assumptions: [],
};

const accountDetail: AccountDetail = {
  account,
  period: {start: "2026-07-01", end: "2026-07-16", income: 1200, expense: 430},
  recent: [],
  connection: null,
  latest_reconciliation: null,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return {promise, resolve, reject};
};

async function choosePlanningComposer(kind: "Presupuesto" | "Recurrente") {
  const view = render(<PlanningView openComposerToken={0} />);
  await screen.findByRole("heading", {name: "Plan"});
  view.rerender(<PlanningView openComposerToken={1} />);
  fireEvent.click(await screen.findByRole("button", {name: new RegExp(`^${kind}$`)}));
}

describe("PlanningView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.prepare.mockResolvedValue({ok: true, month: "2026-07", created: 0});
    apiMock.planning.mockResolvedValue(planningPayload);
    apiMock.calendar.mockResolvedValue(null);
    apiMock.liquidity.mockResolvedValue(liquidityForecastPayload);
    apiMock.createBudget.mockResolvedValue({ok: true, budget: {id: 9, month: "2026-07", category, limit: 300}});
    apiMock.createCategoryRuleFromCandidate.mockResolvedValue({ok: true});
    apiMock.createRecurringRule.mockResolvedValue({ok: true});
    apiMock.updateSavingsGoal.mockResolvedValue({ok: true, goal: {id: null, percentage: 25, minimum: 0, active: true, updated_at: "2026-07-16T00:00:00Z"}});
    apiMock.reviewSubscription.mockResolvedValue({ok: true, idempotent: false});
    sessionStorage.removeItem("mis-cuentas:category-rule-draft");
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-07");
  });

  it("consolida los estados vacíos y permite guardar un presupuesto", async () => {
    apiMock.planning.mockResolvedValueOnce(planningPayload).mockResolvedValueOnce(planningWithBudget(planningPayload, 9, 300));
    await choosePlanningComposer("Presupuesto");

    expect(screen.getByText("Aún no hay presupuestos este mes.")).toBeInTheDocument();
    expect(screen.getByText("No hay recurrentes configurados.")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Comprimir nuevo presupuesto"})).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Límite"), {target: {value: "300"}});
    fireEvent.change(screen.getByLabelText("Categoría"), {target: {value: "2"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar presupuesto"}));

    await waitFor(() => expect(apiMock.createBudget).toHaveBeenCalledWith(expect.objectContaining({month: "2026-07", category: "2", limit: "300"})));
    expect(await screen.findByRole("status")).toHaveTextContent("Presupuesto guardado.");
    expect(document.getElementById("planning-budget-9")).toHaveTextContent("Comida");
    expect(apiMock.planning).toHaveBeenCalledTimes(2);
    expect(apiMock.planning.mock.calls.map(([month]) => month)).toEqual(["2026-07", "2026-07"]);
  });

  it("updates a route-prepared existing budget with its id and edited amount", async () => {
    const routeKey = "http://localhost/?tab=planning&plan_month=2026-07&budget_category=2";
    const navigate = vi.fn();
    apiMock.planning.mockResolvedValue(planningWithBudget(planningPayload, 9, 300));
    apiMock.updateBudget.mockResolvedValue({ok: true, budget: {id: 9, month: "2026-07", category, limit: 210.5}});
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-07&budget_category=2");
    render(<PlanningView routeKey={routeKey} navigate={navigate} />);

    expect(await screen.findByRole("heading", {name: "Editar presupuesto"})).toBeInTheDocument();
    expect(screen.getByLabelText("Límite")).toHaveValue(300);
    expect(apiMock.updateBudget).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Límite"), {target: {value: "210.50"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar presupuesto"}));
    await waitFor(() => expect(apiMock.updateBudget).toHaveBeenCalledWith(9, expect.objectContaining({month: "2026-07", category: "2", limit: "210.50"})));
    expect(await screen.findByText("Presupuesto actualizado.")).toBeInTheDocument();
    const transition = navigate.mock.calls[navigate.mock.calls.length - 1]?.[1] as {history?: string; search?: URLSearchParams};
    expect(transition.history).toBe("replace");
    expect(transition.search?.has("budget_category")).toBe(false);
  });

  it("shows recovery for an invalid prepared-budget route without creating or updating a budget", async () => {
    const routeKey = "http://localhost/?tab=planning&plan_month=2026-13&budget_category=2";
    const navigate = vi.fn();
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-13&budget_category=2");
    render(<PlanningView routeKey={routeKey} navigate={navigate} />);

    expect(await screen.findByText(/El mes del presupuesto preparado no es válido/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Elegir categoría y mes"}));

    expect(navigate).toHaveBeenCalledTimes(1);
    const transition = navigate.mock.calls[0]?.[1] as {search?: URLSearchParams};
    expect(transition.search?.has("budget_category")).toBe(false);
    expect(transition.search?.get("plan_month")).not.toBe("2026-13");
    expect(apiMock.createBudget).not.toHaveBeenCalled();
    expect(apiMock.updateBudget).not.toHaveBeenCalled();
  });

  it("routes a retired prepared-budget category to Classification without writing", async () => {
    const routeKey = "http://localhost/?tab=planning&plan_month=2026-07&budget_category=2";
    const retiredPlan = {...planningPayload, categories: planningPayload.categories.map((item) => item.id === 2 ? {...item, active: false} : item)};
    const navigateToSettings = vi.fn();
    apiMock.planning.mockResolvedValueOnce(retiredPlan);
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-07&budget_category=2");
    render(<PlanningView routeKey={routeKey} navigateToSettings={navigateToSettings} />);

    expect(await screen.findByText(/La categoría ya no está disponible como gasto activo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Revisar categoría"}));

    expect(navigateToSettings).toHaveBeenCalledTimes(1);
    const search = navigateToSettings.mock.calls[0]?.[0] as URLSearchParams;
    expect(Object.fromEntries(search)).toEqual({settings_section: "classification", category: "2"});
    expect(apiMock.createBudget).not.toHaveBeenCalled();
    expect(apiMock.updateBudget).not.toHaveBeenCalled();
  });

  it("cancels a route-prepared existing budget without writing", async () => {
    const routeKey = "http://localhost/?tab=planning&plan_month=2026-07&budget_category=2";
    const navigate = vi.fn();
    apiMock.planning.mockResolvedValueOnce(planningWithBudget(planningPayload, 9, 300));
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-07&budget_category=2");
    render(<PlanningView routeKey={routeKey} navigate={navigate} />);

    expect(await screen.findByRole("heading", {name: "Editar presupuesto"})).toBeInTheDocument();
    expect(screen.getByLabelText("Límite")).toHaveValue(300);
    expect(apiMock.updateBudget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Cancelar edición"}));
    expect(navigate).toHaveBeenCalledTimes(1);
    const transition = navigate.mock.calls[0]?.[1] as {history?: string; search?: URLSearchParams};
    expect(transition.history).toBe("replace");
    expect(transition.search?.has("budget_category")).toBe(false);
    expect(apiMock.updateBudget).not.toHaveBeenCalled();
  });

  it("distingue margen previsto de saldo cuando solo hay un ingreso recurrente pendiente", async () => {
    const plan = {
      ...planningPayload,
      margin: {expected_income: 3000, confirmed_expense: 0, pending_recurring: 0, savings_goal: 0, available: 3000},
      metrics: {...planningPayload.metrics, total_balance: 0, income: 0, expense: 0, net_savings: 0, expected_income: 3000, commitments: 0, savings_goal: 0, safe_to_spend: 3000},
    };
    apiMock.planning.mockResolvedValueOnce(plan);
    render(<PlanningView />);

    const margin = await screen.findByText("Margen mensual previsto");
    const panel = margin.closest(".planning-margin-panel") as HTMLElement;
    expect(panel).toHaveTextContent(/3\.?000,00/);
    expect(panel).toHaveTextContent("Ingresos esperados, incluidos pendientes");
    expect(panel).toHaveTextContent("Gasto confirmado");
    expect(panel).toHaveTextContent("Recurrentes pendientes");
    expect(panel).toHaveTextContent("No equivale al saldo");
    expect(panel).toHaveTextContent(/considera cuándo se cobra o paga.*gastos variables futuros/);
  });

  it("descuenta el objetivo previsto sin anunciar dinero segregado y lo oculta en privacidad", () => {
    const plan = {
      ...planningPayload,
      goal: {...planningPayload.goal, active: true, percentage: 20, target: 600},
      margin: {expected_income: 3000, confirmed_expense: 0, pending_recurring: 0, savings_goal: 600, available: 2400},
      metrics: {...planningPayload.metrics, total_balance: 0, expected_income: 3000, savings_goal: 600, safe_to_spend: 2400},
    };
    const view = render(<PlanningResults planning={plan} />);
    const panel = screen.getByText("Margen mensual previsto").closest(".planning-margin-panel")!;
    expect(panel).toHaveTextContent(/Descuenta 600,00.*del objetivo de ahorro previsto/);
    expect(panel).not.toHaveTextContent("reservados");
    setPrivacyMode(true);
    try {
      view.rerender(<PlanningResults planning={plan} />);
      expect(panel).not.toHaveTextContent(/(?:600|2400|2\.400|3000|3\.000),00/);
      expect(panel).toHaveTextContent("•••• €");
    } finally {
      setPrivacyMode(false);
    }
  });

  it("abre un único detalle diario dentro del calendario y conserva sus estados", async () => {
    apiMock.calendar.mockResolvedValue(calendarPayload);
    render(<PlanningView />);
    expect(await screen.findByRole("heading", {name: "Calendario financiero"})).toBeInTheDocument();
    expect(screen.getByText("julio de 2026", {selector: ".planning-calendar-heading strong"})).toBeInTheDocument();
    expect(document.querySelector(".planning-calendar-day-amounts .income")).toHaveTextContent(/^\+/);
    expect(document.querySelector(".planning-calendar-day-amounts .expense")).toHaveTextContent(/^−/);
    const day = screen.getByRole("button", {name: /abrir detalle del .*1 de julio/i});
    expect(day).toHaveAttribute("aria-expanded", "false");
    day.focus();
    fireEvent.click(day);
    expect(day).toHaveAttribute("aria-expanded", "true");
    expect(day).toHaveFocus();
    expect(screen.getByRole("heading", {name: /detalle del 1 de julio/i})).toBeInTheDocument();
    expect(screen.getByText("Confirmado", {selector: ".planning-calendar-item-state"})).toBeInTheDocument();
    expect(screen.getByText("Previsto", {selector: ".planning-calendar-item-state"})).toBeInTheDocument();
    const close = screen.getByRole("button", {name: "Cerrar detalle"});
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(day).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("heading", {name: /detalle del 1 de julio/i})).not.toBeInTheDocument());
  });

  it("mantiene el error de carga y el reintento", async () => {
    apiMock.planning.mockRejectedValueOnce(new Error("Plan no disponible"));
    render(<PlanningView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Plan no disponible");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    expect(await screen.findByRole("heading", {name: "Plan"})).toBeInTheDocument();
    expect(apiMock.planning).toHaveBeenCalledTimes(2);
  });

  it("sincroniza el mes de la ruta activa sin perder el foco del selector", async () => {
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-07");
    const {rerender} = render(<PlanningView routeKey={window.location.href} />);
    await screen.findByRole("heading", {name: "Plan"});
    const month = screen.getByLabelText("Mes del plan");
    await waitFor(() => expect(apiMock.planning.mock.calls.some(([month]) => month === "2026-07")).toBe(true));
    month.focus();

    await act(async () => {
      window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-06");
      rerender(<PlanningView routeKey={window.location.href} />);
      await Promise.resolve();
    });
    await waitFor(() => expect(apiMock.planning.mock.calls.some(([month]) => month === "2026-06")).toBe(true));
    expect(month).toHaveValue("2026-06");
    expect(month).toHaveFocus();
  });

  it("convierte el CTA en una elección breve y mueve el foco al formulario", async () => {
    const {rerender} = render(<PlanningView openComposerToken={0} />);
    await screen.findByRole("heading", {name: "Plan"});
    rerender(<PlanningView openComposerToken={1} />);
    const choice = await screen.findByRole("button", {name: "Presupuesto"});
    await waitFor(() => expect(choice).toHaveFocus());
    fireEvent.click(choice);
    await waitFor(() => expect(screen.getByLabelText("Mes", {selector: 'input[type="month"]'})).toHaveFocus());
  });

  it("bloquea el doble envío y conserva el borrador mientras guarda", async () => {
    let finish: (() => void) | undefined;
    apiMock.planning.mockResolvedValueOnce(planningPayload).mockResolvedValueOnce(planningWithBudget(planningPayload, 11, 300));
    apiMock.createBudget.mockReturnValueOnce(new Promise((resolve) => {
      finish = () => resolve({ok: true, budget: {id: 11, month: "2026-07", category, limit: 300}});
    }));
    await choosePlanningComposer("Presupuesto");
    fireEvent.change(await screen.findByLabelText("Límite"), {target: {value: "300"}});
    fireEvent.change(screen.getByLabelText("Categoría"), {target: {value: "2"}});
    const save = screen.getByRole("button", {name: "Guardar presupuesto"});
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    expect(apiMock.createBudget).toHaveBeenCalledOnce();
    const saving = screen.getByRole("button", {name: "Guardando…"});
    expect(saving).toHaveAttribute("aria-disabled", "true");
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(saving).not.toBeDisabled();
    expect(saving).toHaveFocus();
    fireEvent.click(saving);
    expect(apiMock.createBudget).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Límite")).toHaveValue(300);
    expect(finish).toBeDefined();
    await act(async () => {finish?.(); await Promise.resolve();});
    expect(await screen.findByText("Presupuesto guardado.")).toBeInTheDocument();
    expect(document.getElementById("planning-budget-11")).toHaveTextContent("Comida");
    expect(apiMock.planning.mock.calls.map(([month]) => month)).toEqual(["2026-07", "2026-07"]);
    await waitFor(() => expect(document.getElementById("planning-budget-11")).toHaveFocus());
  }, 10_000);

  it("enfoca el primer campo con error devuelto al guardar un presupuesto", async () => {
    apiMock.createBudget.mockRejectedValueOnce(new ApiError("Corrige el límite.", 400, {limit: ["El límite debe ser mayor que cero."]}));
    await choosePlanningComposer("Presupuesto");
    const limit = await screen.findByLabelText("Límite");
    fireEvent.change(limit, {target: {value: "300"}});
    fireEvent.change(screen.getByLabelText("Categoría"), {target: {value: "2"}});
    const save = screen.getByRole("button", {name: "Guardar presupuesto"});
    save.focus();
    fireEvent.click(save);

    expect(await screen.findByText("El límite debe ser mayor que cero.")).toBeInTheDocument();
    expect(limit).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(limit).toHaveFocus());
    expect(limit).toHaveValue(300);
    expect(save).not.toBeDisabled();
  });

  it("bloquea el doble envío recurrente y conserva el borrador mientras guarda", async () => {
    let finish: (() => void) | undefined;
    apiMock.planning.mockResolvedValueOnce(planningPayload).mockResolvedValueOnce(planningWithRecurringRule(planningPayload));
    apiMock.createRecurringRule.mockReturnValueOnce(new Promise((resolve) => {
      finish = () => resolve({ok: true, rule: createdRecurringRule});
    }));
    await choosePlanningComposer("Recurrente");

    const save = screen.getByRole("button", {name: "Guardar recurrente"});
    const form = save.closest("form");
    expect(form).not.toBeNull();
    const recurringForm = form as HTMLFormElement;
    for (const name of ["name", "amount", "day_of_month", "start_date", "end_date"]) {
      expect(recurringForm.querySelector(`[name="${name}"]`)).toHaveClass("ui-input");
    }
    expect(recurringForm.querySelector('[name="notes"]')).toHaveClass("ui-textarea");
    for (const name of ["kind", "account", "category", "frequency"]) {
      expect(recurringForm.querySelector(`select[name="${name}"]`)).toHaveClass("ui-select");
    }
    expect(save).toHaveClass(/ui-button--primary/);
    fireEvent.change(within(recurringForm).getByLabelText("Nombre"), {target: {value: "Internet mensual"}});
    fireEvent.change(within(recurringForm).getByLabelText("Importe"), {target: {value: "42"}});
    fireEvent.change(within(recurringForm).getByLabelText("Cuenta"), {target: {value: "1"}});
    fireEvent.change(within(recurringForm).getByLabelText("Categoría"), {target: {value: "2"}});

    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    expect(apiMock.createRecurringRule).toHaveBeenCalledOnce();
    const saving = screen.getByRole("button", {name: "Guardando…"});
    expect(saving).toHaveAttribute("aria-disabled", "true");
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(saving).not.toBeDisabled();
    expect(saving).toHaveFocus();
    fireEvent.click(saving);
    expect(apiMock.createRecurringRule).toHaveBeenCalledOnce();
    expect(within(recurringForm).getByLabelText("Nombre")).toHaveValue("Internet mensual");
    expect(within(recurringForm).getByLabelText("Importe")).toHaveValue(42);

    expect(finish).toBeDefined();
    await act(async () => {finish?.(); await Promise.resolve();});
    expect(await screen.findByText("Recurrente guardado.")).toBeInTheDocument();
    expect(document.getElementById("planning-recurring-12")).toHaveTextContent("Servicio de vídeo");
    expect(apiMock.createRecurringRule).toHaveBeenCalledWith(expect.objectContaining({name: "Internet mensual", amount: "42", account: "1", category: "2"}));
    expect(apiMock.planning.mock.calls.map(([month]) => month)).toEqual(["2026-07", "2026-07"]);
    await waitFor(() => expect(document.getElementById("planning-recurring-12")).toHaveFocus());
  }, 10_000);

  it("retiene foco y mueve el toggle de recurrente entre grupos", async () => {
    let finishPause: (() => void) | undefined;
    const activeRule: RecurringRule = {
      id: 12,
      name: "Internet mensual",
      kind: "expense",
      amount: 42,
      account,
      category,
      frequency: "monthly",
      frequency_display: "Mensual",
      day_of_month: 8,
      start_date: "2026-07-08",
      end_date: "",
      notes: "",
      active: true,
      lifecycle: "active",
      affects_selected_month: true,
    };
    const activePlan = {...planningPayload, rules: [activeRule]};
    const pausedPlan = {...planningPayload, rules: [{...activeRule, active: false, lifecycle: "paused" as const}]};
    apiMock.planning
      .mockResolvedValueOnce(activePlan)
      .mockResolvedValueOnce(pausedPlan)
      .mockResolvedValueOnce(activePlan);
    apiMock.setRecurringRuleActive.mockReturnValueOnce(new Promise((resolve) => {
      finishPause = () => resolve({ok: true, rule: pausedPlan.rules[0]});
    }));

    render(<PlanningView />);
    const pause = await screen.findByRole("button", {name: "Pausar"});
    pause.focus();
    fireEvent.click(pause);
    await waitFor(() => expect(apiMock.setRecurringRuleActive).toHaveBeenCalledWith(12, false));

    const pending = screen.getByRole("button", {name: "Actualizando recurrente…"});
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    fireEvent.click(pending);
    expect(apiMock.setRecurringRuleActive).toHaveBeenCalledOnce();

    finishPause?.();
    expect(await screen.findByRole("status")).toHaveTextContent("Recurrente pausado.");
    const reactivate = await screen.findByRole("button", {name: "Reactivar"});
    await waitFor(() => expect(reactivate).toHaveFocus());

    fireEvent.click(reactivate);
    await waitFor(() => expect(apiMock.setRecurringRuleActive).toHaveBeenLastCalledWith(12, true));
    expect(await screen.findByRole("status")).toHaveTextContent("Recurrente reactivado.");
    const pauseAgain = screen.getByRole("button", {name: "Pausar"});
    await waitFor(() => expect(pauseAgain).toHaveFocus());
  });

  it("muestra la proyección y convierte candidatos mediante acciones React", async () => {
    const navigateToSettings = vi.fn();
    apiMock.planning.mockResolvedValueOnce({
      ...planningPayload,
      projection: {
        as_of: "2026-07-16",
        sufficient: true,
        actual_expense: 420,
        projected_expense: 780,
        projected_savings: 220,
        expense_median: 760,
        delta_vs_median: 20,
        normalized_income: 1000,
        normalized_savings: 220,
        normalized_savings_rate: 22,
        expense_expected_to_date: 390,
        expense_delta_vs_pace: 30,
        method: "Previsión combinada: historial de gasto variable y ritmo confirmado hasta hoy.",
        category_watchlist: [],
      },
      subscription_candidates: [videoCandidate],
    }).mockResolvedValueOnce(planningWithRecurringRule(planningPayload));
    apiMock.createRecurringRule.mockResolvedValueOnce({ok: true, rule: createdRecurringRule});

    render(<PlanningView navigateToSettings={navigateToSettings} />);
    expect(await screen.findByText("Previsión combinada: historial de gasto variable y ritmo confirmado hasta hoy.")).toBeInTheDocument();
    expect(screen.getByText("Servicio de vídeo")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reglas automáticas (opcional)"));
    const createCategoryButton = screen.getByRole("button", {name: "Crear regla en Clasificación"});
    createCategoryButton.focus();
    fireEvent.click(createCategoryButton);
    expect(navigateToSettings).toHaveBeenCalledWith(new URLSearchParams([["settings_section", "classification"], ["focus", "new-rule"]]));
    expect(consumeCategoryRuleDraftHandoff()).toEqual(videoCandidate.category_rule_input);
    expect(apiMock.createCategoryRuleFromCandidate).not.toHaveBeenCalled();

    const createRecurringButton = screen.getByRole("button", {name: "Automatizar como recurrente"});
    createRecurringButton.focus();
    fireEvent.click(createRecurringButton);
    await waitFor(() => expect(apiMock.createRecurringRule).toHaveBeenCalledWith(videoCandidate.recurring_rule_input));
    expect(await screen.findByRole("status")).toHaveTextContent("Recurrente creado para Servicio de vídeo.");
    expect(document.getElementById("planning-recurring-12")).toHaveTextContent("Servicio de vídeo");
    expect(apiMock.planning.mock.calls.map(([month]) => month)).toEqual(["2026-07", "2026-07"]);
  });

  it("acepta el patrón con fecha y coste opcional sin crear una regla", async () => {
    const acceptedCandidate = {
      ...videoCandidate,
      review_status: "accepted" as const,
      reviewed_status: "accepted" as const,
      confirmed_annual_cost: 168,
      monthly_periodicity_confirmed: true,
      next_review_date: "2027-01-15",
      reviewed_at: "2026-10-23T12:00:00+02:00",
    };
    apiMock.planning.mockResolvedValueOnce({...planningPayload, subscription_candidates: [videoCandidate]})
      .mockResolvedValueOnce({...planningPayload, subscription_candidates: [acceptedCandidate]});

    render(<PlanningView />);
    fireEvent.click(await screen.findByText("Confirmar coste o periodicidad (opcional)"));
    fireEvent.change(await screen.findByLabelText("Próxima revisión"), {target: {value: "2027-01-15"}});
    fireEvent.change(screen.getByLabelText("Coste anual confirmado (opcional)"), {target: {value: "168"}});
    fireEvent.click(screen.getByLabelText("Confirmo periodicidad mensual"));
    fireEvent.click(screen.getByRole("button", {name: "Aceptar y revisar después"}));

    await waitFor(() => expect(apiMock.reviewSubscription).toHaveBeenCalledWith({
      account_id: account.id,
      normalized_description: videoCandidate.normalized_description,
      evidence_signature: videoCandidate.evidence_signature,
      expected_revision: videoCandidate.review_revision,
      action: "accept",
      next_review_date: "2027-01-15",
      monthly_periodicity_confirmed: true,
      confirmed_annual_cost: "168",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Seguimiento guardado para Servicio de vídeo.");
    fireEvent.click(screen.getByText("Decisiones guardadas (1)"));
    expect(screen.getByText(/En seguimiento hasta 2027-01-15/)).toBeInTheDocument();
    expect(screen.getByText(/Coste anual confirmado: 168,00 €/)).toBeInTheDocument();
    expect(apiMock.createRecurringRule).not.toHaveBeenCalled();
  });

  it("reabre y descarta una decisión cuando los movimientos cambian materialmente", async () => {
    const reopenedCandidate = {
      ...videoCandidate,
      review_status: "pending" as const,
      reviewed_status: "accepted" as const,
      review_revision: 1,
      review_reason: "material_change" as const,
      next_review_date: "2026-12-08",
      confirmed_annual_cost: 144,
      monthly_periodicity_confirmed: true,
      latest_amount: 850,
      latest_month_median: 850,
    };
    const dismissedCandidate = {
      ...reopenedCandidate,
      review_status: "dismissed" as const,
      reviewed_status: "dismissed" as const,
      review_revision: 2,
      review_reason: "" as const,
      next_review_date: null,
      confirmed_annual_cost: null,
      monthly_periodicity_confirmed: false,
    };
    apiMock.planning.mockResolvedValueOnce({...planningPayload, subscription_candidates: [reopenedCandidate]})
      .mockResolvedValueOnce({...planningPayload, subscription_candidates: [dismissedCandidate]});

    render(<PlanningView />);
    await screen.findByText("Servicio de vídeo", {selector: ".planning-candidate strong"});
    const card = screen.getByText("Servicio de vídeo", {selector: ".planning-candidate strong"}).closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("Los movimientos cambiaron materialmente desde la última revisión.")).toBeInTheDocument();
    fireEvent.click(within(card as HTMLElement).getByRole("button", {name: "Descartar sugerencia"}));

    await waitFor(() => expect(apiMock.reviewSubscription).toHaveBeenCalledWith({
      account_id: account.id,
      normalized_description: videoCandidate.normalized_description,
      evidence_signature: videoCandidate.evidence_signature,
      expected_revision: 1,
      action: "dismiss",
      next_review_date: null,
      monthly_periodicity_confirmed: false,
      confirmed_annual_cost: null,
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sugerencia descartada para Servicio de vídeo.");
    await waitFor(() => expect(document.querySelector(".planning-candidate")).toBeNull());
    fireEvent.click(screen.getByText("Decisiones guardadas (1)"));
    const reviewed = document.querySelector(".planning-candidate-reviewed");
    expect(reviewed).not.toBeNull();
    expect(reviewed!).toHaveTextContent("Descartada mientras no haya un cambio material");
    expect(reviewed!).toHaveTextContent("Descartada");
  });

  it("no aplica el margen tardío del mes anterior después de cambiar de periodo", async () => {
    const septemberPlan: PlanningPayload = {
      ...planningPayload,
      period: {...planningPayload.period, month: "2026-09", start: "2026-09-01", end: "2026-09-30", status: "past", partial: false},
      metrics: {...planningPayload.metrics, start: "2026-09-01", end: "2026-09-30"},
      goal: {...planningPayload.goal, configured: true},
      margin: {...planningPayload.margin, available: 9876.54},
    };
    const augustPlan: PlanningPayload = {
      ...planningPayload,
      period: {...planningPayload.period, month: "2026-08", start: "2026-08-01", end: "2026-08-31", status: "past", partial: false},
      metrics: {...planningPayload.metrics, start: "2026-08-01", end: "2026-08-31"},
      goal: {configured: true, active: true, percentage: 25, minimum: 0, target: 25},
      margin: {...planningPayload.margin, available: 1234.56},
    };
    const augustCalendar: PlanningCalendarPayload = {...calendarPayload, month: "2026-08", period: augustPlan.period, days: []};
    const oldSeptemberRead = deferred<PlanningPayload>();
    let markOldRefreshStarted!: () => void;
    const oldRefreshStarted = new Promise<void>((resolve) => {markOldRefreshStarted = resolve;});
    apiMock.planning.mockImplementation((month, options) => {
      if (month === "2026-09" && (options as RequestInit | undefined)?.cache === "reload") {
        markOldRefreshStarted();
        return oldSeptemberRead.promise;
      }
      return Promise.resolve(month === "2026-08" ? augustPlan : septemberPlan);
    });
    apiMock.calendar.mockImplementation(async (month) => month === "2026-08" ? augustCalendar : null);
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-09");

    render(<PlanningView />);
    await screen.findByLabelText("Mes del plan");
    fireEvent.click(screen.getByRole("button", {name: "Expandir objetivo de ahorro"}));
    fireEvent.change(screen.getByLabelText("Porcentaje"), {target: {value: "25"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar objetivo"}));
    await oldRefreshStarted;

    fireEvent.change(screen.getByLabelText("Mes del plan"), {target: {value: "2026-08"}});
    await waitFor(() => expect(apiMock.planning.mock.calls.some(([month]) => month === "2026-08")).toBe(true));
    await waitFor(() => expect(document.querySelector('.planning-view[aria-busy="false"]')).not.toBeNull());
    expect(document.querySelector(".planning-margin-lead strong")).toHaveTextContent("1234,56");
    expect(document.querySelector(".planning-calendar-heading strong")).toHaveTextContent("agosto de 2026");
    await act(async () => {oldSeptemberRead.resolve(septemberPlan);});

    expect(await screen.findByRole("status")).toHaveTextContent("Objetivo guardado y margen actualizado.");
    expect(screen.getByLabelText("Mes del plan")).toHaveValue("2026-08");
    expect(document.querySelector(".planning-margin-lead strong")).toHaveTextContent("1234,56");
    expect(screen.getByText("Periodo cerrado")).toBeInTheDocument();
  });

  it("descarta el GET mensual que comenzó antes de guardar el objetivo", async () => {
    const staleAugustPlan: PlanningPayload = {
      ...planningPayload,
      period: {...planningPayload.period, month: "2026-08", start: "2026-08-01", end: "2026-08-31", status: "past", partial: false},
      metrics: {...planningPayload.metrics, start: "2026-08-01", end: "2026-08-31"},
      goal: {...planningPayload.goal, configured: true},
      margin: {...planningPayload.margin, available: 9876.54},
    };
    const updatedAugustPlan: PlanningPayload = {
      ...staleAugustPlan,
      goal: {configured: true, active: true, percentage: 25, minimum: 0, target: 25},
      margin: {...staleAugustPlan.margin, available: 1234.56},
    };
    const augustCalendar: PlanningCalendarPayload = {...calendarPayload, month: "2026-08", period: updatedAugustPlan.period, days: []};
    const oldAugustRead = deferred<PlanningPayload>();
    let markOldReadStarted!: () => void;
    const oldReadStarted = new Promise<void>((resolve) => {markOldReadStarted = resolve;});
    apiMock.planning.mockImplementation((month, options) => {
      if (month === "2026-08" && (options as RequestInit | undefined)?.cache !== "reload") {
        markOldReadStarted();
        return oldAugustRead.promise;
      }
      return Promise.resolve(month === "2026-08" ? updatedAugustPlan : planningPayload);
    });
    apiMock.calendar.mockImplementation(async (month) => month === "2026-08" ? augustCalendar : null);
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-07");

    render(<PlanningView />);
    await screen.findByLabelText("Mes del plan");
    fireEvent.change(screen.getByLabelText("Mes del plan"), {target: {value: "2026-08"}});
    await oldReadStarted;
    fireEvent.click(screen.getByRole("button", {name: "Expandir objetivo de ahorro"}));
    fireEvent.change(screen.getByLabelText("Porcentaje"), {target: {value: "25"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar objetivo"}));

    expect(await screen.findByRole("status")).toHaveTextContent("Objetivo guardado y margen actualizado.");
    expect(document.querySelector(".planning-margin-lead strong")).toHaveTextContent("1234,56");
    await act(async () => {oldAugustRead.resolve(staleAugustPlan);});
    await waitFor(() => expect(document.querySelector('.planning-view[aria-busy="false"]')).not.toBeNull());
    expect(screen.getByLabelText("Mes del plan")).toHaveValue("2026-08");
    expect(document.querySelector(".planning-margin-lead strong")).toHaveTextContent("1234,56");
    expect(document.querySelector(".planning-calendar-heading strong")).toHaveTextContent("agosto de 2026");
    expect(document.querySelector(".planning-savings-goal")).toHaveTextContent(/Activo.*25\s*%/);
  });

  it("mantiene el retry del margen si una carga posterior falla al omitir dos previsiones", async () => {
    const rule = (id: number, name: string) => ({
      id, name, kind: "expense" as const, amount: 50, account, category, frequency: "monthly" as const,
      frequency_display: "Mensual", day_of_month: 12, start_date: "2026-09-08", end_date: "", notes: "",
      active: true, lifecycle: "active" as const, affects_selected_month: true,
    });
    const firstOccurrence: PlanningPayload["occurrences"][number] = {
      id: 9031, amount: 125, due_date: "2026-09-15", status: "pending", status_display: "Pendiente", rule: rule(77, "Suscripción A"),
    };
    const secondOccurrence: PlanningPayload["occurrences"][number] = {
      id: 9032, amount: 85, due_date: "2026-09-20", status: "pending", status_display: "Pendiente", rule: rule(78, "Suscripción B"),
    };
    const initialPlan: PlanningPayload = {
      ...planningPayload,
      period: {...planningPayload.period, month: "2026-09", start: "2026-09-01", end: "2026-09-30", status: "past", partial: false},
      metrics: {...planningPayload.metrics, start: "2026-09-01", end: "2026-09-30"},
      occurrences: [firstOccurrence, secondOccurrence],
    };
    const afterFirstSkip: PlanningPayload = {...initialPlan, occurrences: [secondOccurrence]};
    const oldMarginRead = deferred<PlanningPayload>();
    const oldRevalidation = deferred<PlanningPayload>();
    let markMarginReadStarted!: () => void;
    let markRevalidationStarted!: () => void;
    const marginReadStarted = new Promise<void>((resolve) => {markMarginReadStarted = resolve;});
    const revalidationStarted = new Promise<void>((resolve) => {markRevalidationStarted = resolve;});
    let reads = 0;
    apiMock.planning.mockImplementation(() => {
      reads += 1;
      if (reads === 1) return Promise.resolve(initialPlan);
      if (reads === 2) {
        markMarginReadStarted();
        return oldMarginRead.promise;
      }
      if (reads === 3) return Promise.resolve(afterFirstSkip);
      if (reads === 4) {
        markRevalidationStarted();
        return oldRevalidation.promise;
      }
      return Promise.reject(new Error("Carga del plan tras omitir B fallida."));
    });
    apiMock.updateSavingsGoal.mockResolvedValue({ok: true, goal: {id: null, percentage: 25, minimum: 0, active: true, updated_at: "2026-09-08T00:00:00Z"}});
    apiMock.occurrenceAction.mockResolvedValue({ok: true, message: "Previsión omitida."});
    window.history.replaceState({}, "", "/?tab=planning&plan_month=2026-09");

    try {
      render(<PlanningView />);
      await screen.findByRole("button", {name: "Expandir objetivo de ahorro"});
      fireEvent.click(screen.getByRole("button", {name: "Expandir objetivo de ahorro"}));
      fireEvent.change(screen.getByLabelText("Porcentaje"), {target: {value: "25"}});
      fireEvent.click(screen.getByRole("button", {name: "Guardar objetivo"}));
      await marginReadStarted;

      const occurrencePanel = document.querySelector("#planning-occurrences");
      expect(occurrencePanel).not.toBeNull();
      fireEvent.click(within(occurrencePanel as HTMLElement).getAllByRole("button", {name: /^Omitir$/})[0]);
      const firstDialog = screen.getByRole("dialog", {name: /Suscripción A/});
      fireEvent.click(within(firstDialog).getByRole("button", {name: /^Omitir previsión$/}));
      expect(await screen.findByText("Previsión omitida.")).toBeInTheDocument();
      expect(screen.queryByText("Suscripción A")).not.toBeInTheDocument();
      expect(screen.getByText("Suscripción B")).toBeInTheDocument();

      await act(async () => {oldMarginRead.reject(new Error("GET de margen obsoleto no disponible."));});
      await revalidationStarted;
      const secondDialogButton = within(occurrencePanel as HTMLElement).getByRole("button", {name: /^Omitir$/});
      fireEvent.click(secondDialogButton);
      const secondDialog = screen.getByRole("dialog", {name: /Suscripción B/});
      fireEvent.click(within(secondDialog).getByRole("button", {name: /^Omitir previsión$/}));
      expect(await screen.findByRole("alert")).toHaveTextContent("Carga del plan tras omitir B fallida.");
      expect(screen.getByText("Suscripción B")).toBeInTheDocument();

      await act(async () => {oldRevalidation.reject(new Error("Revalidación anterior fallida."));});
      expect(await screen.findByRole("button", {name: "Reintentar actualización del margen"})).toBeVisible();
      expect(screen.getByLabelText("Porcentaje")).toBeDisabled();
      expect(screen.queryByText("Objetivo guardado y margen actualizado.", {exact: true})).not.toBeInTheDocument();
      expect(apiMock.updateSavingsGoal).toHaveBeenCalledOnce();
      expect(apiMock.occurrenceAction).toHaveBeenCalledTimes(2);
      expect(apiMock.occurrenceAction).toHaveBeenNthCalledWith(1, 9031, "skip");
      expect(apiMock.occurrenceAction).toHaveBeenNthCalledWith(2, 9032, "skip");
    } finally {
      oldMarginRead.reject(new Error("Release pending margin read"));
      oldRevalidation.reject(new Error("Release pending revalidation"));
    }
  });

  it("revalida el mes seleccionado si el POST termina después de cambiar el periodo", async () => {
    const acceptedCandidate = {
      ...videoCandidate,
      review_status: "accepted" as const,
      reviewed_status: "accepted" as const,
      review_revision: 1,
      next_review_date: "2027-01-15",
    };
    const junePlan = {
      ...planningPayload,
      period: {...planningPayload.period, month: "2026-06", start: "2026-06-01", end: "2026-06-30", as_of: "2026-06-15"},
      subscription_candidates: [videoCandidate],
    };
    const reviewedJunePlan = {...junePlan, subscription_candidates: [acceptedCandidate]};
    apiMock.planning.mockImplementation(async (month, options) => {
      if (month === "2026-06" && (options as RequestInit | undefined)?.cache === "reload") return reviewedJunePlan;
      return month === "2026-06" ? junePlan : {...planningPayload, subscription_candidates: [videoCandidate]};
    });
    let finishReview!: () => void;
    apiMock.reviewSubscription.mockReturnValueOnce(new Promise((resolve) => {
      finishReview = () => resolve({ok: true, idempotent: false});
    }));

    render(<PlanningView />);
    fireEvent.click(await screen.findByRole("button", {name: "Aceptar y revisar después"}));
    await waitFor(() => expect(apiMock.reviewSubscription).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Mes del plan"), {target: {value: "2026-06"}});
    await waitFor(() => expect(apiMock.planning.mock.calls.some(([month]) => month === "2026-06")).toBe(true));

    await act(async () => {
      finishReview();
      await Promise.resolve();
    });

    await waitFor(() => expect(apiMock.planning.mock.calls.some(([month, options]) => month === "2026-06" && (options as RequestInit | undefined)?.cache === "reload")).toBe(true));
    fireEvent.click(await screen.findByText("Decisiones guardadas (1)"));
    expect(screen.getByText(/En seguimiento hasta 2027-01-15/)).toBeInTheDocument();
  });

  it.each([
    {name: "descarta la respuesta antigua", status: 200, failDeleteLoad: false, failRevalidation: false},
    {name: "tolera el GET antiguo fallido", status: 404, failDeleteLoad: false, failRevalidation: false},
    {name: "revalida tras fallar la carga del borrado", status: 200, failDeleteLoad: true, failRevalidation: false},
    {name: "reintenta tras fallar la carga y su revalidación", status: 200, failDeleteLoad: true, failRevalidation: true},
  ])("protege el margen ante una respuesta antigua cuando $name", async ({status, failDeleteLoad, failRevalidation}) => {
    const beforeDelete = planningWithBudget(planningPayload, 42, 300);
    const retainedCategory = {...category, id: 3, name: "Transporte", display_name: "Transporte"};
    const retainedBudget = {id: 43, month: beforeDelete.period.month, category: retainedCategory, limit: 100};
    beforeDelete.budgets.push(retainedBudget);
    beforeDelete.budget_progress.push({id: 43, category: retainedCategory, limit: 100, spent: 0, remaining: 100, percent: 0, actual_percent: 0, projected_percent: 0, pace: "normal"});
    const afterDelete: PlanningPayload = {
      ...beforeDelete,
      goal: {configured: true, active: true, percentage: 25, minimum: 0, target: 25},
      budgets: beforeDelete.budgets.filter(({id}) => id !== 42),
      budget_progress: beforeDelete.budget_progress.filter(({id}) => id !== 42),
      margin: {...beforeDelete.margin, available: 4321.09},
    };
    const staleMargin: PlanningPayload = {
      ...beforeDelete,
      goal: afterDelete.goal,
      margin: {...beforeDelete.margin, available: 1234.56},
    };
    let finishOldRead!: (plan: PlanningPayload) => void;
    let failOldRead!: (error: Error) => void;
    let markOldReadStarted!: () => void;
    const oldReadStarted = new Promise<void>((resolve) => {markOldReadStarted = resolve;});
    const oldRead = new Promise<PlanningPayload>((resolve, reject) => {
      finishOldRead = resolve;
      failOldRead = reject;
    });
    let reads = 0;
    apiMock.planning.mockImplementation(() => {
      reads += 1;
      if (reads === 1) return Promise.resolve(beforeDelete);
      if (reads === 2) {
        markOldReadStarted();
        return oldRead;
      }
      if (reads === 3 && failDeleteLoad) return Promise.reject(new Error("No se pudo revalidar el plan."));
      if (reads === 4 && failRevalidation) return Promise.reject(new Error("No se pudo revalidar el plan."));
      return Promise.resolve(afterDelete);
    });
    apiMock.deleteBudget.mockResolvedValue({ok: true, message: "Presupuesto eliminado."});

    try {
      render(<PlanningView />);
      await screen.findByRole("button", {name: "Eliminar presupuesto Comida"});
      fireEvent.click(screen.getByRole("button", {name: "Expandir objetivo de ahorro"}));
      fireEvent.change(screen.getByLabelText("Porcentaje"), {target: {value: "25"}});
      fireEvent.click(screen.getByRole("button", {name: "Guardar objetivo"}));
      await waitFor(() => expect(apiMock.updateSavingsGoal).toHaveBeenCalledOnce());
      await oldReadStarted;

      fireEvent.click(screen.getByRole("button", {name: "Eliminar presupuesto Comida"}));
      const dialog = screen.getByRole("dialog", {name: /Eliminar el presupuesto de Comida/});
      fireEvent.click(within(dialog).getByRole("button", {name: /^Eliminar presupuesto$/}));
      await waitFor(() => expect(apiMock.deleteBudget).toHaveBeenCalledWith(42));
      await waitFor(() => expect(reads).toBe(3));
      if (!failDeleteLoad) await screen.findByText("Presupuesto eliminado.");

      if (status === 200) finishOldRead(staleMargin);
      else failOldRead(new Error("GET de margen antiguo fallido."));

      if (failDeleteLoad && failRevalidation) {
        const retryMargin = await screen.findByRole("button", {name: "Reintentar actualización del margen"});
        fireEvent.click(retryMargin);
        await waitFor(() => expect(reads).toBe(5));
      }
      await screen.findByText("Objetivo guardado y margen actualizado.");
      expect(screen.getByRole("button", {name: "Eliminar presupuesto Transporte"})).toBeVisible();
      expect(screen.queryByRole("button", {name: "Eliminar presupuesto Comida"})).not.toBeInTheDocument();
      expect(document.querySelector("#planning-budget-42")).toBeNull();
      expect(document.querySelector(".planning-margin-lead strong")).toHaveTextContent(/4321,09/);
      expect(apiMock.updateSavingsGoal).toHaveBeenCalledOnce();
      expect(apiMock.deleteBudget).toHaveBeenCalledOnce();
    } finally {
      failOldRead(new Error("Release pending test read"));
    }
  });

  it("mantiene la revisión pendiente cuando ya existe una regla de clasificación", async () => {
    const candidateWithRule = {...videoCandidate, has_category_rule: true};
    apiMock.planning.mockResolvedValueOnce({...planningPayload, subscription_candidates: [candidateWithRule]});

    render(<PlanningView />);
    const candidate = (await screen.findByText("Servicio de vídeo")).closest("article");
    expect(candidate).not.toBeNull();
    expect(within(candidate as HTMLElement).getByRole("button", {name: "Aceptar y revisar después"})).toBeVisible();
    fireEvent.click(within(candidate as HTMLElement).getByText("Reglas automáticas (opcional)"));
    expect(within(candidate as HTMLElement).getByRole("button", {name: "Regla de clasificación activa"})).toHaveAttribute("aria-disabled", "true");
    expect(apiMock.reviewSubscription).not.toHaveBeenCalled();
  });

  it("genera IDs de formulario distintos para conceptos con signos normalizados diferentes", async () => {
    const dottedCandidate = {...videoCandidate, key: "1:servicio.a", normalized_description: "servicio.a", description: "Servicio.a"};
    const spacedCandidate = {...videoCandidate, key: "1:servicio a", normalized_description: "servicio a", description: "Servicio a"};
    apiMock.planning.mockResolvedValueOnce({...planningPayload, subscription_candidates: [dottedCandidate, spacedCandidate]});

    render(<PlanningView />);
    const dates = await screen.findAllByLabelText("Próxima revisión");

    expect(dates).toHaveLength(2);
    expect(new Set(dates.map((input) => input.id)).size).toBe(2);
    dates.forEach((input) => expect(input.closest("label")).toHaveAttribute("for", input.id));
  });

  it("mueve el foco al encabezado cuando desaparece la última sugerencia", async () => {
    const withCandidate = {...planningPayload, subscription_candidates: [videoCandidate]};
    let finishRecurring!: () => void;
    const refreshedPlan = planningWithRecurringRule(withCandidate);
    apiMock.planning.mockImplementation(async () => apiMock.createRecurringRule.mock.calls.length ? refreshedPlan : withCandidate);
    apiMock.createRecurringRule.mockReturnValueOnce(new Promise((resolve) => {
      finishRecurring = () => resolve({ok: true, rule: createdRecurringRule});
    }));
    render(<PlanningView />);

    fireEvent.click(await screen.findByText("Reglas automáticas (opcional)"));
    await screen.findByRole("button", {name: "Automatizar como recurrente"});
    const heading = screen.getByRole("heading", {name: "Suscripciones por revisar"});
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue({top: 10, bottom: 30, left: 0, right: 100, width: 100, height: 20, x: 0, y: 10, toJSON: () => ({})});
    const createButton = await screen.findByRole("button", {name: "Automatizar como recurrente"});
    createButton.focus();
    fireEvent.click(createButton);

    await waitFor(() => expect(apiMock.createRecurringRule).toHaveBeenCalledWith(videoCandidate.recurring_rule_input));
    await act(async () => {
      finishRecurring();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(apiMock.planning).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No hay sugerencias pendientes.")).toBeInTheDocument();
    expect(document.getElementById("planning-recurring-12")).toHaveTextContent("Servicio de vídeo");
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("conserva el feedback de una acción de Plan sin publicarlo cuando la pestaña está inactiva", async () => {
    const withCandidate = {...planningPayload, subscription_candidates: [videoCandidate]};
    const refreshedPlan = planningWithRecurringRule(withCandidate);
    apiMock.planning.mockImplementation(async () => apiMock.createRecurringRule.mock.calls.length ? refreshedPlan : withCandidate);
    let finishRecurring!: () => void;
    apiMock.createRecurringRule.mockReturnValueOnce(new Promise((resolve) => {
      finishRecurring = () => resolve({ok: true, rule: createdRecurringRule});
    }));

    const view = render(<PlanningView isActive />);
    fireEvent.click(await screen.findByText("Reglas automáticas (opcional)"));
    fireEvent.click(await screen.findByRole("button", {name: "Automatizar como recurrente"}));
    await waitFor(() => expect(apiMock.createRecurringRule).toHaveBeenCalledOnce());
    view.rerender(<PlanningView isActive={false} />);

    await act(async () => {
      finishRecurring();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(apiMock.planning).toHaveBeenCalledTimes(2));
    expect(document.body.querySelector(".planning-feedback")).toBeNull();

    view.rerender(<PlanningView isActive />);
    expect(await screen.findByRole("status")).toHaveTextContent("Recurrente creado para Servicio de vídeo.");
  });
});

describe("AccountsView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.bankConnectOptions.mockResolvedValue({
      ok: true,
      configured: true,
      country: "ES",
      banks: [{name: "Banco de pruebas", country: "ES"}],
    });
    apiMock.createAccount.mockResolvedValue({ok: true, account});
    window.history.replaceState({}, "", "/?tab=accounts");
  });

  it("conserva las cuentas, el aviso bancario y el directorio de conexión", async () => {
    const onOpenReview = vi.fn();
    const refresh = vi.fn(async () => undefined);
    window.history.replaceState({}, "", "/?tab=accounts&bank_notice=connected&bank_message=Conectada");

    render(
      <AccountsView
        accounts={[account]}
        connections={[]}
        bankingConfigured
        pendingBankReviewCount={2}
        onOpenReview={onOpenReview}
        refresh={refresh}
      />,
    );

    expect(screen.getByRole("heading", {name: "Cuentas"})).toBeInTheDocument();
    expect(screen.getByText("Cuenta diaria")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Conectada");
    expect(window.location.search).toBe("?tab=accounts");

    fireEvent.click(screen.getByRole("button", {name: "Revisar 2"}));
    expect(onOpenReview).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", {name: "Nueva banca"}));
    expect(await screen.findByRole("option", {name: "Banco de pruebas"})).toBeInTheDocument();
    expect(apiMock.bankConnectOptions).toHaveBeenCalledOnce();
  });

  it("muestra el error del directorio bancario y permite reintentar al reabrir", async () => {
    apiMock.bankConnectOptions.mockRejectedValueOnce(new Error("Directorio no disponible"));
    render(
      <AccountsView
        accounts={[account]}
        connections={[]}
        bankingConfigured
        pendingBankReviewCount={0}
        onOpenReview={() => undefined}
        refresh={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", {name: "Nueva banca"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Directorio no disponible");
    fireEvent.click(screen.getByRole("button", {name: "Comprimir"}));
    fireEvent.click(screen.getByRole("button", {name: "Nueva banca"}));
    expect(await screen.findByRole("option", {name: "Banco de pruebas"})).toBeInTheDocument();
    expect(apiMock.bankConnectOptions).toHaveBeenCalledTimes(2);
  });

  it("oculta saldos del registry con el contrato MoneyAmount", () => {
    render(
      <AccountsView
        accounts={[account]}
        connections={[]}
        bankingConfigured={false}
        pendingBankReviewCount={0}
        privateAmounts
        onOpenReview={() => undefined}
        refresh={async () => undefined}
      />,
    );

    expect(screen.getAllByLabelText("Importe oculto")).toHaveLength(2);
    expect(screen.queryByText(/1\.250,00/)).not.toBeInTheDocument();
  });

  it("mantiene el alta manual y refresca el bootstrap", async () => {
    const refresh = vi.fn(async () => undefined);
    render(
      <AccountsView
        accounts={[account]}
        connections={[]}
        bankingConfigured={false}
        pendingBankReviewCount={0}
        onOpenReview={() => undefined}
        refresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", {name: "Expandir nueva cuenta"}));
    fireEvent.change(await screen.findByLabelText("Nombre"), {target: {value: "Ahorro"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar cuenta"}));

    await waitFor(() => expect(apiMock.createAccount).toHaveBeenCalledWith(expect.objectContaining({name: "Ahorro"})));
    expect(await screen.findByRole("status")).toHaveTextContent("Cuenta creada.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explica la consecuencia antes de eliminar una cuenta", async () => {
    const refresh = vi.fn(async () => undefined);
    apiMock.deleteAccount.mockResolvedValue({ok: true});
    render(
      <AccountsView
        accounts={[account]}
        connections={[]}
        bankingConfigured={false}
        pendingBankReviewCount={0}
        onOpenReview={() => undefined}
        refresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", {name: "Acciones de Cuenta diaria"}));
    fireEvent.click(screen.getByRole("button", {name: /^Eliminar$/}));
    expect(screen.getByRole("dialog", {name: "¿Eliminar la cuenta “Cuenta diaria”?"})).toHaveTextContent("no se puede deshacer");
    expect(apiMock.deleteAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "Eliminar cuenta"}));

    await waitFor(() => expect(apiMock.deleteAccount).toHaveBeenCalledWith(account.id));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("AccountDetailView reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.accountDetail.mockResolvedValue(accountDetail);
    apiMock.saveReconciliation.mockResolvedValue({ok: true, snapshot: {
      id: 3,
      date: "2026-07-16",
      statement_balance: 1000,
      ledger_balance: 990,
      difference: 10,
      status: "difference",
      status_display: "Con diferencia",
      created_at: "2026-07-16T10:00:00+02:00",
    }});
  });

  it("muestra error de carga del detalle y permite reintentar", async () => {
    apiMock.accountDetail.mockRejectedValueOnce(new Error("Detalle no disponible"));
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Detalle no disponible");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    expect(await screen.findByRole("heading", {name: "Cuenta diaria"})).toBeInTheDocument();
    expect(apiMock.accountDetail).toHaveBeenCalledTimes(2);
  });

  it("comunica y permite reintentar un fallo de sincronización bancaria", async () => {
    const connection = {
      id: 5, bank_name: "Banco conectado", bank_country: "ES", status: "connected", status_display: "Conectado",
      sync_status: "error", sync_status_display: "Error", sync_started_at: "", sync_started_at_display: "",
      last_synced_at: "", last_synced_at_display: "", last_error: "", authorized_until: "", accounts: [account],
    };
    apiMock.accountDetail.mockResolvedValue({...accountDetail, connection});
    const onSync = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={onSync} />);
    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(document.querySelector(".account-detail-bank")).toHaveClass("needs-attention");

    fireEvent.click(screen.getByRole("button", {name: "Acciones de Cuenta diaria"}));
    fireEvent.click(screen.getByRole("button", {name: "Sincronizar"}));
    expect(await screen.findByText("No se pudo iniciar la sincronización. Inténtalo de nuevo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Reintentar sincronización"}));
    await waitFor(() => expect(onSync).toHaveBeenCalledTimes(2));
  });

  it("conserva el detalle, el borrador y el foco durante el refresco tras sincronizar", async () => {
    const connection = {
      id: 5, bank_name: "Banco conectado", bank_country: "ES", status: "connected", status_display: "Conectado",
      sync_status: "success", sync_status_display: "Sincronizado", sync_started_at: "", sync_started_at_display: "",
      last_synced_at: "", last_synced_at_display: "", last_error: "", authorized_until: "", accounts: [account],
    };
    const refresh = deferred<AccountDetail>();
    apiMock.accountDetail.mockResolvedValueOnce({...accountDetail, connection}).mockReturnValueOnce(refresh.promise);
    const {container} = render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);
    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(document.querySelector(".account-detail-bank")).not.toHaveClass("needs-attention");
    const balance = screen.getByLabelText("Saldo según el extracto");
    fireEvent.change(balance, {target: {value: "1000"}});

    const menuTrigger = screen.getByRole("button", {name: "Acciones de Cuenta diaria"});
    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole("button", {name: "Sincronizar"}));
    await waitFor(() => expect(apiMock.accountDetail).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("heading", {name: "Cuenta diaria"})).toBeInTheDocument();
    expect(screen.queryByText("Cargando detalle de cuenta…")).not.toBeInTheDocument();
    expect(container.querySelector(".account-detail")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Saldo según el extracto")).toHaveValue(1000);
    expect(menuTrigger).toHaveFocus();

    await act(async () => { refresh.resolve({...accountDetail, connection, account: {...account, balance: 1300}}); await Promise.resolve(); });
    await waitFor(() => expect(container.querySelector(".account-detail")).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByRole("heading", {name: "Cuenta diaria"})).toBeInTheDocument();
    expect(screen.getByLabelText("Saldo según el extracto")).toHaveValue(1000);
    expect(menuTrigger).toHaveFocus();
  });

  it("conserva los datos anteriores si falla el refresco del detalle", async () => {
    const connection = {
      id: 5, bank_name: "Banco conectado", bank_country: "ES", status: "connected", status_display: "Conectado",
      sync_status: "success", sync_status_display: "Sincronizado", sync_started_at: "", sync_started_at_display: "",
      last_synced_at: "", last_synced_at_display: "", last_error: "", authorized_until: "", accounts: [account],
    };
    apiMock.accountDetail.mockResolvedValueOnce({...accountDetail, connection}).mockRejectedValueOnce(new Error("Error de refresco"));
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);
    await screen.findByRole("heading", {name: "Cuenta diaria"});
    fireEvent.click(screen.getByRole("button", {name: "Acciones de Cuenta diaria"}));
    fireEvent.click(screen.getByRole("button", {name: "Sincronizar"}));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Error de refresco.*Se mantienen los datos anteriores/);
    expect(screen.getByRole("heading", {name: "Cuenta diaria"})).toBeInTheDocument();
    expect(screen.queryByText("Cargando detalle de cuenta…")).not.toBeInTheDocument();
  });

  it("oculta los cuatro importes del resumen de cuenta", async () => {
    render(<AccountDetailView accountId={account.id} privateAmounts onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.getAllByLabelText("Importe oculto")).toHaveLength(4);
  });

  it("separa el saldo informado por el banco de ledger y extracto, con tipo y dos fechas", async () => {
    const linkedAccount: Account = {
      ...account,
      bank_link: {
        id: 9,
        display_name: "Cuenta de ahorro",
        remote_balance: 54.3,
        remote_balance_type: "CLBD",
        remote_balance_currency: "EUR",
        remote_balance_reference_date: "2026-10-20",
        balance_updated_at: "2026-10-22T09:30:00+02:00",
        last_transaction_date: "2026-10-22",
        connection_id: 5,
      },
    };
    apiMock.accountDetail.mockResolvedValue({...accountDetail, account: linkedAccount});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.getByLabelText(/^Saldo informado por el banco:/)).toBeInTheDocument();
    expect(screen.getByText("Contable · cierre")).toBeInTheDocument();
    expect(screen.getByText("20/10/2026")).toBeInTheDocument();
    expect(screen.getByText(new Intl.DateTimeFormat("es-ES", {dateStyle: "short", timeStyle: "short"}).format(new Date("2026-10-22T09:30:00+02:00")))).toBeInTheDocument();
    expect(screen.getByText("Saldo actual")).toBeInTheDocument();
    expect(screen.getByText("Saldo según el extracto")).toBeInTheDocument();
  });

  it("oculta el saldo bancario informado en modo privado", async () => {
    const linkedAccount: Account = {
      ...account,
      bank_link: {
        id: 9,
        display_name: "Cuenta de ahorro",
        remote_balance: 54.3,
        remote_balance_type: "CLBD",
        remote_balance_currency: "EUR",
        remote_balance_reference_date: "2026-10-20",
        balance_updated_at: "2026-10-22T09:30:00+02:00",
        last_transaction_date: "2026-10-22",
        connection_id: 5,
      },
    };
    apiMock.accountDetail.mockResolvedValue({...accountDetail, account: linkedAccount});
    render(<AccountDetailView accountId={account.id} privateAmounts onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.getAllByLabelText("Importe oculto")).toHaveLength(5);
    expect(screen.queryByLabelText(/^Saldo informado por el banco:/)).not.toBeInTheDocument();
  });

  it("identifica el balance legacy como desconocido sin inventar un cero", async () => {
    const linkedAccount: Account = {
      ...account,
      bank_link: {
        id: 9,
        display_name: "Cuenta de ahorro",
        remote_balance: null,
        remote_balance_type: "",
        remote_balance_currency: "",
        remote_balance_reference_date: "",
        balance_updated_at: "",
        last_transaction_date: "",
        connection_id: 5,
      },
    };
    apiMock.accountDetail.mockResolvedValue({...accountDetail, account: linkedAccount});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.getByText("No disponible con procedencia verificable.")).toBeInTheDocument();
  });

  it("oculta un saldo cero legacy de la caché si carece de metadatos de procedencia", async () => {
    const linkedAccount: Account = {
      ...account,
      bank_link: {
        id: 9,
        display_name: "Cuenta de ahorro",
        remote_balance: 0,
        remote_balance_type: "",
        remote_balance_currency: "",
        remote_balance_reference_date: "",
        balance_updated_at: "",
        last_transaction_date: "",
        connection_id: 5,
      },
    };
    apiMock.accountDetail.mockResolvedValue({...accountDetail, account: linkedAccount});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.getByText("No disponible con procedencia verificable.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Saldo informado por el banco:/)).not.toBeInTheDocument();
  });

  it("mantiene visible un saldo bancario cero con procedencia verificada", async () => {
    const linkedAccount: Account = {
      ...account,
      bank_link: {
        id: 9,
        display_name: "Cuenta de ahorro",
        remote_balance: 0,
        remote_balance_type: "CLBD",
        remote_balance_currency: "EUR",
        remote_balance_reference_date: "2026-10-20",
        balance_updated_at: "2026-10-22T09:30:00+02:00",
        last_transaction_date: "2026-10-22",
        connection_id: 5,
      },
    };
    apiMock.accountDetail.mockResolvedValue({...accountDetail, account: linkedAccount});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.getByLabelText("Saldo informado por el banco: 0,00 €")).toBeInTheDocument();
  });

  it("reutiliza la fila ledger para movimientos recientes sin exponer acciones", async () => {
    apiMock.accountDetail.mockResolvedValue({...accountDetail, recent: [recentTransaction]});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    const row = document.querySelector(".ui-transaction-row");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("Compra reciente");
    expect(row).toHaveTextContent("Comida");
    expect(row).toHaveTextContent("Cuenta diaria");
    expect(row).not.toHaveTextContent("Acciones");
  });

  it("respeta el modo privado en los movimientos recientes reutilizados", async () => {
    apiMock.accountDetail.mockResolvedValue({...accountDetail, recent: [recentTransaction]});
    render(<AccountDetailView accountId={account.id} privateAmounts onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    const row = document.querySelector(".ui-transaction-row") as HTMLElement;
    expect(within(row).getByLabelText("Importe oculto")).toHaveTextContent("••••••");
    expect(screen.queryByText("-12,50 €")).not.toBeInTheDocument();
  });

  it("guarda una comprobación y comunica una diferencia sin prometer una conciliación", async () => {
    const onOpenTransactions = vi.fn();
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={onOpenTransactions} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    fireEvent.change(screen.getByLabelText("Fecha del extracto"), {target: {value: "2026-07-16"}});
    fireEvent.change(screen.getByLabelText("Saldo según el extracto"), {target: {value: "1000"}});
    fireEvent.click(screen.getByRole("button", {name: "Comprobar saldo"}));

    await waitFor(() => expect(apiMock.saveReconciliation).toHaveBeenCalledWith(account.id, {date: "2026-07-16", statement_balance: "1000"}));
    expect(await screen.findByText("Hay una diferencia pendiente de revisar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Revisar movimientos de esta cuenta"}));
    expect(onOpenTransactions).toHaveBeenCalledOnce();
  });

  it("enlaza pendientes y duplicados de la conciliación a sus colas", async () => {
    const onOpenReview = vi.fn();
    apiMock.accountDetail.mockResolvedValue({...accountDetail, latest_reconciliation: {
      id: 7,
      date: "2026-07-16",
      statement_balance: 1000,
      ledger_balance: 990,
      difference: 10,
      status: "difference",
      status_display: "Con diferencia",
      created_at: "2026-07-16T10:00:00+02:00",
      current_ledger_balance: 990,
      ledger_change: 0,
      stale: false,
      diagnosis: {pending_bank: 2, pending_imports: 3, possible_duplicates: 1},
    }});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onOpenReview={onOpenReview} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    fireEvent.click(screen.getByRole("button", {name: "Revisar movimientos bancarios pendientes (2)"}));
    fireEvent.click(screen.getByRole("button", {name: "Revisar importaciones pendientes (3)"}));
    fireEvent.click(screen.getByRole("button", {name: "Revisar posibles duplicados (1)"}));

    expect(onOpenReview.mock.calls.map(([search]) => search?.get("focus"))).toEqual(["bank-review", "csv-review", "review-attention"]);
  });

  it("no muestra accesos a colas vacías", async () => {
    apiMock.accountDetail.mockResolvedValue({...accountDetail, latest_reconciliation: {
      id: 8,
      date: "2026-07-16",
      statement_balance: 990,
      ledger_balance: 990,
      difference: 0,
      status: "reconciled",
      status_display: "Conciliada",
      created_at: "2026-07-16T10:00:00+02:00",
      current_ledger_balance: 990,
      ledger_change: 0,
      stale: false,
      diagnosis: {pending_bank: 0, pending_imports: 0, possible_duplicates: 0},
    }});
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    expect(screen.queryByRole("navigation", {name: "Colas relacionadas con la conciliación"})).not.toBeInTheDocument();
  });

  it("mantiene enfocado el botón de conciliar mientras guarda y conserva foco al terminar", async () => {
    let finishSave!: (value: {ok: true; snapshot: {id: number; date: string; statement_balance: number; ledger_balance: number; difference: number; status: string; status_display: string; created_at: string}}) => void;
    apiMock.saveReconciliation.mockImplementationOnce(() => new Promise((resolve) => {finishSave = resolve;}));
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);

    await screen.findByRole("heading", {name: "Cuenta diaria"});
    fireEvent.change(screen.getByLabelText("Fecha del extracto"), {target: {value: "2026-07-16"}});
    fireEvent.change(screen.getByLabelText("Saldo según el extracto"), {target: {value: "1000"}});
    const submit = screen.getByRole("button", {name: "Comprobar saldo"});
    submit.focus();
    fireEvent.click(submit);

    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveFocus();
    fireEvent.click(submit);
    expect(apiMock.saveReconciliation).toHaveBeenCalledOnce();

    finishSave({ok: true, snapshot: {id: 3, date: "2026-07-16", statement_balance: 1000, ledger_balance: 990, difference: 10, status: "difference", status_display: "Con diferencia", created_at: "2026-07-16T10:00:00+02:00"}});
    expect(await screen.findByText("Hay una diferencia pendiente de revisar.")).toBeInTheDocument();
    expect(submit).toHaveFocus();
  });

  it("conserva los datos del extracto y comunica un fallo al comprobar saldo", async () => {
    apiMock.saveReconciliation.mockRejectedValueOnce(new Error("No se pudo guardar la comprobación"));
    render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);
    await screen.findByRole("heading", {name: "Cuenta diaria"});
    fireEvent.change(screen.getByLabelText("Fecha del extracto"), {target: {value: "2026-07-16"}});
    fireEvent.change(screen.getByLabelText("Saldo según el extracto"), {target: {value: "1000"}});
    const submit = screen.getByRole("button", {name: "Comprobar saldo"});
    submit.focus();
    fireEvent.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la comprobación");
    expect(screen.getByLabelText("Saldo según el extracto")).toHaveValue(1000);
    expect(submit).toHaveFocus();
    fireEvent.click(screen.getByRole("button", {name: "Comprobar saldo"}));
    expect(await screen.findByText("Hay una diferencia pendiente de revisar.")).toBeInTheDocument();
    expect(submit).toHaveFocus();
  });

  it("reinicia formularios y feedback al cambiar de cuenta sin desmontar la vista", async () => {
    const secondAccount = {...account, id: 2, name: "Cuenta ahorro"};
    apiMock.accountDetail.mockImplementation(async (id: number) => id === 2 ? {...accountDetail, account: secondAccount} : accountDetail);
    const view = render(<AccountDetailView accountId={account.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);
    await screen.findByRole("heading", {name: "Cuenta diaria"});
    fireEvent.change(screen.getByLabelText("Saldo según el extracto"), {target: {value: "1000"}});
    view.rerender(<AccountDetailView accountId={secondAccount.id} onBack={() => undefined} onEdit={() => undefined} onOpenTransactions={() => undefined} onSync={async () => undefined} />);
    await screen.findByRole("heading", {name: "Cuenta ahorro"});
    expect(screen.getByLabelText("Saldo según el extracto")).toHaveValue(null);
  });
});
