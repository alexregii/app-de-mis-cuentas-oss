import {act, createEvent, fireEvent, render, renderHook, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {useState} from "react";
import {CollapsiblePanel} from "../shared/components/CollapsiblePanel";
import {FieldError} from "../shared/components/FieldError";
import {PullToRefresh} from "../shared/components/PullToRefresh";
import {ViewLoadError} from "../shared/components/ViewLoadError";
import {useStoredBoolean} from "../shared/hooks/useStoredBoolean";
import {errorMessage} from "../shared/lib/errors";

describe("shared foundations", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads and updates a stored boolean with direct and functional values", () => {
    const {result, unmount} = renderHook(() => useStoredBoolean("test.preference", false));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("test.preference")).toBe("true");

    act(() => result.current[1]((current) => !current));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("test.preference")).toBe("false");
    unmount();

    window.localStorage.setItem("test.preference", "true");
    const restored = renderHook(() => useStoredBoolean("test.preference", false));
    expect(restored.result.current[0]).toBe(true);
  });

  it("keeps field errors absent or joined with the same markup", () => {
    const {container, rerender} = render(<FieldError name="amount" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FieldError name="amount" errors={{amount: ["Es obligatorio.", "Debe ser positivo."]}} />);
    expect(screen.getByText("Es obligatorio. Debe ser positivo.")).toHaveClass("field-error");
  });

  it("renders the load error contract and retries", () => {
    const onRetry = vi.fn();
    render(<ViewLoadError title="Estadísticas" message="No disponible" onRetry={onRetry} />);

    expect(screen.getByRole("heading", {name: "Estadísticas"})).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No disponible");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("preserves the collapsed summary and disclosure callback", () => {
    const onToggle = vi.fn();
    const {container} = render(
      <CollapsiblePanel title="Presupuestos" open={false} onToggle={onToggle} summary={<span>Resumen cerrado</span>}>
        <span>Formulario abierto</span>
      </CollapsiblePanel>,
    );

    expect(screen.getByText("Resumen cerrado")).toBeInTheDocument();
    expect(screen.getByText("Resumen cerrado").closest(".collapsed-summary")?.closest(".section-heading")).not.toBeNull();
    expect(container.querySelector(".collapsible-panel > .collapsed-summary")).toBeNull();
    expect(screen.queryByText("Formulario abierto")).not.toBeInTheDocument();
    const disclosure = screen.getByRole("button", {name: "Expandir presupuestos"});
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(disclosure).toHaveFocus();
  });

  it("returns focus to the disclosure when an action closes focused content", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <CollapsiblePanel title="Editar categoría" open={open} onToggle={() => setOpen(false)}>
        <button onClick={() => setOpen(false)}>Guardar y cerrar</button>
      </CollapsiblePanel>;
    }

    render(<Harness />);
    const save = screen.getByRole("button", {name: "Guardar y cerrar"});
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("button", {name: "Expandir editar categoría"})).toHaveFocus());
  });

  it("renders open collapsible content", () => {
    render(
      <CollapsiblePanel title="Presupuestos" open onToggle={() => undefined} summary={<span>Resumen cerrado</span>}>
        <span>Formulario abierto</span>
      </CollapsiblePanel>,
    );

    expect(screen.getByText("Formulario abierto")).toBeInTheDocument();
    expect(screen.queryByText("Resumen cerrado")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Comprimir presupuestos"})).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the pull-to-refresh threshold and refresh callback", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const {container} = render(<PullToRefresh onRefresh={onRefresh}><span>Contenido</span></PullToRefresh>);
    const zone = container.querySelector(".pull-zone");
    expect(zone).not.toBeNull();

    fireEvent.touchStart(zone!, {touches: [{clientY: 20}]});
    fireEvent.touchMove(zone!, {touches: [{clientY: 180}]});
    expect(screen.getByText("Suelta")).toBeInTheDocument();
    fireEvent.touchEnd(zone!);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("Desliza")).toBeInTheDocument());
  });

  it("cancels short, cancelled, horizontal and control-started pulls and suppresses duplicates", async () => {
    let finishRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {finishRefresh = resolve;}));
    const {container} = render(<PullToRefresh onRefresh={onRefresh}><button>Acción</button></PullToRefresh>);
    const zone = container.querySelector(".pull-zone")!;

    fireEvent.touchStart(zone, {touches: [{clientX: 10, clientY: 10}]});
    fireEvent.touchMove(zone, {touches: [{clientX: 10, clientY: 40}]});
    fireEvent.touchEnd(zone);
    fireEvent.touchStart(zone, {touches: [{clientX: 10, clientY: 10}]});
    fireEvent.touchMove(zone, {touches: [{clientX: 10, clientY: 180}]});
    fireEvent.touchCancel(zone);
    fireEvent.touchEnd(zone);
    fireEvent.touchStart(screen.getByRole("button", {name: "Acción"}), {touches: [{clientX: 10, clientY: 10}]});
    fireEvent.touchMove(zone, {touches: [{clientX: 10, clientY: 180}]});
    fireEvent.touchEnd(zone);
    fireEvent.touchStart(zone, {touches: [{clientX: 10, clientY: 10}]});
    fireEvent.touchMove(zone, {touches: [{clientX: 100, clientY: 20}]});
    fireEvent.touchEnd(zone);
    expect(onRefresh).not.toHaveBeenCalled();

    fireEvent.touchStart(zone, {touches: [{clientX: 10, clientY: 10}]});
    const pullEvent = createEvent.touchMove(zone, {touches: [{clientX: 10, clientY: 180}]});
    zone.dispatchEvent(pullEvent);
    expect(pullEvent.defaultPrevented).toBe(true);
    fireEvent.touchEnd(zone);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    fireEvent.touchStart(zone, {touches: [{clientX: 10, clientY: 10}]});
    fireEvent.touchMove(zone, {touches: [{clientX: 10, clientY: 180}]});
    fireEvent.touchEnd(zone);
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () => finishRefresh());
    await waitFor(() => expect(container.querySelector(".pull-indicator")).toHaveAttribute("aria-hidden", "true"));
  });

  it("cancels a ready pull when a second finger joins and refreshes only after a fresh one-finger pull", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const {container} = render(<PullToRefresh onRefresh={onRefresh}><span>Contenido</span></PullToRefresh>);
    const zone = container.querySelector(".pull-zone")!;
    const first = {identifier: 1, clientX: 12, clientY: 10};
    const second = {identifier: 2, clientX: 20, clientY: 12};

    fireEvent.touchStart(zone, {touches: [first]});
    fireEvent.touchMove(zone, {touches: [{...first, clientY: 180}]});
    expect(screen.getByText("Suelta")).toBeInTheDocument();
    fireEvent.touchStart(zone, {touches: [first, second]});
    fireEvent.touchMove(zone, {touches: [first, second]});
    expect(container.querySelector(".pull-indicator")).toHaveClass("pull-indicator");
    expect(container.querySelector(".pull-indicator")).not.toHaveClass("ready");
    fireEvent.touchEnd(zone, {touches: [first]});
    fireEvent.touchEnd(zone, {touches: []});
    expect(onRefresh).not.toHaveBeenCalled();

    fireEvent.touchStart(zone, {touches: [first]});
    fireEvent.touchMove(zone, {touches: [{...first, clientY: 180}]});
    fireEvent.touchEnd(zone, {touches: []});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  });

  it("uses an Error message and otherwise keeps the fallback", () => {
    expect(errorMessage(new Error("Detalle"), "Fallback")).toBe("Detalle");
    expect(errorMessage("Detalle", "Fallback")).toBe("Fallback");
  });
});
