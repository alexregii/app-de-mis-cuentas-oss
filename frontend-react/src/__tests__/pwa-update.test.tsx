import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {useState} from "react";
import {usePwaUpdate} from "../app/hooks/usePwaUpdate";

const originalServiceWorker = Object.getOwnPropertyDescriptor(window.navigator, "serviceWorker");

afterEach(() => {
  if (originalServiceWorker) Object.defineProperty(window.navigator, "serviceWorker", originalServiceWorker);
  else Reflect.deleteProperty(window.navigator, "serviceWorker");
});

function installServiceWorkerHarness() {
  const worker = Object.assign(new EventTarget(), {postMessage: vi.fn(), state: "installing"});
  const registration = Object.assign(new EventTarget(), {installing: worker, waiting: null as ServiceWorker | null});
  const container = Object.assign(new EventTarget(), {controller: {} as ServiceWorker | null, register: vi.fn().mockResolvedValue(registration)});
  Object.defineProperty(window.navigator, "serviceWorker", {configurable: true, value: container});
  return {container, registration, worker};
}

function UpdateProbe() {
  const update = usePwaUpdate();
  const [concept, setConcept] = useState("");
  return <>
    <span data-testid="update-state">{update.updateAvailable ? "available" : "idle"}</span>
    <span data-testid="dirty-state">{update.hasDirtyForm ? "dirty" : "clean"}</span>
    <button type="button" disabled={update.hasDirtyForm} onClick={update.applyUpdate}>Actualizar ahora</button>
    <form><label>Concepto<input aria-label="Concepto" value={concept} onChange={(event) => setConcept(event.currentTarget.value)} /></label></form>
  </>;
}

it("waits for explicit approval before activating a service worker update", async () => {
  const {container, registration, worker} = installServiceWorkerHarness();
  render(<UpdateProbe />);
  await waitFor(() => expect(container.register).toHaveBeenCalledWith("/sw.js"));

  act(() => registration.dispatchEvent(new Event("updatefound")));
  registration.waiting = worker as unknown as ServiceWorker;
  worker.state = "installed";
  act(() => worker.dispatchEvent(new Event("statechange")));

  expect(await screen.findByTestId("update-state")).toHaveTextContent("available");
  fireEvent.click(screen.getByRole("button", {name: "Actualizar ahora"}));
  expect(worker.postMessage).toHaveBeenCalledWith({type: "SKIP_WAITING"});
});

it("blocks the update while a form has unsaved changes", async () => {
  const {container, registration, worker} = installServiceWorkerHarness();
  render(<UpdateProbe />);
  await waitFor(() => expect(container.register).toHaveBeenCalledWith("/sw.js"));

  act(() => registration.dispatchEvent(new Event("updatefound")));
  registration.waiting = worker as unknown as ServiceWorker;
  worker.state = "installed";
  act(() => worker.dispatchEvent(new Event("statechange")));
  await screen.findByTestId("update-state");

  const input = screen.getByLabelText("Concepto");
  fireEvent.pointerDown(input);
  fireEvent.input(input, {target: {value: "Pendiente"}});

  await waitFor(() => expect(screen.getByTestId("dirty-state")).toHaveTextContent("dirty"));
  expect(input).toHaveValue("Pendiente");
  expect(screen.getByRole("button", {name: "Actualizar ahora"})).toBeDisabled();
  expect(worker.postMessage).not.toHaveBeenCalled();
});
