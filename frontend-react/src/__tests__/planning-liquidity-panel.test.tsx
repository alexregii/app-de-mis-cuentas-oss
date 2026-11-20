import {fireEvent, render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {todayInputValue} from "../format";
import {PlanningLiquidityPanel} from "../features/planning/PlanningLiquidityPanel";
import type {Account} from "../shared/model/accounts";
import type {LiquidityAccountForecast, LiquidityCashflow, LiquidityDailyPoint, LiquidityForecast} from "../shared/model/planning";

const apiMock = vi.hoisted(() => ({liquidity: vi.fn()}));
vi.mock("../features/planning/api", () => ({planningApi: apiMock}));

const today = todayInputValue();
const tomorrow = new Date(`${today}T00:00:00Z`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const nextDay = tomorrow.toISOString().slice(0, 10);

const account = {
  id: 2,
  name: "Cuenta diaria E2E",
  kind: "bank",
  kind_display: "Cuenta bancaria",
  balance: 0,
  opening_balance: 0,
  color: "#3478F6",
  active: true,
  bank_link: null,
} as Account;

const cashflow = (sourceId: number, date: string, description: string, amount: number, state: LiquidityCashflow["state"] = "confirmed"): LiquidityCashflow => ({
  date,
  account_id: account.id,
  kind: "expense",
  state,
  amount,
  signed_amount: -amount,
  description,
  origin: state === "confirmed" ? "manual" : "recurring",
  source_id: sourceId,
  transfer_group: "",
});

const dailyPoint = (date: string, opening: number, closing: number, cashflows: LiquidityCashflow[] = []): LiquidityDailyPoint => ({
  date,
  opening_balance: opening,
  closing_balance: closing,
  confirmed_net_cashflow: cashflows.filter((flow) => flow.state === "confirmed").reduce((sum, flow) => sum + flow.signed_amount, 0),
  forecast_net_cashflow: cashflows.filter((flow) => flow.state !== "confirmed").reduce((sum, flow) => sum + flow.signed_amount, 0),
  confirmed_income: 0,
  confirmed_expense: cashflows.filter((flow) => flow.state === "confirmed").reduce((sum, flow) => sum + flow.amount, 0),
  confirmed_transfer_net: 0,
  forecast_income: 0,
  forecast_expense: cashflows.filter((flow) => flow.state !== "confirmed").reduce((sum, flow) => sum + flow.amount, 0),
  forecast_transfer_net: 0,
  cashflows,
});

const forecastAccount = (overrides: Partial<LiquidityAccountForecast> = {}): LiquidityAccountForecast => ({
  account_id: account.id,
  name: account.name,
  status: "known",
  starting_balance: -20,
  provenance: {kind: "ledger", cut_date: today},
  unknown_reasons: [],
  starting_adjustments: [],
  minimum_balance: -20,
  minimum_date: today,
  first_deficit_date: today,
  daily_series: [dailyPoint(today, -20, -20)],
  ...overrides,
});

const forecast = (selected: LiquidityAccountForecast): LiquidityForecast => ({
  date_from: today,
  date_to: nextDay,
  currency: "EUR",
  status: selected.status,
  accounts: [selected],
  starting_balance: selected.starting_balance,
  daily_series: selected.daily_series,
  minimum_balance: selected.minimum_balance,
  minimum_date: selected.minimum_date,
  first_deficit_date: selected.first_deficit_date,
  assumptions: [],
});

const routeKey = `http://localhost/?tab=planning&liquidity_account=${account.id}&liquidity_from=${today}&liquidity_to=${nextDay}&liquidity_scenario=base`;

function renderForecast(selected: LiquidityAccountForecast) {
  apiMock.liquidity.mockResolvedValueOnce(forecast(selected));
  return render(<PlanningLiquidityPanel accounts={[account]} routeKey={routeKey} navigate={vi.fn()} />);
}

beforeEach(() => vi.clearAllMocks());

describe("PlanningLiquidityPanel", () => {
  it("explains a starting deficit with same-day charges", async () => {
    const charges = [cashflow(1, today, "Alquiler", 60), cashflow(2, today, "Factura", 20)];
    renderForecast(forecastAccount({daily_series: [dailyPoint(today, -20, -100, charges)]}));

    expect(await screen.findByText("El saldo ya estaba por debajo de cero al inicio del rango. Estos cargos lo reducen aún más.")).toBeInTheDocument();
    expect(document.querySelectorAll(".planning-liquidity-causes li")).toHaveLength(2);
  });

  it("does not invent a charge explanation when the starting deficit has no flows", async () => {
    renderForecast(forecastAccount());

    const cause = await screen.findByText("El saldo ya estaba por debajo de cero al inicio del rango.");
    expect(cause).toBeInTheDocument();
    expect(screen.queryByText(/No hay cargos previstos que expliquen/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".planning-liquidity-causes li")).toHaveLength(0);
  });

  it("keeps a later expense out of the cause list for an earlier deficit", async () => {
    const laterCharge = cashflow(3, nextDay, "Factura médica", 25, "forecast");
    renderForecast(forecastAccount({daily_series: [dailyPoint(today, -20, -20), dailyPoint(nextDay, -20, -45, [laterCharge])]}));

    expect(await screen.findByText("El saldo ya estaba por debajo de cero al inicio del rango.")).toBeInTheDocument();
    expect(document.querySelectorAll(".planning-liquidity-causes li")).toHaveLength(0);
    const rows = document.querySelectorAll(".planning-liquidity-table-wrap tbody tr");
    fireEvent.click(rows[1]?.querySelector("button") as HTMLButtonElement);
    expect(await screen.findByText("Factura médica")).toBeInTheDocument();
  });

  it("shows unknown coverage without displaying a fabricated balance", async () => {
    renderForecast(forecastAccount({
      status: "unknown",
      starting_balance: null,
      minimum_balance: null,
      minimum_date: null,
      first_deficit_date: null,
      unknown_reasons: ["no_verified_balance_cut"],
      daily_series: [],
    }));

    expect(await screen.findByText("Saldo desconocido; no se puede demostrar cobertura suficiente.")).toBeInTheDocument();
    expect(screen.getByText("No hay un saldo inicial verificable para esta cuenta.")).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
  });

  it("shows an error without a forecast and retries the server request", async () => {
    apiMock.liquidity.mockRejectedValueOnce(new Error("Fallo simulado de la previsión."))
      .mockResolvedValueOnce(forecast(forecastAccount()));
    render(<PlanningLiquidityPanel accounts={[account]} routeKey={routeKey} navigate={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Fallo simulado de la previsión.");
    expect(alert).toHaveTextContent("No se muestra una previsión guardada.");
    expect(screen.queryByText(/999[.,]999/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    expect(await screen.findByText(/Primer déficit:/)).toBeInTheDocument();
    expect(apiMock.liquidity).toHaveBeenCalledTimes(2);
  });
});
