import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {PageHeader} from "../ui/layout/PageHeader";

describe("PageHeader", () => {
  it("owns the page heading and optional description", () => {
    render(<PageHeader title="Movimientos" description="Consulta y filtra movimientos." />);
    expect(screen.getByRole("heading", {level: 1, name: "Movimientos"})).toBeInTheDocument();
    expect(screen.getByText("Consulta y filtra movimientos.")).toBeInTheDocument();
  });

  it("keeps actions and supplements as composition slots", () => {
    render(
      <PageHeader title="Cuentas" actions={<button type="button">Añadir</button>}>
        <div aria-label="Resumen de cuentas">Resumen</div>
      </PageHeader>,
    );
    expect(screen.getByRole("button", {name: "Añadir"})).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen de cuentas")).toBeInTheDocument();
  });
});
