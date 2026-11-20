import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {ChartLegendInline} from "../features/statistics/charts/FinanceLineChart";

describe("ChartLegendInline", () => {
  it("announces when the monthly series contains a partial period", () => {
    render(<ChartLegendInline hasPartialPeriod />);

    const legend = screen.getByLabelText("Leyenda del gráfico");
    expect(legend).toHaveTextContent("Ingresos");
    expect(legend).toHaveTextContent("Gasto neto");
    expect(legend).toHaveTextContent("Resultado");
    expect(legend.querySelector(".legend-chip.partial")).toHaveTextContent("Mes parcial");
  });

  it("does not announce a partial period when none is present", () => {
    render(<ChartLegendInline />);
    expect(screen.getByLabelText("Leyenda del gráfico").querySelector(".legend-chip.partial")).toBeNull();
  });
});
