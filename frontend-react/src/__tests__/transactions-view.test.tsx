import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TransactionsView} from "../features/transactions/TransactionsView";
import {toLedgerCapabilities} from "../features/transactions/ledgerAdapter";
import type {BootstrapPayload, OptionsPayload} from "../shared/model/bootstrap";
import type {Transaction} from "../shared/model/transactions";

const apiMock = vi.hoisted(() => ({
  archiveTransaction: vi.fn(),
  bulkCategory: vi.fn(),
  reopenTransaction: vi.fn(),
  transactions: vi.fn(),
  updateTransaction: vi.fn(),
}));

vi.mock("../features/transactions/api", () => ({transactionsApi: apiMock}));

const movement = {
  id: 41,
  kind: "income",
  kind_display: "Ingreso",
  amount: 120,
  signed_amount: 120,
  date: "2026-03-10",
  description: "Sobre-reembolso",
  notes: "",
  account: {id: 1, name: "Principal", active: true},
  category: null,
  source: "manual",
  source_display: "Manual",
  refund_for_id: 17,
  is_refund: true,
  is_transfer: false,
  tags: [],
  attachments: [],
  statistics_attribution: {applied_amount: 100, extra_income: 20},
} as unknown as Transaction;

const listPayload = {
  count: 1,
  page: 1,
  page_size: 50,
  num_pages: 1,
  has_next: false,
  has_previous: false,
  results: [movement],
  filters: {accounts: [], categories: [], kinds: [], sources: []},
  summary: {income: 120, expense: 40, net: 80, excluded: 12, count: 1},
  statistics_attribution: {gross_expense: 100, refunds_applied: 100, extra_income: 20, net_expense: 0},
};

const bootstrap = {accounts: [], categories: []} as unknown as BootstrapPayload;
const options = {
  accounts: [],
  categories: [],
  refund_candidates: [],
  account_kinds: [],
  category_kinds: [],
  transaction_kinds: [],
  transaction_sources: [],
  recurring_frequencies: [],
} as OptionsPayload;

const payloadWithDescription = (description: string) => ({...listPayload, results: [{...movement, description}]});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return {promise, resolve, reject};
};

describe("statistical transaction drill-down", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-01-01&date_to=2026-01-31&statistics_attribution=report");
    apiMock.transactions.mockReset().mockResolvedValue(listPayload);
    apiMock.updateTransaction.mockReset().mockResolvedValue({ok: true, transaction: movement});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the stable control contracts across the transaction surface", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const {container} = render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    await screen.findByText("Sobre-reembolso");

    expect(container.querySelectorAll(".button, .icon-button")).toHaveLength(0);
    expect(screen.getByRole("button", {name: "Guardar filtros actuales"})).toHaveClass("ui-button", "ui-button--secondary");
    expect(screen.queryByRole("button", {name: "Añadir movimiento"})).not.toBeInTheDocument();
    const transferButton = screen.getByRole("button", {name: "Registrar traspaso"});
    expect(transferButton).toHaveClass("ui-button", "ui-button--secondary");

    fireEvent.click(transferButton);
    const transferForm = screen.getByRole("heading", {name: "Traspaso entre cuentas"}).closest("form");
    expect(transferForm).not.toBeNull();
    expect(within(transferForm!).getByRole("combobox", {name: "Origen"})).toHaveClass("ui-select");
    expect(within(transferForm!).getByRole("spinbutton", {name: "Importe"})).toHaveClass("ui-input");
    expect(within(transferForm!).getByRole("textbox", {name: "Notas"})).toHaveClass("ui-textarea");
  });

  it("serializes a parent category filter and restores it from the route", async () => {
    const parentCategory: BootstrapPayload["categories"][number] = {
      id: 3, name: "Ocio E2E", display_name: "Ocio E2E", kind: "expense", color: "#2563a8", icon: "tag",
      active: true, parent_id: null, exclude_from_analytics: false, sort_order: 0, is_favorite: false,
    };
    const childCategory: BootstrapPayload["categories"][number] = {
      ...parentCategory, id: 4, name: "Salidas E2E", display_name: "Ocio E2E · Salidas E2E", parent_id: 3,
    };
    const direct = {...movement, id: 51, kind: "expense", kind_display: "Gasto", description: "Ocio directo E2E", category: parentCategory} as Transaction;
    const child = {...movement, id: 52, kind: "expense", kind_display: "Gasto", description: "Salida hija E2E", category: childCategory} as Transaction;
    const unrelated = {...movement, id: 53, kind: "expense", kind_display: "Gasto", description: "Compra supermercado E2E", category: {...parentCategory, id: 9, name: "Comida E2E", display_name: "Comida E2E"}} as Transaction;
    const filtered = {...listPayload, count: 2, results: [direct, child]};
    const unfiltered = {...listPayload, count: 3, results: [direct, child, unrelated]};
    const bootstrapWithCategories = {...bootstrap, categories: [parentCategory, childCategory, unrelated.category as NonNullable<Transaction["category"]>]} as BootstrapPayload;
    const viewProps = {options, bootstrap: bootstrapWithCategories, onChanged: vi.fn(async () => undefined)};
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockImplementation(async (params: URLSearchParams) => params.get("category") === "3" ? filtered : unfiltered);
    const firstMount = render(<TransactionsView {...viewProps} />);
    await screen.findByText("Ocio directo E2E");
    fireEvent.click(screen.getByRole("button", {name: "Filtros"}));
    const category = screen.getByRole("combobox", {name: "Categoría"});
    expect(category.querySelector('option[value="3"]')).toHaveTextContent("Ocio E2E");
    expect(category.querySelector('option[value="4"]')).toHaveTextContent("Ocio E2E · Salidas E2E");

    fireEvent.change(category, {target: {value: "3"}});
    await waitFor(() => expect(apiMock.transactions).toHaveBeenCalledTimes(2));
    const request = apiMock.transactions.mock.calls[1][0] as URLSearchParams;
    expect(Object.fromEntries(request)).toMatchObject({category: "3"});
    expect(request.has("category_family")).toBe(false);
    expect(request.has("statistics_attribution")).toBe(false);
    expect(window.location.search).toContain("category=3");
    expect(window.location.search).not.toContain("category_family");
    expect(window.location.search).not.toContain("statistics_attribution");
    expect(screen.getByText("Ocio directo E2E")).toBeInTheDocument();
    expect(screen.getByText("Salida hija E2E")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Compra supermercado E2E")).not.toBeInTheDocument());

    firstMount.unmount();
    apiMock.transactions.mockClear();
    render(<TransactionsView {...viewProps} />);
    await screen.findByText("Ocio directo E2E");
    await waitFor(() => {
      const calls = apiMock.transactions.mock.calls;
      expect((calls[calls.length - 1]?.[0] as URLSearchParams).get("category")).toBe("3");
    });
    fireEvent.click(screen.getByRole("button", {name: /^Filtros/}));
    expect(screen.getByRole("combobox", {name: "Categoría"})).toHaveValue("3");
  });

  it("keeps typing immediate and defers the effective text query by 250 ms", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    vi.useFakeTimers();
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    await act(async () => { await Promise.resolve(); });

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, {target: {value: "supermercado"}});
    expect(search).toHaveValue("supermercado");
    expect(apiMock.transactions).toHaveBeenCalledOnce();

    await act(async () => { vi.advanceTimersByTime(249); });
    expect(apiMock.transactions).toHaveBeenCalledOnce();
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).toMatchObject({q: "supermercado"});

    fireEvent.click(screen.getByRole("button", {name: "Limpiar búsqueda"}));
    await act(async () => { vi.advanceTimersByTime(250); await Promise.resolve(); });
    expect(Object.fromEntries(apiMock.transactions.mock.calls[2][0] as URLSearchParams)).not.toHaveProperty("q");
  });

  it("resets pagination in the same request as the debounced query", async () => {
    window.history.replaceState({}, "", "/?tab=transactions&page=2&q=anterior");
    vi.useFakeTimers();
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByRole("searchbox"), {target: {value: "actual"}});
    expect(apiMock.transactions).toHaveBeenCalledOnce();
    await act(async () => { vi.advanceTimersByTime(250); await Promise.resolve(); });

    expect(apiMock.transactions).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).toMatchObject({q: "actual", page: "1"});
  });

  it("keeps the newest query result when earlier responses arrive late", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    vi.useFakeTimers();
    const requests = [deferred<typeof listPayload>(), deferred<typeof listPayload>(), deferred<typeof listPayload>()];
    let nextRequest = 0;
    apiMock.transactions.mockImplementation(() => requests[nextRequest++].promise);
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, {target: {value: "anterior"}});
    act(() => vi.advanceTimersByTime(250));
    fireEvent.change(search, {target: {value: "actual"}});
    act(() => vi.advanceTimersByTime(250));

    await act(async () => {
      requests[2].resolve(payloadWithDescription("Resultado actual"));
      await Promise.resolve();
    });
    expect(screen.getByText("Resultado actual")).toBeInTheDocument();

    await act(async () => {
      requests[1].resolve(payloadWithDescription("Resultado anterior"));
      await Promise.resolve();
    });
    expect(screen.getByText("Resultado actual")).toBeInTheDocument();
    expect(screen.queryByText("Resultado anterior")).not.toBeInTheDocument();
  });

  it("restaura la atribución por fila en la vista productiva sin contaminar una fila normal", async () => {
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-01-01&date_to=2026-01-31&statistics_attribution=report");
    const attributed = {...movement, id: 41, description: "Reembolso atribuido"};
    const normal = {...movement, id: 42, description: "Movimiento normal", is_refund: false, refund_for_id: null, statistics_attribution: undefined};
    apiMock.transactions.mockResolvedValue({...listPayload, count: 2, results: [attributed, normal]});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Reembolso atribuido");
    expect(screen.getByText(/100,00.*aplicado al gasto original.*20,00.*tratado como ingreso/)).toBeInTheDocument();
    expect(screen.getByText("Gasto bruto")).toBeInTheDocument();
    const normalRow = screen.getByText("Movimiento normal").closest("li");
    expect(normalRow).not.toBeNull();
    expect(within(normalRow!).queryByText(/aplicado al gasto original/)).not.toBeInTheDocument();
  });

  it("transmite privacy a header y filas sin exponer importes accesibles", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockResolvedValue({...listPayload, statistics_attribution: undefined});
    const {rerender} = render(<TransactionsView privateAmounts options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    const row = screen.getByText("Sobre-reembolso").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByLabelText("Importe oculto")).toBeInTheDocument();
    expect(within(row!).queryByLabelText(/Importe: 120,00/)).not.toBeInTheDocument();

    rerender(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    expect(within(screen.getByText("Sobre-reembolso").closest("li")!).getByLabelText(/Importe: 120,00/)).toBeInTheDocument();
  });

  it("edita las partidas de una compra importada sin abrir sus campos de origen", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const food = {id: 1, name: "Comida", display_name: "Comida", kind: "expense", color: "#267", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 0, is_favorite: false};
    const transport = {id: 2, name: "Transporte", display_name: "Transporte", kind: "expense", color: "#278", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false};
    const splitMovement = {
      ...movement,
      id: 77,
      kind: "expense",
      kind_display: "Gasto",
      amount: 100,
      signed_amount: -100,
      description: "Compra repartida importada",
      category: null,
      source: "csv",
      source_display: "Importación CSV",
      refund_for_id: null,
      is_refund: false,
      allocations: [
        {category: food, amount: 60, position: 0},
        {category: transport, amount: 40, position: 1},
      ],
      allocation_revision: 2,
    } as unknown as Transaction;
    expect(toLedgerCapabilities(splitMovement).allocate).toBe(true);
    const splitPayload = {...listPayload, results: [splitMovement]};
    apiMock.transactions.mockResolvedValue(splitPayload);
    apiMock.updateTransaction.mockResolvedValue({ok: true, transaction: splitMovement});
    const splitBootstrap = {...bootstrap, categories: [food, transport]} as unknown as BootstrapPayload;
    render(<TransactionsView options={options} bootstrap={splitBootstrap} onChanged={vi.fn(async () => undefined)} />);

    const row = await screen.findByText("Compra repartida importada").then((element) => element.closest("li"));
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", {name: "Acciones para Compra repartida importada"}));
    fireEvent.click(within(row!).getByRole("button", {name: "Distribuir categorías Compra repartida importada"}));
    const editor = await screen.findByRole("heading", {name: "Distribuir categorías"});
    expect(editor).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Importe de la partida 1"), {target: {value: "50.00"}});
    fireEvent.change(screen.getByLabelText("Importe de la partida 2"), {target: {value: "50.00"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar partidas"}));

    await waitFor(() => expect(apiMock.updateTransaction).toHaveBeenCalledWith(77, expect.objectContaining({
      expected_allocation_revision: 2,
      allocations: [
        {category_id: 1, amount: "50.00"},
        {category_id: 2, amount: "50.00"},
      ],
    })));
    await waitFor(() => expect(screen.getByRole("button", {name: "Acciones para Compra repartida importada"})).toHaveFocus());
  });

  it("edita las partidas de un reembolso importado sin cambiar su enlace de compra", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const refundIncome = {id: 1, name: "Reembolso", display_name: "Reembolso", kind: "income", color: "#267", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 0, is_favorite: false};
    const refundBonus = {id: 2, name: "Compensación", display_name: "Compensación", kind: "income", color: "#278", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false};
    const linkedRefund = {
      ...movement,
      id: 79,
      kind: "income",
      kind_display: "Ingreso",
      amount: 130,
      signed_amount: 130,
      description: "Reembolso repartido importado",
      category: null,
      source: "csv",
      source_display: "Importación CSV",
      refund_for_id: 56,
      is_refund: true,
      allocations: [{category: refundIncome, amount: 65, position: 0}, {category: refundBonus, amount: 65, position: 1}],
      allocation_revision: 3,
    } as unknown as Transaction;
    apiMock.transactions.mockResolvedValue({...listPayload, results: [linkedRefund]});
    apiMock.updateTransaction.mockResolvedValue({ok: true, transaction: linkedRefund});
    render(<TransactionsView options={options} bootstrap={{...bootstrap, categories: [refundIncome, refundBonus]} as unknown as BootstrapPayload} onChanged={vi.fn(async () => undefined)} />);

    const row = await screen.findByText(linkedRefund.description).then((element) => element.closest("li"));
    fireEvent.click(within(row!).getByRole("button", {name: `Acciones para ${linkedRefund.description}`}));
    fireEvent.click(within(row!).getByRole("button", {name: `Distribuir categorías ${linkedRefund.description}`}));
    expect(await screen.findByText("Lo aplicado reduce primero el gasto original; el exceso sigue esta distribución.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Importe de la partida 1"), {target: {value: "60.00"}});
    fireEvent.change(screen.getByLabelText("Importe de la partida 2"), {target: {value: "70.00"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar partidas"}));

    await waitFor(() => expect(apiMock.updateTransaction).toHaveBeenCalledWith(79, expect.objectContaining({
      expected_allocation_revision: 3,
      allocations: [
        {category_id: 1, amount: "60.00"},
        {category_id: 2, amount: "70.00"},
      ],
    })));
  });

  it("a late save for a closed allocation editor does not close the newer editor", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const food = {id: 1, name: "Comida", display_name: "Comida", kind: "expense", color: "#267", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 0, is_favorite: false};
    const transport = {id: 2, name: "Transporte", display_name: "Transporte", kind: "expense", color: "#278", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false};
    const first = {
      ...movement,
      id: 77,
      kind: "expense",
      kind_display: "Gasto",
      amount: 100,
      signed_amount: -100,
      description: "Compra repartida A",
      category: null,
      source: "manual",
      source_display: "Manual",
      refund_for_id: null,
      is_refund: false,
      allocations: [{category: food, amount: 60, position: 0}, {category: transport, amount: 40, position: 1}],
      allocation_revision: 2,
    } as unknown as Transaction;
    const second = {...first, id: 78, description: "Compra repartida B"} as Transaction;
    const save = deferred<{ok: true; transaction: Transaction}>();
    const splitBootstrap = {...bootstrap, categories: [food, transport]} as unknown as BootstrapPayload;
    apiMock.transactions.mockResolvedValue({...listPayload, results: [first, second]});
    apiMock.updateTransaction.mockReturnValueOnce(save.promise);
    render(<TransactionsView options={options} bootstrap={splitBootstrap} onChanged={vi.fn(async () => undefined)} />);

    const firstRow = await screen.findByText(first.description).then((element) => element.closest("li"));
    fireEvent.click(within(firstRow!).getByRole("button", {name: `Acciones para ${first.description}`}));
    fireEvent.click(within(firstRow!).getByRole("button", {name: `Distribuir categorías ${first.description}`}));
    fireEvent.click(screen.getByRole("button", {name: "Guardar partidas"}));
    await waitFor(() => expect(apiMock.updateTransaction).toHaveBeenCalledWith(first.id, expect.any(Object)));

    fireEvent.click(screen.getByRole("button", {name: "Cerrar"}));
    const secondRow = screen.getByText(second.description).closest("li");
    fireEvent.click(within(secondRow!).getByRole("button", {name: `Acciones para ${second.description}`}));
    fireEvent.click(within(secondRow!).getByRole("button", {name: `Distribuir categorías ${second.description}`}));
    await waitFor(() => expect(screen.getByLabelText("Categoría de la partida 1")).toHaveFocus());

    await act(async () => save.resolve({ok: true, transaction: first}));
    await waitFor(() => expect(document.querySelector(".transaction-allocation-form__movement")).toHaveTextContent(second.description));
    expect(screen.queryByText("Distribución actualizada.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Categoría de la partida 1")).toHaveFocus();
  });

  it("starts a fresh allocation draft when switching directly from movement A to B", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const food = {id: 1, name: "Comida", display_name: "Comida", kind: "expense", color: "#267", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 0, is_favorite: false};
    const transport = {id: 2, name: "Transporte", display_name: "Transporte", kind: "expense", color: "#278", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false};
    const split = (id: number, description: string) => ({
      ...movement,
      id,
      kind: "expense",
      kind_display: "Gasto",
      amount: 100,
      signed_amount: -100,
      description,
      category: null,
      source: "manual",
      source_display: "Manual",
      refund_for_id: null,
      is_refund: false,
      allocations: [{category: food, amount: 60, position: 0}, {category: transport, amount: 40, position: 1}],
      allocation_revision: 2,
    } as unknown as Transaction);
    const first = split(77, "Compra repartida A");
    const second = split(78, "Compra repartida B");
    apiMock.transactions.mockResolvedValue({...listPayload, results: [first, second]});
    apiMock.updateTransaction.mockResolvedValue({ok: true, transaction: second});
    const splitBootstrap = {...bootstrap, categories: [food, transport]} as unknown as BootstrapPayload;
    render(<TransactionsView options={options} bootstrap={splitBootstrap} onChanged={vi.fn(async () => undefined)} />);

    const firstRow = await screen.findByText(first.description).then((element) => element.closest("li"));
    fireEvent.click(within(firstRow!).getByRole("button", {name: `Acciones para ${first.description}`}));
    fireEvent.click(within(firstRow!).getByRole("button", {name: `Distribuir categorías ${first.description}`}));
    fireEvent.change(screen.getByLabelText("Importe de la partida 1"), {target: {value: "50.00"}});
    fireEvent.change(screen.getByLabelText("Importe de la partida 2"), {target: {value: "50.00"}});

    const secondRow = screen.getByText(second.description).closest("li");
    fireEvent.click(within(secondRow!).getByRole("button", {name: `Acciones para ${second.description}`}));
    fireEvent.click(within(secondRow!).getByRole("button", {name: `Distribuir categorías ${second.description}`}));
    await waitFor(() => expect(screen.getByLabelText("Importe de la partida 1")).toHaveValue(60));
    expect(screen.getByLabelText("Importe de la partida 2")).toHaveValue(40);
    fireEvent.click(screen.getByRole("button", {name: "Guardar partidas"}));

    await waitFor(() => expect(apiMock.updateTransaction).toHaveBeenCalledWith(second.id, expect.objectContaining({
      expected_allocation_revision: 2,
      allocations: [
        {category_id: 1, amount: "60.00"},
        {category_id: 2, amount: "40.00"},
      ],
    })));
  });

  it("prepara las filas del ledger desde el adapter y respeta capabilities de CSV", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const csvMovement = {
      ...movement,
      id: 44,
      description: "Importado desde CSV",
      notes: "No debe aparecer en la fila",
      source: "csv",
      source_display: "CSV",
      tags: [{name: "privado"}],
      attachments: [{id: 1}, {id: 2}],
      category: {id: 7, display_name: "Hogar", color: "#2563eb"},
      is_refund: false,
      refund_for_id: null,
      statistics_attribution: {applied_amount: 90},
    } as unknown as Transaction;
    apiMock.transactions.mockResolvedValue({...listPayload, results: [csvMovement]});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Importado desde CSV");
    expect(screen.getByText("CSV · 2 adjuntos")).toBeInTheDocument();
    expect(screen.queryByText("No debe aparecer en la fila")).not.toBeInTheDocument();
    const row = screen.getByText("Importado desde CSV").closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", {name: /^Acciones para/}));
    expect(within(row!).getByRole("button", {name: "Reabrir Importado desde CSV"})).toBeInTheDocument();
    expect(within(row!).queryByRole("button", {name: "Editar Importado desde CSV"})).not.toBeInTheDocument();
  });

  it("permite reabrir un traspaso manual solo cuando la API confirma el origen bancario", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const linkedTransfer = {
      ...movement,
      id: 46,
      description: "Traspaso manual enlazado",
      kind: "transfer_out",
      signed_amount: -120,
      is_transfer: true,
      can_reopen: true,
      category: null,
    } as unknown as Transaction;
    apiMock.transactions.mockResolvedValue({...listPayload, results: [linkedTransfer]});
    apiMock.reopenTransaction.mockResolvedValue({ok: true, message: "Movimiento reabierto para revisión.", source: "bank", target: 5, removed: []});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Traspaso manual enlazado");
    const row = screen.getByText("Traspaso manual enlazado").closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", {name: /^Acciones para/}));
    const reopen = within(row!).getByRole("button", {name: "Reabrir Traspaso manual enlazado"});
    fireEvent.click(reopen);

    await waitFor(() => expect(apiMock.reopenTransaction).toHaveBeenCalledWith(46));
    await waitFor(() => expect(apiMock.transactions).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Traspaso manual enlazado")).toBeInTheDocument();
  });

  it("deja desconocidos y traspasos en acciones fail-closed", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const unknown = {...movement, id: 45, description: "Origen futuro", source: "future_source", source_display: "Futuro"};
    const transfer = {...movement, id: 46, description: "Traspaso interno", kind: "transfer_in", is_transfer: true, source: "csv"};
    apiMock.transactions.mockResolvedValue({...listPayload, count: 2, results: [unknown, transfer]});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Origen futuro");
    for (const description of ["Origen futuro", "Traspaso interno"]) {
      const row = screen.getByText(description).closest("li");
      expect(row).not.toBeNull();
      fireEvent.click(within(row!).getByRole("button", {name: /^Acciones para/}));
      expect(within(row!).getByRole("button", {name: `Archivar ${description}`})).toBeInTheDocument();
      expect(within(row!).queryByRole("button", {name: `Reabrir ${description}`})).not.toBeInTheDocument();
      expect(within(row!).queryByRole("button", {name: `Editar ${description}`})).not.toBeInTheDocument();
    }
  });

  it("mantiene el estado de carga hasta que llega el payload real", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const request = deferred<typeof listPayload>();
    apiMock.transactions.mockReturnValue(request.promise);
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    expect(screen.getByText("Cargando movimientos…")).toBeInTheDocument();
    expect(screen.queryByText("Extracto de movimientos")).not.toBeInTheDocument();
    expect(screen.queryByText("0,00 €")).not.toBeInTheDocument();
    await act(async () => { request.resolve(listPayload); await Promise.resolve(); });
    expect(await screen.findByText("Sobre-reembolso")).toBeInTheDocument();
    expect(screen.getByText("Excluido")).toBeInTheDocument();
  });

  it("no muestra un header financiero ficticio si la request inicial falla", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockRejectedValueOnce(new Error("Servicio no disponible"));
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Servicio no disponible");
    expect(screen.queryByText("Extracto de movimientos")).not.toBeInTheDocument();
    expect(screen.queryByText("Excluido")).not.toBeInTheDocument();
  });

  it("ofrece limpiar filtros solo cuando el empty state tiene filtros activos", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockResolvedValueOnce({...listPayload, count: 0, results: [], summary: {income: 0, expense: 0, net: 0, excluded: 0, count: 0}});
    const firstEmpty = render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    expect(await screen.findByText("No hay movimientos para mostrar.")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Limpiar filtros"})).not.toBeInTheDocument();
    firstEmpty.unmount();

    window.history.replaceState({}, "", "/?tab=transactions&q=ausente");
    apiMock.transactions.mockResolvedValueOnce({...listPayload, count: 0, results: [], summary: {income: 0, expense: 0, net: 0, excluded: 0, count: 0}});
    const {unmount} = render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    expect(await screen.findByRole("button", {name: "Limpiar filtros"})).toBeInTheDocument();
    unmount();
  });

  it("expone adjuntos desde un detalle de feature sin ampliar LedgerItem", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const attachments = [
      {id: 1, name: "ticket.pdf", url: "/adjuntos/1/"},
      {id: 2, name: "factura.png", url: "/adjuntos/2/"},
    ];
    const attached = {...movement, description: "Compra con documentos", attachments};
    apiMock.transactions.mockResolvedValueOnce({...listPayload, results: [attached]});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    const row = (await screen.findByText("Compra con documentos")).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", {name: /^Acciones para/}));
    fireEvent.click(within(row!).getByRole("button", {name: "Ver adjuntos de Compra con documentos"}));
    const dialog = await screen.findByRole("dialog", {name: "Adjuntos de Compra con documentos"});
    expect(within(dialog).getByRole("link", {name: "ticket.pdf"})).toHaveAttribute("href", "/adjuntos/1/");
    expect(within(dialog).getByRole("link", {name: "factura.png"})).toHaveAttribute("href", "/adjuntos/2/");
    expect(screen.queryByText("URLs")).not.toBeInTheDocument();
  });

  it("no permite abrir adjuntos desde una fila que no tiene ninguno", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockResolvedValueOnce(listPayload);
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    const row = (await screen.findByText("Sobre-reembolso")).closest("li");
    fireEvent.click(within(row!).getByRole("button", {name: /^Acciones para/}));
    expect(within(row!).queryByRole("button", {name: /Ver adjuntos/})).not.toBeInTheDocument();
  });

  it("redacta también el contexto estadístico cuando privacy está activa", async () => {
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-01-01&date_to=2026-01-31&statistics_attribution=report");
    apiMock.transactions.mockResolvedValueOnce(listPayload);
    render(<TransactionsView privateAmounts options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    expect(screen.queryByText(/100,00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/20,00/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/100,00|20,00/)).not.toBeInTheDocument();
  });

  it("mantiene los resultados anteriores, la estructura y el foco durante una búsqueda y si falla", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    vi.useFakeTimers();
    const request = deferred<typeof listPayload>();
    apiMock.transactions.mockResolvedValueOnce(listPayload).mockReturnValueOnce(request.promise);
    const {container} = render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("Sobre-reembolso")).toBeInTheDocument();
    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.change(search, {target: {value: "nuevo"}});
    await act(async () => { vi.advanceTimersByTime(250); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("Sobre-reembolso")).toBeInTheDocument();
    expect(screen.getByText("Actualizando resultados…")).toBeInTheDocument();
    expect(container.querySelector(".view-stack")).toHaveAttribute("aria-busy", "true");
    expect(search).toHaveFocus();

    await act(async () => { request.reject(new Error("Fallo de la nueva consulta")); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("Fallo de la nueva consulta");
    expect(screen.getByText("Sobre-reembolso")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Seleccionar"})).toBeInTheDocument();
    expect(screen.getByText("Extracto de movimientos")).toBeInTheDocument();
    expect(container.querySelector(".view-stack")).toHaveAttribute("aria-busy", "false");
    expect(search).toHaveFocus();
  });

  it("mueve el foco a la siguiente fila y al estado vacío cuando se elimina la fila enfocada", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const first = {...movement, id: 41, description: "Fila para archivar"};
    const second = {...movement, id: 42, description: "Fila siguiente"};
    apiMock.transactions.mockResolvedValueOnce({...listPayload, count: 2, results: [first, second]})
      .mockResolvedValueOnce({...listPayload, count: 1, results: [second]})
      .mockResolvedValueOnce({...listPayload, count: 0, results: []});
    apiMock.archiveTransaction.mockResolvedValue({ok: true});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    await screen.findByText("Fila para archivar");

    fireEvent.click(screen.getByRole("button", {name: "Acciones para Fila para archivar"}));
    fireEvent.click(screen.getByRole("button", {name: "Archivar Fila para archivar"}));
    const nextRowAction = await screen.findByRole("button", {name: "Acciones para Fila siguiente"});
    const nextRow = nextRowAction.closest(".ui-statement-ledger__row");
    await waitFor(() => expect(nextRow).toHaveFocus());

    fireEvent.click(nextRowAction);
    fireEvent.click(screen.getByRole("button", {name: "Archivar Fila siguiente"}));
    const emptyState = await screen.findByRole("region", {name: "No hay movimientos para mostrar."});
    await waitFor(() => expect(emptyState).toHaveFocus());
  });

  it("limpia el rango sin emitir dos requests ni una URL intermedia", async () => {
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-01-01&date_to=2026-01-31");
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    fireEvent.click(screen.getByRole("button", {name: /Quitar filtro de periodo/}));
    await waitFor(() => expect(apiMock.transactions).toHaveBeenCalledTimes(2));
    expect(apiMock.transactions).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).not.toHaveProperty("date_from");
    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).not.toHaveProperty("date_to");
    expect(window.location.search).not.toContain("date_from");
    expect(window.location.search).not.toContain("date_to");
  });

  it("salta a una página numérica y conserva el contrato de paginación", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockResolvedValue({...listPayload, count: 200, num_pages: 4, has_next: true});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    expect(screen.getByRole("navigation", {name: "Páginas de movimientos"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Ir a página 3"}));
    await waitFor(() => expect(apiMock.transactions).toHaveBeenCalledTimes(2));
    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).toMatchObject({page: "3"});
  });

  it("calcula el rango con el tamaño de página efectivo del payload", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    apiMock.transactions.mockResolvedValue({...listPayload, count: 73, page: 2, page_size: 25, num_pages: 3, has_previous: true, has_next: true});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    expect(screen.getByText("26–50 de 73 movimientos")).toBeInTheDocument();
  });

  it("selecciona un rango con Shift y aplica una categoría sin tocar un traspaso", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const expenseOne = {...movement, id: 51, kind: "expense", is_transfer: false, description: "Compra uno", refund_for_id: null, is_refund: false};
    const expenseTwo = {...movement, id: 52, kind: "expense", is_transfer: false, description: "Compra dos", refund_for_id: null, is_refund: false};
    const category = {id: 7, name: "Hogar", display_name: "Hogar", kind: "expense", color: "#d94841"};
    apiMock.transactions.mockResolvedValue({...listPayload, count: 2, results: [expenseOne, expenseTwo]});
    apiMock.bulkCategory.mockResolvedValue({ok: true, updated: [51, 52]});
    render(<TransactionsView options={options} bootstrap={{...bootstrap, categories: [category]} as BootstrapPayload} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Compra uno");
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(screen.getByRole("checkbox", {name: "Seleccionar Compra uno"}));
    fireEvent.click(screen.getByRole("checkbox", {name: "Seleccionar Compra dos"}), {shiftKey: true});
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Categorizar"}));
    fireEvent.change(screen.getByPlaceholderText("Busca una categoría…"), {target: {value: "Hog"}});
    fireEvent.click(screen.getAllByRole("option", {name: "Hogar"}).find((option) => option.tagName === "BUTTON")!);
    expect(screen.getByRole("button", {name: "Exportar"})).toBeInTheDocument();
    const apply = screen.getByRole("button", {name: "Aplicar categoría"});
    fireEvent.click(apply);
    await waitFor(() => expect(apiMock.bulkCategory).toHaveBeenCalledWith([51, 52], 7));
    const toolbar = await screen.findByRole("region", {name: "Selección de movimientos"});
    expect(await within(toolbar).findByRole("status")).toHaveTextContent("2 movimientos recategorizados.");
    expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveFocus();
    expect(screen.queryByRole("checkbox", {name: /Seleccionar Compra/})).not.toBeInTheDocument();
  });

  it("keeps a failed bulk categorization retryable and suppresses duplicate requests", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const expenseOne = {...movement, id: 51, kind: "expense", is_transfer: false, description: "Compra uno", refund_for_id: null, is_refund: false};
    const expenseTwo = {...movement, id: 52, kind: "expense", is_transfer: false, description: "Compra dos", refund_for_id: null, is_refund: false};
    const category = {id: 7, name: "Hogar", display_name: "Hogar", kind: "expense", color: "#d94841"};
    const bulkGate = deferred<{ok: true; updated: number[]; message: string}>();
    apiMock.transactions.mockResolvedValue({...listPayload, count: 2, results: [expenseOne, expenseTwo]});
    apiMock.bulkCategory.mockResolvedValue({ok: true, updated: [51, 52], message: "Movimientos categorizados."});
    apiMock.bulkCategory.mockImplementationOnce(() => bulkGate.promise);
    render(<TransactionsView options={options} bootstrap={{...bootstrap, categories: [category]} as BootstrapPayload} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Compra uno");
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    const firstCheckbox = screen.getByRole("checkbox", {name: "Seleccionar Compra uno"});
    const secondCheckbox = screen.getByRole("checkbox", {name: "Seleccionar Compra dos"});
    fireEvent.click(firstCheckbox);
    fireEvent.click(secondCheckbox);
    fireEvent.click(screen.getByRole("button", {name: "Categorizar"}));
    fireEvent.change(screen.getByPlaceholderText("Busca una categoría…"), {target: {value: "Hog"}});
    fireEvent.click(screen.getAllByRole("option", {name: "Hogar"}).find((option) => option.tagName === "BUTTON")!);

    const apply = screen.getByRole("button", {name: "Aplicar categoría"});
    fireEvent.click(apply);
    await waitFor(() => expect(apiMock.bulkCategory).toHaveBeenCalledOnce());
    expect(apply).toHaveAttribute("aria-busy", "true");
    expect(apply).toHaveAttribute("aria-disabled", "true");
    expect(apply).toHaveFocus();
    fireEvent.click(apply);
    expect(apiMock.bulkCategory).toHaveBeenCalledOnce();

    await act(async () => {
      bulkGate.reject(new Error("No se pudo recategorizar; inténtalo de nuevo."));
      await bulkGate.promise.catch(() => undefined);
    });
    const toolbar = screen.getByRole("region", {name: "Acciones de selección"});
    expect(within(toolbar).getByRole("alert")).toHaveTextContent("No se pudo recategorizar; inténtalo de nuevo.");
    expect(firstCheckbox).toBeChecked();
    expect(secondCheckbox).toBeChecked();
    expect(within(screen.getByRole("group", {name: "Categorizar selección"})).getByRole("combobox")).toHaveValue("Hogar");
    expect(apply).not.toHaveAttribute("aria-busy");
    expect(apply).toHaveFocus();
    expect(screen.queryByRole("button", {name: "Reintentar"})).not.toBeInTheDocument();

    fireEvent.click(apply);
    await waitFor(() => expect(apiMock.bulkCategory).toHaveBeenCalledTimes(2));
    const completedToolbar = await screen.findByRole("region", {name: "Selección de movimientos"});
    expect(await within(completedToolbar).findByRole("status")).toHaveTextContent("2 movimientos recategorizados.");
    expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveFocus();
    expect(screen.queryByRole("checkbox", {name: /Seleccionar Compra/})).not.toBeInTheDocument();
  });

  it("reports a post-categorization refresh failure locally without restoring selection", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const expenseOne = {...movement, id: 51, kind: "expense", is_transfer: false, description: "Compra uno", refund_for_id: null, is_refund: false};
    const expenseTwo = {...movement, id: 52, kind: "expense", is_transfer: false, description: "Compra dos", refund_for_id: null, is_refund: false};
    const category = {id: 7, name: "Hogar", display_name: "Hogar", kind: "expense", color: "#d94841"};
    apiMock.transactions.mockResolvedValueOnce({...listPayload, count: 2, results: [expenseOne, expenseTwo]})
      .mockRejectedValueOnce(new Error("No se pudo cargar el listado."));
    apiMock.bulkCategory.mockResolvedValue({ok: true, updated: [51, 52], message: "Movimientos categorizados."});
    render(<TransactionsView options={options} bootstrap={{...bootstrap, categories: [category]} as BootstrapPayload} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Compra uno");
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(screen.getByRole("checkbox", {name: "Seleccionar Compra uno"}));
    fireEvent.click(screen.getByRole("checkbox", {name: "Seleccionar Compra dos"}));
    fireEvent.click(screen.getByRole("button", {name: "Categorizar"}));
    fireEvent.change(screen.getByPlaceholderText("Busca una categoría…"), {target: {value: "Hog"}});
    fireEvent.click(screen.getAllByRole("option", {name: "Hogar"}).find((option) => option.tagName === "BUTTON")!);
    fireEvent.click(screen.getByRole("button", {name: "Aplicar categoría"}));

    await waitFor(() => expect(apiMock.bulkCategory).toHaveBeenCalledWith([51, 52], 7));
    const toolbar = await screen.findByRole("region", {name: "Selección de movimientos"});
    expect(await within(toolbar).findByRole("alert")).toHaveTextContent("Los movimientos se recategorizaron, pero no se pudieron actualizar todos los datos.");
    expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveFocus();
    expect(screen.queryByRole("checkbox", {name: /Seleccionar Compra/})).not.toBeInTheDocument();
    expect(document.querySelector(".transactions-load-error")).not.toBeInTheDocument();
  });

  it("keeps a blocked archive error in the ledger without replacing its results", async () => {
    apiMock.archiveTransaction.mockRejectedValue(new Error("No puedes archivar una compra con reembolsos vinculados."));
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    const trigger = screen.getByRole("button", {name: "Acciones para Sobre-reembolso"});
    fireEvent.click(trigger);
    const archive = screen.getByRole("button", {name: "Archivar Sobre-reembolso"});
    fireEvent.click(archive);

    await waitFor(() => expect(apiMock.archiveTransaction).toHaveBeenCalledWith(41));
    const results = screen.getByRole("region", {name: "Resultados del ledger"});
    expect(await within(results).findByRole("alert")).toHaveTextContent("No puedes archivar una compra con reembolsos vinculados.");
    expect(screen.queryByRole("button", {name: "Reintentar"})).not.toBeInTheDocument();
    expect(archive).toHaveFocus();
    expect(screen.getByText("Sobre-reembolso")).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Filtros fijados por Estadísticas"})).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("announces archive pending, suppresses repeats, then retries and focuses the empty state", async () => {
    window.history.replaceState({}, "", "/?tab=transactions");
    const archiveGate = deferred<{ok: true}>();
    apiMock.archiveTransaction.mockImplementationOnce(() => archiveGate.promise).mockResolvedValueOnce({ok: true});
    apiMock.transactions.mockResolvedValueOnce(listPayload).mockResolvedValueOnce({...listPayload, count: 0, results: []});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);
    await screen.findByText("Sobre-reembolso");

    const row = document.querySelector(".ui-statement-ledger__row") as HTMLElement;
    const trigger = screen.getByRole("button", {name: "Acciones para Sobre-reembolso"});
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", {name: "Archivar Sobre-reembolso"}));
    await waitFor(() => expect(apiMock.archiveTransaction).toHaveBeenCalledOnce());
    expect(row).toHaveAttribute("aria-busy", "true");
    const archive = screen.getByRole("button", {name: "Archivar Sobre-reembolso"});
    expect(archive).toHaveFocus();

    expect(archive).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(archive);
    expect(apiMock.archiveTransaction).toHaveBeenCalledOnce();
    expect(archive).toHaveFocus();

    await act(async () => {
      archiveGate.reject(new Error("No se pudo archivar; inténtalo de nuevo."));
      await archiveGate.promise.catch(() => undefined);
    });
    const results = screen.getByRole("region", {name: "Resultados del ledger"});
    expect(await within(results).findByRole("alert")).toHaveTextContent("No se pudo archivar; inténtalo de nuevo.");
    expect(row).toBeInTheDocument();
    expect(row).not.toHaveAttribute("aria-busy");
    expect(archive).toHaveFocus();

    fireEvent.click(archive);
    const emptyState = await screen.findByRole("region", {name: "No hay movimientos para mostrar."});
    await waitFor(() => expect(emptyState).toHaveFocus());
    expect(document.querySelector(".view-stack > .sr-status")).toHaveTextContent("Movimiento archivado.");
    expect(apiMock.archiveTransaction).toHaveBeenCalledTimes(2);
  });

  it("keeps the complete statistical context when moving to the next page", async () => {
    window.history.replaceState({}, "", "/?tab=transactions&date_from=2026-01-01&date_to=2026-01-31&analytics=included&category_family=4&statistics_attribution=purchase");
    apiMock.transactions.mockResolvedValue({...listPayload, count: 100, num_pages: 2, has_next: true});
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    await screen.findByText("Sobre-reembolso");
    expect(screen.getByRole("heading", {name: "Filtros fijados por Estadísticas"})).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Página siguiente"}));
    await waitFor(() => expect(apiMock.transactions).toHaveBeenCalledTimes(2));

    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).toMatchObject({
      date_from: "2026-01-01",
      date_to: "2026-01-31",
      analytics: "included",
      category_family: "4",
      statistics_attribution: "purchase",
      page: "2",
    });
  });

  it("retries an exact report without dropping its attribution or dates", async () => {
    apiMock.transactions
      .mockRejectedValueOnce(new Error("Detalle no disponible"))
      .mockResolvedValueOnce(listPayload);
    render(<TransactionsView options={options} bootstrap={bootstrap} onChanged={vi.fn(async () => undefined)} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Detalle no disponible");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    await screen.findByText("Sobre-reembolso");

    expect(Object.fromEntries(apiMock.transactions.mock.calls[1][0] as URLSearchParams)).toMatchObject({
      date_from: "2026-01-01",
      date_to: "2026-01-31",
      statistics_attribution: "report",
      page: "1",
    });
  });
});
