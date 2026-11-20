import {fireEvent, render, screen, within} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {euro} from "../format";
import {LedgerHeader} from "../ui/finance/LedgerHeader";
import {useInputModality} from "../ui/foundations/useInputModality";
import {StatementLedger} from "../ui/finance/StatementLedger";
import {SelectionToolbar} from "../ui/finance/SelectionToolbar";
import {ledgerFixtures} from "../test-fixtures/ledger";

describe("Production ledger contracts", () => {
it("trata una lista de acciones vacía como selección bloqueada", () => {
    render(<SelectionToolbar selectionMode onToggleSelection={() => undefined} selectedCount={1} actions={[]} />);

    const toolbar = screen.getByRole("region", {name: "Acciones de selección"});
    expect(toolbar).toHaveTextContent("1 seleccionado · No hay acciones disponibles.");
    expect(within(toolbar).queryAllByRole("button")).toHaveLength(1);
    expect(within(toolbar).getByRole("button", {name: "Cancelar selección"})).toBeInTheDocument();
  });

it.each(["textarea", "contenteditable", "number", "month"])("conserva edición touch en %s, también durante composición", (kind) => {
    function Editor() {
      const ref = useInputModality();
      return <main ref={ref}>{kind === "textarea" ? <textarea aria-label="Editor" /> : kind === "contenteditable" ? <div contentEditable suppressContentEditableWarning><span>Editor</span></div> : <input type={kind} aria-label="Editor" />}</main>;
    }
    render(<Editor />);
    const root = screen.getByRole("main");
    const editor = kind === "contenteditable" ? screen.getByText("Editor") : screen.getByLabelText("Editor");
    fireEvent.pointerDown(editor, {pointerType: "touch"});
    for (const key of ["x", "Enter", "ArrowUp", "Home", "Backspace"]) {
      fireEvent.keyDown(editor, {key});
      expect(root).toHaveAttribute("data-input-modality", "pointer");
    }
    fireEvent.keyDown(editor, {key: "Escape", isComposing: true});
    expect(root).toHaveAttribute("data-input-modality", "pointer");
    fireEvent.keyDown(editor, {key: "Tab", shiftKey: true});
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
  });

it("mantiene un solo menú, cierra fuera/Escape y descarta menús al cambiar datos o selección", () => {
    const props = {items: ledgerFixtures.slice(0, 3), capabilitiesFor: () => ({edit: true, archive: true, reopen: true}), privateAmounts: false, selectionMode: false, selectedIds: [], onSelect: vi.fn(), onAction: vi.fn()};
    const {container, rerender} = render(<StatementLedger {...props} />);
    const triggers = () => container.querySelectorAll<HTMLButtonElement>(".ui-overflow-menu__trigger");
    const opened = () => container.querySelectorAll<HTMLDivElement>(".ui-overflow-menu.is-open");
    fireEvent.click(triggers()[0]);
    expect(opened()).toHaveLength(1);
    fireEvent.click(triggers()[1]);
    expect(opened()).toHaveLength(1);
    expect(opened()[0]).toContainElement(triggers()[1]);
    fireEvent.pointerDown(document.body);
    expect(opened()).toHaveLength(0);
    fireEvent.click(triggers()[0]);
    fireEvent.keyDown(within(opened()[0] as HTMLElement).getByRole("button", {name: /^Editar /}), {key: "Escape"});
    expect(opened()).toHaveLength(0);
    expect(triggers()[0]).toHaveFocus();
    fireEvent.click(triggers()[0]);
    rerender(<StatementLedger {...props} selectionMode />);
    expect(container.querySelectorAll(".ui-overflow-menu.is-open")).toHaveLength(0);
    expect(within(container).queryByRole("button", {name: /^Editar /})).not.toBeInTheDocument();
    rerender(<StatementLedger {...props} />);
    expect(opened()).toHaveLength(0);
    fireEvent.click(triggers()[0]);
    const trigger = triggers()[0];
    trigger.focus();
    rerender(<StatementLedger {...props} items={props.items.map((item) => ({...item}))} />);
    expect(opened()).toHaveLength(1);
    expect(triggers()[0]).toBe(trigger);
    expect(trigger).toHaveFocus();
    rerender(<StatementLedger {...props} privateAmounts items={props.items.map((item) => ({...item, description: item.description + " actualizado"}))} />);
    expect(opened()).toHaveLength(1);
    const firstRow = container.querySelector(`[data-ledger-item-id="${props.items[0].id}"]`);
    rerender(<StatementLedger {...props} items={[...props.items].reverse()} />);
    expect(opened()).toHaveLength(1);
    expect(opened()[0]).toContainElement(trigger);
    expect(container.querySelector(`[data-ledger-item-id="${props.items[0].id}"]`)).toBe(firstRow);
    expect(trigger).toHaveFocus();
    rerender(<StatementLedger {...props} />);
    expect(opened()).toHaveLength(1);
    expect(triggers()[0]).toBe(trigger);
    rerender(<StatementLedger {...props} items={props.items.slice(1)} />);
    expect(opened()).toHaveLength(0);
  });

it("no renderiza acciones de fila sin un callback de despacho", () => {
    const {container} = render(<StatementLedger items={ledgerFixtures.slice(0, 1)} capabilitiesFor={() => ({edit: true, archive: true, reopen: true})} privateAmounts={false} selectionMode={false} selectedIds={[]} onSelect={() => undefined} />);
    expect(container.querySelector(".ui-statement-ledger__menu")).not.toBeInTheDocument();
    expect(container.querySelector(".ui-overflow-menu__trigger")).not.toBeInTheDocument();
  });

it.each([['Editar', 'edit'], ['Archivar', 'archive'], ['Reabrir', 'reopen']])("%s cierra antes de despachar exactamente una vez", (label, action) => {
    const onAction = vi.fn(() => expect(container.querySelector(".ui-overflow-menu.is-open")).toBeNull());
    const {container} = render(<StatementLedger items={ledgerFixtures.slice(0, 1)} capabilitiesFor={() => ({edit: true, archive: true, reopen: true})} privateAmounts={false} selectionMode={false} selectedIds={[]} onSelect={() => undefined} onAction={onAction} />);
    fireEvent.click(container.querySelector(".ui-overflow-menu__trigger")!);
    fireEvent.click(screen.getByRole("button", {name: new RegExp(`^${label} `)}));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(ledgerFixtures[0].id, action);
  });

it("recibe la cabecera preparada sin recalcular el neto ni fijar el periodo", () => {
    const props = {summary: {period: "Abril 2031", income: 10, expense: -5, net: 999}, privateAmounts: false};
    const {rerender, container} = render(<LedgerHeader {...props} />);
    expect(screen.getByText("Abril 2031")).toBeInTheDocument();
    expect(screen.getByLabelText(`Neto operativo: ${euro(999)}`, {normalizer: (value) => value})).toBeInTheDocument();
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    rerender(<LedgerHeader {...props} privateAmounts />);
    expect(screen.getAllByLabelText("Importe oculto")).toHaveLength(3);
    expect(container.textContent).not.toContain(euro(999));
    expect(container.innerHTML).not.toContain(euro(10));
    rerender(<LedgerHeader {...props} summary={{period: "Sin movimientos", income: 0, expense: 0, net: 0}} />);
    expect(screen.getByText("Sin movimientos")).toBeInTheDocument();
    expect(screen.getByLabelText(`Neto operativo: ${euro(0)}`, {normalizer: (value) => value})).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

it.each([{income: 123, expense: -45, net: 999}, {income: -10, expense: 20, net: -999}])("muestra agregados firmados sin normalizar ni derivar neto: %j", (summary) => {
    render(<LedgerHeader summary={{period: "Periodo preparado", ...summary}} privateAmounts={false} />);
    for (const [label, value] of [["Ingresos", summary.income], ["Gastos", summary.expense], ["Neto operativo", summary.net]] as const) {
      expect(screen.getByLabelText(`${label}: ${euro(value)}`, {normalizer: (text) => text}).textContent).toBe(euro(value));
    }
  });

it("la toolbar instala su propia política y conserva foco al cambiar de modo", () => {
    const props = {selectionMode: false, selectedCount: 0, actions: [], onToggleSelection: vi.fn()};
    const {rerender} = render(<SelectionToolbar {...props} />);
    const button = screen.getByRole("button", {name: "Seleccionar"});
    const boundary = button.closest("section")!;
    expect(boundary).toHaveClass("ui-input-modality");
    fireEvent.pointerDown(button, {pointerType: "touch"});
    fireEvent.click(button, {detail: 1});
    expect(button).toHaveFocus();
    expect(boundary).toHaveAttribute("data-input-modality", "pointer");
    rerender(<SelectionToolbar {...props} selectionMode />);
    expect(screen.getByRole("button", {name: "Cancelar selección"})).toBe(button);
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, {key: "Tab"});
    expect(boundary).toHaveAttribute("data-input-modality", "keyboard");
    fireEvent.click(button, {detail: 0});
    rerender(<SelectionToolbar {...props} />);
    expect(screen.getByRole("button", {name: "Seleccionar"})).toBe(button);
    expect(button).toHaveFocus();
    expect(props.onToggleSelection).toHaveBeenCalledTimes(2);
  });
});
