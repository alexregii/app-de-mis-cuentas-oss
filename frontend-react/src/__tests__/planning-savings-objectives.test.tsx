import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiError} from "../shared/api/client";
import type {PlanningPayload, SavingsObjective, SavingsObjectiveSummary} from "../shared/model/planning";
import {PlanningSavingsObjectives} from "../features/planning/PlanningSavingsObjectives";
import type {SavingsObjectiveMutation} from "../features/planning/api";

const apiMock = vi.hoisted(() => ({
  createSavingsObjective: vi.fn(),
  updateSavingsObjective: vi.fn(),
  updateSavingsObjectiveAllocation: vi.fn(),
}));
vi.mock("../features/planning/api", () => ({planningApi: apiMock}));

const objective: SavingsObjective = {
  id: 9,
  name: "Estudios",
  target_amount: 1200,
  target_date: "2027-06-01",
  priority: 1,
  assigned_amount: 250,
  remaining_amount: 950,
  archived: false,
  achieved: false,
  revision: 0,
  recurring_rule_id: null,
  annual_reserve: null,
};

const summary: SavingsObjectiveSummary = {
  ledger_balance: 1000,
  eligible_balance: 1000,
  assigned_total: 250,
  free_to_assign: 750,
  overallocated: false,
  overallocated_by: 0,
  confirmation_token: "a".repeat(64),
};

const mutation: SavingsObjectiveMutation = {ok: true, objective, summary};

const props = () => ({
  objectives: {items: [objective], summary},
  rules: [],
  refreshPlan: vi.fn().mockResolvedValue(undefined),
  setError: vi.fn(),
  setStatus: vi.fn(),
});

describe("PlanningSavingsObjectives", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.createSavingsObjective.mockResolvedValue({...mutation, created: true});
    apiMock.updateSavingsObjective.mockResolvedValue(mutation);
    apiMock.updateSavingsObjectiveAllocation.mockResolvedValue(mutation);
  });
  afterEach(() => vi.restoreAllMocks());

  it("explains and displays target, assignment, remaining amount, date and priority", () => {
    const view = props();
    render(<PlanningSavingsObjectives {...view} />);

    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("heading", {name: "Estudios"})).toBeInTheDocument();
    expect(row).toHaveTextContent("Objetivo");
    expect(row).toHaveTextContent("Asignado");
    expect(row).toHaveTextContent("Falta");
    expect(row).toHaveTextContent("01/06/2027");
    expect(row).toHaveTextContent("Alta");
    expect(screen.getByText(/no confirma efectivo disponible, saldo bancario actualizado ni pagos futuros/i)).toBeInTheDocument();
  });

  it("keeps the create request key and draft across an uncertain response retry", async () => {
    const view = props();
    apiMock.createSavingsObjective.mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({...mutation, created: true});
    render(<PlanningSavingsObjectives {...view} />);

    fireEvent.click(screen.getByText("Añadir una meta de ahorro"));
    fireEvent.change(screen.getByLabelText("Propósito"), {target: {value: "Fondo de emergencia"}});
    fireEvent.change(screen.getByLabelText("Importe objetivo"), {target: {value: "2500.00"}});
    fireEvent.change(screen.getByLabelText("Fecha objetivo"), {target: {value: "2027-12-01"}});
    const submit = screen.getByRole("button", {name: "Crear meta"});
    fireEvent.click(submit);
    await waitFor(() => expect(apiMock.createSavingsObjective).toHaveBeenCalledOnce());
    const firstRequest = apiMock.createSavingsObjective.mock.calls[0][0];
    expect(view.setError).toHaveBeenCalledWith("offline");
    expect(screen.getByLabelText("Propósito")).toHaveValue("Fondo de emergencia");

    fireEvent.click(submit);
    await waitFor(() => expect(apiMock.createSavingsObjective).toHaveBeenCalledTimes(2));
    expect(apiMock.createSavingsObjective.mock.calls[1][0]).toEqual(firstRequest);
  });

  it("preserves a dirty details draft through allocation refresh and references its editor while open", async () => {
    const view = props();
    function Harness() {
      const [current, setCurrent] = useState(objective);
      const refreshPlan = async () => setCurrent((value) => ({...value, assigned_amount: 300, remaining_amount: 900, revision: 1}));
      return <PlanningSavingsObjectives {...view} objectives={{...view.objectives, items: [current]}} refreshPlan={refreshPlan} />;
    }
    render(<Harness />);

    const row = screen.getByRole("listitem");
    const editButton = within(row).getByRole("button", {name: "Editar detalles"});
    fireEvent.click(editButton);
    const detailsForm = row.querySelector("form#planning-objective-edit-9");
    expect(detailsForm).toBeInTheDocument();
    expect(editButton).toHaveAttribute("aria-controls", "planning-objective-edit-9");
    fireEvent.change(within(detailsForm as HTMLElement).getByLabelText("Propósito"), {target: {value: "Borrador sin guardar"}});
    fireEvent.change(within(row).getByLabelText("Importe asignado"), {target: {value: "300.00"}});
    fireEvent.click(within(row).getByRole("button", {name: "Guardar asignación"}));

    await waitFor(() => expect(within(row).getByLabelText("Importe asignado")).toHaveValue(300));
    expect(within(detailsForm as HTMLElement).getByLabelText("Propósito")).toHaveValue("Borrador sin guardar");
    expect(detailsForm).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", {name: "Cerrar edición"}));
    expect(within(row).queryByRole("textbox", {name: "Propósito"})).not.toBeInTheDocument();
    expect(within(row).getByRole("button", {name: "Editar detalles"})).not.toHaveAttribute("aria-controls");
    fireEvent.click(within(row).getByRole("button", {name: "Editar detalles"}));
    expect(within(row).getByLabelText("Propósito")).toHaveValue("Estudios");
  });

  it("closes the details editor after explicitly saving its draft", async () => {
    const view = props();
    render(<PlanningSavingsObjectives {...view} />);
    const row = screen.getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", {name: "Editar detalles"}));
    fireEvent.change(within(row).getByLabelText("Propósito"), {target: {value: "Estudios avanzados"}});
    fireEvent.click(within(row).getByRole("button", {name: "Guardar detalles"}));

    await waitFor(() => expect(apiMock.updateSavingsObjective).toHaveBeenCalledWith(9, expect.objectContaining({name: "Estudios avanzados"})));
    await waitFor(() => expect(within(row).queryByLabelText("Propósito")).not.toBeInTheDocument());
    expect(within(row).getByRole("button", {name: "Editar detalles"})).toHaveAttribute("aria-expanded", "false");
  });

  it("preserves an unsaved assignment draft when saving details increments the revision", async () => {
    const view = props();
    function Harness() {
      const [current, setCurrent] = useState(objective);
      const refreshPlan = async () => setCurrent((value) => ({...value, name: "Estudios actualizados", revision: 1}));
      return <PlanningSavingsObjectives {...view} objectives={{...view.objectives, items: [current]}} refreshPlan={refreshPlan} />;
    }
    render(<Harness />);
    const row = screen.getByRole("listitem");
    fireEvent.change(within(row).getByLabelText("Importe asignado"), {target: {value: "300.00"}});
    fireEvent.click(within(row).getByRole("button", {name: "Editar detalles"}));
    fireEvent.change(within(row).getByLabelText("Propósito"), {target: {value: "Estudios avanzados"}});
    fireEvent.click(within(row).getByRole("button", {name: "Guardar detalles"}));

    await waitFor(() => expect(within(row).getByRole("heading", {name: "Estudios actualizados"})).toBeInTheDocument());
    expect(within(row).getByLabelText("Importe asignado")).toHaveValue(300);
  });

  it("requires explicit confirmation bound to the current allocation snapshot", async () => {
    const view = props();
    const refreshedSummary = {...summary, eligible_balance: 900, confirmation_token: "b".repeat(64)};
    apiMock.updateSavingsObjectiveAllocation.mockRejectedValueOnce(new ApiError(
      "La asignación supera el saldo contable registrado.",
      409,
      undefined,
      "over_allocation_confirmation_required",
      {summary: {...summary, assigned_total: 1100, overallocated: true, overallocated_by: 100}},
    )).mockRejectedValueOnce(new ApiError(
      "El saldo o las metas cambiaron; revisa el resumen actualizado antes de confirmar.",
      409,
      undefined,
      "allocation_snapshot_changed",
      {summary: {...refreshedSummary, assigned_total: 1100, overallocated: true, overallocated_by: 200}},
    )).mockResolvedValueOnce(mutation);
    render(<PlanningSavingsObjectives {...view} />);

    const row = screen.getByRole("listitem");
    fireEvent.change(within(row).getByLabelText("Importe asignado"), {target: {value: "1100.00"}});
    fireEvent.click(within(row).getByRole("button", {name: "Guardar asignación"}));
    await screen.findByRole("alert");
    fireEvent.click(within(row).getByRole("button", {name: "Confirmar asignación"}));
    await waitFor(() => expect(apiMock.updateSavingsObjectiveAllocation).toHaveBeenCalledTimes(2));
    expect(apiMock.updateSavingsObjectiveAllocation.mock.calls[1][1]).toMatchObject({confirm_overallocation: true, confirmed_snapshot: "a".repeat(64)});

    await waitFor(() => expect(within(row).getByText(/supera la base en/i)).toBeInTheDocument());
    fireEvent.click(within(row).getByRole("button", {name: "Confirmar asignación"}));
    await waitFor(() => expect(apiMock.updateSavingsObjectiveAllocation).toHaveBeenCalledTimes(3));
    expect(apiMock.updateSavingsObjectiveAllocation.mock.calls[2][1]).toMatchObject({confirm_overallocation: true, confirmed_snapshot: "b".repeat(64)});
    await waitFor(() => expect(within(row).queryByRole("button", {name: "Confirmar asignación"})).not.toBeInTheDocument());
  });

  it("does not let a late annual-reserve response steal focus from a newer action", async () => {
    const ruleOne = {id: 41, name: "Seguro A", kind: "expense", amount: 500, frequency: "yearly", active: true, day_of_month: 1, account: {id: 1, name: "Cuenta"}} as PlanningPayload["rules"][number];
    const ruleTwo = {...ruleOne, id: 42, name: "Seguro B"};
    const objectiveOne: SavingsObjective = {...objective, id: 41, name: ruleOne.name, recurring_rule_id: ruleOne.id, annual_reserve: {
      rule_id: ruleOne.id, rule_name: ruleOne.name, status: "active", due_date: "2027-10-01", months_remaining: 12, remaining_amount: 500, monthly_amount: 41.67,
    }};
    const objectiveTwo: SavingsObjective = {...objective, id: 42, name: ruleTwo.name, recurring_rule_id: ruleTwo.id, annual_reserve: {
      rule_id: ruleTwo.id, rule_name: ruleTwo.name, status: "active", due_date: "2027-10-01", months_remaining: 12, remaining_amount: 500, monthly_amount: 41.67,
    }};
    let resolveSecond: ((result: SavingsObjectiveMutation) => void) | undefined;
    apiMock.createSavingsObjective
      .mockResolvedValueOnce({...mutation, objective: objectiveOne, created: true})
      .mockImplementationOnce(() => new Promise<SavingsObjectiveMutation>((resolve) => {resolveSecond = resolve;}));

    function Harness() {
      const [items, setItems] = useState<SavingsObjective[]>([]);
      const refreshPlan = async () => setItems((current) => [...current, current.length ? objectiveTwo : objectiveOne]);
      return <PlanningSavingsObjectives {...props()} rules={[ruleOne, ruleTwo]} objectives={{...props().objectives, items}} refreshPlan={refreshPlan} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", {name: "Preparar reserva anual"})[0]);
    await screen.findByRole("heading", {name: "Seguro A"});
    await waitFor(() => expect(screen.getByRole("button", {name: "Preparar reserva anual"})).not.toHaveAttribute("aria-disabled", "true"));

    fireEvent.click(screen.getByRole("button", {name: "Preparar reserva anual"}));
    await waitFor(() => expect(resolveSecond).toBeDefined());
    const userChoice = screen.getByText("Añadir una meta de ahorro");
    userChoice.focus();
    resolveSecond?.({...mutation, objective: objectiveTwo, created: true});

    await screen.findByRole("heading", {name: "Seguro B"});
    expect(userChoice).toHaveFocus();
  });

  it("invalidates annual-reserve focus after leaving and returning to Planning during the request", async () => {
    const annualRule = {id: 41, name: "Seguro A", kind: "expense", amount: 500, frequency: "yearly", active: true, day_of_month: 1, account: {id: 1, name: "Cuenta"}} as PlanningPayload["rules"][number];
    const reserveObjective: SavingsObjective = {...objective, id: 41, name: annualRule.name, recurring_rule_id: annualRule.id, annual_reserve: {
      rule_id: annualRule.id, rule_name: annualRule.name, status: "active", due_date: "2027-10-01", months_remaining: 12, remaining_amount: 500, monthly_amount: 41.67,
    }};
    let resolveCreate: ((result: SavingsObjectiveMutation) => void) | undefined;
    let updateContext: ((value: {routeKey: string; isActive: boolean}) => void) | undefined;
    apiMock.createSavingsObjective.mockImplementationOnce(() => new Promise<SavingsObjectiveMutation>((resolve) => {resolveCreate = resolve;}));

    function Harness() {
      const [items, setItems] = useState<SavingsObjective[]>([]);
      const [context, setContext] = useState({routeKey: "planning", isActive: true});
      updateContext = setContext;
      const refreshPlan = async () => setItems([reserveObjective]);
      return <PlanningSavingsObjectives {...props()} routeKey={context.routeKey} isActive={context.isActive} rules={[annualRule]} objectives={{...props().objectives, items}} refreshPlan={refreshPlan} />;
    }
    render(<Harness />);
    const prepareButton = screen.getByRole("button", {name: "Preparar reserva anual"});
    prepareButton.focus();
    fireEvent.click(prepareButton);
    await waitFor(() => expect(resolveCreate).toBeDefined());

    act(() => updateContext?.({routeKey: "statistics", isActive: false}));
    act(() => updateContext?.({routeKey: "planning", isActive: true}));
    await act(async () => {
      resolveCreate?.({...mutation, objective: reserveObjective, created: true});
    });

    await screen.findByRole("heading", {name: "Seguro A"});
    const reserveInput = document.querySelector<HTMLElement>('[data-objective-id="41"] [data-objective-focus-target]');
    expect(reserveInput).not.toBeNull();
    expect(reserveInput).not.toHaveFocus();
  });

  it.each(["allocation", "details"] as const)("ignores annual-reserve focus after a later %s mutation without focusin", async (action) => {
    const annualRule = {id: 41, name: "Seguro A", kind: "expense", amount: 500, frequency: "yearly", active: true, day_of_month: 1, account: {id: 1, name: "Cuenta"}} as PlanningPayload["rules"][number];
    const reserveObjective: SavingsObjective = {...objective, id: 41, name: annualRule.name, recurring_rule_id: annualRule.id, annual_reserve: {
      rule_id: annualRule.id, rule_name: annualRule.name, status: "active", due_date: "2027-10-01", months_remaining: 12, remaining_amount: 500, monthly_amount: 41.67,
    }};
    const otherObjective: SavingsObjective = {...objective, id: 8, name: "Otra meta"};
    let resolveCreate: ((result: SavingsObjectiveMutation) => void) | undefined;
    let refreshCount = 0;
    apiMock.createSavingsObjective.mockImplementationOnce(() => new Promise<SavingsObjectiveMutation>((resolve) => {resolveCreate = resolve;}));
    apiMock.updateSavingsObjectiveAllocation.mockResolvedValueOnce(mutation);
    apiMock.updateSavingsObjective.mockResolvedValueOnce(mutation);
    const base = props();

    function Harness() {
      const [items, setItems] = useState([otherObjective]);
      const refreshPlan = async () => {
        refreshCount += 1;
        if (refreshCount === 2) act(() => setItems([otherObjective, reserveObjective]));
      };
      return <PlanningSavingsObjectives {...base} rules={[annualRule]} objectives={{...base.objectives, items}} refreshPlan={refreshPlan} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", {name: "Preparar reserva anual"}));
    await waitFor(() => expect(resolveCreate).toBeDefined());
    const focusin = vi.fn();
    document.addEventListener("focusin", focusin, true);
    const otherRow = document.querySelector<HTMLElement>('[data-objective-id="8"]');
    expect(otherRow).not.toBeNull();

    try {
      if (action === "allocation") {
        fireEvent.change(within(otherRow as HTMLElement).getByLabelText("Importe asignado"), {target: {value: "300.00"}});
        fireEvent.click(within(otherRow as HTMLElement).getByRole("button", {name: "Guardar asignación"}));
        await waitFor(() => expect(apiMock.updateSavingsObjectiveAllocation).toHaveBeenCalledOnce());
      } else {
        fireEvent.click(within(otherRow as HTMLElement).getByRole("button", {name: "Editar detalles"}));
        fireEvent.change(within(otherRow as HTMLElement).getByLabelText("Propósito"), {target: {value: "Otra meta actualizada"}});
        fireEvent.click(within(otherRow as HTMLElement).getByRole("button", {name: "Guardar detalles"}));
        await waitFor(() => expect(apiMock.updateSavingsObjective).toHaveBeenCalledOnce());
      }
      expect(focusin).not.toHaveBeenCalled();
      await act(async () => {
        resolveCreate?.({...mutation, objective: reserveObjective, created: true});
        await Promise.resolve();
      });
      await waitFor(() => expect(document.querySelector('[data-objective-id="41"] [data-objective-focus-target]')).not.toBeNull());
      const reserveInput = document.querySelector<HTMLElement>('[data-objective-id="41"] [data-objective-focus-target]')!;
      expect(reserveInput).not.toHaveFocus();
      expect(focusin).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("focusin", focusin, true);
    }
  });
  it("archives only after explaining the release and returns keyboard focus to a live action", async () => {
    const view = props();
    function Harness() {
      const [archived, setArchived] = useState(false);
      const refreshPlan = async () => setArchived(true);
      return <PlanningSavingsObjectives
        {...view}
        objectives={{...view.objectives, items: [{...objective, archived, revision: archived ? 1 : 0}]}}
        refreshPlan={refreshPlan}
      />;
    }
    apiMock.updateSavingsObjective.mockResolvedValue({...mutation, objective: {...objective, archived: true, revision: 1}});
    render(<Harness />);
    const row = screen.getByRole("listitem");

    fireEvent.click(within(row).getByRole("button", {name: "Archivar meta"}));
    expect(within(row).getByText(/libera.*de la reserva activa/i)).toBeInTheDocument();
    expect(apiMock.updateSavingsObjective).not.toHaveBeenCalled();
    const confirmation = within(row).getByRole("button", {name: "Confirmar archivo"});
    confirmation.focus();
    fireEvent.click(confirmation);
    await waitFor(() => expect(apiMock.updateSavingsObjective).toHaveBeenCalledWith(9, {expected_revision: 0, archived: true}));
    await waitFor(() => expect(within(row).getByRole("button", {name: "Reactivar meta"})).toHaveFocus());
  });

  it("reactivates an archived objective and restores it to the active state", async () => {
    function Harness() {
      const [current, setCurrent] = useState({...objective, archived: true, revision: 1});
      const refreshPlan = async () => setCurrent({...current, archived: false, revision: 2});
      return <PlanningSavingsObjectives {...props()} objectives={{...props().objectives, items: [current]}} refreshPlan={refreshPlan} />;
    }
    apiMock.updateSavingsObjective.mockResolvedValue({...mutation, objective: {...objective, archived: false, revision: 2}});
    render(<Harness />);
    const row = screen.getByRole("listitem");

    fireEvent.click(within(row).getByRole("button", {name: "Reactivar meta"}));

    await waitFor(() => expect(apiMock.updateSavingsObjective).toHaveBeenCalledWith(9, {expected_revision: 1, archived: false}));
    await waitFor(() => expect(within(row).getByRole("button", {name: "Archivar meta"})).toBeInTheDocument());
    expect(within(row).getByText("En curso")).toBeInTheDocument();
  });

  it("does not restore archive focus after the user moves it elsewhere", async () => {
    const view = props();
    let resolveUpdate: ((value: typeof mutation) => void) | undefined;
    apiMock.updateSavingsObjective.mockReturnValue(new Promise((resolve) => {resolveUpdate = resolve;}));
    function Harness() {
      const [archived, setArchived] = useState(false);
      const refreshPlan = async () => setArchived(true);
      return <PlanningSavingsObjectives
        {...view}
        objectives={{...view.objectives, items: [{...objective, archived, revision: archived ? 1 : 0}]}}
        refreshPlan={refreshPlan}
      />;
    }
    render(<Harness />);
    const row = screen.getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", {name: "Archivar meta"}));
    const confirmation = within(row).getByRole("button", {name: "Confirmar archivo"});
    confirmation.focus();
    fireEvent.click(confirmation);
    const createSummary = screen.getByText("Añadir una meta de ahorro");
    createSummary.focus();
    resolveUpdate?.({...mutation, objective: {...objective, archived: true, revision: 1}});

    await waitFor(() => expect(within(row).getByRole("button", {name: "Reactivar meta"})).toBeInTheDocument());
    expect(createSummary).toHaveFocus();
  });
  it("prepares a reserve from an eligible annual expense and keeps retry idempotency", async () => {
    const annualRule = {
      id: 42,
      name: "Seguro vivienda",
      kind: "expense",
      amount: 900,
      account: {id: 1, name: "Cuenta"},
      frequency: "yearly",
      active: true,
      day_of_month: 8,
    } as PlanningPayload["rules"][number];
    const view = {...props(), rules: [annualRule]};
    render(<PlanningSavingsObjectives {...view} />);

    fireEvent.click(screen.getByRole("button", {name: "Preparar reserva anual"}));
    await waitFor(() => expect(apiMock.createSavingsObjective).toHaveBeenCalledOnce());
    expect(apiMock.createSavingsObjective.mock.calls[0][0]).toMatchObject({recurring_rule_id: 42});
    expect(apiMock.createSavingsObjective.mock.calls[0][0].idempotency_key).toMatch(/[0-9a-f-]{36}/);
  });

  it("moves focus to the new annual-reserve allocation input after creation", async () => {
    const annualRule = {id: 42, name: "Seguro vivienda", kind: "expense", amount: 900, frequency: "yearly", active: true, day_of_month: 8, account: {id: 1, name: "Cuenta"}} as PlanningPayload["rules"][number];
    const annualObjective: SavingsObjective = {...objective, id: 41, name: annualRule.name, recurring_rule_id: annualRule.id, annual_reserve: {
      rule_id: annualRule.id, rule_name: annualRule.name, status: "active", due_date: "2027-06-01", months_remaining: 8, remaining_amount: 900, monthly_amount: 112.5,
    }};
    function Harness() {
      const [items, setItems] = useState<SavingsObjective[]>([]);
      const refreshPlan = async () => setItems([annualObjective]);
      return <PlanningSavingsObjectives {...props()} rules={[annualRule]} objectives={{...props().objectives, items}} refreshPlan={refreshPlan} />;
    }
    apiMock.createSavingsObjective.mockResolvedValue({...mutation, objective: annualObjective, created: true});
    render(<Harness />);
    const trigger = screen.getByRole("button", {name: "Preparar reserva anual"});
    trigger.focus();

    fireEvent.click(trigger);

    const reserveInput = await screen.findByLabelText("Importe asignado");
    await waitFor(() => expect(reserveInput).toHaveFocus());
    expect(apiMock.createSavingsObjective).toHaveBeenCalledWith(expect.objectContaining({recurring_rule_id: 42}));
  });

  it("shows the due-date quota and can unlink an annual goal before editing it", async () => {
    const annualObjective: SavingsObjective = {
      ...objective,
      recurring_rule_id: 42,
      annual_reserve: {
        rule_id: 42,
        rule_name: "Seguro vivienda",
        status: "active",
        due_date: "2027-06-01",
        months_remaining: 8,
        remaining_amount: 800,
        monthly_amount: 100,
      },
    };
    const view = {...props(), objectives: {...props().objectives, items: [annualObjective]}};
    render(<PlanningSavingsObjectives {...view} />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent(/ahorro sugerido/i);
    expect(row).toHaveTextContent(/100/);

    fireEvent.click(within(row).getByRole("button", {name: "Editar detalles"}));
    const editForm = row.querySelector("form#planning-objective-edit-9") as HTMLElement;
    expect(within(editForm).queryByLabelText("Importe objetivo")).not.toBeInTheDocument();
    expect(within(editForm).getByText(/controla el pago anual/i)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", {name: "Desvincular pago anual"}));
    await waitFor(() => expect(apiMock.updateSavingsObjective).toHaveBeenCalledWith(
      9,
      {expected_revision: 0, recurring_rule_id: null},
    ));
  });
});
