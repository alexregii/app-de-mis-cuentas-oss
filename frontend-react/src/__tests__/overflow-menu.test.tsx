import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {OverflowMenu, OverflowMenuItem} from "../ui/controls/OverflowMenu";

describe("OverflowMenu", () => {
  it("cierra con Escape y devuelve el foco al trigger", () => {
    render(<OverflowMenu label="Acciones de Cuenta diaria"><OverflowMenuItem>Editar</OverflowMenuItem></OverflowMenu>);

    const trigger = screen.getByRole("button", {name: "Acciones de Cuenta diaria"});
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("group", {name: "Acciones de Cuenta diaria"}), {key: "Escape"});

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("button", {name: "Editar"})).not.toBeInTheDocument();
  });

  it("cierra al elegir una acción antes de ejecutar su callback", () => {
    const onAction = vi.fn();
    render(<OverflowMenu label="Acciones de Cuenta diaria"><OverflowMenuItem onClick={onAction}>Editar</OverflowMenuItem></OverflowMenu>);

    const trigger = screen.getByRole("button", {name: "Acciones de Cuenta diaria"});
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", {name: "Editar"}));

    expect(onAction).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("cierra ante un click externo y mantiene las acciones fuera del árbol cuando está cerrado", () => {
    render(<><OverflowMenu label="Acciones de Cuenta diaria"><OverflowMenuItem>Editar</OverflowMenuItem></OverflowMenu><button>Fuera</button></>);

    fireEvent.click(screen.getByRole("button", {name: "Acciones de Cuenta diaria"}));
    fireEvent.pointerDown(screen.getByRole("button", {name: "Fuera"}));

    expect(screen.getByRole("button", {name: "Acciones de Cuenta diaria"})).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", {name: "Editar"})).not.toBeInTheDocument();
  });
});
