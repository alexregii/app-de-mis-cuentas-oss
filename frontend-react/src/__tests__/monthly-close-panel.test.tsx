import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {MonthlyClosePanel} from "../features/statistics/components/MonthlyClosePanel";
import type {MonthlyCloseState, MonthlyCloseVersion} from "../features/statistics/types";
import {setPrivacyMode} from "../shared/lib/privacy";

const apiMock = vi.hoisted(() => ({monthlyClose: vi.fn(), createMonthlyClose: vi.fn()}));
vi.mock("../features/statistics/api", () => ({statisticsApi: apiMock}));

const issue = {
  key: "csv:Cuenta:pending",
  type: "pending_csv",
  title: "Filas CSV pendientes: Cuenta",
  description: "Hay 1 fila CSV pendiente hasta el corte.",
  account_name: "Cuenta",
  details: {rows: [{source_id: 12, filename: "cargos.csv", row_number: 4, date: "2026-06-20", description: "Compra pendiente", amount: "5.00", kind: "expense", possible_duplicate: true}]},
};

const baseState = (): MonthlyCloseState => ({
  ok: true,
  preview: {
    month: "2026-06",
    cutoff: "2026-06-30",
    basis: "analytics",
    source_digest: "b".repeat(64),
    report: {
      scope: {month: "2026-06", date_from: "2026-06-01", date_to: "2026-06-30", cutoff: "2026-06-30", basis: "analytics", basis_label: "Categorías analíticas"},
      activity_status: "recorded",
      summary: {income: "2000.00", net_expense: "1100.00", refunds_applied: "100.00", analytical_result: "900.00", savings_rate: 45},
      daily_series: [{date: "2026-06-20", income: "0.00", net_expense: "5.00", refunds_applied: "0.00", analytical_result: "-5.00", source_movements_url: "/?tab=transactions&date_from=2026-06-20&date_to=2026-06-20"}],
      source_movements_url: "/?tab=transactions&date_from=2026-06-01&date_to=2026-06-30",
    },
    accounts: [{
      account_name: "Cuenta",
      account_kind: "checking",
      created_at: "2026-05-01T12:00:00Z",
      created_after_cutoff: false,
      ledger_balance_at_cut: "10.00",
      active_at_capture: true,
      issue_codes: [],
      reconciliation_history: [{date: "2026-06-30", statement_balance: "10.00", ledger_balance: "10.00", difference: "0.00", status: "reconciled"}],
      reconciliation: {date: "2026-06-30", statement_balance: "10.00", ledger_balance_at_reconciliation: "10.00", current_ledger_balance_at_cut: "10.00", difference: "0.00", status: "reconciled", stale: false},
      bank_source: null,
    }],
    issues: [issue],
  },
  versions: [],
});

const version = (overrides: Partial<MonthlyCloseVersion> = {}): MonthlyCloseVersion => ({
  month: "2026-06",
  basis: "analytics",
  version: 1,
  status_at_close: "clean",
  origin: "portable_archive",
  source_verification: "unknown",
  source_digest: "a".repeat(64),
  report: baseState().preview.report,
  accounts: baseState().preview.accounts,
  issues: [],
  declarations: [],
  correction_reason: "",
  created_at: "2026-07-01T12:00:00Z",
  ...overrides,
});

describe("MonthlyClosePanel", () => {
  beforeEach(() => {
    setPrivacyMode(false);
    apiMock.monthlyClose.mockReset().mockResolvedValue(baseState());
    apiMock.createMonthlyClose.mockReset().mockImplementation(async (payload) => ({
      ...baseState(),
      created: true,
      versions: [version({origin: "native", source_verification: "current", source_digest: payload.source_digest})],
    }));
  });

  it("uses the shared fallback for an invalid month label", () => {
    render(<MonthlyClosePanel month="not-a-month" basis="analytics" />);

    expect(screen.getByRole("heading", {name: "Cierre del mes · Periodo no disponible"})).toBeInTheDocument();
    expect(screen.getByText("Podrás cerrar este mes cuando haya terminado.")).toBeInTheDocument();
    expect(apiMock.monthlyClose).not.toHaveBeenCalled();
  });

  it("preserves the legacy label for canonical years below 0100", async () => {
    render(<MonthlyClosePanel month="0099-06" basis="analytics" />);

    expect(await screen.findByRole("heading", {name: "Cierre del mes · junio de 1999"})).toBeInTheDocument();
    fireEvent.change(await screen.findByRole("textbox", {name: /decisión y motivo/i}), {target: {value: "Revisado."}});
    fireEvent.click(screen.getByRole("button", {name: "Revisar y cerrar mes"}));
    expect(await screen.findByRole("dialog", {name: /Confirmar cierre · junio de 1999/})).toBeInTheDocument();
  });

  it("muestra evidencia y cantidades privadas, exige una razón y persiste el cierre con confirmación", async () => {
    render(<MonthlyClosePanel month="2026-06" basis="analytics" privateAmounts />);

    expect(await screen.findByRole("heading", {name: "Cierre del mes · junio de 2026"})).toBeInTheDocument();
    expect(await screen.findByText("Filas CSV pendientes: Cuenta")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ver evidencia de origen (1)"));
    const evidence = screen.getByText("Ver evidencia de origen (1)").closest("details");
    expect(within(evidence!).getByRole("listitem")).toHaveTextContent("cargos.csv · fila 4");
    expect(within(evidence!).getByRole("listitem")).toHaveTextContent("Compra pendiente");
    expect(evidence).toHaveTextContent("posible duplicado");
    expect(screen.queryByText("5,00 €")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Importe oculto").length).toBeGreaterThan(0);

    const closeButton = screen.getByRole("button", {name: "Revisar y cerrar mes"});
    expect(closeButton).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", {name: /decisión y motivo/i}), {target: {value: "Revisado contra el recibo."}});
    expect(closeButton).toBeEnabled();
    fireEvent.click(closeButton);
    const dialog = await screen.findByRole("dialog", {name: /Confirmar cierre/});
    expect(dialog).toHaveTextContent("1 incidencia quedará declarada");
    fireEvent.click(within(dialog).getByRole("button", {name: "Cerrar mes"}));

    await waitFor(() => expect(apiMock.createMonthlyClose).toHaveBeenCalledTimes(1));
    expect(apiMock.createMonthlyClose).toHaveBeenCalledWith(expect.objectContaining({
      month: "2026-06",
      basis: "analytics",
      source_digest: "b".repeat(64),
      declarations: {[issue.key]: "Revisado contra el recibo."},
      correction_reason: "",
      idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
    expect(await screen.findByText("Cierre guardado: versión 1.")).toHaveAttribute("role", "status");
    expect(document.querySelector(".monthly-close-verification")).toHaveTextContent("Fuentes actuales");
  });

  it("muestra que una importación es desconocida y exige motivo para versionar tras cambiar fuentes", async () => {
    const state = baseState();
    state.preview.issues = [];
    state.versions = [version({
      issues: [issue],
      declarations: [{issue_key: issue.key, reason: "Se revisó la fila importada."}],
    })];
    apiMock.monthlyClose.mockResolvedValue(state);
    const view = render(<MonthlyClosePanel month="2026-06" basis="analytics" />);

    await waitFor(() => expect(view.container.querySelector(".monthly-close-verification")).toHaveTextContent("Verificación desconocida"));
    expect(view.container.querySelector(".monthly-close-verification")).toHaveTextContent("importada de un archivo");
    fireEvent.click(screen.getByText(/Consultar historial/));
    expect(screen.getByText(/Ver informe y checklist de esta versión/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Ver informe y checklist de esta versión/));
    const historyVersion = screen.getByText(/Ver informe y checklist de esta versión/).closest("details")?.closest("li");
    expect(historyVersion).toHaveTextContent("Cuentas incluidas en la versión");
    expect(historyVersion).toHaveTextContent("Resultado");
    expect(historyVersion).toHaveTextContent("Se revisó la fila importada.");
    fireEvent.click(within(historyVersion!).getByText(/Ver evidencia de origen/));
    expect(historyVersion).toHaveTextContent("cargos.csv · fila 4");
    const newVersionButton = screen.getByRole("button", {name: "Crear nueva versión"});
    expect(newVersionButton).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", {name: /motivo de la nueva versión/i}), {target: {value: "Se corrigió el extracto del banco."}});
    expect(newVersionButton).toBeEnabled();
    fireEvent.click(newVersionButton);
    const dialog = await screen.findByRole("dialog", {name: /Guardar versión nueva/});
    fireEvent.click(within(dialog).getByRole("button", {name: "Guardar versión"}));

    await waitFor(() => expect(apiMock.createMonthlyClose).toHaveBeenCalledWith(expect.objectContaining({
      declarations: {},
      correction_reason: "Se corrigió el extracto del banco.",
    })));
  });

  it("no pide ni permite previsualizar el mes actual antes de que termine", () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    render(<MonthlyClosePanel month={currentMonth} basis="analytics" />);

    expect(screen.getByText("Podrás cerrar este mes cuando haya terminado.")).toBeInTheDocument();
    expect(apiMock.monthlyClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {name: "Revisar y cerrar mes"})).not.toBeInTheDocument();
  });

  it("no consulta el API si la ruta todavía no ha seleccionado un mes", () => {
    const view = render(<MonthlyClosePanel month="" basis="analytics" />);
    expect(view.container).toBeEmptyDOMElement();
    expect(apiMock.monthlyClose).not.toHaveBeenCalled();
  });

  it("no presenta como cifras probadas los ceros de una cobertura desconocida en preview ni en historia", async () => {
    const state = baseState();
    const unknownReport = {
      ...state.preview.report,
      activity_status: "unknown" as const,
      summary: {income: "0.00", net_expense: "0.00", refunds_applied: "0.00", analytical_result: "0.00", savings_rate: null},
      daily_series: [],
    };
    const coverageIssue = {
      key: "coverage:2026-06:analytics",
      type: "coverage_unknown",
      title: "Cobertura del mes desconocida",
      description: "No se puede demostrar cobertura completa.",
      details: {basis: "analytics", month: "2026-06"},
    };
    state.preview.report = unknownReport;
    state.preview.issues = [coverageIssue];
    state.versions = [version({
      report: unknownReport,
      issues: [coverageIssue],
      declarations: [{issue_key: coverageIssue.key, reason: "Se conserva como cobertura no acreditada."}],
    })];
    apiMock.monthlyClose.mockResolvedValue(state);
    const view = render(<MonthlyClosePanel month="2026-06" basis="analytics" />);

    await waitFor(() => expect(view.container.querySelector(".monthly-close-unknown")).toHaveTextContent("El gasto del mes es desconocido"));
    expect(view.container.querySelectorAll(".monthly-close-amounts")).toHaveLength(0);
    expect(view.container.querySelectorAll(".monthly-close-unknown")).toHaveLength(2);
    fireEvent.click(screen.getByText(/Consultar historial/));
    fireEvent.click(screen.getByText(/Ver informe y checklist de esta versión/));
    expect(view.container.querySelectorAll(".monthly-close-amounts")).toHaveLength(0);
    expect(view.container).not.toHaveTextContent("0,00 €");
  });

  it("ignora un POST viejo si el mes o la base cambian antes de responder", async () => {
    const forMonth = (month: string, digest: string): MonthlyCloseState => {
      const state = baseState();
      state.preview.month = month;
      state.preview.cutoff = `${month}-31`;
      state.preview.source_digest = digest.repeat(64);
      state.preview.report.scope.month = month;
      state.preview.report.scope.date_from = `${month}-01`;
      state.preview.report.scope.date_to = `${month}-31`;
      state.preview.report.scope.cutoff = `${month}-31`;
      return state;
    };
    let resolveOldPost!: (value: MonthlyCloseState) => void;
    apiMock.monthlyClose.mockImplementation((month: string) => Promise.resolve(forMonth(month, month === "2026-07" ? "c" : "b")));
    apiMock.createMonthlyClose.mockImplementation(() => new Promise((resolve) => {resolveOldPost = resolve;}));
    const view = render(<MonthlyClosePanel month="2026-06" basis="analytics" />);

    await screen.findByRole("heading", {name: "Cierre del mes · junio de 2026"});
    fireEvent.change(await screen.findByRole("textbox", {name: /decisión y motivo/i}), {target: {value: "Cierre junio revisado."}});
    fireEvent.click(screen.getByRole("button", {name: "Revisar y cerrar mes"}));
    const dialog = await screen.findByRole("dialog", {name: /Confirmar cierre/});
    fireEvent.click(within(dialog).getByRole("button", {name: "Cerrar mes"}));
    await waitFor(() => expect(apiMock.createMonthlyClose).toHaveBeenCalledTimes(1));

    view.rerender(<MonthlyClosePanel month="2026-07" basis="all" />);
    await waitFor(() => expect(view.container.querySelector(".monthly-close-source code")).toHaveAttribute("title", "c".repeat(64)));
    await act(async () => {
      resolveOldPost({...forMonth("2026-06", "b"), created: true, versions: [version({source_digest: "b".repeat(64)})]});
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", {name: "Cierre del mes · julio de 2026"})).toBeInTheDocument();
    expect(view.container.querySelector(".monthly-close-source code")).toHaveAttribute("title", "c".repeat(64));
    expect(screen.queryByText(/Cierre guardado/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
