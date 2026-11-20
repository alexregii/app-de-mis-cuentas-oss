import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {Search} from "lucide-react";
import {CommandPalette} from "../app/shell/CommandPalette";
import {commandSearchApi} from "../app/commandSearchApi";
import type {SectionDefinition} from "../app/contracts";

vi.mock("../app/commandSearchApi", () => ({commandSearchApi: {search: vi.fn()}}));

const sections: SectionDefinition[] = [{
  id: "transactions",
  label: "Movimientos",
  Icon: Search,
  navigationGroup: "primary",
  action: {label: "Añadir movimiento", Icon: Search, onClick: () => undefined},
  render: () => null,
}];

const renderPalette = (open = true) => {
  const onClose = vi.fn();
  const onOpen = vi.fn();
  const onNavigate = vi.fn();
  const onOpenHref = vi.fn();
  const {unmount} = render(
    <CommandPalette
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      sections={sections}
      runtime={{activeTab: "dashboard", navigate: onNavigate, openNewMovement: vi.fn(), openPlanningComposer: vi.fn(), openTransactionIntent: vi.fn(), reload: vi.fn(async () => undefined)}}
      routeKey={window.location.href}
      onNavigate={onNavigate}
      onOpenHref={onOpenHref}
    />,
  );
  return {onClose, onOpen, onNavigate, onOpenHref, unmount};
};

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

it("opens from Ctrl+K and exposes registry-derived frequent actions", () => {
  const {onOpen} = renderPalette(false);
  fireEvent.keyDown(window, {key: "k", ctrlKey: true});
  expect(onOpen).toHaveBeenCalledOnce();
});

it("wraps focus in both Tab directions and returns to the opener when closed", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const {onClose, unmount} = renderPalette();
  const input = screen.getByPlaceholderText("Buscar movimientos, cuentas, categorías…");
  const options = screen.getAllByRole("option");
  const lastOption = options[options.length - 1];

  expect(input).toHaveFocus();
  lastOption.focus();
  fireEvent.keyDown(document, {key: "Tab"});
  expect(input).toHaveFocus();
  fireEvent.keyDown(document, {key: "Tab", shiftKey: true});
  expect(lastOption).toHaveFocus();

  fireEvent.keyDown(document, {key: "Escape"});
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

it("searches the API and opens a canonical movement link", async () => {
  vi.mocked(commandSearchApi.search).mockResolvedValue({
    query: "super",
    groups: [{id: "transactions", label: "Movimientos", items: [{id: "transaction:3", title: "Supermercado", detail: "Hoy · Cuenta diaria", href: "/?tab=transactions&q=Supermercado"}]}],
  });
  const {onClose, onOpenHref} = renderPalette();
  const input = screen.getByPlaceholderText("Buscar movimientos, cuentas, categorías…");
  fireEvent.change(input, {target: {value: "super"}});

  await waitFor(() => expect(commandSearchApi.search).toHaveBeenCalledWith("super"));
  fireEvent.click(await screen.findByRole("option", {name: /Supermercado/}));

  expect(onClose).toHaveBeenCalledOnce();
  expect(onOpenHref).toHaveBeenCalledWith("/?tab=transactions&q=Supermercado");
});
