import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ReviewView} from "../features/review/ReviewView";
import type {Account, Connection} from "../shared/model/accounts";
import type {Category} from "../shared/model/categories";
import type {ImportPayload, ImportRowsPayload} from "../shared/model/imports";
import type {Transaction} from "../shared/model/transactions";
import type {BankReviewPayload} from "../features/review/types";

const apiMock = vi.hoisted(() => ({
  bankReview: vi.fn(),
  bankReviewAction: vi.fn(),
  bankReviewBulk: vi.fn(),
  bankTransferOptions: vi.fn(),
  confirmImportBatch: vi.fn(),
  deleteImportBatch: vi.fn(),
  importBulk: vi.fn(),
  importRowAction: vi.fn(),
  importRows: vi.fn(),
  imports: vi.fn(),
  syncBank: vi.fn(),
  uploadImport: vi.fn(),
}));

vi.mock("../features/review/api", () => ({reviewApi: apiMock}));
vi.mock("../shared/api/banking", () => ({bankingApi: apiMock}));
vi.mock("../shared/api/imports", () => ({importsApi: apiMock}));

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

const emptyBank: BankReviewPayload = {rows: [], unlinked_transfers: [], categories: [category], refund_candidates: []};

const bankPayload: BankReviewPayload = {
  rows: [{
    id: 41,
    bank_account: {id: 9, display_name: "Principal", account},
    booking_date: "2026-07-10",
    description: "Compra bancaria",
    amount: 24.5,
    kind: "expense",
    currency: "EUR",
    category: null,
    suggested_category: category,
    prediction: null,
    possible_duplicate: false,
    possible_transfer: true,
    fee_transaction_id: null,
    status: "pending",
  }],
  unlinked_transfers: [],
  categories: [category],
  refund_candidates: [],
};

const refundCandidate: Transaction = {
  id: 77,
  kind: "expense",
  kind_display: "Gasto",
  amount: 24.5,
  signed_amount: -24.5,
  date: "2026-07-08",
  description: "Compra anterior",
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

const emptyImports: ImportPayload = {
  profiles: [],
  default_profile_id: 0,
  batches: [],
  accounts: [account],
};

const csvImports: ImportPayload = {
  profiles: [],
  default_profile_id: 0,
  accounts: [account],
  batches: [{
    id: 61,
    filename: "movimientos.csv",
    account,
    profile: null,
    status: "review",
    status_display: "En revisión",
    created_at: "2026-07-11T10:00:00Z",
    pending_count: 1,
    row_count: 1,
  }],
};

const csvRows: ImportRowsPayload = {
  batch: csvImports.batches[0],
  count: 1,
  page: 1,
  num_pages: 1,
  has_next: false,
  has_previous: false,
  categories: [category],
  results: [{
    id: 71,
    batch_id: 61,
    row_number: 2,
    date: "2026-07-09",
    description: "Compra CSV",
    amount: 15,
    kind: "expense",
    category: null,
    possible_duplicate: false,
    status: "pending",
    status_display: "Pendiente",
    transaction_id: null,
  }],
};

const connection = (id: number): Connection => ({
  id,
  bank_name: `Banco ${id}`,
  bank_country: "ES",
  status: "linked",
  status_display: "Conectado",
  sync_status: "idle",
  sync_status_display: "Preparado",
  sync_started_at: "",
  sync_started_at_display: "",
  last_synced_at: "",
  last_synced_at_display: "",
  last_error: "",
  authorized_until: "",
  accounts: [account],
});

async function openSelectionActions() {
  const trigger = await screen.findByRole("button", {name: /Acciones de selección, /});
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  return screen.findByRole("group", {name: "Acciones de selección"});
}

describe("ReviewView", () => {
  afterEach(() => {vi.restoreAllMocks();});

  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.bankReview.mockResolvedValue(emptyBank);
    apiMock.imports.mockResolvedValue(emptyImports);
    apiMock.bankTransferOptions.mockResolvedValue({ok: true, candidates: []});
    apiMock.bankReviewAction.mockResolvedValue({ok: true, message: "", removed: []});
    apiMock.bankReviewBulk.mockResolvedValue({ok: true, message: "", removed: [], failed: []});
    apiMock.importRowAction.mockResolvedValue({ok: true, message: ""});
    apiMock.importBulk.mockResolvedValue({ok: true, message: "", removed: [], failed: []});
    apiMock.confirmImportBatch.mockResolvedValue({ok: true, message: "Lote confirmado", imported: 1});
    apiMock.deleteImportBatch.mockResolvedValue({ok: true, message: "Lote eliminado"});
    apiMock.importRows.mockResolvedValue(csvRows);
    apiMock.syncBank.mockResolvedValue({ok: true});
    apiMock.uploadImport.mockResolvedValue({ok: true, batch: csvImports.batches[0]});
  });

  it("focuses the bank queue from a bank-review deep link", async () => {
    render(<ReviewView connections={[]} routeKey="http://localhost/?tab=review&focus=bank-review" />);

    const target = await screen.findByRole("region", {name: "Cola bancaria"});
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.getByRole("button", {name: "Todos"})).toHaveAttribute("aria-pressed", "true");
  });

  it("expands and focuses CSV review without opening the CSV uploader", async () => {
    render(<ReviewView connections={[]} routeKey="http://localhost/?tab=review&focus=csv-review" />);

    const target = document.getElementById("review-csv-workspace");
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.getByRole("button", {name: "Comprimir CSV"})).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Cerrar carga CSV"})).not.toBeInTheDocument();
  });

  it("focuses both review queues with the needs-attention filter", async () => {
    render(<ReviewView connections={[]} routeKey="http://localhost/?tab=review&focus=review-attention" />);

    const target = document.getElementById("review-workspace");
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.getByRole("button", {name: "Necesitan atención"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name: "Todos"})).toHaveAttribute("aria-pressed", "false");
  });

  it("clears mixed selections when a cached Review view opens the attention deep link", async () => {
    const preparedBankRow = {...bankPayload.rows[0], possible_transfer: false, category};
    const preparedCsvRows = {...csvRows, results: [{...csvRows.results[0], category}]};
    apiMock.bankReview.mockResolvedValue({...bankPayload, rows: [preparedBankRow]});
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue(preparedCsvRows);
    const view = render(<ReviewView connections={[]} routeKey="http://localhost/?tab=review" />);

    const bankCard = (await screen.findByText("Compra bancaria")).closest('[data-review-item="bank:41"]') as HTMLElement;
    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const csvCard = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(bankCard).getByRole("checkbox", {name: "Seleccionar Compra bancaria"}));
    fireEvent.click(within(csvCard).getByRole("checkbox", {name: "Seleccionar Compra CSV"}));
    expect(screen.getByRole("button", {name: "Acciones de selección, 2 seleccionados"})).toBeInTheDocument();

    view.rerender(<ReviewView connections={[]} routeKey="http://localhost/?tab=review&focus=review-attention" />);

    await waitFor(() => expect(screen.getByRole("button", {name: "Necesitan atención"})).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("Compra bancaria")).not.toBeInTheDocument();
    expect(screen.queryByText("Compra CSV")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", {name: /Acciones de selección/})).not.toBeInTheDocument();
    expect(apiMock.bankReviewBulk).not.toHaveBeenCalled();
    expect(apiMock.importBulk).not.toHaveBeenCalled();
  });

  it("does not apply review deep links while the cached view is inactive", () => {
    render(<ReviewView connections={[]} isActive={false} routeKey="http://localhost/?tab=review&focus=review-attention" />);

    expect(screen.getByRole("button", {name: "Todos"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name: "Necesitan atención"})).toHaveAttribute("aria-pressed", "false");
  });

  it("sube un CSV, conserva el lote pendiente y separa el POST del refresco", async () => {
    const profile = {
      id: 17,
      name: "Perfil de pruebas",
      delimiter: ",",
      date_format: "%Y-%m-%d",
      date_column: "date",
      description_column: "description",
      amount_column: "amount",
      category_column: "category",
      subcategory_column: "subcategory",
    };
    const initialImports = {...emptyImports, profiles: [profile], default_profile_id: profile.id};
    const uploadedBatch = {...csvImports.batches[0], id: 92, filename: "nuevo.csv", profile};
    const latestImports = {...initialImports, batches: [uploadedBatch]};
    const latestRows = {
      ...csvRows,
      batch: uploadedBatch,
      results: [{...csvRows.results[0], id: 93, batch_id: uploadedBatch.id, description: "Nueva compra CSV"}],
    };
    let currentImports = initialImports;
    apiMock.imports.mockImplementation(() => Promise.resolve(currentImports));
    apiMock.importRows.mockResolvedValue(latestRows);
    let finishUpload!: () => void;
    apiMock.uploadImport.mockImplementationOnce(() => new Promise((resolve) => {
      finishUpload = () => { currentImports = latestImports; resolve({ok: true, batch: uploadedBatch}); };
    }));
    render(<ReviewView connections={[]} />);
    fireEvent.click(await screen.findByRole("button", {name: "Importar CSV"}));
    const fileInput = await screen.findByLabelText("Archivo CSV") as HTMLInputElement;
    fireEvent.change(fileInput, {target: {files: [new File(["date,description,amount"], "nuevo.csv", {type: "text/csv"})]}});
    const submit = screen.getByRole("button", {name: "Subir CSV"});
    submit.focus();
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(apiMock.uploadImport).toHaveBeenCalledOnce());
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveFocus();
    fireEvent.click(submit);
    expect(apiMock.uploadImport).toHaveBeenCalledOnce();
    finishUpload();

    expect(await screen.findByRole("status")).toHaveTextContent("El lote está pendiente y todavía no se ha importado.");
    await waitFor(() => expect(fileInput).toHaveFocus());
    expect(apiMock.importRows).not.toHaveBeenCalled();
    expect(apiMock.confirmImportBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Revisar lote"}));
    expect(await screen.findByText("Nueva compra CSV")).toBeInTheDocument();
    expect(apiMock.importRows).toHaveBeenCalledWith(uploadedBatch.id, expect.any(URLSearchParams));
    expect(apiMock.uploadImport).toHaveBeenCalledOnce();
    expect(apiMock.confirmImportBatch).not.toHaveBeenCalled();
  });

  it("ignora la lectura tardía del lote anterior al abrir el lote devuelto por la subida", async () => {
    const profile = {id: 17, name: "Perfil de pruebas", delimiter: ",", date_format: "%Y-%m-%d", date_column: "date", description_column: "description", amount_column: "amount", category_column: "category", subcategory_column: "subcategory"};
    const olderBatch = csvImports.batches[0];
    const uploadedBatch = {...olderBatch, id: 92, filename: "nuevo.csv", profile};
    const latestImports = {...csvImports, profiles: [profile], default_profile_id: profile.id, batches: [olderBatch, uploadedBatch]};
    const olderRows = {...csvRows, results: [{...csvRows.results[0], description: "Lote anterior pendiente"}]};
    const uploadedRows = {...csvRows, batch: uploadedBatch, results: [{...csvRows.results[0], id: 93, batch_id: uploadedBatch.id, description: "Lote recién cargado"}]};
    let finishOlderRead!: (payload: ImportRowsPayload) => void;
    apiMock.imports.mockResolvedValue(latestImports);
    apiMock.importRows.mockImplementation((batchId: number) => batchId === olderBatch.id
      ? new Promise((resolve) => {finishOlderRead = resolve;})
      : Promise.resolve(uploadedRows));
    apiMock.uploadImport.mockResolvedValue({ok: true, batch: uploadedBatch});
    render(<ReviewView connections={[]} />);

    await waitFor(() => expect(apiMock.importRows).toHaveBeenCalledWith(olderBatch.id, expect.any(URLSearchParams)));
    fireEvent.click(await screen.findByRole("button", {name: "Importar CSV"}));
    const file = await screen.findByLabelText("Archivo CSV") as HTMLInputElement;
    fireEvent.change(file, {target: {files: [new File(["datos"], "nuevo.csv", {type: "text/csv"})]}});
    fireEvent.submit(file.closest("form")!);
    fireEvent.click(await screen.findByRole("button", {name: "Revisar lote"}));
    expect(await screen.findByText("Lote recién cargado")).toBeInTheDocument();

    await act(async () => {finishOlderRead(olderRows);});
    expect(screen.getByText("Lote recién cargado")).toBeInTheDocument();
    expect(screen.queryByText("Lote anterior pendiente")).not.toBeInTheDocument();
    expect(apiMock.uploadImport).toHaveBeenCalledOnce();
    expect(apiMock.confirmImportBatch).not.toHaveBeenCalled();
  });

  it("recarga el lote visible si falla el recién subido y termina tarde su primera lectura", async () => {
    const profile = {id: 17, name: "Perfil de pruebas", delimiter: ",", date_format: "%Y-%m-%d", date_column: "date", description_column: "description", amount_column: "amount", category_column: "category", subcategory_column: "subcategory"};
    const visibleBatch = csvImports.batches[0];
    const uploadedBatch = {...visibleBatch, id: 92, filename: "nuevo.csv", profile};
    const initialImports = {...csvImports, profiles: [profile], default_profile_id: profile.id, batches: [visibleBatch]};
    const updatedImports = {...initialImports, batches: [visibleBatch, uploadedBatch]};
    const staleVisibleRows = {...csvRows, batch: visibleBatch, results: [{...csvRows.results[0], description: "Lote A obsoleto"}]};
    const refreshedRows = {...staleVisibleRows, results: [{...csvRows.results[0], description: "Lote A tras refrescar"}]};
    let currentImports = initialImports;
    let finishInitialRows!: (payload: ImportRowsPayload) => void;
    let finishReplacementRows!: (payload: ImportRowsPayload) => void;
    let visibleBatchReads = 0;
    apiMock.imports.mockImplementation(() => Promise.resolve(currentImports));
    apiMock.importRows.mockImplementation((batchId: number, params: URLSearchParams) => {
      if (batchId === uploadedBatch.id) return Promise.reject(new Error("No se pudo leer el lote nuevo."));
      visibleBatchReads += 1;
      if (visibleBatchReads === 1) return new Promise((resolve) => {finishInitialRows = resolve;});
      return new Promise((resolve) => {finishReplacementRows = resolve;});
    });
    apiMock.uploadImport.mockImplementationOnce(() => {
      currentImports = updatedImports;
      return Promise.resolve({ok: true, batch: uploadedBatch});
    });
    render(<ReviewView connections={[]} />);

    await waitFor(() => expect(apiMock.importRows).toHaveBeenCalledWith(visibleBatch.id, expect.any(URLSearchParams)));
    fireEvent.click(await screen.findByRole("button", {name: "Importar CSV"}));
    const input = await screen.findByLabelText("Archivo CSV") as HTMLInputElement;
    fireEvent.change(input, {target: {files: [new File(["datos"], "nuevo.csv", {type: "text/csv"})]}});
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent("El lote está pendiente y todavía no se ha importado.");
    expect(visibleBatchReads).toBe(1);
    fireEvent.click(screen.getByRole("button", {name: "Revisar lote"}));
    expect(await screen.findByText("El CSV se guardó, pero no se pudieron cargar sus filas.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Expandir CSV"}));

    await waitFor(() => expect(visibleBatchReads).toBe(2));
    await act(async () => {finishInitialRows(staleVisibleRows);});
    expect(screen.queryByText("Lote A obsoleto")).not.toBeInTheDocument();
    await act(async () => {finishReplacementRows(refreshedRows);});
    expect(await screen.findByText("Lote A tras refrescar")).toBeInTheDocument();
    expect(apiMock.uploadImport).toHaveBeenCalledOnce();
    expect(apiMock.importRows).toHaveBeenCalledTimes(3);
    expect(apiMock.importRows.mock.calls.map(([batchId]) => batchId)).toEqual([visibleBatch.id, uploadedBatch.id, visibleBatch.id]);
    expect(apiMock.confirmImportBatch).not.toHaveBeenCalled();
  });

  it("no invalida la lectura pendiente al volver a seleccionar el lote activo", async () => {
    let finishRows!: (payload: ImportRowsPayload) => void;
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockImplementationOnce(() => new Promise((resolve) => {finishRows = resolve;}));
    render(<ReviewView connections={[]} />);

    await waitFor(() => expect(apiMock.importRows).toHaveBeenCalledWith(csvImports.batches[0].id, expect.any(URLSearchParams)));
    const activeBatch = document.querySelector<HTMLElement>(".batch-card.selected");
    expect(activeBatch).not.toBeNull();
    fireEvent.click(activeBatch!.querySelector<HTMLButtonElement>(".batch-select-button")!);
    await act(async () => finishRows(csvRows));

    expect(await screen.findByText(csvRows.results[0].description)).toBeInTheDocument();
    expect(apiMock.importRows).toHaveBeenCalledOnce();
  });

  it("conserva el archivo y permite reintentar cuando falla el POST", async () => {
    const profile = {...emptyImports, profiles: [{
      id: 17, name: "Perfil de pruebas", delimiter: ",", date_format: "%Y-%m-%d", date_column: "date",
      description_column: "description", amount_column: "amount", category_column: "category", subcategory_column: "subcategory",
    }], default_profile_id: 17};
    apiMock.imports.mockResolvedValue(profile);
    apiMock.uploadImport.mockRejectedValueOnce(new Error("CSV no válido")).mockResolvedValueOnce({ok: true, batch: csvImports.batches[0]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Importar CSV"}));
    const fileInput = await screen.findByLabelText("Archivo CSV") as HTMLInputElement;
    fireEvent.change(fileInput, {target: {files: [new File(["datos"], "pendiente.csv", {type: "text/csv"})]}});
    const form = fileInput.closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByRole("alert")).toHaveTextContent("CSV no válido");
    expect(fileInput.files?.[0]).toMatchObject({name: "pendiente.csv"});
    fireEvent.click(screen.getByRole("button", {name: "Cerrar carga CSV"}));
    expect(fileInput).not.toBeVisible();
    expect(fileInput).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Importar CSV"}));
    await waitFor(() => expect(fileInput).toBeVisible());
    expect(fileInput.files?.[0]).toMatchObject({name: "pendiente.csv"});
    fireEvent.submit(form);
    expect(await screen.findByRole("status")).toHaveTextContent("CSV cargado a revisión");
    expect(apiMock.uploadImport).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(fileInput).toHaveFocus());
  });

  it("conserva cuenta y archivo al abrir la configuración del perfil CSV", async () => {
    const navigateToSettings = vi.fn();
    apiMock.imports.mockResolvedValue(emptyImports);
    render(<ReviewView connections={[]} navigateToSettings={navigateToSettings} />);

    fireEvent.click(await screen.findByRole("button", {name: "Importar CSV"}));
    const fileInput = await screen.findByLabelText("Archivo CSV") as HTMLInputElement;
    fireEvent.change(fileInput, {target: {files: [new File(["datos"], "pendiente.csv", {type: "text/csv"})]}});
    fireEvent.click(screen.getByRole("button", {name: "Ir a Ajustes › Importación"}));

    expect(navigateToSettings.mock.calls[0][0].toString()).toBe("settings_section=imports");
    expect(fileInput.files?.[0]).toMatchObject({name: "pendiente.csv"});
    expect(apiMock.uploadImport).not.toHaveBeenCalled();
  });

  it("usa los controles estables en las acciones comunes de Revisión", async () => {
    apiMock.bankReview.mockResolvedValue(bankPayload);
    apiMock.imports.mockResolvedValue(csvImports);
    render(<ReviewView connections={[connection(1)]} />);

    expect(await screen.findByRole("button", {name: "Sincronizar banco"})).toHaveClass("ui-button", "ui-button--primary");
    expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveClass("ui-button", "ui-button--secondary");
    expect(screen.getByRole("button", {name: "Expandir CSV"})).toHaveClass("ui-button", "ui-button--secondary");
    expect(await screen.findByRole("button", {name: "Eliminar lote CSV movimientos.csv"})).toHaveClass("ui-icon-button", "ui-icon-button--subtle");

    const bankCard = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    expect(within(bankCard).getByRole("button", {name: "Vincular traspaso"})).toHaveClass("ui-button", "ui-button--secondary");
    expect(bankCard.querySelector(".button, .icon-button, .text-button")).toBeNull();
  });

  it("ofrece el menú de reglas y al cerrarlo restaura foco sin desplazar la página", async () => {
    const navigateToSettings = vi.fn();
    render(<ReviewView connections={[]} navigateToSettings={navigateToSettings} />);

    const trigger = await screen.findByRole("button", {name: "Reglas de categoría"});
    trigger.focus();
    const scrollBefore = window.scrollY;
    fireEvent.click(trigger);
    expect(screen.getByRole("button", {name: "Nueva regla"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Gestionar reglas"})).toBeInTheDocument();
    fireEvent.keyDown(document, {key: "Escape"});
    expect(trigger).toHaveFocus();
    expect(window.scrollY).toBe(scrollBefore);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", {name: "Nueva regla"}));
    expect(navigateToSettings.mock.calls[0][0].toString()).toBe("focus=new-rule");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", {name: "Gestionar reglas"}));
    expect(navigateToSettings.mock.calls[1][0].toString()).toBe("focus=rules");
  });

  it("mantiene el error de carga y reintenta banco e importaciones juntos", async () => {
    apiMock.bankReview.mockRejectedValueOnce(new Error("Revisión no disponible"));
    render(<ReviewView connections={[]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Revisión no disponible");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));

    expect(await screen.findByRole("heading", {name: "Revisión"})).toBeInTheDocument();
    expect(apiMock.bankReview).toHaveBeenCalledTimes(2);
    expect(apiMock.imports).toHaveBeenCalledTimes(2);
  });

  it("previsualiza el candidato bancario y exige confirmar la comisión", async () => {
    const incomingRow = {
      ...bankPayload.rows[0],
      id: 42,
      bank_account: {id: 10, display_name: "Ahorro", account: {...account, id: 10, name: "Cuenta ahorro"}},
      booking_date: "2026-07-11",
      description: "Abono traspaso",
      amount: 23.5,
      kind: "income" as const,
    };
    const candidate = {
      candidate_type: "bank_row" as const,
      candidate_id: "42",
      source: "bank" as const,
      outgoing: {bank_transaction_id: 41, transaction_id: null, account: {id: account.id, name: account.name}, booking_date: "2026-07-10", description: "Compra bancaria", amount: 24.5},
      incoming: {bank_transaction_id: 42, transaction_id: null, account: {id: 10, name: "Cuenta ahorro"}, booking_date: "2026-07-11", description: "Abono traspaso", amount: 23.5},
      transfer_amount: 23.5,
      fee_amount: 1,
      requires_fee_confirmation: true,
      days_apart: 1,
    };
    const secondCandidate = {
      ...candidate,
      candidate_id: "43",
      incoming: {...candidate.incoming, bank_transaction_id: 43, account: {id: 11, name: "Cuenta ahorro 2"}, description: "Otro abono", amount: 24.5},
      transfer_amount: 24.5,
      fee_amount: 0,
      requires_fee_confirmation: false,
    };
    const pendingPayload = {...bankPayload, rows: [bankPayload.rows[0], incomingRow]};
    const refreshedPayload = {...pendingPayload, rows: []};
    apiMock.bankReview.mockResolvedValueOnce(pendingPayload).mockResolvedValue(refreshedPayload);
    apiMock.bankTransferOptions.mockResolvedValue({ok: true, candidates: [candidate, secondCandidate]});
    apiMock.bankReviewAction.mockResolvedValue({ok: true, message: "Traspaso bancario enlazado.", removed: [41, 42]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]");
    expect(card).not.toBeNull();
    const trigger = within(card as HTMLElement).getByRole("button", {name: "Vincular traspaso"});
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByText("Enlazar traspaso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Cancelar"}));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(await screen.findByText("Enlazar traspaso")).toBeInTheDocument();
    const candidateSelect = await screen.findByRole("combobox", {name: "Contrapartida"});
    expect(candidateSelect).toHaveValue("");
    expect(screen.queryByRole("button", {name: "Confirmar traspaso y comisión"})).not.toBeInTheDocument();
    fireEvent.change(candidateSelect, {target: {value: "bank_row:42"}});
    expect(screen.getByText(/Sale de Cuenta diaria:/)).toBeInTheDocument();
    expect(screen.getByText(/Entra en Cuenta ahorro:/)).toBeInTheDocument();
    expect(apiMock.bankTransferOptions).toHaveBeenCalledWith(41);
    fireEvent.click(screen.getByRole("checkbox", {name: /Confirmo que/}));
    fireEvent.click(screen.getByRole("button", {name: "Confirmar traspaso y comisión"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "transfer", {
      candidate_type: "bank_row", candidate_id: "42", confirm_fee: true,
    }));
    await waitFor(() => expect(apiMock.bankReview).toHaveBeenCalledTimes(2));
    expect(apiMock.bankReviewBulk).not.toHaveBeenCalledWith(expect.objectContaining({action: "transfer"}));
  });

  it("ignora la respuesta tardía de un preview cancelado sin cerrar ni desenfocar otro origen", async () => {
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    const otherOrigin = {
      ...bankPayload.rows[0],
      id: 42,
      bank_account: {id: 10, display_name: "Ahorro", account: {...account, id: 10, name: "Cuenta ahorro"}},
      description: "Otro cargo",
      amount: 12,
      possible_transfer: true,
    };
    const firstCandidate = {
      candidate_type: "bank_row" as const,
      candidate_id: "99",
      source: "bank" as const,
      outgoing: {bank_transaction_id: 41, transaction_id: null, account: {id: account.id, name: account.name}, booking_date: "2026-07-10", description: "Compra bancaria", amount: 24.5},
      incoming: {bank_transaction_id: 99, transaction_id: null, account: {id: 10, name: "Cuenta ahorro"}, booking_date: "2026-07-11", description: "Abono traspaso", amount: 24.5},
      transfer_amount: 24.5,
      fee_amount: 0,
      requires_fee_confirmation: false,
      days_apart: 1,
    };
    const secondCandidate = {
      ...firstCandidate,
      candidate_id: "100",
      outgoing: {...firstCandidate.outgoing, bank_transaction_id: 42, account: {id: 10, name: "Cuenta ahorro"}, description: "Otro cargo", amount: 12},
      incoming: {...firstCandidate.incoming, bank_transaction_id: 100, account: {id: 11, name: "Cuenta secundaria"}, amount: 12},
      transfer_amount: 12,
    };
    const initialPayload = {...bankPayload, rows: [bankPayload.rows[0], otherOrigin]};
    const refreshedPayload = {...initialPayload, rows: [otherOrigin]};
    let finishFirstTransfer!: () => void;
    apiMock.bankReview.mockResolvedValueOnce(initialPayload).mockResolvedValue(refreshedPayload);
    apiMock.bankTransferOptions.mockImplementation((id: number) => Promise.resolve({ok: true, candidates: id === 41 ? [firstCandidate] : [secondCandidate]}));
    apiMock.bankReviewAction.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirstTransfer = () => resolve({ok: true, message: "Traspaso enlazado", removed: [41, 99]});
    }));
    render(<ReviewView connections={[]} />);

    const firstCard = (await screen.findByText("Compra bancaria")).closest('[data-review-item="bank:41"]') as HTMLElement;
    const firstTrigger = within(firstCard).getByRole("button", {name: "Vincular traspaso"});
    fireEvent.click(firstTrigger);
    fireEvent.change(await screen.findByRole("combobox", {name: "Contrapartida"}), {target: {value: "bank_row:99"}});
    fireEvent.click(screen.getByRole("button", {name: "Confirmar traspaso"}));
    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "transfer", {
      candidate_type: "bank_row", candidate_id: "99", confirm_fee: false,
    }));

    const pendingFrames = scheduledFrames.length;
    fireEvent.click(screen.getByRole("button", {name: "Cancelar"}));
    const closeFirstFrame = scheduledFrames[pendingFrames];
    expect(closeFirstFrame).toBeDefined();
    const secondCard = (await screen.findByText("Otro cargo")).closest('[data-review-item="bank:42"]') as HTMLElement;
    fireEvent.click(within(secondCard).getByRole("button", {name: "Vincular traspaso"}));
    const secondPanel = await screen.findByRole("region", {name: "Preview y enlace de traspaso"});
    expect(secondPanel).toHaveTextContent(/Origen seleccionado: Cuenta ahorro/);
    const secondSelect = await within(secondPanel).findByRole("combobox", {name: "Contrapartida"});
    secondSelect.focus();

    act(() => closeFirstFrame(0));
    expect(secondSelect).toHaveFocus();

    await act(async () => { finishFirstTransfer(); });
    await waitFor(() => expect(apiMock.bankReview).toHaveBeenCalledTimes(2));

    expect(document.getElementById("bank-transfer-link-panel-42")).toBeInTheDocument();
    expect(secondSelect).toHaveFocus();
    expect(within(secondPanel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recupera las filas antiguas omitidas como posible traspaso fuera de la cola principal", async () => {
    const skippedTransfer = {...bankPayload.rows[0], status: "skipped", possible_transfer: true};
    apiMock.bankReview.mockResolvedValue({...emptyBank, unlinked_transfers: [skippedTransfer]});
    render(<ReviewView connections={[]} />);

    expect(await screen.findByRole("heading", {name: "Traspasos omitidos sin enlazar"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Revisar traspaso"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Revisar traspaso"}));

    expect(await screen.findByText("No hay una contrapartida compatible en otra cuenta dentro de siete días. La fila permanece sin contabilizar.")).toBeInTheDocument();
    expect(apiMock.bankTransferOptions).toHaveBeenCalledWith(skippedTransfer.id);
  });

  it("retira un traspaso enlazado si la recarga posterior falla", async () => {
    const skippedTransfer = {...bankPayload.rows[0], status: "skipped", possible_transfer: true};
    const candidate = {
      candidate_type: "transfer_group" as const,
      candidate_id: "existing-pair",
      source: "existing_pair" as const,
      outgoing: {bank_transaction_id: null, transaction_id: 801, account: {id: account.id, name: account.name}, booking_date: "2026-07-10", description: "Traspaso manual", amount: 24.5},
      incoming: {bank_transaction_id: null, transaction_id: 802, account: {id: 10, name: "Cuenta ahorro"}, booking_date: "2026-07-11", description: "Traspaso manual", amount: 24.5},
      transfer_amount: 24.5,
      fee_amount: 0,
      requires_fee_confirmation: false,
      days_apart: 1,
    };
    apiMock.bankReview.mockResolvedValueOnce({...emptyBank, unlinked_transfers: [skippedTransfer]}).mockRejectedValueOnce(new Error("GET falla"));
    apiMock.bankTransferOptions.mockResolvedValue({ok: true, candidates: [candidate]});
    apiMock.bankReviewAction.mockResolvedValueOnce({ok: true, message: "", removed: [skippedTransfer.id]});
    render(<ReviewView connections={[]} />);

    await screen.findByRole("heading", {name: "Traspasos omitidos sin enlazar"});
    fireEvent.click(screen.getByRole("button", {name: "Revisar traspaso"}));
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar traspaso"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(skippedTransfer.id, "transfer", {
      candidate_type: candidate.candidate_type,
      candidate_id: candidate.candidate_id,
      confirm_fee: false,
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no se pudo actualizar la cola");
    expect(screen.queryByRole("heading", {name: "Traspasos omitidos sin enlazar"})).not.toBeInTheDocument();
  });

  it("permite enlazar una fila a un par manual existente sin volver a crearlo", async () => {
    const manualPair = {
      candidate_type: "transfer_group" as const,
      candidate_id: "9e521990-b884-4b44-9ce7-6c939e1c6d3a",
      source: "existing_pair" as const,
      outgoing: {bank_transaction_id: null, transaction_id: 801, account: {id: account.id, name: account.name}, booking_date: "2026-07-10", description: "Traspaso manual", amount: 24.5},
      incoming: {bank_transaction_id: null, transaction_id: 802, account: {id: 10, name: "Cuenta ahorro"}, booking_date: "2026-07-11", description: "Traspaso manual", amount: 24.5},
      transfer_amount: 24.5,
      fee_amount: 0,
      requires_fee_confirmation: false,
      days_apart: 1,
    };
    apiMock.bankReview.mockResolvedValue(bankPayload);
    apiMock.bankTransferOptions.mockResolvedValue({ok: true, candidates: [manualPair]});
    apiMock.bankReviewAction.mockResolvedValue({ok: true, message: "Origen bancario enlazado al traspaso existente.", removed: [41]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Vincular traspaso"}));
    expect(await screen.findByText("Se enlazará esta fila al par de traspaso existente; el par no se duplicará.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Confirmar traspaso"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "transfer", {
      candidate_type: "transfer_group", candidate_id: manualPair.candidate_id, confirm_fee: false,
    }));
  });

  it("prioriza confirmar la sugerencia y mantiene visibles las señales que requieren revisión", async () => {
    const incomeCategory = {...category, kind: "income" as const};
    apiMock.bankReview.mockResolvedValue({...bankPayload, categories: [incomeCategory], rows: [{...bankPayload.rows[0], kind: "income", category: incomeCategory, suggested_category: incomeCategory, possible_transfer: false}]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    expect(within(card).getByRole("button", {name: "Categoría: Comida"})).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", {name: "Categoría: Comida"}));
    expect(within(card).getByRole("combobox", {name: "Categoría"})).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", {name: "Incorporar"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "confirm", {
      category: 2,
      refund_for: "",
      remember_category: false,
    }));
    fireEvent.click(within(card).getByRole("button", {name: "Más detalles"}));
    expect(within(card).getByRole("checkbox", {name: "Recordar categoría para descripciones futuras"})).toBeInTheDocument();
  });

  it("bloquea confirmar cuando una señal exige revisión manual", async () => {
    apiMock.bankReview.mockResolvedValue(bankPayload);
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    expect(within(card).getByText(/podría ser un traspaso/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", {name: "Incorporar"})).not.toBeInTheDocument();
    expect(within(card).getByRole("button", {name: "Vincular traspaso"})).toBeEnabled();
    expect(apiMock.bankReviewAction).not.toHaveBeenCalled();
  });

  it("permite forzar una fila bancaria con atención usando el draft actual", async () => {
    const incomeCategory = {...category, kind: "income" as const};
    const incomeRow = {...bankPayload.rows[0], kind: "income" as const, category: incomeCategory, suggested_category: incomeCategory, possible_duplicate: true, possible_transfer: false};
    apiMock.bankReview.mockResolvedValue({...bankPayload, categories: [incomeCategory], refund_candidates: [refundCandidate], rows: [incomeRow]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Más detalles"}));
    fireEvent.change(within(card).getByLabelText("Reembolso de gasto"), {target: {value: "77"}});
    fireEvent.click(within(card).getByRole("checkbox", {name: "Recordar categoría para descripciones futuras"}));
    fireEvent.click(within(card).getByRole("button", {name: "Cerrar detalles"}));
    fireEvent.click(within(card).getByRole("button", {name: "Incorporar igualmente"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "force", {
      category: 2,
      refund_for: 77,
      remember_category: true,
    }));
  });

  it("solo presenta como editables los campos que el endpoint bancario persiste", async () => {
    apiMock.bankReview.mockResolvedValue(bankPayload);
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    expect(card.querySelector('[data-review-inline-field="category"] button')).not.toBeNull();
    expect(card.querySelector('[data-review-inline-field="date"] button')).toBeNull();
    expect(card.querySelector('[data-review-inline-field="kind"] button')).toBeNull();
    expect(card.querySelector('[data-review-inline-field="account"] button')).toBeNull();
    expect(card.querySelector('[data-review-inline-field="amount"] button')).toBeNull();
  });


  it("mantiene el error de categoría descrito al abrir el editor y restaura el foco con Escape", async () => {
    apiMock.bankReview.mockResolvedValue({
      ...bankPayload,
      rows: [{...bankPayload.rows[0], suggested_category: null, possible_transfer: false}],
    });
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    const categoryTrigger = within(card).getByRole("button", {name: "Categoría: Sin categoría"});
    const describedBy = categoryTrigger.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("Selecciona una categoría.");

    fireEvent.click(categoryTrigger);
    const categoryEditor = within(card).getByRole("combobox", {name: "Categoría"});
    expect(categoryEditor).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy as string)).toHaveTextContent("Selecciona una categoría.");

    fireEvent.keyDown(categoryEditor, {key: "Escape"});
    await waitFor(() => expect(within(card).getByRole("button", {name: "Categoría: Sin categoría"})).toHaveFocus());
  });

  it("confirma el draft bancario actual con override de categoría y memoria", async () => {
    const nextCategory = {...category, id: 3, name: "Ocio", display_name: "Ocio", kind: "income" as const};
    const incomeCategory = {...category, kind: "income" as const};
    const incomeRow = {...bankPayload.rows[0], kind: "income" as const, category: incomeCategory, suggested_category: incomeCategory, possible_transfer: false};
    apiMock.bankReview.mockResolvedValue({...bankPayload, categories: [incomeCategory, nextCategory], rows: [incomeRow]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Categoría: Comida"}));
    const categoryInput = within(card).getByRole("combobox", {name: "Categoría"});
    fireEvent.focus(categoryInput);
    fireEvent.change(categoryInput, {target: {value: "Ocio"}});
    fireEvent.keyDown(categoryInput, {key: "Enter"});
    fireEvent.click(within(card).getByRole("button", {name: "Más detalles"}));
    fireEvent.click(within(card).getByRole("checkbox", {name: "Recordar categoría para descripciones futuras"}));
    fireEvent.click(within(card).getByRole("button", {name: "Cerrar detalles"}));
    fireEvent.click(within(card).getByRole("button", {name: "Incorporar"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "confirm", {
      category: 3,
      refund_for: "",
      remember_category: true,
    }));
  });

  it("confirma el reembolso elegido desde el draft bancario", async () => {
    const incomeCategory = {...category, kind: "income" as const};
    const incomeRow = {...bankPayload.rows[0], kind: "income" as const, category: incomeCategory, suggested_category: incomeCategory, possible_transfer: false};
    apiMock.bankReview.mockResolvedValue({...bankPayload, categories: [incomeCategory], refund_candidates: [refundCandidate], rows: [incomeRow]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Más detalles"}));
    fireEvent.change(within(card).getByLabelText("Reembolso de gasto"), {target: {value: "77"}});
    fireEvent.click(within(card).getByRole("button", {name: "Cerrar detalles"}));
    fireEvent.click(within(card).getByRole("button", {name: "Incorporar"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "confirm", {
      category: 2,
      refund_for: 77,
      remember_category: false,
    }));
  });

  it("reconfirma un reembolso bancario repartido conservando el gasto vinculado", async () => {
    const incomeCategory = {...category, kind: "income" as const};
    const linkedRefundRow = {
      ...bankPayload.rows[0],
      kind: "income" as const,
      category: null,
      suggested_category: null,
      prediction: null,
      possible_transfer: false,
      reopened_refund: {id: 77, date: "2026-07-08", description: "Compra anterior"},
      reopened_split: {
        transaction_id: 88,
        allocations: [
          {category: incomeCategory, amount: 65, position: 0},
          {category: {...incomeCategory, id: 3, name: "Compensación", display_name: "Compensación"}, amount: 65, position: 1},
        ],
      },
    };
    apiMock.bankReview.mockResolvedValue({...bankPayload, categories: [incomeCategory], rows: [linkedRefundRow]});
    apiMock.bankReviewAction.mockResolvedValue({ok: true, message: "Reembolso bancario confirmado.", removed: [41]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest('[data-review-item="bank:41"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Más detalles"}));
    const refundNote = within(card).getByText("Reembolso vinculado").closest("p");
    expect(refundNote).toHaveTextContent("Compra anterior · 2026-07-08");
    expect(within(card).queryByLabelText("Reembolso de gasto")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", {name: "Cerrar detalles"}));
    fireEvent.click(within(card).getByRole("button", {name: "Reconfirmar reparto"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "confirm", {
      category: "",
      refund_for: 77,
      remember_category: false,
    }));
  });

  it("conserva la tarjeta y muestra el error cuando falla una mutación bancaria", async () => {
    apiMock.bankReview.mockResolvedValue({...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]});
    apiMock.bankReviewAction.mockRejectedValueOnce(new Error("Fallo temporal"));
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    const action = within(card).getByRole("button", {name: "Incorporar"});
    action.focus();
    fireEvent.click(action);

    const bankQueue = screen.getByRole("region", {name: "Cola bancaria"});
    expect(await within(bankQueue).findByRole("alert")).toHaveTextContent("Fallo temporal");
    expect(screen.getByText("Compra bancaria")).toBeInTheDocument();
    expect(action).toHaveFocus();
    expect(document.querySelector(".view-stack > .message.error")).toBeNull();
  });

  it("omite una fila bancaria individual sin volver a descargar las colas", async () => {
    const preparedPayload = {...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]};
    apiMock.bankReview.mockResolvedValueOnce(preparedPayload);
    apiMock.bankReviewAction.mockResolvedValueOnce({ok: true, message: "", removed: [41]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Omitir"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "skip", {}));
    await waitFor(() => expect(screen.queryByText("Compra bancaria")).not.toBeInTheDocument());
    expect(apiMock.bankReview).toHaveBeenCalledTimes(2);
    expect(apiMock.imports).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("region", {name: "Cola bancaria"})).getByRole("status")).toHaveTextContent("Movimiento bancario omitido.");
  });

  it("conserva como traspaso omitido una fila que sale de la cola durante su animación", async () => {
    const possibleTransfer = {...bankPayload.rows[0], possible_transfer: true};
    const skippedTransfer = {...possibleTransfer, status: "skipped"};
    apiMock.bankReview.mockResolvedValueOnce({...bankPayload, rows: [possibleTransfer]}).mockResolvedValueOnce({...emptyBank, unlinked_transfers: [skippedTransfer]});
    apiMock.bankReviewAction.mockResolvedValueOnce({ok: true, message: "Movimiento bancario omitido.", removed: [possibleTransfer.id]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest('[data-review-item="bank:41"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Omitir"}));
    await waitFor(() => expect(card).toHaveAttribute("data-review-exiting", "true"));
    const unlinked = await screen.findByRole("region", {name: "Traspasos omitidos sin enlazar"});
    expect(within(unlinked).getByText(/Compra bancaria/)).toBeInTheDocument();

    const transition = new Event("transitionend", {bubbles: true});
    Object.defineProperty(transition, "propertyName", {value: "block-size"});
    fireEvent(card, transition);
    await waitFor(() => expect(card).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", {name: "Traspasos omitidos sin enlazar"})).getByText(/Compra bancaria/)).toBeInTheDocument();
  });

  it("conserva un draft bancario sucio durante un refresh de otra fila", async () => {
    const nextCategory = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const unrelatedRow = {...bankPayload.rows[0], id: 42, description: "Otra compra bancaria", category: category, suggested_category: null, possible_transfer: false};
    const firstPayload = {...bankPayload, categories: [category, nextCategory], rows: [{...bankPayload.rows[0], possible_transfer: false}, unrelatedRow]};
    const refreshedPayload = {...firstPayload, rows: [
      {...firstPayload.rows[0], category: null, suggested_category: category},
      {...unrelatedRow, category: nextCategory, suggested_category: null},
    ]};
    apiMock.bankReview.mockResolvedValueOnce(firstPayload).mockResolvedValueOnce(refreshedPayload);
    apiMock.syncBank.mockResolvedValueOnce({ok: true});
    render(<ReviewView connections={[connection(10)]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Categoría: Comida"}));
    const categoryInput = within(card).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(categoryInput, {target: {value: "Ocio"}});
    fireEvent.keyDown(categoryInput, {key: "Enter"});
    fireEvent.click(screen.getByRole("button", {name: "Sincronizar banco"}));

    await waitFor(() => expect(apiMock.syncBank).toHaveBeenCalledWith(10));
    await waitFor(() => expect(apiMock.bankReview).toHaveBeenCalledTimes(2));
    expect(await within(card).findByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument();
  });

  it("mantiene la acción bancaria completada aunque no recargue datos ajenos", async () => {
    const preparedPayload = {...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]};
    apiMock.bankReview.mockResolvedValueOnce(preparedPayload);
    apiMock.bankReviewAction.mockResolvedValueOnce({ok: true, message: "", removed: [41]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", {name: "Incorporar"}));

    await waitFor(() => expect(apiMock.bankReviewAction).toHaveBeenCalledWith(41, "confirm", expect.anything()));
    await waitFor(() => expect(screen.queryByText("Compra bancaria")).not.toBeInTheDocument());
    expect(apiMock.bankReview).toHaveBeenCalledTimes(2);
    expect(apiMock.imports).toHaveBeenCalledTimes(1);
  });

  it("envía al bulk la categoría del draft bancario actual", async () => {
    const preparedPayload = {...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]};
    apiMock.bankReview.mockResolvedValue(preparedPayload);
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(card).getByRole("checkbox", {name: "Seleccionar Compra bancaria"}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionados"}));

    await waitFor(() => expect(apiMock.bankReviewBulk).toHaveBeenCalledWith({action: "confirm", rows: [41], categories: {41: "2"}}));
    await waitFor(() => expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByRole("group", {name: "Acciones de selección"})).not.toBeInTheDocument();
  });

  it("mantiene una fila pendiente y comunica los fallos parciales del bulk", async () => {
    const preparedPayload = {...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]};
    apiMock.bankReview.mockResolvedValue(preparedPayload);
    apiMock.bankReviewBulk.mockResolvedValue({ok: true, message: "1 movimiento requiere revisión individual.", removed: [], failed: [41]});
    render(<ReviewView connections={[]} />);

    const card = (await screen.findByText("Compra bancaria")).closest("[data-review-item=\"bank:41\"]") as HTMLElement;
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(card).getByRole("checkbox", {name: "Seleccionar Compra bancaria"}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionados"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("1 movimiento requiere revisión individual.");
    expect(screen.getByText("Compra bancaria")).toBeInTheDocument();
    expect(apiMock.bankReviewBulk).toHaveBeenCalledWith({action: "confirm", rows: [41], categories: {41: "2"}});
  });

  it("en un bulk no contiguo enfoca la siguiente fila útil tras la primera retirada", async () => {
    const rows = [
      {...bankPayload.rows[0], id: 41, description: "Movimiento A", category, suggested_category: null, possible_transfer: false},
      {...bankPayload.rows[0], id: 42, description: "Movimiento B", category, suggested_category: null, possible_transfer: false},
      {...bankPayload.rows[0], id: 43, description: "Movimiento C", category, suggested_category: null, possible_transfer: false},
      {...bankPayload.rows[0], id: 44, description: "Movimiento D", category, suggested_category: null, possible_transfer: false},
    ];
    apiMock.bankReview
      .mockResolvedValueOnce({...bankPayload, rows})
      .mockResolvedValueOnce({...bankPayload, rows: [rows[0], rows[2]]});
    apiMock.bankReviewBulk.mockResolvedValue({ok: true, message: "Movimiento C requiere revisión.", removed: [42, 44], failed: [43]});
    render(<ReviewView connections={[]} />);

    const cardB = (await screen.findByText("Movimiento B")).closest('[data-review-item="bank:42"]') as HTMLElement;
    const cardC = screen.getByText("Movimiento C").closest('[data-review-item="bank:43"]') as HTMLElement;
    const cardD = screen.getByText("Movimiento D").closest('[data-review-item="bank:44"]') as HTMLElement;
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(cardB).getByRole("checkbox", {name: "Seleccionar Movimiento B"}));
    fireEvent.click(within(cardC).getByRole("checkbox", {name: "Seleccionar Movimiento C"}));
    fireEvent.click(within(cardD).getByRole("checkbox", {name: "Seleccionar Movimiento D"}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionados"}));

    await waitFor(() => expect(cardB).toHaveAttribute("data-review-exiting", "true"));
    expect(cardD).toHaveAttribute("data-review-exiting", "true");
    expect(cardC).not.toHaveAttribute("data-review-exiting");
    const finishExit = (card: HTMLElement, propertyName: "max-height" | "block-size") => {
      const event = new Event("transitionend", {bubbles: true});
      Object.defineProperty(event, "propertyName", {value: propertyName});
      fireEvent(card, event);
    };
    finishExit(cardB, "block-size");
    await waitFor(() => expect(cardB).not.toBeInTheDocument());
    finishExit(cardD, "max-height");

    await waitFor(() => expect(cardC.contains(document.activeElement)).toBe(true));
  });

  it("sincroniza todas las conexiones y conserva el resultado parcial", async () => {
    apiMock.syncBank.mockResolvedValueOnce({ok: true}).mockRejectedValueOnce(new Error("Sin conexión"));
    render(<ReviewView connections={[connection(10), connection(11)]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Sincronizar banco"}));

    await waitFor(() => {
      expect(apiMock.syncBank).toHaveBeenCalledWith(10);
      expect(apiMock.syncBank).toHaveBeenCalledWith(11);
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Sincronización bancaria solicitada.");
    expect(screen.getByRole("alert")).toHaveTextContent("1 conexión no pudo iniciar la sincronización");
  });

  it("refleja el estado real de sincronización bancaria en la barra de Review", async () => {
    const onOpenBankConnections = vi.fn();
    const syncingConnection = {
      ...connection(10),
      sync_status: "syncing",
      sync_status_display: "Sincronizando",
    };
    const {rerender} = render(<ReviewView connections={[syncingConnection]} onOpenBankConnections={onOpenBankConnections} />);

    const syncingLabel = await screen.findByText(/Sincronizando banco/);
    expect(syncingLabel.closest(".review-sync-bar")).toHaveAttribute("data-review-sync-state", "syncing");

    rerender(<ReviewView onOpenBankConnections={onOpenBankConnections} connections={[{
      ...syncingConnection,
      status: "needs_reconnect",
      sync_status: "error",
      sync_status_display: "Error",
      last_error: "Reconecta la cuenta",
    }]} />);

    const errorLabel = await screen.findByText(/Conexión interrumpida/);
    expect(errorLabel.closest(".review-sync-bar")).toHaveAttribute("data-review-sync-state", "error");
    fireEvent.click(screen.getByRole("button", {name: "Revisar conexión"}));
    expect(onOpenBankConnections).toHaveBeenCalledOnce();
  });

  it("mantiene la carga paginada y los payloads de acciones CSV", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    render(<ReviewView connections={[]} />);

    expect(await screen.findByText("movimientos.csv")).toBeInTheDocument();
    await waitFor(() => expect(apiMock.importRows).toHaveBeenCalledWith(61, expect.any(URLSearchParams)));
    expect((apiMock.importRows.mock.calls[0][1] as URLSearchParams).toString()).toBe("page=1&status=pending");

    fireEvent.click(screen.getByRole("button", {name: "Expandir CSV"}));
    expect(await screen.findByRole("button", {name: "Pendientes (1)"})).toHaveAttribute("aria-pressed", "true");
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]');
    expect(row).not.toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(row as HTMLElement).getByRole("checkbox", {name: "Seleccionar Compra CSV"}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Omitir seleccionadas"}));
    await waitFor(() => expect(apiMock.importBulk).toHaveBeenCalledWith(61, {action: "skip", rows: [71]}));

    await waitFor(() => expect(within(row as HTMLElement).getByRole("button", {name: "Importar"})).toBeEnabled());
    fireEvent.click(within(row as HTMLElement).getByRole("button", {name: "Importar"}));
    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "confirm", input: {
      category: "",
      new_category: "",
      new_subcategory: "",
    }}));

    fireEvent.click(screen.getByRole("button", {name: "Todas (1)"}));
    await waitFor(() => expect(apiMock.importRows).toHaveBeenLastCalledWith(61, expect.any(URLSearchParams)));
    const lastImportRowsCall = apiMock.importRows.mock.calls[apiMock.importRows.mock.calls.length - 1];
    expect((lastImportRowsCall[1] as URLSearchParams).toString()).toBe("page=1");
  });

  it("reconfirma un CSV repartido sin permitir una categoría única", async () => {
    const reopenedRows: ImportRowsPayload = {
      ...csvRows,
      results: [{
        ...csvRows.results[0],
        transaction_id: 81,
        category_rule_matches: [{id: 88, description: "Compra CSV", kind: "expense", category, priority: 1, match_mode: "exact", account_id: null, amount_min: null, amount_max: null}],
        reopened_split: {
          transaction_id: 81,
          allocations: [{category, amount: 10, position: 0}, {category: null, amount: 5, position: 1}],
        },
        reopened_refund: {id: 72, date: "2026-07-01", description: "Compra original CSV"},
      }],
    };
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue(reopenedRows);
    apiMock.importRowAction.mockResolvedValue({ok: true, message: "Reparto reconfirmado.", removed: [71]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    expect(row).toHaveTextContent("Reabierto");
    expect(within(row).getByRole("button", {name: "Reconfirmar reparto"})).toBeInTheDocument();
    expect(row.querySelector('[data-review-inline-field="category"] button')).toBeNull();
    expect(within(row).queryByRole("button", {name: "Guardar categoría"})).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", {name: "Más detalles"}));
    const preserved = within(row).getByText("Reparto existente").closest("p");
    expect(preserved).toHaveTextContent("Comida");
    expect(preserved).toHaveTextContent("Sin categoría");
    const refundNote = within(row).getByText("Reembolso vinculado").closest("p");
    expect(refundNote).toHaveTextContent("Compra original CSV · 2026-07-01");
    expect(within(row).queryByRole("textbox", {name: "Nueva categoría"})).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", {name: "Cerrar detalles"}));

    fireEvent.click(within(row).getByRole("button", {name: "Reconfirmar reparto"}));
    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "confirm", input: {
      category: "",
      new_category: "",
      new_subcategory: "",
    }}));
  });

  it("al borrar el lote CSV activo limpia selección y continúa con el siguiente lote", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const secondBatch = {...csvImports.batches[0], id: 62, filename: "otro.csv"};
    const secondRows = {
      ...csvRows,
      batch: secondBatch,
      categories: [category, ocio],
      results: [{...csvRows.results[0], id: 72, batch_id: 62, description: "Otra compra CSV"}],
    };
    const importsWithTwoBatches = {...csvImports, batches: [csvImports.batches[0], secondBatch]};
    const importsAfterDeletion = {...csvImports, batches: [secondBatch]};
    let deleted = false;
    apiMock.imports.mockImplementation(() => Promise.resolve(deleted ? importsAfterDeletion : importsWithTwoBatches));
    apiMock.importRows.mockImplementation((batchId: number) => {
      if (batchId === 61 && deleted) return Promise.reject(new Error("deleted batch"));
      return Promise.resolve(batchId === 62 ? secondRows : {...csvRows, categories: [category, ocio]});
    });
    apiMock.deleteImportBatch.mockImplementation(async () => {
      deleted = true;
      return {ok: true, message: "Lote eliminado"};
    });
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.click(await within(row).findByRole("option", {name: "Ocio"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(row).getByRole("checkbox", {name: "Seleccionar Compra CSV"}));

    fireEvent.click(screen.getByRole("button", {name: "Eliminar lote CSV movimientos.csv"}));
    expect(await screen.findByRole("dialog", {name: /Eliminar el lote CSV/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Eliminar lote"}));

    await waitFor(() => expect(apiMock.deleteImportBatch).toHaveBeenCalledWith(61));
    expect(await screen.findByRole("status")).toHaveTextContent("Lote eliminado");
    expect((await screen.findAllByText("otro.csv")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("Otra compra CSV")).toBeInTheDocument();
    expect(screen.queryByText("movimientos.csv")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Acciones de selección, 0 seleccionados"})).toBeDisabled();
  });

  it("permite buscar y elegir una categoría de importación con el teclado", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue({...csvRows, categories: [category, {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2}]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    expect(within(row).getByRole("option", {name: "Ocio"})).toBeInTheDocument();
    fireEvent.keyDown(combobox, {key: "Enter"});
    expect(within(row).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", {name: "Importar"}));
    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "confirm", input: expect.objectContaining({category: "3"})}));
  });

  it("deriva force del draft actual para una fila CSV duplicada", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue({...csvRows, results: [{...csvRows.results[0], possible_duplicate: true}]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    expect(row).toHaveAttribute("data-review-preparation", "needs_attention");
    expect(within(row).queryByRole("button", {name: "Importar"})).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", {name: "Importar igualmente"}));

    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "force", input: {
      category: "",
      new_category: "",
      new_subcategory: "",
    }}));
  });

  it("guarda categoría y nombres nuevos sin retirar la fila CSV", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Más detalles"}));
    fireEvent.change(within(row).getByRole("textbox", {name: "Nueva categoría"}), {target: {value: "Compras personales"}});
    fireEvent.change(within(row).getByRole("textbox", {name: "Subcategoría"}), {target: {value: "Hogar"}});
    fireEvent.click(within(row).getByRole("button", {name: "Cerrar detalles"}));
    fireEvent.click(within(row).getByRole("button", {name: "Guardar categoría"}));

    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "category", input: {
      category: "",
      new_category: "Compras personales",
      new_subcategory: "Hogar",
    }}));
    expect(row).not.toHaveAttribute("data-review-exiting");
  });

  it("conserva la fila y su draft cuando falla una acción CSV", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue({...csvRows, categories: [category, {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2}]});
    apiMock.importRowAction.mockRejectedValueOnce(new Error("API no disponible"));
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    await waitFor(() => expect(within(row).getByRole("button", {name: "Categoría: Ocio"})).toHaveFocus());
    const importButton = within(row).getByRole("button", {name: "Importar"});
    importButton.focus();
    fireEvent.click(importButton);

    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    expect(await within(csv).findByRole("alert")).toHaveTextContent("No se pudo procesar la fila CSV: API no disponible");
    expect(row).toBeInTheDocument();
    expect(within(row).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument();
    expect(importButton).toHaveFocus();
  });

  it("separa éxito CSV y fallo de refresh conservando rows y draft", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce({...csvRows, categories: [category, ocio]}).mockRejectedValueOnce(new Error("GET CSV caído"));
    apiMock.importRowAction.mockResolvedValueOnce({ok: true, message: "Categoría guardada", removed: []});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    fireEvent.click(within(row).getByRole("button", {name: "Guardar categoría"}));

    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "category", input: {category: "3", new_category: "", new_subcategory: ""}}));
    expect(await within(screen.getByRole("region", {name: "Importaciones CSV"})).findByRole("alert")).toHaveTextContent("La acción CSV se completó, pero no se pudo actualizar la cola");
    expect(screen.getByText("Compra CSV")).toBeInTheDocument();
    expect(within(row).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument();
  });

  it("confirma el bulk seguro limpio una sola vez con el endpoint existente", async () => {
    let resolveConfirmation: ((value: {ok: true; message: string; imported: number; removed: number[]}) => void) | undefined;
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue(csvRows);
    apiMock.confirmImportBatch.mockImplementation(() => new Promise((resolve) => {
      resolveConfirmation = resolve;
    }));
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const safeButton = await screen.findByRole("button", {name: "Confirmar lote seguro"});
    fireEvent.click(safeButton);
    await waitFor(() => expect(safeButton).toHaveAttribute("aria-disabled", "true"));
    expect(safeButton).toHaveAttribute("aria-busy", "true");
    expect(safeButton).not.toBeDisabled();
    fireEvent.click(safeButton);
    expect(apiMock.confirmImportBatch).toHaveBeenCalledTimes(1);
    resolveConfirmation?.({ok: true, message: "1 fila importada.", imported: 1, removed: [71]});

    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    await waitFor(() => expect(within(csv).getByRole("status")).toHaveTextContent("1 fila importada."));
  });

  it("bloquea el bulk seguro cuando una fila visible tiene draft dirty", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue({...csvRows, categories: [category, ocio]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar lote seguro"}));

    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    expect(await within(csv).findByRole("alert")).toHaveTextContent("Hay cambios locales sin guardar en filas de este lote");
    expect(screen.getAllByText("Hay cambios locales sin guardar en filas de este lote. Guárdalos antes de confirmar el lote seguro.")).toHaveLength(1);
    expect(apiMock.confirmImportBatch).not.toHaveBeenCalled();
    expect(within(row).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument();
  });

  it("bloquea el bulk seguro por un draft dirty de una página anterior", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const secondRow = {...csvRows.results[0], id: 72, row_number: 3, description: "Segunda compra CSV"};
    const firstPage = {...csvRows, batch: {...csvRows.batch, pending_count: 2, row_count: 2}, count: 2, num_pages: 2, has_next: true, categories: [category, ocio]};
    const secondPage = {...firstPage, page: 2, has_previous: true, has_next: false, results: [secondRow]};
    apiMock.imports.mockResolvedValue({...csvImports, batches: [{...csvImports.batches[0], pending_count: 2, row_count: 2}]});
    apiMock.importRows.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage).mockResolvedValueOnce(firstPage);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const firstRow = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(firstRow).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(firstRow).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    fireEvent.click(screen.getByRole("button", {name: "Página siguiente CSV"}));

    expect(await screen.findByText("Segunda compra CSV")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar lote seguro"}));

    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    expect(await within(csv).findByRole("alert")).toHaveTextContent("Hay cambios locales sin guardar");
    expect(apiMock.confirmImportBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "Página anterior CSV"}));
    const restored = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    expect(within(restored).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument();
  });

  it("ignora drafts dirty de otro lote al confirmar el lote actual", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const secondBatch = {...csvImports.batches[0], id: 62, filename: "otro.csv"};
    const firstRows = {...csvRows, categories: [category, ocio]};
    const secondRows = {...csvRows, batch: secondBatch, categories: [category, ocio], results: [{...csvRows.results[0], id: 72, batch_id: 62, description: "Otra compra CSV"}]};
    const importsWithTwoBatches = {...csvImports, batches: [csvImports.batches[0], secondBatch]};
    apiMock.imports.mockResolvedValue(importsWithTwoBatches);
    apiMock.importRows.mockResolvedValueOnce(firstRows).mockResolvedValueOnce(secondRows).mockResolvedValueOnce(firstRows);
    apiMock.confirmImportBatch.mockResolvedValue({ok: true, message: "1 fila importada.", imported: 1, removed: [71]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    await screen.findByText("Compra CSV");
    const otherBatchButton = screen.getAllByRole("button").find((button) => button.classList.contains("batch-select-button") && button.textContent?.includes("otro.csv"));
    fireEvent.click(otherBatchButton as HTMLButtonElement);
    const otherRow = (await screen.findByText("Otra compra CSV")).closest('[data-review-item="csv:72"]') as HTMLElement;
    fireEvent.click(within(otherRow).getByRole("button", {name: "Categoría: Sin categoría"}));
    const otherCombobox = within(otherRow).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(otherCombobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(otherCombobox, {key: "Enter"});
    const originalBatchButton = screen.getAllByRole("button").find((button) => button.classList.contains("batch-select-button") && button.textContent?.includes("movimientos.csv"));
    fireEvent.click(originalBatchButton as HTMLButtonElement);

    expect(await screen.findByText("Compra CSV")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar lote seguro"}));

    await waitFor(() => expect(apiMock.confirmImportBatch).toHaveBeenCalledWith(61));
    expect(screen.queryByText("Hay cambios locales sin guardar")).not.toBeInTheDocument();
    expect(screen.getByText("Compra CSV")).toBeInTheDocument();
  });

  it("retira solo los IDs devueltos por safe bulk y deja duplicados pendientes", async () => {
    const duplicate = {...csvRows.results[0], id: 72, row_number: 3, description: "Compra duplicada", possible_duplicate: true};
    const initialRows = {...csvRows, batch: {...csvRows.batch, pending_count: 2, row_count: 2}, count: 2, categories: [category], results: [csvRows.results[0], duplicate]};
    const refreshedRows = {...initialRows, batch: {...initialRows.batch, pending_count: 1}, count: 1, results: [duplicate]};
    apiMock.imports.mockResolvedValue({...csvImports, batches: [{...csvImports.batches[0], pending_count: 1, row_count: 2}]});
    apiMock.importRows.mockResolvedValueOnce(initialRows).mockResolvedValueOnce(refreshedRows);
    apiMock.confirmImportBatch.mockResolvedValue({ok: true, message: "1 fila importada.", imported: 1, removed: [71]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const safeRow = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar lote seguro"}));

    await waitFor(() => expect(safeRow).toHaveAttribute("data-review-exiting", "true"));
    const event = new Event("transitionend", {bubbles: true});
    Object.defineProperty(event, "propertyName", {value: "max-height"});
    fireEvent(safeRow, event);
    expect(await screen.findByText("Compra duplicada")).toBeInTheDocument();
    expect(screen.queryByText("Compra CSV")).not.toBeInTheDocument();
    expect(apiMock.confirmImportBatch).toHaveBeenCalledWith(61);
  });

  it("muestra dentro del panel CSV el fallo al refrescar después del bulk seguro", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce(csvRows).mockRejectedValueOnce(new Error("CSV no disponible"));
    apiMock.confirmImportBatch.mockResolvedValue({ok: true, message: "Lote confirmado", imported: 0, removed: []});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar lote seguro"}));

    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    const feedback = await within(csv).findByRole("alert");
    const message = "El lote CSV se confirmó, pero no se pudo actualizar la cola: CSV no disponible. Reintenta.";
    expect(feedback).toHaveTextContent(message);
    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  it("retira la tarjeta tras confirmación CSV aunque falle el refresh y enfoca empty", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce(csvRows).mockRejectedValueOnce(new Error("GET CSV caído"));
    apiMock.importRowAction.mockResolvedValueOnce({ok: true, message: "Fila importada", removed: [71]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Importar"}));

    await waitFor(() => expect(row).toHaveAttribute("data-review-exiting", "true"));
    const event = new Event("transitionend", {bubbles: true});
    Object.defineProperty(event, "propertyName", {value: "max-height"});
    fireEvent(row, event);

    const empty = await screen.findByText(/Este lote no tiene filas pendientes/);
    await waitFor(() => expect(document.activeElement).toBe(empty));
    expect(screen.queryByText("Compra CSV")).not.toBeInTheDocument();
    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    expect(within(csv).getByRole("alert")).toHaveTextContent("La acción CSV se completó, pero no se pudo actualizar la cola");
    expect(apiMock.importRowAction).toHaveBeenCalledTimes(1);
  });

  it("actualiza un draft CSV limpio con el valor remoto nuevo", async () => {
    const remoteRows = {...csvRows, results: [{...csvRows.results[0], category}], categories: [category]};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce(csvRows).mockResolvedValueOnce(remoteRows);
    render(<ReviewView connections={[connection(10)]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(await screen.findByRole("button", {name: "Sincronizar banco"}));

    await waitFor(() => expect(within(row).getByRole("button", {name: "Categoría: Comida"})).toBeInTheDocument());
  });

  it("conserva un draft CSV dirty frente a una actualización remota", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const initialRows = {...csvRows, categories: [category, ocio]};
    const remoteRows = {...initialRows, results: [{...csvRows.results[0], category}]};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce(initialRows).mockResolvedValueOnce(remoteRows);
    render(<ReviewView connections={[connection(10)]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    fireEvent.click(await screen.findByRole("button", {name: "Sincronizar banco"}));

    await waitFor(() => expect(within(row).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument());
  });

  it("conserva un draft CSV dirty al cambiar el filtro", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const initialRows = {...csvRows, categories: [category, ocio]};
    const allRows = {...initialRows, count: 1, results: [{...csvRows.results[0], category: null}]};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce(initialRows).mockResolvedValueOnce(allRows);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    fireEvent.click(screen.getByRole("button", {name: "Todas (1)"}));

    const filteredRow = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    await waitFor(() => expect(within(filteredRow).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument());
  });

  it("conserva un draft CSV dirty al paginar y volver", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const secondRow = {...csvRows.results[0], id: 72, row_number: 3, description: "Segunda compra CSV"};
    const firstPage = {...csvRows, batch: {...csvRows.batch, pending_count: 2, row_count: 2}, count: 2, num_pages: 2, has_next: true, categories: [category, ocio]};
    const secondPage = {...firstPage, page: 2, has_previous: true, has_next: false, results: [secondRow]};
    apiMock.imports.mockResolvedValue({...csvImports, batches: [{...csvImports.batches[0], pending_count: 2, row_count: 2}]});
    apiMock.importRows.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage).mockResolvedValueOnce(firstPage);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    fireEvent.click(screen.getByRole("button", {name: "Página siguiente CSV"}));
    expect(await screen.findByText("Segunda compra CSV")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Página anterior CSV"}));

    const restored = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    await waitFor(() => expect(within(restored).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument());
  });

  it("conserva un draft CSV dirty al cambiar de lote y volver", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const secondBatch = {...csvImports.batches[0], id: 62, filename: "otro.csv"};
    const secondBatchRows = {...csvRows, batch: secondBatch, results: [{...csvRows.results[0], id: 72, batch_id: 62, description: "Otra compra CSV"}]};
    const importsWithTwoBatches = {...csvImports, batches: [csvImports.batches[0], secondBatch]};
    const initialRows = {...csvRows, categories: [category, ocio]};
    apiMock.imports.mockResolvedValue(importsWithTwoBatches);
    apiMock.importRows.mockResolvedValueOnce(initialRows).mockResolvedValueOnce(secondBatchRows).mockResolvedValueOnce(initialRows);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.keyDown(combobox, {key: "Enter"});
    const otherBatchButton = screen.getAllByRole("button").find((button) => button.classList.contains("batch-select-button") && button.textContent?.includes("otro.csv"));
    expect(otherBatchButton).toBeDefined();
    fireEvent.click(otherBatchButton as HTMLButtonElement);
    expect(await screen.findByText("Otra compra CSV")).toBeInTheDocument();
    const originalBatchButton = screen.getAllByRole("button").find((button) => button.classList.contains("batch-select-button") && button.textContent?.includes("movimientos.csv"));
    expect(originalBatchButton).toBeDefined();
    fireEvent.click(originalBatchButton as HTMLButtonElement);

    const restored = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    await waitFor(() => expect(within(restored).getByRole("button", {name: "Categoría: Ocio"})).toBeInTheDocument());
  });

  it("bloquea edición, selección y acciones de fila durante un bulk CSV", async () => {
    let resolveBulk: ((value: {ok: true; message: string; removed: number[]; failed: number[]}) => void) | undefined;
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue(csvRows);
    apiMock.importBulk.mockImplementation(() => new Promise((resolve) => {
      resolveBulk = resolve;
    }));
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox", {name: /^Seleccionar/}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionadas"}));

    expect(within(row).getByRole("checkbox", {name: /^Seleccionar/})).toBeDisabled();
    expect(within(row).queryByRole("button", {name: "Importar"})).not.toBeInTheDocument();
    expect(row.querySelector('[data-review-inline-field="category"] button')).toBeNull();
    expect(within(row).queryByRole("button", {name: "Más detalles"})).not.toBeInTheDocument();

    resolveBulk?.({ok: true, message: "Sin cambios", removed: [], failed: []});
    await waitFor(() => expect(within(row).getByRole("button", {name: "Importar"})).toBeEnabled());
    fireEvent.click(within(row).getByRole("button", {name: "Más detalles"}));
    expect(within(row).getByRole("textbox", {name: "Nueva categoría"})).toBeEnabled();
  });

  it("limpia draft y selección CSV cuando la fila desaparece", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    const emptyRows = {...csvRows, batch: {...csvRows.batch, pending_count: 0}, count: 0, results: [], categories: [category, ocio]};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce({...csvRows, categories: [category, ocio]}).mockResolvedValueOnce(emptyRows).mockResolvedValueOnce({...csvRows, categories: [category, ocio]});
    apiMock.importBulk.mockResolvedValueOnce({ok: true, message: "Fila importada", removed: [71], failed: []});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.click(await within(row).findByRole("option", {name: "Ocio"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(row).getByRole("checkbox", {name: /^Seleccionar/}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionadas"}));

    await waitFor(() => expect(row).toHaveAttribute("data-review-exiting", "true"));
    const event = new Event("transitionend", {bubbles: true});
    Object.defineProperty(event, "propertyName", {value: "max-height"});
    fireEvent(row, event);
    await waitFor(() => expect(screen.getByText(/Este lote no tiene filas pendientes/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", {name: "Todas (1)"}));
    const restored = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    expect(within(restored).getByRole("button", {name: "Categoría: Sin categoría"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    expect(within(restored).getByRole("checkbox", {name: /^Seleccionar/})).not.toBeChecked();
  });

  it("el modo selección CSV solo incluye filas pending en Todas", async () => {
    const imported = {...csvRows.results[0], id: 72, row_number: 3, description: "Compra CSV importada", category, status: "imported" as const, status_display: "Importada", transaction_id: 90};
    const allRows = {...csvRows, batch: {...csvRows.batch, pending_count: 1, row_count: 2}, count: 2, categories: [category], results: [csvRows.results[0], imported]};
    apiMock.imports.mockResolvedValue({...csvImports, batches: [{...csvImports.batches[0], pending_count: 1, row_count: 2}]});
    apiMock.importRows.mockResolvedValue(allRows);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    fireEvent.click(await screen.findByRole("button", {name: /^Todas \(/}));
    expect(await screen.findByText("Compra CSV importada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    expect(screen.getAllByRole("checkbox", {name: /^Seleccionar/})).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", {name: /^Seleccionar/}));

    expect(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionadas"})).toBeInTheDocument();
  });

  it("el bulk CSV usa el draft actual de cada fila", async () => {
    const ocio = {...category, id: 3, name: "Ocio", display_name: "Ocio", sort_order: 2};
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue({...csvRows, categories: [category, ocio]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Categoría: Sin categoría"}));
    const combobox = within(row).getByRole("combobox", {name: "Categoría"});
    fireEvent.change(combobox, {target: {value: "Ocio"}});
    fireEvent.click(await within(row).findByRole("option", {name: "Ocio"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(row).getByRole("checkbox", {name: /^Seleccionar/}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionadas"}));

    await waitFor(() => expect(apiMock.importBulk).toHaveBeenCalledWith(61, {action: "confirm", rows: [71], categories: {71: "3"}}));
    await waitFor(() => expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByRole("group", {name: "Acciones de selección"})).not.toBeInTheDocument();
  });

  it("el bulk CSV conserva fallos parciales y enfoca la siguiente fila", async () => {
    const secondRow = {...csvRows.results[0], id: 72, row_number: 3, description: "Segunda compra CSV"};
    const firstPayload = {...csvRows, batch: {...csvRows.batch, pending_count: 2, row_count: 2}, count: 2, results: [csvRows.results[0], secondRow]};
    const refreshedPayload = {...firstPayload, results: [secondRow]};
    apiMock.imports.mockResolvedValue({...csvImports, batches: [{...csvImports.batches[0], pending_count: 2, row_count: 2}]});
    apiMock.importRows.mockResolvedValueOnce(firstPayload).mockResolvedValue(refreshedPayload);
    apiMock.importBulk.mockResolvedValueOnce({ok: true, message: "1 fila requiere revisión individual.", removed: [71], failed: [72]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    const firstCard = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    const secondCard = (await screen.findByText("Segunda compra CSV")).closest('[data-review-item="csv:72"]') as HTMLElement;
    fireEvent.click(within(firstCard).getByRole("checkbox", {name: /^Seleccionar/}));
    fireEvent.click(within(secondCard).getByRole("checkbox", {name: /^Seleccionar/}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Importar seleccionadas"}));

    await waitFor(() => expect(firstCard).toHaveAttribute("data-review-exiting", "true"));
    expect(secondCard).not.toHaveAttribute("data-review-exiting");
    const event = new Event("transitionend", {bubbles: true});
    Object.defineProperty(event, "propertyName", {value: "max-height"});
    fireEvent(firstCard, event);
    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    await waitFor(() => expect(within(csv).getByRole("alert")).toHaveTextContent("1 fila requiere revisión individual."));
    expect(screen.getAllByText("1 fila requiere revisión individual.")).toHaveLength(1);
    await waitFor(() => expect(secondCard.contains(document.activeElement)).toBe(true));
  });

  it("muestra dentro del panel CSV el fallo al refrescar después de una acción masiva", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValueOnce(csvRows).mockRejectedValueOnce(new Error("CSV no disponible"));
    apiMock.importBulk.mockResolvedValue({ok: true, message: "Fila importada", removed: [71], failed: []});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox", {name: /^Seleccionar/}));
    fireEvent.click(within(await openSelectionActions()).getByRole("button", {name: "Omitir seleccionadas"}));

    const csv = screen.getByRole("region", {name: "Importaciones CSV"});
    const feedback = await within(csv).findByRole("alert");
    expect(feedback).toHaveTextContent("La acción CSV masiva se completó, pero no se pudo actualizar la cola: CSV no disponible. Reintenta.");
    expect(screen.getAllByText("La acción CSV masiva se completó, pero no se pudo actualizar la cola: CSV no disponible. Reintenta.")).toHaveLength(1);
  });

  it("reutiliza la salida y enfoca la siguiente fila CSV tras confirmar", async () => {
    const secondRow = {...csvRows.results[0], id: 72, row_number: 3, description: "Segunda compra CSV"};
    const firstPayload = {...csvRows, count: 2, results: [csvRows.results[0], secondRow]};
    const refreshedPayload = {...csvRows, results: [secondRow]};
    apiMock.imports.mockResolvedValue({...csvImports, batches: [{...csvImports.batches[0], pending_count: 2, row_count: 2}]});
    apiMock.importRows.mockResolvedValueOnce(firstPayload).mockResolvedValue(refreshedPayload);
    apiMock.importRowAction.mockResolvedValue({ok: true, message: "Fila importada", removed: [71]});
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const firstCard = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    const secondCard = screen.getByText("Segunda compra CSV").closest('[data-review-item="csv:72"]') as HTMLElement;
    fireEvent.click(within(firstCard).getByRole("button", {name: "Importar"}));

    await waitFor(() => expect(firstCard).toHaveAttribute("data-review-exiting", "true"));
    const event = new Event("transitionend", {bubbles: true});
    Object.defineProperty(event, "propertyName", {value: "max-height"});
    fireEvent(firstCard, event);
    await waitFor(() => expect(firstCard).not.toBeInTheDocument());
    await waitFor(() => expect(secondCard.contains(document.activeElement)).toBe(true));
  });

  it("omite una fila CSV con la operación productiva existente", async () => {
    apiMock.imports.mockResolvedValue(csvImports);
    render(<ReviewView connections={[]} />);

    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const row = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", {name: "Omitir"}));

    await waitFor(() => expect(apiMock.importRowAction).toHaveBeenCalledWith(71, {action: "skip", input: {}}));
  });

  it("lleva filtros y selección modal del Lab a la cola productiva", async () => {
    const preparedRow = {...bankPayload.rows[0], possible_transfer: false, category};
    const attentionRow = {...bankPayload.rows[0], id: 42, description: "Compra duplicada", possible_transfer: false, possible_duplicate: true, category};
    apiMock.bankReview.mockResolvedValue({...bankPayload, rows: [preparedRow, attentionRow]});
    render(<ReviewView connections={[]} />);

    expect(await screen.findByText("Compra bancaria")).toBeInTheDocument();
    expect(screen.getByText("Compra duplicada")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Preparados"}));
    expect(screen.getByText("Compra bancaria")).toBeInTheDocument();
    expect(screen.queryByText("Compra duplicada")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Necesitan atención"}));
    expect(screen.queryByText("Compra bancaria")).not.toBeInTheDocument();
    expect(screen.getByText("Compra duplicada")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Todos"}));
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));

    const preparedCard = screen.getByText("Compra bancaria").closest('[data-review-item="bank:41"]') as HTMLElement;
    const attentionCard = screen.getByText("Compra duplicada").closest('[data-review-item="bank:42"]') as HTMLElement;
    expect(within(preparedCard).getByRole("checkbox", {name: "Seleccionar Compra bancaria"})).toBeInTheDocument();
    expect(within(attentionCard).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(preparedCard).queryByRole("button", {name: "Incorporar"})).not.toBeInTheDocument();
    expect(within(attentionCard).queryByRole("button", {name: "Incorporar igualmente"})).not.toBeInTheDocument();

    fireEvent.click(within(preparedCard).getByRole("checkbox", {name: "Seleccionar Compra bancaria"}));
    const selectionActions = await openSelectionActions();
    expect(within(selectionActions).getByText("1 seleccionado")).toBeInTheDocument();
    expect(within(selectionActions).getByRole("button", {name: "Importar seleccionados"})).toBeInTheDocument();
    expect(document.querySelector(".bank-review-panel .bulk-toolbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", {name: "Necesitan atención"}));
    expect(screen.getByRole("button", {name: "Seleccionar"})).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", {name: "Acciones de selección"})).not.toBeInTheDocument();
  });

  it("unifica selección mixta Bank y CSV y restaura el foco al cancelar", async () => {
    apiMock.bankReview.mockResolvedValue({...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]});
    apiMock.imports.mockResolvedValue(csvImports);
    apiMock.importRows.mockResolvedValue(csvRows);
    render(<ReviewView connections={[]} />);

    const bankCard = (await screen.findByText("Compra bancaria")).closest('[data-review-item="bank:41"]') as HTMLElement;
    fireEvent.click(await screen.findByRole("button", {name: "Expandir CSV"}));
    const csvCard = (await screen.findByText("Compra CSV")).closest('[data-review-item="csv:71"]') as HTMLElement;

    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(bankCard).getByRole("checkbox", {name: "Seleccionar Compra bancaria"}));
    fireEvent.click(within(csvCard).getByRole("checkbox", {name: "Seleccionar Compra CSV"}));

    const selectionActions = await openSelectionActions();
    expect(within(selectionActions).getByText("2 seleccionados")).toBeInTheDocument();
    expect(within(selectionActions).getByRole("button", {name: "Importar seleccionados"})).toBeInTheDocument();
    expect(within(selectionActions).getByRole("button", {name: "Omitir seleccionados"})).toBeInTheDocument();
    expect(within(selectionActions).getByRole("button", {name: "Importar seleccionadas"})).toBeInTheDocument();
    expect(within(selectionActions).getByRole("button", {name: "Omitir seleccionadas"})).toBeInTheDocument();
    expect(document.querySelector(".bank-review-panel .bulk-toolbar")).toBeNull();
    expect(document.querySelector(".csv-selection-toolbar")).toBeNull();

    fireEvent.click(within(selectionActions).getByRole("button", {name: "Cancelar"}));

    const selectionTrigger = screen.getByRole("button", {name: "Seleccionar"});
    expect(selectionTrigger).toHaveFocus();
    expect(selectionTrigger).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", {name: "Acciones de selección"})).not.toBeInTheDocument();
    expect(within(bankCard).queryByRole("checkbox", {name: "Seleccionar Compra bancaria"})).not.toBeInTheDocument();
    expect(within(csvCard).queryByRole("checkbox", {name: "Seleccionar Compra CSV"})).not.toBeInTheDocument();
  });

  it("respeta la privacidad global en la cola bancaria productiva", async () => {
    apiMock.bankReview.mockResolvedValue({...bankPayload, rows: [{...bankPayload.rows[0], possible_transfer: false}]});
    render(<ReviewView connections={[]} privateAmounts />);

    const card = (await screen.findByText("Compra bancaria")).closest('[data-review-item="bank:41"]') as HTMLElement;
    const amount = within(card).getByLabelText("Importe: ••••••");
    expect(amount).toHaveTextContent("••••••");
    expect(card).not.toHaveTextContent("24,50");
    expect(screen.getAllByText("••••••").length).toBeGreaterThanOrEqual(2);
  });

});
