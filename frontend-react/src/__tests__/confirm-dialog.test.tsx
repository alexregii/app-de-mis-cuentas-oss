import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {StrictMode, useState} from "react";
import {ConfirmDialog} from "../shared/components/ConfirmDialog";

afterEach(() => {
  document.querySelector("[data-dialog-trigger]")?.remove();
});

it("traps focus, cancels with Escape and returns focus to the trigger", async () => {
  const trigger = document.createElement("button");
  trigger.dataset.dialogTrigger = "true";
  document.body.append(trigger);
  trigger.focus();
  const onCancel = vi.fn();
  const {unmount} = render(
    <ConfirmDialog title="Eliminar cuenta" description="No se puede deshacer." confirmLabel="Eliminar" onConfirm={() => undefined} onCancel={onCancel} />,
  );

  expect(screen.getByRole("dialog", {name: "Eliminar cuenta"})).toHaveAttribute("aria-modal", "true");
  const cancel = screen.getByRole("button", {name: "Cancelar"});
  const confirm = screen.getByRole("button", {name: "Eliminar"});
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(document, {key: "Tab", shiftKey: true});
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(document, {key: "Tab"});
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(document, {key: "Escape"});
  expect(onCancel).toHaveBeenCalledOnce();

  unmount();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("only executes the destructive action after explicit confirmation", async () => {
  const onConfirm = vi.fn(async () => undefined);
  const onCancel = vi.fn();
  render(
    <ConfirmDialog title="Eliminar regla" description="La automatización dejará de aplicarse." confirmLabel="Eliminar regla" onConfirm={onConfirm} onCancel={onCancel} />,
  );

  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Eliminar regla"}));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onCancel).toHaveBeenCalledOnce();
});

it("retains focus on the pending confirmation and ignores repeated submits", async () => {
  let releaseAction!: () => void;
  const actionGate = new Promise<void>((resolve) => {releaseAction = resolve;});
  const onConfirm = vi.fn(() => actionGate);
  const onCancel = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setOpen(true);}}>Eliminar presupuesto</button>
      {open ? <ConfirmDialog
        title="Eliminar presupuesto"
        description="El presupuesto dejará de estar configurado."
        confirmLabel="Eliminar"
        onConfirm={onConfirm}
        onCancel={() => {onCancel(); setOpen(false);}}
      /> : null}
    </>;
  }

  render(<Harness />);
  const trigger = screen.getByRole("button", {name: "Eliminar presupuesto"});
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", {name: "Eliminar presupuesto"});
  const cancel = screen.getByRole("button", {name: "Cancelar"});
  const confirm = screen.getByRole("button", {name: "Eliminar"});
  await waitFor(() => expect(cancel).toHaveFocus());

  fireEvent.click(confirm);
  await waitFor(() => expect(confirm).toHaveAttribute("aria-disabled", "true"));
  expect(confirm).toHaveAttribute("aria-busy", "true");
  expect(confirm).not.toBeDisabled();
  expect(confirm).toHaveFocus();
  expect(cancel).toBeDisabled();
  fireEvent.click(confirm);
  fireEvent.keyDown(document, {key: "Escape"});
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onCancel).not.toHaveBeenCalled();
  expect(dialog).toBeInTheDocument();

  releaseAction();
  await waitFor(() => expect(screen.queryByRole("dialog", {name: "Eliminar presupuesto"})).not.toBeInTheDocument());
  expect(onCancel).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
});

it("keeps a rejected confirmation open with an accessible retry error", async () => {
  const trigger = document.createElement("button");
  trigger.dataset.dialogTrigger = "true";
  document.body.append(trigger);
  trigger.focus();
  const onConfirm = vi.fn().mockRejectedValueOnce(new Error("No se pudo desconectar.")).mockResolvedValueOnce(undefined);
  const onCancel = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <ConfirmDialog title="Desconectar banco" description="Se detendrá la sincronización." confirmLabel="Desconectar" onConfirm={onConfirm} onCancel={() => {onCancel(); setOpen(false);}} /> : null;
  }
  render(<Harness />);
  const dialog = screen.getByRole("dialog", {name: "Desconectar banco"});
  const confirm = screen.getByRole("button", {name: "Desconectar"});
  confirm.focus();

  fireEvent.click(confirm);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("No se pudo desconectar.");
  expect(dialog).toBeInTheDocument();
  expect(confirm).toHaveFocus();
  expect(confirm).not.toHaveAttribute("aria-busy", "true");

  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog", {name: "Desconectar banco"})).not.toBeInTheDocument());
  expect(onConfirm).toHaveBeenCalledTimes(2);
  expect(onCancel).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
});

it("returns focus to a surviving sibling when confirmation removes its trigger", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [recordExists, setRecordExists] = useState(true);
    return <div>
      {recordExists ? <button data-dialog-trigger onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setOpen(true);}}>Eliminar registro</button> : null}
      <button data-testid="successor">Abrir siguiente registro</button>
      {open ? <ConfirmDialog
        title="Eliminar registro"
        description="No se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => setRecordExists(false)}
        onCancel={() => setOpen(false)}
      /> : null}
    </div>;
  }

  render(<StrictMode><Harness /></StrictMode>);
  const trigger = screen.getByRole("button", {name: "Eliminar registro"});
  const successor = screen.getByTestId("successor");
  fireEvent.click(trigger);
  await screen.findByRole("dialog", {name: "Eliminar registro"});
  fireEvent.click(screen.getByRole("button", {name: "Eliminar"}));

  await waitFor(() => expect(trigger).not.toBeInTheDocument());
  await waitFor(() => expect(successor).toHaveFocus());
});

it("returns focus to an empty-state action inserted when confirmation removes the last row", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [recordExists, setRecordExists] = useState(true);
    return <main id="main-content" tabIndex={-1}>
      <section aria-labelledby="forecast-title">
        <h2 id="forecast-title">Movimientos previstos</h2>
        {recordExists ? <article><button data-dialog-trigger onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setOpen(true);}}>Omitir previsión</button></article> : (
          <div className="empty-state"><strong>No hay previsiones pendientes.</strong><button data-testid="empty-forecast-action">Crear recurrente</button></div>
        )}
      </section>
      {open ? <ConfirmDialog
        title="Omitir previsión"
        description="La previsión dejará de aparecer en este mes."
        confirmLabel="Omitir"
        onConfirm={() => setRecordExists(false)}
        onCancel={() => setOpen(false)}
      /> : null}
    </main>;
  }

  render(<Harness />);
  const trigger = screen.getByRole("button", {name: "Omitir previsión"});
  fireEvent.click(trigger);
  await screen.findByRole("dialog", {name: "Omitir previsión"});
  fireEvent.click(screen.getByRole("button", {name: /^Omitir$/}));

  const emptyAction = await screen.findByTestId("empty-forecast-action");
  await waitFor(() => expect(emptyAction).toHaveFocus());
  expect(trigger).not.toBeInTheDocument();
});

it("uses the main content as fallback when confirmation removes its only control", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [recordExists, setRecordExists] = useState(true);
    return <main id="main-content" tabIndex={-1}>
      {recordExists ? <button data-dialog-trigger onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setOpen(true);}}>Eliminar registro</button> : null}
      {open ? <ConfirmDialog title="Eliminar registro" description="No se puede deshacer." confirmLabel="Eliminar" onConfirm={() => setRecordExists(false)} onCancel={() => setOpen(false)} /> : null}
    </main>;
  }

  render(<Harness />);
  const trigger = screen.getByRole("button", {name: "Eliminar registro"});
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole("dialog", {name: "Eliminar registro"});
  fireEvent.click(screen.getByRole("button", {name: "Eliminar"}));

  await waitFor(() => expect(trigger).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
});

it("focuses a surviving neighbor when confirmation removes the opener and dialog together", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [recordExists, setRecordExists] = useState(true);
    return <div>
      {recordExists ? <button onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setOpen(true);}}>Eliminar registro</button> : null}
      <button data-testid="successor">Abrir siguiente registro</button>
      {open ? <ConfirmDialog
        title="Eliminar registro"
        description="No se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {setRecordExists(false); setOpen(false);}}
        onCancel={() => setOpen(false)}
      /> : null}
    </div>;
  }

  render(<StrictMode><Harness /></StrictMode>);
  fireEvent.click(screen.getByRole("button", {name: "Eliminar registro"}));
  fireEvent.click(await screen.findByRole("button", {name: "Eliminar"}));
  await waitFor(() => expect(screen.queryByRole("button", {name: "Eliminar registro"})).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId("successor")).toHaveFocus());
});
