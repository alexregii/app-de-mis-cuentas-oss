import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {FormField, Input, Select} from "../ui/controls/FormField";
import {SegmentedControl, SegmentedItem} from "../ui/controls/SegmentedControl";

describe("stable form controls", () => {
  it("composes labels, hints and errors without owning domain validation", () => {
    render(<FormField label="Importe" hint="EUR" error={<small role="alert">Importe inválido</small>}><Input aria-invalid="true" /></FormField>);
    expect(screen.getByText("Importe")).toBeInTheDocument();
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Importe inválido");
    expect(screen.getByRole("textbox")).toHaveClass("ui-input");
  });

  it("keeps native select semantics", () => {
    render(<FormField label="Tipo"><Select defaultValue="expense"><option value="expense">Gasto</option><option value="income">Ingreso</option></Select></FormField>);
    expect(screen.getByRole("combobox", {name: "Tipo"})).toHaveValue("expense");
  });

  it("expresses segmented selection with aria-pressed", () => {
    const onSelect = vi.fn();
    render(<SegmentedControl aria-label="Filtro"><SegmentedItem selected={false} onClick={onSelect}>Atención</SegmentedItem><SegmentedItem selected>Todos</SegmentedItem></SegmentedControl>);
    const attention = screen.getByRole("button", {name: "Atención"});
    fireEvent.click(attention);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(attention).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", {name: "Todos"})).toHaveAttribute("aria-pressed", "true");
  });
});
