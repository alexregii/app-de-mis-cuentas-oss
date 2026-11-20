import {render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {Button, ButtonLink, IconButton, TextButton, TextLink} from "../ui/controls/Button";

describe("stable UI controls", () => {
  it("expresses Button intent through stable variants without feature classes", () => {
    render(<Button variant="primary" fullWidth className="consumer-hook">Guardar</Button>);
    const button = screen.getByRole("button", {name: "Guardar"});
    expect(button).toHaveClass("ui-button", "ui-button--primary", "ui-button--full", "consumer-hook");
    expect(button).toHaveAttribute("type", "button");
  });

  it("makes loading a disabled and announced control state", () => {
    const onClick = vi.fn();
    render(<Button loading loadingLabel="Guardando…" onClick={onClick}>Guardar</Button>);
    const button = screen.getByRole("button", {name: "Guardando…"});
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("keeps IconButton accessible by requiring a semantic label", () => {
    render(<IconButton aria-label="Buscar" variant="subtle"><span aria-hidden="true">?</span></IconButton>);
    expect(screen.getByRole("button", {name: "Buscar"})).toHaveClass("ui-icon-button", "ui-icon-button--subtle");
  });

  it("shares button geometry with navigational actions without faking button semantics", () => {
    render(<ButtonLink href="/export" variant="secondary">Exportar</ButtonLink>);
    expect(screen.getByRole("link", {name: "Exportar"})).toHaveClass("ui-button", "ui-button--secondary");
  });

  it("keeps text actions semantic for buttons and links", () => {
    render(<><TextButton>Reintentar</TextButton><TextLink href="/movimientos">Ver movimientos</TextLink></>);
    expect(screen.getByRole("button", {name: "Reintentar"})).toHaveClass("ui-text-button");
    expect(screen.getByRole("link", {name: "Ver movimientos"})).toHaveClass("ui-text-button");
  });
});
