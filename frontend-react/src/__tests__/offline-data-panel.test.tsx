import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {OfflineDataPanel} from "../features/settings/OfflineDataPanel";

const offlineApiMock = vi.hoisted(() => ({clearOfflineData: vi.fn()}));
vi.mock("../shared/api/client", () => offlineApiMock);

beforeEach(() => {
  offlineApiMock.clearOfflineData.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

it("clears offline copies with an explicit message that server data remains intact", async () => {
  const setStatus = vi.fn();
  render(<OfflineDataPanel setStatus={setStatus} />);
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos sin conexión"}));
  expect(screen.getByRole("dialog", {name: "¿Borrar datos sin conexión?"})).toHaveTextContent("Tus preferencias, cuentas, movimientos y ajustes del servidor no cambiarán.");
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos"}));

  await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Datos sin conexión eliminados de este dispositivo. El servidor no se ha modificado."));
  expect(offlineApiMock.clearOfflineData).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("cancels without clearing local or server data", () => {
  const setStatus = vi.fn();
  render(<OfflineDataPanel setStatus={setStatus} />);
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos sin conexión"}));
  fireEvent.click(screen.getByRole("button", {name: "Cancelar"}));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(offlineApiMock.clearOfflineData).not.toHaveBeenCalled();
  expect(setStatus).not.toHaveBeenCalled();
});

it("locks the confirmation until the local clear completes", async () => {
  let finishClear!: () => void;
  offlineApiMock.clearOfflineData.mockImplementationOnce(() => new Promise<void>((resolve) => {finishClear = resolve;}));
  const setStatus = vi.fn();
  render(<OfflineDataPanel setStatus={setStatus} />);
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos sin conexión"}));
  const confirmButton = screen.getByRole("button", {name: "Borrar datos"});
  confirmButton.focus();
  fireEvent.click(confirmButton);

  const confirm = await screen.findByRole("button", {name: "Aplicando…"});
  expect(confirm).toHaveAttribute("aria-disabled", "true");
  expect(confirm).toHaveAttribute("aria-busy", "true");
  expect(confirm).not.toBeDisabled();
  expect(confirm).toHaveFocus();
  expect(screen.getByRole("button", {name: "Cancelar"})).toBeDisabled();
  expect(screen.getByRole("button", {name: "Borrando datos…"})).toBeDisabled();
  expect(offlineApiMock.clearOfflineData).toHaveBeenCalledOnce();
  finishClear();

  await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Datos sin conexión eliminados de este dispositivo. El servidor no se ha modificado."));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("informa del error de limpieza y vuelve a permitir reintento", async () => {
  offlineApiMock.clearOfflineData.mockRejectedValueOnce(new Error("Cache local inaccesible.")).mockResolvedValueOnce(undefined);
  const setStatus = vi.fn();
  render(<OfflineDataPanel setStatus={setStatus} />);
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos sin conexión"}));
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos"}));

  await waitFor(() => expect(setStatus).toHaveBeenCalledWith("No se pudieron borrar los datos sin conexión. Inténtalo otra vez."));
  expect(screen.getByRole("button", {name: "Borrar datos sin conexión"})).toBeEnabled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos sin conexión"}));
  fireEvent.click(screen.getByRole("button", {name: "Borrar datos"}));
  await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Datos sin conexión eliminados de este dispositivo. El servidor no se ha modificado."));
  expect(offlineApiMock.clearOfflineData).toHaveBeenCalledTimes(2);
});
