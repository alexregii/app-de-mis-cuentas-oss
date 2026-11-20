import type {LiquidityAccountForecast, LiquidityCashflow, LiquidityDailyPoint} from "../../shared/model/planning";

export type LiquidityScenario = "base" | "conservador";

const cents = (value: number) => Math.round(value * 100);
const euros = (value: number) => value / 100;
const isProjectedIncome = (flow: LiquidityCashflow) => flow.state !== "confirmed" && flow.kind === "income";

export function prepareLiquidityScenario(account: LiquidityAccountForecast, scenario: LiquidityScenario): LiquidityAccountForecast {
  if (scenario === "base" || account.status === "unknown") return account;

  const excludedStartingIncome = account.starting_adjustments
    .filter(isProjectedIncome)
    .reduce((total, flow) => total + cents(flow.signed_amount), 0);
  const startingBalance = account.starting_balance === null
    ? null
    : euros(cents(account.starting_balance) - excludedStartingIncome);
  let running = startingBalance;
  let minimumBalance = startingBalance;
  let minimumDate = startingBalance === null ? null : account.daily_series[0]?.date ?? null;
  let firstDeficitDate = startingBalance !== null && startingBalance < 0 ? minimumDate : null;

  const dailySeries: LiquidityDailyPoint[] = account.daily_series.map((day) => {
    const excludedIncome = day.cashflows
      .filter(isProjectedIncome)
      .reduce((total, flow) => total + cents(flow.signed_amount), 0);
    const cashflows = day.cashflows.filter((flow) => !isProjectedIncome(flow));
    const openingBalance = running;
    const confirmedNet = cents(day.confirmed_net_cashflow);
    const forecastNet = cents(day.forecast_net_cashflow) - excludedIncome;
    const closingBalance = running === null ? null : euros(cents(running) + confirmedNet + forecastNet);
    const next: LiquidityDailyPoint = {
      ...day,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      forecast_net_cashflow: euros(forecastNet),
      forecast_income: euros(cents(day.forecast_income) - excludedIncome),
      cashflows,
    };
    if (openingBalance !== null && (minimumBalance === null || openingBalance < minimumBalance)) {
      minimumBalance = openingBalance;
      minimumDate = day.date;
    }
    if (closingBalance !== null && (minimumBalance === null || closingBalance < minimumBalance)) {
      minimumBalance = closingBalance;
      minimumDate = day.date;
    }
    if (firstDeficitDate === null && ((openingBalance !== null && openingBalance < 0) || (closingBalance !== null && closingBalance < 0))) {
      firstDeficitDate = day.date;
    }
    running = closingBalance;
    return next;
  });

  return {
    ...account,
    starting_balance: startingBalance,
    starting_adjustments: account.starting_adjustments.filter((flow) => !isProjectedIncome(flow)),
    minimum_balance: minimumBalance,
    minimum_date: minimumDate,
    first_deficit_date: firstDeficitDate,
    daily_series: dailySeries,
  };
}

export function topLiquidityCauses(account: LiquidityAccountForecast): LiquidityCashflow[] {
  if (account.status !== "known") return [];
  const cutoff = account.first_deficit_date ?? account.minimum_date;
  if (!cutoff) return [];
  const events = [
    ...account.starting_adjustments,
    ...account.daily_series.filter((day) => day.date <= cutoff).flatMap((day) => day.cashflows),
  ];
  const seen = new Set<string>();
  return events
    .filter((flow) => flow.signed_amount < 0)
    .filter((flow) => {
      const key = `${flow.state}:${flow.source_id}:${flow.date}:${flow.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Math.abs(cents(right.signed_amount)) - Math.abs(cents(left.signed_amount)))
    .slice(0, 3);
}
