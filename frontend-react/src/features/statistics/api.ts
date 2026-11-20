import {jsonBody, request} from "../../shared/api/client";
import type {MonthlyCloseRequest, MonthlyCloseState, MonthStatisticsPayload, StatisticsBasis, StatisticsPayload} from "./types";

export const statisticsApi = {
  statistics: (params: URLSearchParams) => request<StatisticsPayload>(`/api/statistics/?${params.toString()}`),
  monthStatistics: (detailUrl: string) => request<MonthStatisticsPayload>(detailUrl),
  monthlyClose: (month: string, basis: StatisticsBasis) => request<MonthlyCloseState>(`/api/monthly-closes/?${new URLSearchParams({month, basis}).toString()}`, {cache: "no-store"}),
  createMonthlyClose: (payload: MonthlyCloseRequest) => request<MonthlyCloseState>("/api/monthly-closes/", {method: "POST", body: jsonBody(payload)}),
};
