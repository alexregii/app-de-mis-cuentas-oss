import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {getLedgerPaginationItems, LedgerPagination} from "../ui/finance/LedgerPagination";
import {LedgerEmptyState, LedgerErrorState, LedgerLoadingState} from "../ui/finance/LedgerStates";

describe("estados del ledger", () => {
  it.each([
    {detail: undefined, action: false},
    {detail: "Cambia los filtros.", action: false},
    {detail: undefined, action: true},
    {detail: "Cambia los filtros.", action: true},
  ])("acepta vacío con detail=$detail y action=$action", ({detail, action}) => {
    const onAction = vi.fn();
    const {container} = render(<LedgerEmptyState title="Sin movimientos" detail={detail} action={action ? {label: "Volver", onAction} : undefined} />);
    const section = screen.getByRole("region", {name: "Sin movimientos"});
    expect(section).not.toHaveAttribute("aria-live");
    expect(container.querySelectorAll("p")).toHaveLength(detail ? 1 : 0);
    if (detail) expect(section).toHaveAccessibleDescription(detail);
    else expect(section).not.toHaveAttribute("aria-describedby");
    if (action) {
      fireEvent.click(screen.getByRole("button", {name: "Volver"}));
      expect(onAction).toHaveBeenCalledOnce();
    } else expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[autofocus], .panel")).toBeNull();
  });

  it("mantiene error sin retry como un solo aviso sin mover foco", () => {
    const {container} = render(<LedgerErrorState message="Vuelve más tarde." />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[autofocus], [aria-live]")).toBeNull();
  });

  it("mantiene vacío como presentación opcionalmente recuperable", () => {
    const onAction = vi.fn();
    const {rerender} = render(<LedgerEmptyState title="Sin coincidencias" detail="Cambia los filtros." />);

    expect(screen.getByRole("heading", {name: "Sin coincidencias"})).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<LedgerEmptyState title="Sin coincidencias" detail="Cambia los filtros." action={{label: "Limpiar filtros", onAction}} />);
    fireEvent.click(screen.getByRole("button", {name: "Limpiar filtros"}));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("expone el loading sin acoplarlo a fetching ni a Panel", () => {
    const {container} = render(<LedgerLoadingState label="Cargando extracto…" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Cargando extracto…")).toBeInTheDocument();
    expect(container.querySelectorAll(".ui-ledger-loading-state__row")).toHaveLength(4);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelector(".ui-ledger-loading-state__rows")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".panel")).not.toBeInTheDocument();
  });

  it("anuncia el error y deja el reintento en manos del consumidor", () => {
    const onRetry = vi.fn();
    render(<LedgerErrorState message="La red no responde." onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("La red no responde.");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("paginación del ledger", () => {
  it.each([
    {numPages: 4, page: 3, expected: [1, 2, 3, 4]},
    {numPages: 6, page: 3, expected: [1, 2, 3, 4, 5, 6]},
    {numPages: 24, page: 3, expected: [1, 2, 3, "ellipsis", 24]},
    {numPages: 24, page: 7, expected: [1, "ellipsis", 6, 7, 8, "ellipsis", 24]},
    {numPages: 24, page: 23, expected: [1, "ellipsis", 22, 23, 24]},
  ])("genera páginas deterministas sin ellipsis innecesario", ({numPages, page, expected}) => {
    expect(getLedgerPaginationItems(numPages, page)).toEqual(expected);
  });

  it("recupera el foco cuando una disponibilidad preparada pasa a false", () => {
    const props = {page: 2, numPages: 4, itemFrom: 9, itemTo: 16, totalItems: 32,
      hasPrevious: true, hasNext: true, onPrevious: vi.fn(), onNext: vi.fn(), onPageChange: vi.fn()};
    const {rerender} = render(<LedgerPagination {...props} />);
    screen.getByRole("button", {name: "Página siguiente"}).focus();
    rerender(<LedgerPagination {...props} hasNext={false} />);
    expect(screen.getByRole("button", {name: "Ir a página 2"})).toHaveFocus();
    screen.getByRole("button", {name: "Página anterior"}).focus();
    rerender(<LedgerPagination {...props} hasPrevious={false} />);
    expect(screen.getByRole("button", {name: "Ir a página 2"})).toHaveFocus();
  });

  it("respeta disponibilidad externa y no captura teclas fuera del nav", () => {
    const onPrevious = vi.fn(), onNext = vi.fn(), onPageChange = vi.fn();
    render(<><input aria-label="Fuera" /><LedgerPagination page={2} numPages={4} itemFrom={9} itemTo={16} totalItems={32} hasPrevious={false} hasNext={false} onPrevious={onPrevious} onNext={onNext} onPageChange={onPageChange} /></>);
    expect(screen.getByRole("button", {name: "Página anterior"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Página siguiente"})).toBeDisabled();
    for (const key of ["Home", "End", "PageUp", "PageDown"]) fireEvent.keyDown(screen.getByLabelText("Fuera"), {key});
    for (const key of ["PageUp", "PageDown"]) fireEvent.keyDown(screen.getByRole("button", {name: "Ir a página 2"}), {key});
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("presenta el estado preparado y no navega desde extremos deshabilitados", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onPageChange = vi.fn();
    render(<LedgerPagination page={1} numPages={4} itemFrom={1} itemTo={8} totalItems={29} hasPrevious={false} hasNext onPrevious={onPrevious} onNext={onNext} onPageChange={onPageChange} />);

    const pagination = screen.getByRole("navigation", {name: "Páginas de movimientos"});
    expect(pagination).toHaveTextContent("1–8 de 29 movimientos");
    expect(screen.getByRole("button", {name: "Ir a página 1"})).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("button", {name: /Ir a página/})).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", {name: "Página anterior"}));
    const next = screen.getByRole("button", {name: "Página siguiente"});
    expect(next).toHaveAttribute("aria-keyshortcuts", "PageDown End");
    fireEvent.click(next);
    fireEvent.keyDown(next, {key: "PageDown"});
    fireEvent.keyDown(screen.getByRole("button", {name: "Ir a página 1"}), {key: "End"});
    fireEvent.click(screen.getByRole("button", {name: "Ir a página 4"}));
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPageChange).toHaveBeenCalledTimes(2);
    expect(onPageChange).toHaveBeenLastCalledWith(4);
  });

  it("expone controles accesibles y usa callbacks numerados", () => {
    const onPageChange = vi.fn();
    render(<LedgerPagination page={7} numPages={24} itemFrom={49} itemTo={56} totalItems={192} hasPrevious hasNext onPrevious={vi.fn()} onNext={vi.fn()} onPageChange={onPageChange} />);

    expect(screen.queryByText("Página", {exact: true})).not.toBeInTheDocument();
    const currentPage = screen.getByRole("button", {name: "Ir a página 7"});
    expect(currentPage).toHaveAttribute("aria-current", "page");
    currentPage.focus();
    expect(currentPage).toHaveFocus();
    expect(screen.getAllByText("…")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", {name: "Ir a página 8"}));
    expect(onPageChange).toHaveBeenCalledWith(8);
  });
});
