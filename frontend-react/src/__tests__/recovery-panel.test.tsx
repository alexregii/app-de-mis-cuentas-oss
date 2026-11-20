import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {RecoveryPayload, ScheduledBackupStatus} from "../features/settings/api";
import {RecoveryPanel} from "../features/settings/RecoveryPanel";

const apiMock = vi.hoisted(() => ({
  createBackup: vi.fn(),
  previewRestore: vi.fn(),
  recovery: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("../features/settings/api", () => ({settingsApi: apiMock}));

const missingBackupStatus: ScheduledBackupStatus = {
  worker: "healthy", schedule: "missing", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: null,
};
const healthyBackupStatus: ScheduledBackupStatus = {
  worker: "healthy", schedule: "healthy", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: "2026-10-21T09:30:00Z",
};
const emptyRecovery: RecoveryPayload = {ok: true, latest_backup: null, backup_status: missingBackupStatus, restore: {available: true, status: null}};
const populatedRecovery: RecoveryPayload = {
  ok: true,
  latest_backup: {name: "manual-fixture.zip", created_at: "2026-10-21T09:30:00Z", size: 2048, destination: "fixture"},
  backup_status: healthyBackupStatus,
  restore: {available: true, status: null},
};
const pendingRecovery: RecoveryPayload = {
  ...populatedRecovery,
  restore: {available: true, status: {status: "restoring", message: "Restaurando datos…"}},
};
const completedRecovery: RecoveryPayload = {
  ...populatedRecovery,
  restore: {available: true, status: {status: "completed", message: "Restauración completada."}},
};

function renderPanel() {
  const setStatus = vi.fn();
  render(<RecoveryPanel />);
  return {setStatus};
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.recovery.mockResolvedValue(emptyRecovery);
  apiMock.createBackup.mockResolvedValue(populatedRecovery);
  apiMock.previewRestore.mockResolvedValue({ok: true, token: "a".repeat(32), impact: {files: 12, media_files: 3, size: 4096}});
  apiMock.restore.mockResolvedValue({ok: true, message: "Restauración solicitada; la aplicación se reiniciará."});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RecoveryPanel", () => {
  it("descarga Excel y conserva la exportación portable", () => {
    renderPanel();

    expect(screen.getByRole("link", {name: "Descargar Excel"})).toHaveAttribute("href", "/exportar/excel/");
    expect(screen.getByRole("link", {name: "Descargar exportación portable"})).toHaveAttribute("href", "/api/recovery/export/");
  });

  it("explica la restauración manual y oculta el formulario sin coordinador", async () => {
    apiMock.recovery.mockResolvedValueOnce({...emptyRecovery, restore: {available: false, status: null}});
    renderPanel();

    const message = await screen.findByText("Esta instalación no ejecuta el coordinador automático de restauración. Sigue la guía manual en docs/self-hosted-recovery.md desde el host, con los servicios detenidos.");
    expect(message).toHaveAttribute("role", "status");
    expect(screen.queryByText("Restaurar una copia")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Archivo ZIP de copia")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Crear copia ahora/})).toBeEnabled();
    expect(apiMock.previewRestore).not.toHaveBeenCalled();
  });

  it("distingue carga inicial de ausencia de copias", async () => {
    let resolveRecovery!: (value: RecoveryPayload) => void;
    apiMock.recovery.mockImplementationOnce(() => new Promise((resolve) => {resolveRecovery = resolve;}));
    renderPanel();

    expect(screen.getByText("Consultando copias…")).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay una copia programada")).not.toBeInTheDocument();
    resolveRecovery(emptyRecovery);
    expect(await screen.findByText("Todavía no hay una copia programada")).toBeInTheDocument();
  });

  it("no oculta un worker detenido ni una copia atrasada tras una copia manual", async () => {
    apiMock.recovery.mockResolvedValueOnce({
      ...populatedRecovery,
      backup_status: {
        worker: "stale",
        schedule: "failed",
        heartbeat_at: "2026-10-19T08:00:00Z",
        last_failure_at: "2026-10-21T08:00:00Z",
        last_success_at: "2026-10-19T07:00:00Z",
      },
    });
    renderPanel();
    expect(await screen.findByText("El worker de copias no informa actividad")).toBeInTheDocument();
    expect(screen.getByText(/Última señal: .*Último intento fallido:/)).toBeInTheDocument();
    expect(screen.getByText("Comprueba que el servicio backup esté activo en tu instalación.")).toBeInTheDocument();
    expect(screen.getByText(/Último archivo disponible: .*manual-fixture.zip/)).toBeInTheDocument();
    expect(document.querySelector(".recovery-status")).toHaveAttribute("data-attention", "true");
  });

  it("expone un fallo reciente y la ruta de recuperación", async () => {
    apiMock.recovery.mockResolvedValueOnce({
      ...emptyRecovery,
      backup_status: {
        worker: "healthy",
        schedule: "failed",
        heartbeat_at: "2026-10-21T10:00:00Z",
        last_failure_at: "2026-10-21T09:00:00Z",
        last_success_at: "2026-10-20T09:00:00Z",
      },
    });
    renderPanel();
    expect(await screen.findByText("Falló la última copia programada")).toBeInTheDocument();
    expect(screen.getByText(/Último fallo: .*Última copia válida:/)).toBeInTheDocument();
    expect(screen.getByText(/El worker reintentará automáticamente/)).toBeInTheDocument();
  });

  it("permite reintentar una consulta inicial fallida", async () => {
    apiMock.recovery.mockRejectedValueOnce(new Error("Storage no disponible."));
    const {setStatus} = renderPanel();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo consultar el estado de las copias.");
    expect(document.querySelector(".recovery-status")).toHaveTextContent("No se pudo consultar el estado de las copias.");
    expect(screen.queryByText("Todavía no hay una copia programada")).not.toBeInTheDocument();
    let resolveRetry!: (payload: RecoveryPayload) => void;
    apiMock.recovery.mockImplementationOnce(() => new Promise((resolve) => {resolveRetry = resolve;}));
    const retry = screen.getByRole("button", {name: "Reintentar consulta"});
    retry.focus();
    fireEvent.click(retry);
    const pending = await screen.findByRole("button", {name: "Consultando copias…"});
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    fireEvent.click(pending);
    expect(apiMock.recovery).toHaveBeenCalledTimes(2);
    resolveRetry(emptyRecovery);
    expect(await screen.findByText("Todavía no hay una copia programada")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".recovery-status")).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(setStatus).not.toHaveBeenCalled();
    expect(apiMock.recovery).toHaveBeenCalledTimes(2);
  });

  it("bloquea creación duplicada, actualiza la copia y recupera tras un error", async () => {
    let resolveBackup!: (value: RecoveryPayload) => void;
    apiMock.createBackup.mockImplementationOnce(() => new Promise((resolve) => {resolveBackup = resolve;}));
    const {setStatus} = renderPanel();
    const create = screen.getByRole("button", {name: /Crear copia ahora|Creando copia…/});

    await waitFor(() => expect(create).toBeEnabled());
    create.focus();
    fireEvent.click(create);
    await waitFor(() => expect(create).toHaveAttribute("aria-busy", "true"));
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).not.toBeDisabled();
    expect(create).toHaveFocus();
    fireEvent.click(create);
    expect(apiMock.createBackup).toHaveBeenCalledOnce();
    resolveBackup(populatedRecovery);
    expect(await screen.findByText("Copias programadas al día")).toBeInTheDocument();
    expect(create).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();

    apiMock.createBackup.mockRejectedValueOnce(new Error("Disco lleno."));
    fireEvent.click(create);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo crear la copia de seguridad. Inténtalo otra vez.");
    expect(create).toBeEnabled();
    expect(create).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("valida ZIP con estado pendiente, retry y salida explícita de la previsualización", async () => {
    let resolvePreview!: (value: {ok: true; token: string; impact: {files: number; media_files: number; size: number}}) => void;
    apiMock.previewRestore.mockImplementationOnce(() => new Promise((resolve) => {resolvePreview = resolve;}));
    const {setStatus} = renderPanel();
    const file = new File(["fixture"], "copia.zip", {type: "application/zip"});
    const fileInput = await screen.findByLabelText("Archivo ZIP de copia");

    fireEvent.change(fileInput, {target: {files: [file]}});
    expect(screen.getByText("Validando copia…")).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("aria-busy", "true");
    expect(fileInput).toHaveAttribute("aria-disabled", "true");
    expect(fileInput).not.toBeDisabled();
    expect(fileInput).toHaveFocus();
    fireEvent.change(fileInput, {target: {files: [new File(["duplicate"], "duplicate.zip", {type: "application/zip"})]}});
    expect(apiMock.previewRestore).toHaveBeenCalledOnce();
    resolvePreview({ok: true, token: "a".repeat(32), impact: {files: 12, media_files: 3, size: 4096}});
    expect(await screen.findByText("Copia validada:")).toBeInTheDocument();
    expect(screen.getByText("12 archivos, 3 adjuntos, 4 KB.")).toBeInTheDocument();
    expect(screen.getByLabelText("Escribe RESTAURAR para confirmar")).toHaveFocus();
    expect(screen.getByRole("button", {name: "Restaurar copia"})).toBeDisabled();

    fireEvent.click(screen.getByRole("button", {name: "Elegir otra copia"}));
    expect(await screen.findByLabelText("Archivo ZIP de copia")).toBeEnabled();
    expect(screen.getByLabelText("Archivo ZIP de copia")).toHaveFocus();
    await waitFor(() => expect(screen.queryByText("Copia validada:")).not.toBeInTheDocument());
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("comunica ZIP inválido y deja reintentar la selección", async () => {
    apiMock.previewRestore.mockRejectedValueOnce(new Error("El ZIP no contiene una copia válida."));
    const {setStatus} = renderPanel();
    const file = new File(["invalid"], "invalida.zip", {type: "application/zip"});
    const fileInput = await screen.findByLabelText("Archivo ZIP de copia");

    fireEvent.change(fileInput, {target: {files: [file]}});
    expect(await screen.findByRole("alert")).toHaveTextContent("El ZIP no contiene una copia válida.");
    expect(fileInput).toBeEnabled();
    expect((fileInput as HTMLInputElement).files?.[0]).toBe(file);
    expect(fileInput).toHaveFocus();
    const retry = screen.getByRole("button", {name: "Reintentar validación"});
    expect(setStatus).not.toHaveBeenCalled();
    apiMock.previewRestore.mockResolvedValueOnce({ok: true, token: "b".repeat(32), impact: {files: 1, media_files: 0, size: 1024}});
    fireEvent.click(retry);
    expect(await screen.findByText("Copia validada:")).toBeInTheDocument();
    expect(screen.getByLabelText("Escribe RESTAURAR para confirmar")).toHaveFocus();
    expect(apiMock.previewRestore).toHaveBeenCalledTimes(2);
  });

  it("exige la frase exacta y bloquea restauración duplicada mientras espera", async () => {
    let resolveRestore!: (value: {ok: true; message: string}) => void;
    apiMock.restore.mockImplementationOnce(() => new Promise((resolve) => {resolveRestore = resolve;}));
    const {setStatus} = renderPanel();
    const file = new File(["fixture"], "copia.zip", {type: "application/zip"});
    fireEvent.change(await screen.findByLabelText("Archivo ZIP de copia"), {target: {files: [file]}});
    await screen.findByText("Copia validada:");
    const confirmation = screen.getByLabelText("Escribe RESTAURAR para confirmar");
    const restore = screen.getByRole("button", {name: "Restaurar copia"});
    expect(restore).toBeDisabled();
    fireEvent.change(confirmation, {target: {value: "restaurar"}});
    expect(restore).toBeDisabled();
    fireEvent.change(confirmation, {target: {value: "RESTAURAR"}});
    expect(restore).toBeEnabled();
    fireEvent.click(restore);

    const pending = await screen.findByRole("button", {name: "Restaurando…"});
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    fireEvent.click(pending);
    expect(apiMock.restore).toHaveBeenCalledOnce();
    resolveRestore({ok: true, message: "Restauración solicitada; la aplicación se reiniciará."});
    await waitFor(() => expect(screen.getByText("Restauración solicitada; la aplicación se reiniciará.")).toBeInTheDocument());
    const submitted = screen.getByRole("button", {name: "Restauración solicitada"});
    expect(submitted).toHaveAttribute("aria-disabled", "true");
    expect(submitted).not.toBeDisabled();
    expect(submitted).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("mantiene datos de confirmación y permite retry ante fallo de restauración", async () => {
    apiMock.restore.mockRejectedValueOnce(new Error("No se pudo solicitar la restauración."));
    const {setStatus} = renderPanel();
    const file = new File(["fixture"], "copia.zip", {type: "application/zip"});
    fireEvent.change(await screen.findByLabelText("Archivo ZIP de copia"), {target: {files: [file]}});
    await screen.findByText("Copia validada:");
    const confirmation = screen.getByLabelText("Escribe RESTAURAR para confirmar");
    fireEvent.change(confirmation, {target: {value: "RESTAURAR"}});
    fireEvent.click(screen.getByRole("button", {name: "Restaurar copia"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo solicitar la restauración. Inténtalo otra vez.");
    expect(confirmation).toHaveValue("RESTAURAR");
    const restore = screen.getByRole("button", {name: "Restaurar copia"});
    expect(restore).toBeEnabled();
    expect(restore).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
    fireEvent.click(restore);
    await waitFor(() => expect(screen.getByText("Restauración solicitada; la aplicación se reiniciará.")).toBeInTheDocument());
    expect(apiMock.restore).toHaveBeenCalledTimes(2);
  });

  it("sigue consultando estados no terminales después de un fallo transitorio", async () => {
    vi.useFakeTimers();
    apiMock.recovery.mockResolvedValueOnce(pendingRecovery).mockRejectedValueOnce(new Error("Temporal." )).mockResolvedValueOnce({...pendingRecovery, restore: {available: true, status: null}}).mockResolvedValueOnce(completedRecovery);
    renderPanel();
    await act(async () => {await Promise.resolve();});
    expect(screen.getByText("Restaurando datos…")).toBeInTheDocument();

    await act(async () => {await vi.advanceTimersByTimeAsync(3000);});
    await act(async () => {await vi.advanceTimersByTimeAsync(3000);});
    expect(screen.getByText("Restaurando datos…")).toBeInTheDocument();
    await act(async () => {await vi.advanceTimersByTimeAsync(3000);});
    expect(screen.getByText("Restauración completada.")).toBeInTheDocument();
    expect(apiMock.recovery).toHaveBeenCalledTimes(4);
  });

  it("muestra el estado terminal fallido sin continuar el polling", async () => {
    vi.useFakeTimers();
    apiMock.recovery.mockResolvedValueOnce({...pendingRecovery, restore: {available: true, status: {status: "failed", message: "Restauración revertida."}}});
    renderPanel();
    await act(async () => {await Promise.resolve(); await Promise.resolve();});
    expect(screen.getByText("Restauración revertida.")).toBeInTheDocument();
    await act(async () => {await vi.advanceTimersByTimeAsync(6000);});
    expect(apiMock.recovery).toHaveBeenCalledOnce();
  });
});
