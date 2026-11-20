import {describe, expect, it} from "vitest";
import type {LiquidityAccountForecast, LiquidityCashflow, LiquidityDailyPoint} from "../shared/model/planning";
import {prepareLiquidityScenario, topLiquidityCauses} from "../features/planning/liquidityScenario";

const flow = (sourceId: number, date: string, kind: LiquidityCashflow["kind"], state: LiquidityCashflow["state"], amount: number): LiquidityCashflow => ({
  source_id: sourceId,
  account_id: 1,
  date,
  kind,
  state,
  amount,
  signed_amount: kind === "expense" || kind === "transfer_out" ? -amount : amount,
  description: `Flujo ${sourceId}`,
  origin: state === "confirmed" ? "manual" : "recurring",
  transfer_group: "",
});

const day = (date: string, opening: number, confirmed: LiquidityCashflow[], forecast: LiquidityCashflow[]): LiquidityDailyPoint => ({
  date,
  opening_balance: opening,
  closing_balance: opening + confirmed.reduce((total, item) => total + item.signed_amount, 0) + forecast.reduce((total, item) => total + item.signed_amount, 0),
  confirmed_net_cashflow: confirmed.reduce((total, item) => total + item.signed_amount, 0),
  forecast_net_cashflow: forecast.reduce((total, item) => total + item.signed_amount, 0),
  confirmed_income: 0,
  confirmed_expense: 0,
  confirmed_transfer_net: 0,
  forecast_income: forecast.filter((item) => item.kind === "income").reduce((total, item) => total + item.amount, 0),
  forecast_expense: forecast.filter((item) => item.kind === "expense").reduce((total, item) => total + item.amount, 0),
  forecast_transfer_net: 0,
  cashflows: [...confirmed, ...forecast],
});

const knownAccount = (): LiquidityAccountForecast => {
  const rent = flow(3, "2026-10-24", "expense", "confirmed", 60);
  const salary = flow(4, "2026-10-23", "income", "forecast", 100);
  const dailyExpense = flow(5, "2026-10-23", "expense", "forecast", 30);
  return {
    account_id: 1,
    name: "Principal",
    status: "known",
    starting_balance: 130,
    provenance: {kind: "ledger", cut_date: "2026-10-22"},
    unknown_reasons: [],
    starting_adjustments: [
      flow(1, "2026-10-22", "income", "forecast_before_start", 50),
      flow(2, "2026-10-22", "expense", "forecast_before_start", 20),
    ],
    minimum_balance: 70,
    minimum_date: "2026-10-24",
    first_deficit_date: null,
    daily_series: [
      day("2026-10-23", 130, [], [salary, dailyExpense]),
      day("2026-10-24", 200, [rent], []),
    ],
  };
};

describe("liquidity forecast scenarios", () => {
  it("conservador removes projected income before and inside the range but keeps expenses", () => {
    const result = prepareLiquidityScenario(knownAccount(), "conservador");

    expect(result.starting_balance).toBe(80);
    expect(result.starting_adjustments.map(({source_id}) => source_id)).toEqual([2]);
    expect(result.daily_series[0]).toMatchObject({
      opening_balance: 80,
      forecast_income: 0,
      forecast_expense: 30,
      forecast_net_cashflow: -30,
      closing_balance: 50,
    });
    expect(result.first_deficit_date).toBe("2026-10-24");
    expect(result.minimum_balance).toBe(-10);
    expect(result.minimum_date).toBe("2026-10-24");
    expect(result.daily_series[0].cashflows.map(({source_id}) => source_id)).toEqual([5]);
    expect(topLiquidityCauses(result).map(({source_id}) => source_id)).toEqual([3, 5, 2]);
  });

  it("keeps the base scenario unchanged", () => {
    const account = knownAccount();
    expect(prepareLiquidityScenario(account, "base")).toBe(account);
  });

  it("does not turn unknown balances into numbers in the conservative scenario", () => {
    const account = {...knownAccount(), status: "unknown" as const, starting_balance: null, minimum_balance: null, first_deficit_date: null};
    const result = prepareLiquidityScenario(account, "conservador");
    expect(result.status).toBe("unknown");
    expect(result.starting_balance).toBeNull();
    expect(result.minimum_balance).toBeNull();
    expect(result.first_deficit_date).toBeNull();
  });
});
