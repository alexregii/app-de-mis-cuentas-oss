import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {StatisticsView} from "../features/statistics/StatisticsView";
import {StatisticsInsightsPanel} from "../features/statistics/components/StatisticsInsights";
import {todayInputValue} from "../format";
import type {MonthlyCloseState, MonthStatisticsPayload, StatisticsPayload, StatisticsPeriod} from "../features/statistics/types";
import {setPrivacyMode} from "../shared/lib/privacy";

const apiMock = vi.hoisted(() => ({
  statistics: vi.fn(),
  monthStatistics: vi.fn(),
  monthlyClose: vi.fn(),
  createMonthlyClose: vi.fn(),
}));

vi.mock("../features/statistics/api", () => ({statisticsApi: apiMock}));
vi.mock("../features/statistics/charts/FinanceLineChart", () => ({
  FinanceLineChart: ({title}: {title: string}) => <div data-testid="finance-chart">{title}</div>,
  ChartLegendInline: ({hasPartialPeriod}: {hasPartialPeriod?: boolean}) => <div>Ingresos · Gasto neto{hasPartialPeriod ? <span className="legend-chip partial">Mes parcial</span> : null}</div>,
}));
vi.mock("../features/statistics/charts/CategoryDonut", () => ({
  CategoryDonut: () => <div data-testid="category-donut" />,
}));

const summary = {
  income: 2_000,
  net_expense: 1_100,
  refunds_applied: 100,
  analytical_result: 900,
  savings_rate: 45,
};

const report = (period: StatisticsPeriod = "12", basis: "analytics" | "all" = "analytics"): StatisticsPayload => ({
  scope: {
    period,
    basis,
    basis_label: basis === "analytics" ? "Categorías analíticas" : "Todas las categorías",
    date_from: period === "custom" ? "2026-01-01" : "2025-08-01",
    date_to: "2026-07-13",
    label: period === "custom" ? "01/01/2026–13/07/2026" : `${period} meses hasta hoy`,
    is_partial: true,
  },
  summary,
  activity_status: "recorded",
  comparison: {
    scope: {date_from: "2024-08-19", date_to: "2025-07-31", label: "periodo anterior"},
    previous_activity_status: "recorded",
    is_comparable: true,
    previous: {...summary, income: 1_800, analytical_result: 700},
    changes: {
      income: {amount: 200, percentage: 11.1},
      net_expense: {amount: 0, percentage: 0},
      analytical_result: {amount: 200, percentage: 28.6},
      savings_rate: {percentage_points: 6.1},
    },
    category_drivers: [{
      family_id: 4,
      family_name: "Hogar",
      current_net_expense: 1_100,
      previous_net_expense: 900,
      change: 200,
      current_movements_url: "/?tab=transactions&date_from=2025-08-01&category_family=4",
      previous_movements_url: "/?tab=transactions&date_to=2025-07-31&category_family=4",
    }],
    category_variations: [{
      family_id: 4,
      family_name: "Hogar",
      current_net_expense: 1_100,
      previous_net_expense: 900,
      change: 200,
      percentage: 22.2,
      current_movements_url: "/?tab=transactions&date_from=2025-08-01&category_family=4",
      previous_movements_url: "/?tab=transactions&date_to=2025-07-31&category_family=4",
    }],
  },
  monthly_series: [{
    month: "2026-06",
    activity_status: "recorded",
    date_from: "2026-06-01",
    date_to: "2026-06-30",
    ...summary,
    is_partial: false,
    is_complete: true,
    detail_url: "/api/statistics/2026/6/?basis=analytics&date_from=2026-06-01&date_to=2026-06-30",
    movements_url: "/?tab=transactions&date_from=2026-06-01&date_to=2026-06-30",
  }],
  categories: [{
    family_id: 4,
    family_name: "Hogar",
    color: "#2563a8",
    gross_expense: 1_200,
    refunds_applied: 100,
    net_expense: 1_100,
    percentage: 100,
    movements_url: "/?tab=transactions&category_family=4",
    subcategories: [{
      category_id: 7,
      name: "Suministros",
      gross_expense: 1_200,
      refunds_applied: 100,
      net_expense: 1_100,
      percentage_of_family: 100,
      movements_url: "/?tab=transactions&category_family=4&category=7",
    }],
  }],
  coverage: {
    imports: {status: "pending", pending_count: 2, last_activity_at: "2026-07-13T09:30:00Z"},
    banking: {status: "not_configured", pending_count: 0, last_synced_at: null},
  },
  basis_reconciliation: {
    excluded_summary: {income: 0, net_expense: 85, analytical_result: -85},
    excluded_categories: [{
      family_id: 9,
      family_name: "Personal",
      net_expense: 85,
      movements_url: "/?tab=transactions&category_family=9",
    }],
  },
  analysis: {
    merchants: [{description: "Mercado", net_expense: 600, transaction_count: 4, last_date: "2026-07-10", active_months: 3, typical_monthly_expense: 200, percentage: 54.5, movements_url: "/?tab=transactions&description=Mercado"}],
    recurring: [{description: "Mercado", net_expense: 600, transaction_count: 4, last_date: "2026-07-10", active_months: 3, typical_monthly_expense: 200, percentage: 54.5, movements_url: "/?tab=transactions&description=Mercado"}],
    category_matrix: {
      months: [{month: "2026-05", is_partial: true, activity_status: "recorded"}, {month: "2026-06", is_partial: false, activity_status: "recorded"}],
      rows: [{family_id: 4, family_name: "Hogar", net_expense: 1_100, values: [
        {month: "2026-05", net_expense: 0, movements_url: "/?tab=transactions&category_family=4&month=5"},
        {month: "2026-06", net_expense: 1_100, movements_url: "/?tab=transactions&category_family=4"},
      ]}],
    },
  },
  data_quality: {
    uncategorized: {count: 1, net_expense: 20, movements_url: "/?tab=transactions&category_family=uncategorized"},
    transfers_excluded: {count: 2},
    possible_bank_transfers: {count: 1},
    basis,
  },
});

const monthReport: MonthStatisticsPayload = {
  scope: {
    selected_month: "2026-06",
    basis: "analytics",
    basis_label: "Categorías analíticas",
    date_from: "2026-06-01",
    date_to: "2026-06-30",
    label: "junio de 2026",
    is_partial: false,
  },
  activity_status: "recorded",
  summary,
  daily_series: [{date: "2026-06-03", ...summary}],
  categories: report().categories,
  movements_url: "/?tab=transactions&date_from=2026-06-01&date_to=2026-06-30",
  insights: {
    rhythm: {
      comparison_months: 6,
      points: [{
        date: "2026-06-03",
        income: 700,
        net_expense: 240,
        analytical_result: 460,
        median_income: 600,
        median_net_expense: 210,
        median_analytical_result: 390,
        movements_url: "/?tab=transactions&date_from=2026-06-03&date_to=2026-06-03&statistics_attribution=report",
      }],
    },
    spikes: {
      comparison_months: 6,
      available_sample_months: 6,
      minimum_sample_size: 3,
      items: [{
        family_id: 4,
        family_name: "Hogar",
        current_net_expense: 240,
        median_net_expense: 120,
        increase_percentage: 100,
        movements_url: "/?tab=transactions&date_from=2026-06-01&category_family=4",
      }],
    },
  },
};

const monthlyCloseReportState = (): MonthlyCloseState => ({
  ok: true,
  preview: {
    month: "2026-06",
    cutoff: "2026-06-30",
    basis: "analytics",
    source_digest: "a".repeat(64),
    report: {
      scope: {month: "2026-06", date_from: "2026-06-01", date_to: "2026-06-30", cutoff: "2026-06-30", basis: "analytics", basis_label: "Categorías analíticas"},
      activity_status: "recorded",
      summary: {income: "2000.00", net_expense: "1100.00", refunds_applied: "100.00", analytical_result: "900.00", savings_rate: 45},
      daily_series: [{date: "2026-06-03", income: "700.00", net_expense: "240.00", refunds_applied: "0.00", analytical_result: "460.00", source_movements_url: "/?tab=transactions&date_from=2026-06-03&date_to=2026-06-03"}],
      source_movements_url: "/?tab=transactions&date_from=2026-06-01&date_to=2026-06-30",
    },
    accounts: [],
    issues: [],
  },
  versions: [],
});

describe("StatisticsView", () => {
  beforeEach(() => {
    apiMock.statistics.mockReset();
    apiMock.monthStatistics.mockReset();
    apiMock.monthlyClose.mockReset();
    apiMock.createMonthlyClose.mockReset();
    Object.defineProperty(window, "scrollTo", {value: vi.fn(), writable: true});
    setPrivacyMode(false);
    Object.defineProperty(window.navigator, "onLine", {value: true, configurable: true});
    window.history.replaceState({}, "", "/?tab=statistics");
    apiMock.statistics.mockImplementation((params: URLSearchParams) => Promise.resolve(report(
      (params.get("period") || "12") as StatisticsPeriod,
      params.get("basis") === "all" ? "all" : "analytics",
    )));
    apiMock.monthStatistics.mockResolvedValue(monthReport);
    apiMock.monthlyClose.mockResolvedValue(monthlyCloseReportState());
    apiMock.createMonthlyClose.mockImplementation(async (payload) => ({
      ...monthlyCloseReportState(),
      created: true,
      versions: [{
        month: payload.month,
        basis: payload.basis,
        version: 1,
        status_at_close: "clean",
        origin: "native",
        source_verification: "current",
        source_digest: payload.source_digest,
        report: monthlyCloseReportState().preview.report,
        accounts: [],
        issues: [],
        declarations: [],
        correction_reason: "",
        created_at: "2026-07-01T12:00:00Z",
      }],
    }));
  });

  it("mantiene el foco del disparador al abrir y cerrar el disclosure de filtros", async () => {
    render(<StatisticsView />);
    await screen.findByRole("heading", {name: "Resultado del periodo"});

    const trigger = screen.getByRole("button", {name: "Cambiar informe"});
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveFocus();
    expect(document.getElementById("statistics-filters")).toBeInTheDocument();

    const close = screen.getByRole("button", {name: "Cerrar"});
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(document.getElementById("statistics-filters")).toBeNull());
  });

  it("restaura filtros y mes desde URL, y carga el detalle mediante su URL exacta", async () => {
    window.history.replaceState({}, "", "/?tab=statistics&period=6&basis=all&month=2026-06");
    render(<StatisticsView />);

    await screen.findByRole("heading", {name: /Detalle mensual/});
    expect(screen.queryByRole("table", {name: "Datos de evolución mensual"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: /Tabla mensual completa/}));
    expect(screen.getByRole("table", {name: "Datos de evolución mensual"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Resultado del periodo"})).toBeInTheDocument();
    expect(screen.getByText("Ingresos menos gasto neto")).toBeInTheDocument();
    expect(screen.getByText("Todas las categorías")).toBeInTheDocument();
    const summary = screen.getByRole("region", {name: "Resultado del periodo"});
    expect(summary).toHaveTextContent("sin equivaler al saldo por cuenta");
    expect(summary).toHaveTextContent("Se descuentan de la compra original");
    expect(screen.getByText("Análisis avanzado")).toBeInTheDocument();
    expect((screen.getByText("Análisis avanzado").closest("details") as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText(/Sube|Baja|Mejora|Empeora/)).not.toBeInTheDocument();
    expect(apiMock.statistics).toHaveBeenCalledWith(expect.objectContaining({}));
    const params = apiMock.statistics.mock.calls[0][0] as URLSearchParams;
    expect(Object.fromEntries(params)).toEqual({period: "6", basis: "all"});
    await waitFor(() => expect(apiMock.monthStatistics).toHaveBeenCalledWith(report("6", "all").monthly_series[0].detail_url));
    expect(await screen.findByRole("heading", {name: /Detalle mensual/})).toBeInTheDocument();
    expect(window.location.search).toContain("month=2026-06");
  });

  it("presents refund and partial-month evidence for a custom interval", async () => {
    const customReport = report("custom");
    customReport.scope = {...customReport.scope, date_from: "2026-06-01", date_to: "2026-06-20", label: "01/06/2026–20/06/2026", is_partial: true};
    customReport.summary = {...customReport.summary, net_expense: 1_120, refunds_applied: 30};
    customReport.monthly_series = [{
      ...customReport.monthly_series[0],
      date_from: "2026-06-01",
      date_to: "2026-06-20",
      net_expense: 1_120,
      refunds_applied: 30,
      is_partial: true,
      is_complete: false,
      detail_url: "/api/statistics/2026/6/?basis=analytics&date_from=2026-06-01&date_to=2026-06-20",
    }];
    const partialMonth: MonthStatisticsPayload = {
      ...monthReport,
      scope: {...monthReport.scope, date_to: "2026-06-20", is_partial: true},
      summary: {...monthReport.summary, net_expense: 1_120, refunds_applied: 30},
      daily_series: [{date: "2026-06-15", ...summary, net_expense: 1_120, refunds_applied: 30}],
    };
    apiMock.statistics.mockResolvedValueOnce(customReport);
    apiMock.monthStatistics.mockResolvedValueOnce(partialMonth);
    window.history.replaceState({}, "", "/?tab=statistics&period=custom&basis=analytics&date_from=2026-06-01&date_to=2026-06-20&month=2026-06");
    render(<StatisticsView />);

    await screen.findByRole("heading", {name: "Detalle mensual · junio de 2026"});
    expect(document.querySelector(".stats-refund-note")).toHaveTextContent("Reembolsos 30,00 €");
    expect(document.querySelector(".stats-month-summary")).toHaveTextContent("1120,00 €");
    expect(await screen.findByText("Mes parcial, limitado al periodo activo.")).toBeInTheDocument();
    expect(screen.getByText("Mes parcial", {selector: ".legend-chip.partial"})).toBeInTheDocument();
    const params = apiMock.statistics.mock.calls[0][0] as URLSearchParams;
    expect(Object.fromEntries(params)).toMatchObject({period: "custom", basis: "analytics", date_from: "2026-06-01", date_to: "2026-06-20"});
    await waitFor(() => expect(apiMock.monthStatistics).toHaveBeenCalledWith(customReport.monthly_series[0].detail_url));
  });

  it("edita un rango sin pedir por cada campo y solo lo aplica con el botón explícito", async () => {
    render(<StatisticsView />);
    await screen.findByRole("button", {name: "Cambiar informe"});
    expect(apiMock.statistics).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", {name: "Cambiar informe"}));
    fireEvent.click(screen.getByRole("button", {name: "Personalizado"}));
    fireEvent.change(screen.getByLabelText("Desde"), {target: {value: "2026-01-01"}});
    fireEvent.change(screen.getByLabelText("Hasta"), {target: {value: "2026-07-13"}});
    expect(apiMock.statistics).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", {name: "Aplicar rango"}));
    await waitFor(() => expect(apiMock.statistics).toHaveBeenCalledTimes(2));
    const params = apiMock.statistics.mock.calls[1][0] as URLSearchParams;
    expect(Object.fromEntries(params)).toEqual({period: "custom", basis: "analytics", date_from: "2026-01-01", date_to: "2026-07-13"});
    await waitFor(() => expect(window.location.search).toContain("period=custom"));
    expect(window.location.search).toContain("date_from=2026-01-01");
  });

  it("conserva el foco al aplicar un rango pendiente, evita repetir y retiene el informe si falla", async () => {
    let finishCustom!: (value: StatisticsPayload) => void;
    apiMock.statistics.mockImplementationOnce(() => Promise.resolve(report())).mockImplementationOnce(() => new Promise((resolve) => {finishCustom = resolve;}));
    render(<StatisticsView />);
    await screen.findByRole("button", {name: "Cambiar informe"});
    fireEvent.click(screen.getByRole("button", {name: "Cambiar informe"}));
    fireEvent.click(screen.getByRole("button", {name: "Personalizado"}));
    fireEvent.change(screen.getByLabelText("Desde"), {target: {value: "2026-01-01"}});
    fireEvent.change(screen.getByLabelText("Hasta"), {target: {value: "2026-07-13"}});
    const apply = screen.getByRole("button", {name: "Aplicar rango"});

    apply.focus();
    fireEvent.click(apply);
    await waitFor(() => expect(apiMock.statistics).toHaveBeenCalledTimes(2));
    expect(apply).toHaveAttribute("aria-disabled", "true");
    expect(apply).toHaveAttribute("aria-busy", "true");
    expect(apply).not.toBeDisabled();
    expect(apply).toHaveFocus();
    fireEvent.click(apply);
    expect(apiMock.statistics).toHaveBeenCalledTimes(2);

    await act(async () => {finishCustom(report("custom"));});
    await waitFor(() => expect(apply).toHaveFocus());
    expect(window.location.search).toContain("period=custom");

    apiMock.statistics.mockRejectedValueOnce(new Error("Informe personalizado no disponible."));
    fireEvent.click(apply);
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe personalizado no disponible.");
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-07-13");
    expect(screen.getByRole("heading", {name: "Resultado del periodo"})).toBeInTheDocument();
    expect(apply).toHaveFocus();
  });

  it("muestra los filtros aplicados y los restablece al informe estándar", async () => {
    window.history.replaceState({}, "", "/?tab=statistics&period=6&basis=all");
    render(<StatisticsView />);

    await screen.findByRole("heading", {name: "Resultado del periodo"});
    expect(await screen.findByText("2 filtros activos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Cambiar informe"}));
    fireEvent.click(screen.getByRole("button", {name: "Limpiar filtros"}));

    await waitFor(() => expect(apiMock.statistics).toHaveBeenCalledTimes(2));
    const params = apiMock.statistics.mock.calls[1][0] as URLSearchParams;
    expect(Object.fromEntries(params)).toEqual({period: "12", basis: "analytics"});
    await waitFor(() => expect(window.location.search).toContain("period=12"));
    expect(window.location.search).toContain("basis=analytics");
  });

  it("no carga detalle hasta elegir un mes y conserva enlaces semánticos exactos", async () => {
    render(<StatisticsView />);
    await screen.findByRole("heading", {name: "Resultado del periodo"});
    expect(apiMock.monthStatistics).not.toHaveBeenCalled();
    const monthSelector = await screen.findByLabelText("Mes para profundizar");
    const trendPanel = (await screen.findByRole("heading", {name: "Flujo neto mensual"})).closest("section");
    expect(trendPanel).toContainElement(monthSelector);
    expect(screen.queryByRole("heading", {name: "Explorar un mes"})).not.toBeInTheDocument();
    expect(trendPanel).toContainElement(screen.getByText("Tabla mensual completa"));
    expect(monthSelector).toHaveValue("");
    expect(screen.queryByRole("heading", {name: /Detalle mensual/})).not.toBeInTheDocument();

    fireEvent.change(monthSelector, {target: {value: "2026-06"}});
    await waitFor(() => expect(apiMock.monthStatistics).toHaveBeenCalledOnce());
    expect(await screen.findByRole("link", {name: "Ver movimientos de este intervalo"})).toHaveAttribute("href", monthReport.movements_url);
    expect(screen.queryByText("Mes seleccionado")).not.toBeInTheDocument();
    expect(document.querySelector(".stats-selected-month")).toBeNull();
    expect(screen.getByText("Días con actividad").closest("div")).toHaveTextContent("1");
    const detailPanel = screen.getByRole("heading", {name: /Detalle mensual/}).closest(".stats-month-detail-panel");
    expect(detailPanel?.querySelector("[data-testid=finance-chart]")).toBeNull();
    expect(screen.queryByRole("table", {name: "Datos diarios del mes seleccionado"})).not.toBeInTheDocument();
    expect(screen.queryByText("Últimos movimientos", {exact: false})).not.toBeInTheDocument();
    expect(screen.queryByText("Lecturas del mes", {exact: false})).not.toBeInTheDocument();
  });

  it("no inventa una serie ni una tabla cuando el mes no tiene actividad", async () => {
    const unknownReport = report();
    unknownReport.monthly_series[0] = {
      ...unknownReport.monthly_series[0],
      activity_status: "unknown",
      income: 0,
      net_expense: 0,
      refunds_applied: 0,
      analytical_result: 0,
      savings_rate: null,
    };
    apiMock.statistics.mockResolvedValueOnce(unknownReport);
    apiMock.monthStatistics.mockResolvedValueOnce({
      ...monthReport,
      activity_status: "unknown",
      summary: {income: 0, net_expense: 0, refunds_applied: 0, analytical_result: 0, savings_rate: null},
      daily_series: [{date: "2026-06-01", income: 0, net_expense: 0, refunds_applied: 0, analytical_result: 0, savings_rate: null}],
      categories: [],
    });
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    expect(await screen.findByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.", {}, {timeout: 3_000})).toBeInTheDocument();
    expect(screen.queryByRole("table", {name: "Datos diarios del mes seleccionado"})).not.toBeInTheDocument();
    const detailPanel = screen.getByRole("heading", {name: /Detalle mensual/}).closest(".stats-month-detail-panel");
    expect(detailPanel?.querySelector("[data-testid=finance-chart]")).toBeNull();
  });

  it("prioriza la cobertura desconocida del detalle frente a un overview cacheado como registrado", async () => {
    apiMock.monthStatistics.mockResolvedValueOnce({
      ...monthReport,
      activity_status: "unknown",
      summary: {income: 0, net_expense: 0, refunds_applied: 0, analytical_result: 0, savings_rate: null},
      daily_series: [{date: "2026-06-01", income: 0, net_expense: 0, refunds_applied: 0, analytical_result: 0, savings_rate: null}],
      categories: [],
    });
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    expect(await screen.findByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.")).toBeInTheDocument();
    const detailPanel = screen.getByRole("heading", {name: /Detalle mensual/}).closest(".stats-month-detail-panel");
    expect(detailPanel).not.toHaveTextContent("No hay actividad financiera en la parte seleccionada de este mes.");
    expect(detailPanel).not.toHaveTextContent("Días con actividad");
    expect(detailPanel).not.toHaveTextContent("Lecturas del mes");
  });

  it("usa la cobertura registrada del detalle cuando el overview cacheado marca el mes como desconocido", async () => {
    const cachedOverview = report();
    cachedOverview.monthly_series[0].activity_status = "unknown";
    apiMock.statistics.mockResolvedValueOnce(cachedOverview);
    apiMock.monthStatistics.mockResolvedValueOnce(monthReport);
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    const days = await screen.findByText("Días con actividad");
    expect(days.closest("div")).toHaveTextContent("1");
    expect(screen.queryByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.")).not.toBeInTheDocument();
  });

  it("falla cerrado ante un detalle cacheado pre-M11 sin estado de cobertura", async () => {
    const legacyMonthData = {...monthReport};
    delete (legacyMonthData as Partial<MonthStatisticsPayload>).activity_status;
    apiMock.monthStatistics.mockResolvedValueOnce(legacyMonthData);
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    expect(await screen.findByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.")).toBeInTheDocument();
    const detailPanel = screen.getByRole("heading", {name: /Detalle mensual/}).closest(".stats-month-detail-panel");
    expect(detailPanel).not.toHaveTextContent("No hay actividad financiera en la parte seleccionada de este mes.");
    expect(detailPanel).not.toHaveTextContent("Días con actividad");
    expect(detailPanel).not.toHaveTextContent("Lecturas del mes");
  });

  it("presenta como desconocido el mes vacío en resumen, tabla y matriz", async () => {
    const payload = report();
    payload.monthly_series = [
      {...payload.monthly_series[0], month: "2026-05", activity_status: "recorded"},
      {
        ...payload.monthly_series[0],
        activity_status: "unknown",
        income: 0,
        net_expense: 0,
        refunds_applied: 0,
        analytical_result: 0,
        savings_rate: null,
      },
    ];
    payload.comparison.is_comparable = false;
    payload.analysis!.category_matrix.months[1] = {month: "2026-06", is_partial: false, activity_status: "unknown"};
    apiMock.statistics.mockResolvedValueOnce(payload);
    apiMock.monthStatistics.mockResolvedValueOnce({...monthReport, activity_status: "unknown"});
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    expect(await screen.findByText("No hay actividad reportable para este mes. El gasto es desconocido, no cero demostrado.")).toBeInTheDocument();
    expect(screen.getByRole("status", {name: "Cobertura estadística"})).toHaveTextContent("1 mes no contiene actividad reportable");
    expect(screen.getByText("Comparación anterior no fiable: hay meses sin actividad reportable y cobertura no acreditada. El resultado del periodo no equivale al saldo por cuenta.")).toBeInTheDocument();
    const monthSummary = screen.getByRole("group", {name: "Resumen de junio de 2026"});
    expect(monthSummary).toHaveTextContent("El gasto es desconocido");
    expect(monthSummary).not.toHaveTextContent("0,00 €");

    fireEvent.click(screen.getByRole("button", {name: /Tabla mensual completa/}));
    const table = screen.getByRole("table", {name: "Datos de evolución mensual"});
    const unknownRow = within(table).getByRole("row", {name: /junio de 2026/});
    expect(unknownRow).toHaveTextContent("Cobertura no acreditada");
    expect(unknownRow).not.toHaveTextContent("0,00 €");

    fireEvent.click(screen.getByText("Análisis avanzado"));
    const matrix = screen.getByRole("table", {name: "Gasto neto de cada familia por mes"});
    expect(within(matrix).getByText("Gasto desconocido; cobertura no acreditada en junio de 2026")).toBeInTheDocument();
    expect(screen.getByText("Hay meses sin actividad reportable y cobertura no acreditada en uno de los periodos; no se puede demostrar la variación del gasto.")).toBeInTheDocument();
  });

  it("retira el detalle anterior mientras cambia la base del informe", async () => {
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);
    expect((await screen.findByText("Días con actividad")).closest("div")).toHaveTextContent("1");

    apiMock.statistics.mockReturnValueOnce(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", {name: "Cambiar informe"}));
    fireEvent.click(screen.getByRole("button", {name: "Todas las categorías"}));

    await waitFor(() => expect(apiMock.statistics).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("table", {name: "Datos diarios del mes seleccionado"})).not.toBeInTheDocument();
  });

  it("no duplica el estado offline que presenta el shell", async () => {
    render(<StatisticsView />);
    await screen.findByRole("heading", {name: "Resultado del periodo"});
    fireEvent(window, new Event("offline"));
    act(() => window.dispatchEvent(new CustomEvent("miscuentas:offline-cache", {detail: {path: "/api/statistics/?period=12", cachedAt: "2026-07-13T11:00:00.000Z"}})));
    await waitFor(() => expect(document.querySelectorAll(".stats-connectivity-status")).toHaveLength(0));
  });

  it("coloca la distribución junto al resumen y omite el estado del informe", async () => {
    render(<StatisticsView />);

    const trigger = await screen.findByRole("button", {name: "Cambiar informe"});
    const summaryPanel = screen.getByRole("heading", {name: "Resultado del periodo"}).closest("section");
    const categories = screen.getByRole("heading", {name: "Distribución por categorías principales"}).closest("section");
    const trend = screen.getByRole("heading", {name: "Flujo neto mensual"}).closest("section");
    expect(summaryPanel!.compareDocumentPosition(categories!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(categories!.compareDocumentPosition(trend!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("status", {name: "Estado del informe"})).not.toBeInTheDocument();
    expect(screen.queryByText("Cómo se construye este informe")).not.toBeInTheDocument();

    expect(trigger.closest("header")).toContainElement(screen.getByRole("heading", {name: "Estadísticas"}));
    fireEvent.click(trigger);
    const filters = screen.getByRole("heading", {name: "Cambiar periodo y base"}).closest(".stats-filter-panel");
    expect(filters!.compareDocumentPosition(summaryPanel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(filters!, {key: "Escape"});
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });

  it("pasa el modo privado al importe reutilizable del resumen", async () => {
    setPrivacyMode(true);
    render(<StatisticsView privateAmounts />);

    const summaryRegion = await screen.findByRole("region", {name: "Resultado del periodo"});
    expect(within(summaryRegion).getAllByLabelText("Importe oculto")).toHaveLength(6);
    expect(summaryRegion).not.toHaveTextContent("2.000,00 €");
    expect(summaryRegion).toHaveTextContent("•••• €");
  });

  it("reserva cambios, patrones y matriz para el análisis avanzado", async () => {
    render(<StatisticsView />);

    const advanced = await screen.findByText("Análisis avanzado");
    const details = advanced.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(advanced);
    expect(details.open).toBe(true);
    expect(screen.getByRole("heading", {name: "Qué cambió por categoría"})).toBeInTheDocument();
    expect(screen.getByText("Patrones observados")).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Revisar suscripciones en Plan"})).toHaveAttribute("href", "/?tab=planning");
    const matrix = screen.getByRole("table", {name: "Gasto neto de cada familia por mes"});
    expect(matrix).toBeInTheDocument();
    expect(within(matrix).getByRole("columnheader", {name: /mayo de 2026.*parcial/i})).toBeInTheDocument();
    expect(within(matrix).getByRole("link", {name: "1100,00 € · Ver movimientos de Hogar en junio de 2026"})).toHaveAttribute("href", "/?tab=transactions&category_family=4");
    expect(within(matrix).queryByRole("link", {name: /mayo de 2026/i})).not.toBeInTheDocument();
    expect(screen.queryByRole("region", {name: "Calidad del análisis"})).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", {name: "Ver movimientos de Mercado"}).some((link) => link.getAttribute("href") === "/?tab=transactions&description=Mercado")).toBe(true);
  });

  it("explica cuando el periodo no contiene gasto categorizado", async () => {
    apiMock.statistics.mockResolvedValueOnce({...report(), analysis: {...report().analysis, category_matrix: {months: [], rows: []}}});
    render(<StatisticsView />);

    const advanced = await screen.findByText("Análisis avanzado");
    fireEvent.click(advanced);
    expect(await screen.findByText("No hay gasto categorizado en este periodo.")).toBeInTheDocument();
    expect(screen.queryByRole("table", {name: "Gasto neto de cada familia por mes"})).not.toBeInTheDocument();
    expect(screen.queryByText("Menor intensidad")).not.toBeInTheDocument();
  });

  it("mantiene la tabla mensual como evidencia progresiva", async () => {
    render(<StatisticsView />);
    const disclosure = await screen.findByRole("button", {name: /Tabla mensual completa/});
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", {name: "Datos de evolución mensual"})).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table", {name: "Datos de evolución mensual"})).toBeInTheDocument();
  });

  it.each([7, 12])("conserva los %i meses y enlaces de la matriz en grupos legibles", async (monthCount) => {
    const payload = report();
    const months = Array.from({length: monthCount}, (_, index) => ({month: `2026-${String(index + 1).padStart(2, "0")}`, is_partial: index === monthCount - 1, activity_status: "recorded" as const}));
    payload.analysis!.category_matrix = {
      months,
      rows: payload.analysis!.category_matrix.rows.map(row => ({...row, values: months.map((month, index) => ({month: month.month, net_expense: (index + 1) * 100, movements_url: `/?tab=transactions&month=${month.month}`}))})),
    };
    apiMock.statistics.mockResolvedValueOnce(payload);
    render(<StatisticsView />);
    fireEvent.click(await screen.findByText("Análisis avanzado"));
    const region = screen.getByRole("region", {name: "Matriz de gasto por familia y mes"});
    const tables = within(region).getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(region.querySelectorAll("tbody td")).toHaveLength(monthCount);
    expect(within(region).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(months.map(month => `/?tab=transactions&month=${month.month}`));
    tables.forEach(table => expect(within(table).getAllByRole("columnheader").length).toBeLessThanOrEqual(7));
    region.querySelectorAll("td[headers]").forEach(cell => {
      cell.getAttribute("headers")!.split(" ").forEach(id => expect(document.getElementById(id)).toHaveAttribute("scope"));
    });
  });

  it("solo muestra el detalle diario cuando se selecciona un día de actividad", async () => {
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    expect(screen.queryByRole("table", {name: "Ritmo acumulado y medianas"})).not.toBeInTheDocument();
    expect(screen.queryByRole("img", {name: "Gráfico de ritmo acumulado del mes"})).not.toBeInTheDocument();
    const calendar = await screen.findByRole("group", {name: "Calendario de gasto neto diario"});
    expect(calendar).toBeInTheDocument();
    expect(screen.queryByText("Mediana de 6 meses comparables")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", {name: /Detalle diario/})).not.toBeInTheDocument();
    const day = within(calendar).getByRole("button", {name: /03 jun/});
    fireEvent.click(day);
    expect(day).toHaveAttribute("aria-pressed", "true");
    const dailyDetail = screen.getByRole("region", {name: "Detalle diario · 03 jun"});
    expect(dailyDetail).toHaveTextContent("Ingresos");
    expect(dailyDetail).toHaveTextContent("Gasto neto");
    expect(within(dailyDetail).getByRole("link", {name: "Ver movimientos de este día"})).toHaveAttribute("href", "/?tab=transactions&date_from=2026-06-03&date_to=2026-06-03&statistics_attribution=report");
    expect(screen.queryByText(/pronóstico|previsión|predecir/i)).not.toBeInTheDocument();
  });

  it("declara cuando la muestra no permite evaluar picos", async () => {
    apiMock.monthStatistics.mockResolvedValueOnce({
      ...monthReport,
      insights: {
        ...monthReport.insights,
        spikes: {comparison_months: 12, available_sample_months: 2, minimum_sample_size: 3, items: []},
      },
    });
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView />);

    expect(await screen.findByText("Muestra insuficiente para evaluar picos de gasto (2 de 3 meses necesarios).")).toBeInTheDocument();
  });

  it("prepara un presupuesto con categoría y mes, sin poner importes en la ruta", async () => {
    const navigate = vi.fn();
    window.history.replaceState({}, "", "/?tab=statistics&month=2026-06");
    render(<StatisticsView navigate={navigate} />);

    fireEvent.click(await screen.findByRole("button", {name: "Preparar presupuesto de Hogar"}));

    expect(navigate).toHaveBeenCalledTimes(1);
    const [tab, transition] = navigate.mock.calls[0];
    expect(tab).toBe("planning");
    expect(Object.fromEntries(transition.search || [])).toEqual({plan_month: "2026-06", budget_category: "4"});
  });

  it("passes the active current month when preparing a budget from a spike", () => {
    const currentMonth = todayInputValue().slice(0, 7);
    const onPrepareBudget = vi.fn();
    render(<StatisticsInsightsPanel
      insights={monthReport.insights!}
      dailySeries={monthReport.daily_series}
      selectedMonth={currentMonth}
      onPrepareBudget={onPrepareBudget}
    />);

    fireEvent.click(screen.getByRole("button", {name: "Preparar presupuesto de Hogar"}));
    expect(onPrepareBudget).toHaveBeenCalledWith(4, currentMonth);
  });

  it("no deja que una sección de estadísticas oculta reescriba la ruta activa", async () => {
    window.history.replaceState({}, "", "/?tab=dashboard");
    render(<StatisticsView isActive />);

    await screen.findByRole("heading", {name: "Resultado del periodo"});
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("tab")).toBe("dashboard"));
  });
});
