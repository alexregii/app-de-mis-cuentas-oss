import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {StatisticsViewModule} from "../features/statistics/loadStatisticsView";

const loadStatisticsViewMock = vi.hoisted(() => vi.fn());

vi.mock("../features/statistics/loadStatisticsView", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/statistics/loadStatisticsView")>();
  return {...original, loadStatisticsView: loadStatisticsViewMock};
});

import {StatisticsSection} from "../features/statistics/StatisticsSection";
import {createStatisticsViewLoader} from "../features/statistics/loadStatisticsView";

describe("lazy statistics", () => {
  beforeEach(() => {
    loadStatisticsViewMock.mockReset();
  });

  it("shares one download and retries after a rejected import", async () => {
    const module = {StatisticsView: () => null};
    const importer = vi.fn<() => Promise<StatisticsViewModule>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValue(module);
    const load = createStatisticsViewLoader(importer);

    const first = load();
    expect(load()).toBe(first);
    await expect(first).rejects.toThrow("chunk unavailable");
    await expect(load()).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("reserves the chart and donut geometry until the feature resolves", async () => {
    let resolveModule!: (module: StatisticsViewModule) => void;
    loadStatisticsViewMock.mockReturnValue(new Promise<StatisticsViewModule>((resolve) => {
      resolveModule = resolve;
    }));

    const {container} = render(<StatisticsSection />);
    expect(screen.getByRole("heading", {name: "Estadísticas"})).toBeInTheDocument();
    expect(container.querySelector(".uplot-chart-shell")).toHaveStyle({height: "286px"});
    expect(container.querySelector(".category-donut")).toBeInTheDocument();

    await act(async () => resolveModule({StatisticsView: () => <p>Estadísticas descargadas</p>}));
    expect(await screen.findByText("Estadísticas descargadas")).toBeInTheDocument();
    expect(container.querySelector("[aria-busy=true]")).not.toBeInTheDocument();
  });

  it("offers a fresh lazy boundary when downloading the chunk fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    loadStatisticsViewMock
      .mockRejectedValueOnce(new Error("fallo de red"))
      .mockResolvedValueOnce({StatisticsView: () => <p>Descarga recuperada</p>});

    render(<StatisticsSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo descargar la sección de estadísticas.");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));

    expect(await screen.findByText("Descarga recuperada")).toBeInTheDocument();
    await waitFor(() => expect(loadStatisticsViewMock).toHaveBeenCalledTimes(2));
  });
});
