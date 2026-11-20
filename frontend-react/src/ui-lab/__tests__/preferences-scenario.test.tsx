import {fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vitest";
import {displayEuro} from "../../format";
import {UiLabApp} from "../App";

afterEach(() => {
  window.location.hash = "";
});

describe("global preferences UI Lab scenario", () => {
  it("reuses segmented controls for theme and privacy", () => {
    window.location.hash = "#global-preferences";
    render(<UiLabApp />);

    const archetype = screen.getByLabelText("Arquetipo de preferencias globales");
    expect(screen.getByRole("heading", {name: "Global preferences"})).toBeInTheDocument();
    expect(archetype).toHaveAttribute("data-theme", "mineral");
    expect(archetype.querySelector(".preferences-scenario-preview strong")?.textContent).toBe(displayEuro(1248.5, false));

    fireEvent.click(within(archetype).getByRole("button", {name: "Basalt"}));
    expect(archetype).toHaveAttribute("data-theme", "basalt");
    expect(within(archetype).getByRole("button", {name: "Basalt"})).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(archetype).getByRole("button", {name: "Ocultar"}));
    expect(archetype.querySelector(".preferences-scenario-preview strong")?.textContent).toBe(displayEuro(1248.5, true));
    expect(within(archetype).getByRole("button", {name: "Ocultar"})).toHaveAttribute("aria-pressed", "true");
  });

  it("represents persistence, recovery and disabled states without a backend", () => {
    window.location.hash = "#global-preferences";
    render(<UiLabApp />);

    fireEvent.click(screen.getByText("Herramientas de prueba de preferencias"));
    const state = screen.getByLabelText("Estado de persistencia");
    fireEvent.change(state, {target: {value: "error"}});
    expect(screen.getByRole("alert")).toHaveTextContent("El cambio se mantiene durante esta sesión");
    fireEvent.change(state, {target: {value: "legacy"}});
    expect(screen.getByRole("status")).toHaveTextContent("configuración anterior");
    fireEvent.change(state, {target: {value: "corrupt"}});
    expect(screen.getByRole("status")).toHaveTextContent("valores seguros");
    fireEvent.change(state, {target: {value: "restored"}});
    expect(screen.getByRole("status")).toHaveTextContent("restauradas al recargar");

    fireEvent.click(screen.getByLabelText("Deshabilitar preferencias"));
    expect(screen.getByRole("button", {name: "Mineral"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Basalt"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Mostrar"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Ocultar"})).toBeDisabled();
  });
});
