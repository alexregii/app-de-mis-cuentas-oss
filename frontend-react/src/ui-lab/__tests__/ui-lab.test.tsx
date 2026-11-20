import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vitest";
import {UiLabApp} from "../App";
import {euro} from "../../format";

afterEach(() => {
  window.location.hash = "";
});

function openLabTools() {
  fireEvent.click(screen.getByText("Herramientas de prueba"));
}

describe("UI Lab", () => {

  it("abre Foundations por defecto y monta un solo escenario", () => {
    render(<UiLabApp />);

    expect(screen.getByRole("heading", {name: "Foundations"})).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "Ledger archetype"})).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", {name: "Catálogo de escenarios"})).toHaveTextContent("Experiments");
  });

  it("resuelve el hash canónico, el heredado y el fallback", () => {
    window.location.hash = "#ledger-archetype";
    const {unmount} = render(<UiLabApp />);
    expect(screen.getByRole("heading", {name: "Ledger archetype"})).toBeInTheDocument();
    unmount();

    window.location.hash = "#statement-ledger";
    const legacy = render(<UiLabApp />);
    expect(screen.getByRole("heading", {name: "Ledger archetype"})).toBeInTheDocument();
    legacy.unmount();

    window.location.hash = "#no-existe";
    render(<UiLabApp />);
    expect(screen.getByRole("heading", {name: "Foundations"})).toBeInTheDocument();
  });

  it("publica navegación desktop como anchors de hash", () => {
    render(<UiLabApp />);

    const ledgerLink = screen.getByRole("link", {name: /Ledger archetype/});
    expect(ledgerLink).toHaveAttribute("href", "#ledger-archetype");
    expect(screen.getByRole("link", {name: /Ledger header tournament/})).toHaveAttribute("href", "#ledger-header-tournament");
  });

  it("mantiene solo los temas aprobados", () => {
    render(<UiLabApp />);

    const lab = screen.getByRole("main");
    const picker = screen.getByLabelText("Tema del experimento");
    expect(lab).toHaveAttribute("data-theme", "mineral");
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
    expect(within(picker).getByRole("option", {name: "Mineral"})).toBeInTheDocument();
    expect(within(picker).getByRole("option", {name: "Basalt"})).toBeInTheDocument();
    fireEvent.change(picker, {target: {value: "basalt"}});
    expect(lab).toHaveAttribute("data-theme", "basalt");
  });

  it("mantiene las acciones declaradas también en densidad compacta", () => {
    window.location.hash = "#transaction-row";
    render(<UiLabApp />);

    const movements = screen.getByLabelText("Movimientos de prueba");
    expect(within(movements).getAllByRole("button", {name: /^Acciones para/})).toHaveLength(5);
    expect(within(movements).queryByLabelText("Acciones para Movimiento sin acciones")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Ver compacta"}));
    expect(within(movements).getAllByRole("button", {name: /^Acciones para/})).toHaveLength(5);
  });

  it("recupera privacidad, vacío y selección en Ledger archetype", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    expect(ledger.querySelectorAll(".ui-statement-ledger__row")).toHaveLength(8);
    expect(within(ledger).getAllByRole("button", {name: /^Acciones para/})).toHaveLength(7);
    expect(within(ledger).getByRole("button", {name: "Acciones para Aporte a cuenta de ahorro"})).toBeInTheDocument();
    const header = ledger.querySelector<HTMLElement>(".ui-ledger-header");
    expect(within(header!).queryByRole("button", {name: /importes/})).not.toBeInTheDocument();

    openLabTools();
    fireEvent.click(screen.getByRole("button", {name: "Ocultar importes"}));
    expect(within(ledger).getAllByLabelText("Importe oculto")).toHaveLength(11);
    fireEvent.click(within(ledger).getByRole("button", {name: "Seleccionar"}));
    const emptyToolbar = within(ledger).getByRole("region", {name: "Acciones de selección"});
    expect(emptyToolbar).toHaveTextContent("0 seleccionados");
    expect(within(ledger).getByRole("button", {name: "Cancelar selección"})).toBeInTheDocument();
    expect(within(emptyToolbar).queryByRole("button", {name: "Categorizar"})).not.toBeInTheDocument();
    expect(within(ledger).getAllByRole("button", {name: "Cancelar selección"})).toHaveLength(1);
    expect(ledger.querySelectorAll(".ui-statement-ledger__menu.is-open")).toHaveLength(0);
    fireEvent.click(within(ledger).getByRole("checkbox", {name: "Seleccionar Nómina septiembre 2026"}));
    expect(within(ledger).getByRole("region", {name: "Acciones de selección"})).toHaveTextContent("1 seleccionado");
    fireEvent.change(screen.getByRole("combobox", {name: "Estado del ledger"}), {target: {value: "empty"}});
    expect(within(ledger).getByRole("heading", {name: "No hay movimientos con estos filtros"})).toBeInTheDocument();
    expect(within(ledger).queryByRole("region", {name: "Acciones de selección"})).not.toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: "Limpiar filtros"}));
    expect(ledger.querySelectorAll(".ui-statement-ledger__row")).toHaveLength(8);
  }, 10000);

  it("mantiene LedgerFilterStrip controlado y permite limpiar filtros activos", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    fireEvent.change(within(ledger).getByRole("searchbox"), {target: {value: "Farmacia"}});
    expect(ledger.querySelectorAll(".ui-statement-ledger__row")).toHaveLength(4);
    expect(within(ledger).getByRole("button", {name: /Búsqueda: Farmacia/})).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: "Limpiar búsqueda"}));
    expect(ledger.querySelectorAll(".ui-statement-ledger__row")).toHaveLength(8);
  });

  it("cubre resultados, estados de carga y paginación del ledger", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    openLabTools();
    const state = screen.getByRole("combobox", {name: "Estado del ledger"});
    const pagination = within(ledger).getByRole("navigation", {name: "Páginas de movimientos"});
    expect(within(pagination).getByRole("button", {name: "Ir a página 1"})).toHaveAttribute("aria-current", "page");
    expect(within(pagination).getAllByRole("button", {name: /Ir a página/})).toHaveLength(4);
    expect(within(pagination).getByRole("button", {name: "Página anterior"})).toBeDisabled();
    expect(within(pagination).getByRole("button", {name: "Página siguiente"})).toBeEnabled();
    fireEvent.click(within(pagination).getByRole("button", {name: "Página siguiente"}));
    expect(within(pagination).getByRole("button", {name: "Ir a página 2"})).toHaveAttribute("aria-current", "page");
    expect(within(ledger).getByText("Nómina septiembre 2026 · 2")).toBeInTheDocument();
    fireEvent.click(within(pagination).getByRole("button", {name: "Ir a página 4"}));
    expect(within(pagination).getByRole("button", {name: "Ir a página 4"})).toHaveAttribute("aria-current", "page");
    expect(within(pagination).getByRole("button", {name: "Página siguiente"})).toBeDisabled();

    fireEvent.change(state, {target: {value: "few"}});
    expect(ledger.querySelectorAll(".ui-statement-ledger__row")).toHaveLength(3);
    expect(within(ledger).queryByRole("navigation", {name: "Páginas de movimientos"})).not.toBeInTheDocument();

    fireEvent.change(state, {target: {value: "loading"}});
    expect(within(ledger).getByRole("status", {name: ""})).toHaveAttribute("aria-busy", "true");
    expect(within(ledger).getByText("Cargando movimientos…")).toBeInTheDocument();
    expect(within(ledger).queryByRole("button", {name: "Seleccionar"})).not.toBeInTheDocument();

    fireEvent.change(state, {target: {value: "error"}});
    const error = within(ledger).getByRole("alert");
    expect(error).toHaveTextContent("No se pudieron cargar los movimientos");
    expect(error).toHaveTextContent("Se mantiene el contexto: el extracto completo");
    fireEvent.click(within(error).getByRole("button", {name: "Reintentar"}));
    expect(ledger.querySelectorAll(".ui-statement-ledger__row")).toHaveLength(8);
    expect(within(ledger).getByText("Los movimientos se han cargado de nuevo.")).toHaveAttribute("role", "status");
    return waitFor(() => expect(within(ledger).getByRole("region", {name: "Resultados del ledger"})).toHaveFocus());
  });

  it("agrupa un rango completo como un único filtro removible", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    expect(within(ledger).queryByLabelText("Desde")).not.toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: /Periodo:/}));
    fireEvent.change(within(ledger).getByLabelText("Mes"), {target: {value: "2026-09"}});
    expect(within(ledger).getByRole("button", {name: /Periodo: Septiembre.*2026/})).toHaveTextContent(/Septiembre.*2026/);
    fireEvent.click(within(ledger).getByRole("button", {name: "Rango personalizado"}));
    expect(within(ledger).getByLabelText("Desde")).toBeInTheDocument();
    expect(within(ledger).getByLabelText("Hasta")).toBeInTheDocument();
    fireEvent.change(within(ledger).getByLabelText("Desde"), {target: {value: "2026-09-22"}});
    fireEvent.change(within(ledger).getByLabelText("Hasta"), {target: {value: "2026-10-11"}});
    expect(within(ledger).getByRole("button", {name: /Periodo: Rango personalizado/})).toHaveTextContent("Rango personalizado");
    expect(within(ledger).getByRole("button", {name: /Quitar filtro de periodo del 22 sept 2026 al 11 oct 2026/})).toHaveTextContent("22 sept – 11 oct 2026");
    expect(within(ledger).queryByRole("button", {name: /Quitar filtro Desde/})).not.toBeInTheDocument();
    expect(within(ledger).queryByRole("button", {name: /Quitar filtro Hasta/})).not.toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: /Quitar filtro de periodo/}));
    fireEvent.click(within(ledger).getByRole("button", {name: "Rango personalizado"}));
    expect(within(ledger).getByLabelText("Desde")).toHaveValue("");
    expect(within(ledger).getByLabelText("Hasta")).toHaveValue("");
    expect(within(ledger).queryByRole("button", {name: /Quitar filtro de periodo/})).not.toBeInTheDocument();
  }, 10000);

  it("mantiene los extremos incompletos y desambigua rangos entre años", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    fireEvent.click(within(ledger).getByRole("button", {name: /Periodo:/}));
    fireEvent.click(within(ledger).getByRole("button", {name: "Rango personalizado"}));
    fireEvent.change(within(ledger).getByLabelText("Desde"), {target: {value: "2026-09-22"}});
    expect(within(ledger).getByRole("button", {name: /Quitar filtro desde 22 sept 2026/})).toHaveTextContent("Desde 22 sept 2026");
    fireEvent.change(within(ledger).getByLabelText("Desde"), {target: {value: ""}});
    fireEvent.click(within(ledger).getByRole("button", {name: "Rango personalizado"}));
    fireEvent.change(within(ledger).getByLabelText("Hasta"), {target: {value: "2026-10-11"}});
    expect(within(ledger).getByRole("button", {name: /Quitar filtro hasta 11 oct 2026/})).toHaveTextContent("Hasta 11 oct 2026");
    fireEvent.change(within(ledger).getByLabelText("Desde"), {target: {value: "2026-12-22"}});
    fireEvent.change(within(ledger).getByLabelText("Hasta"), {target: {value: "2027-01-11"}});
    expect(within(ledger).getByRole("button", {name: /Quitar filtro de periodo del 22 dic 2026 al 11 ene 2027/})).toHaveTextContent("22 dic 2026 – 11 ene 2027");
  }, 10000);

  it("mantiene Limpiar como salida global del periodo", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    fireEvent.click(within(ledger).getByRole("button", {name: /Periodo:/}));
    fireEvent.click(within(ledger).getByRole("button", {name: "Rango personalizado"}));
    fireEvent.change(within(ledger).getByLabelText("Desde"), {target: {value: "2026-09-01"}});
    fireEvent.click(within(ledger).getByRole("button", {name: "Limpiar"}));
    expect(within(ledger).getByRole("button", {name: "Periodo: Cualquier periodo"})).toBeInTheDocument();
    expect(within(ledger).queryByLabelText("Desde")).not.toBeInTheDocument();
  }, 10000);

  it("reserva sourceLabel para metadata excepcional", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    expect(within(ledger).getByText("Nómina septiembre 2026").closest("li")).not.toHaveTextContent("CSV");
    expect(within(ledger).getByText("Factura electricidad").closest("li")).toHaveTextContent("CSV");
  });

  it("mantiene un solo disclosure abierto y permite cerrarlo con Escape", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    const period = within(ledger).getByRole("button", {name: /Periodo:/});
    const refinements = within(ledger).getByRole("button", {name: "Filtros"});
    fireEvent.click(period);
    fireEvent.click(refinements);
    expect(period.closest("details")).not.toHaveAttribute("open");
    expect(refinements.closest("details")).toHaveAttribute("open");
    fireEvent.keyDown(within(ledger).getByRole("combobox", {name: "Tipo"}), {key: "Escape"});
    expect(refinements.closest("details")).not.toHaveAttribute("open");
  });

  it("presenta refinamientos en un popover contenido y elimina filtros activos", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    fireEvent.click(within(ledger).getByRole("button", {name: "Filtros"}));
    expect(within(ledger).getByLabelText("Tipo")).toBeInTheDocument();
    expect(within(ledger).getByLabelText("Base estadística")).toBeInTheDocument();
    fireEvent.change(within(ledger).getByLabelText("Tipo"), {target: {value: "income"}});
    expect(within(ledger).getByRole("button", {name: /Quitar filtro Tipo: Ingreso/})).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: /Quitar filtro Tipo: Ingreso/}));
    expect(within(ledger).queryByRole("button", {name: /Quitar filtro Tipo/})).not.toBeInTheDocument();
  });

  it("separa los controles del Lab de la superficie de producto", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    const filters = within(ledger).getByRole("region", {name: "Filtros del ledger"});
    const labTools = screen.getByText("Herramientas de prueba").closest("details");
    expect(labTools).not.toHaveAttribute("open");
    expect(within(ledger).queryByText("Herramientas de prueba")).not.toBeInTheDocument();
    openLabTools();
    expect(labTools).toHaveAttribute("open");
    expect(screen.getByRole("region", {name: "Controles del Lab"})).toBeInTheDocument();
    expect(screen.getByRole("combobox", {name: "Estado del ledger"})).toBeInTheDocument();
    expect(within(filters).queryByRole("combobox", {name: "Estado del ledger"})).not.toBeInTheDocument();
  });

  it("valida la toolbar de selección con disponibilidad independiente y salida a browse", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    openLabTools();
    fireEvent.click(within(ledger).getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(within(ledger).getByRole("checkbox", {name: "Seleccionar Nómina septiembre 2026"}));
    const toolbar = within(ledger).getByRole("region", {name: "Acciones de selección"});
    expect(within(toolbar).getByRole("button", {name: "Categorizar"})).toBeEnabled();
    expect(within(toolbar).queryByText("La selección contiene movimientos no compatibles.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", {name: "Disponibilidad masiva"}), {target: {value: "mixed"}});
    expect(within(toolbar).getByRole("button", {name: "Categorizar"})).toHaveAttribute("aria-disabled", "true");
    expect(within(toolbar).getByRole("button", {name: "Exportar"})).toBeEnabled();
    fireEvent.click(within(toolbar).getByRole("button", {name: "Categorizar"}));
    const reason = within(toolbar).getByText("La selección contiene movimientos no compatibles.");
    expect(reason).toHaveAttribute("role", "status");
    expect(within(toolbar).getByRole("button", {name: "Categorizar"})).toHaveAttribute("aria-describedby", reason.id);
    expect(within(toolbar).queryByText(/se evaluaría en el flujo real/)).not.toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole("button", {name: "Exportar"}));
    expect(within(toolbar).queryByText("La selección contiene movimientos no compatibles.")).not.toBeInTheDocument();
    expect(within(ledger).getByText("Exportar se evaluaría en el flujo real.")).toHaveAttribute("role", "status");

    fireEvent.change(screen.getByRole("combobox", {name: "Disponibilidad masiva"}), {target: {value: "blocked"}});
    expect(within(toolbar).getByText(/No hay acciones disponibles/)).toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", {name: "Categorizar"})).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", {name: "Exportar"})).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", {name: "Archivar"})).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: "Cancelar selección"}));
    expect(within(ledger).queryByRole("region", {name: "Acciones de selección"})).not.toBeInTheDocument();
    expect(within(ledger).queryByRole("checkbox", {name: "Seleccionar Nómina septiembre 2026"})).not.toBeInTheDocument();
    expect(within(ledger).getByRole("button", {name: "Seleccionar"})).toBeInTheDocument();
  });

  it("bloquea filtros sin borrar la selección", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    const filters = within(ledger).getByRole("region", {name: "Filtros del ledger"});
    const period = within(ledger).getByRole("button", {name: /Periodo:/});
    fireEvent.click(period);
    expect(period.closest("details")).toHaveAttribute("open");
    fireEvent.click(within(ledger).getByRole("button", {name: "Seleccionar"}));
    expect(period.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(within(ledger).getByRole("button", {name: "Cancelar selección"}));
    const refinements = within(ledger).getByRole("button", {name: "Filtros"});
    fireEvent.click(refinements);
    expect(refinements.closest("details")).toHaveAttribute("open");
    fireEvent.click(within(ledger).getByRole("button", {name: "Seleccionar"}));
    expect(refinements.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(within(ledger).getByRole("checkbox", {name: "Seleccionar Nómina septiembre 2026"}));
    expect(within(ledger).getByRole("searchbox")).toBeDisabled();
    expect(within(ledger).getByRole("button", {name: /Periodo:/})).toHaveAttribute("aria-disabled", "true");
    expect(within(ledger).getByRole("button", {name: "Filtros"})).toHaveAttribute("aria-disabled", "true");
    expect(filters).toHaveAttribute("aria-describedby");
    expect(document.getElementById(filters.getAttribute("aria-describedby")!)).toHaveTextContent("Los filtros se bloquean durante la selección.");
    expect(within(ledger).getByRole("region", {name: "Acciones de selección"})).toHaveTextContent("1 seleccionado");
  });

  it("mantiene una fila sin capabilities aunque se active selección", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);

    const ledger = screen.getByLabelText("Escenario de ledger archetype");
    const row = within(ledger).getByText("Cargo pendiente de clasificar").closest("li");
    expect(within(row!).queryByLabelText("Acciones para Cargo pendiente de clasificar")).not.toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole("button", {name: "Seleccionar"}));
    expect(within(row!).getByRole("checkbox", {name: "Seleccionar Cargo pendiente de clasificar"})).toBeInTheDocument();
  });

  it("aísla las variantes de cabecera en Experiments", () => {
    window.location.hash = "#ledger-header-tournament";
    render(<UiLabApp />);

    const experiment = screen.getByLabelText("Experimento de cabeceras del ledger");
    expect(screen.getByRole("heading", {name: "Ledger header tournament"})).toBeInTheDocument();
    expect(within(experiment).getByLabelText("Comparar cabecera")).toHaveValue("statement");
    expect(within(experiment).getAllByRole("option")).toHaveLength(6);
    expect(screen.queryByRole("list", {name: "Movimientos de prueba"})).not.toBeInTheDocument();
  });
});


describe("regresiones del checkpoint M6", () => {
  it("conserva foco DOM y la modalidad de origen, con fallback para activación asistida", () => {
    const {unmount} = render(<UiLabApp />);
    const root = screen.getByRole("main");
    const select = screen.getByLabelText("Tema del experimento");
    fireEvent.keyDown(document, {key: "Tab"});
    select.focus();
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
    fireEvent.pointerDown(select, {pointerType: "touch"});
    expect(root).toHaveAttribute("data-input-modality", "pointer");
    select.focus();
    expect(select).toHaveFocus();
    expect(root).toHaveAttribute("data-input-modality", "pointer");
    fireEvent.click(select, {detail: 0});
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
    fireEvent.blur(window);
    expect(root).not.toHaveAttribute("data-input-modality");
    unmount();
    fireEvent.keyDown(document, {key: "Tab"});
    expect(root).not.toHaveAttribute("data-input-modality");
  });

  it("distingue escritura/edición de navegación sin depender del dispositivo", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);
    const root = screen.getByRole("main");
    const input = screen.getByLabelText("Búsqueda");
    fireEvent.pointerDown(input, {pointerType: "touch"});
    input.focus();
    for (const key of ["a", " ", "Backspace", "Delete", "ArrowLeft", "ArrowDown", "Home", "End", "PageDown", "Enter"]) {
      fireEvent.keyDown(input, {key});
      expect(root, key).toHaveAttribute("data-input-modality", "pointer");
    }
    fireEvent.keyDown(input, {key: "Tab", isComposing: true});
    expect(root).toHaveAttribute("data-input-modality", "pointer");
    fireEvent.keyDown(input, {key: "Tab"});
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
    fireEvent.keyDown(input, {key: "a"});
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
    fireEvent.pointerDown(input, {pointerType: "mouse"});
    fireEvent.keyDown(input, {key: "a", ctrlKey: true});
    expect(root).toHaveAttribute("data-input-modality", "pointer");
    fireEvent.keyDown(input, {key: "Escape"});
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
    const next = screen.getByRole("button", {name: "Página siguiente"});
    for (const key of ["Enter", " ", "ArrowDown", "PageDown", "Home"]) {
      fireEvent.pointerDown(next);
      fireEvent.keyDown(next, {key});
      expect(root).toHaveAttribute("data-input-modality", "keyboard");
    }
  });
});


describe("contrato del arquetipo M7", () => {

  it("resume el conjunto filtrado, conserva totales al paginar y excluye traspasos", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);
    const header = document.querySelector<HTMLElement>(".ui-ledger-header")!;
    expect(header).toHaveTextContent("Todos los periodos");
    const initialSummary = header.textContent;
    fireEvent.click(screen.getByRole("button", {name: "Página siguiente"}));
    expect(header.textContent).toBe(initialSummary);
    fireEvent.change(screen.getByRole("searchbox"), {target: {value: "Farmacia"}});
    expect(within(header).getByLabelText(`Gastos: ${euro(-50.87)}`, {normalizer: (value) => value})).toBeInTheDocument();
    expect(within(header).getByLabelText(`Neto operativo: ${euro(-50.87)}`, {normalizer: (value) => value})).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {target: {value: "Aporte a cuenta"}});
    expect(within(header).getByLabelText(`Neto operativo: ${euro(0)}`, {normalizer: (value) => value})).toBeInTheDocument();
    expect(screen.getByLabelText("Resultados del ledger").querySelectorAll("li")).toHaveLength(4);
    fireEvent.change(screen.getByRole("searchbox"), {target: {value: "inexistente"}});
    expect(within(header).getByLabelText(`Ingresos: ${euro(0)}`, {normalizer: (value) => value})).toBeInTheDocument();
    expect(within(header).getByLabelText(`Gastos: ${euro(0)}`, {normalizer: (value) => value})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "No hay movimientos con estos filtros"})).toBeInTheDocument();
  });

  it("prepara contexto temporal y capabilities de fixtures independientes de metadata", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);
    fireEvent.click(screen.getByRole("button", {name: /Periodo:/}));
    fireEvent.change(screen.getByLabelText("Mes", {exact: true}), {target: {value: "2026-08"}});
    expect(document.querySelector(".ui-ledger-header")).toHaveTextContent("Agosto de 2026");
    fireEvent.click(screen.getByRole("button", {name: "Limpiar"}));
    const row = screen.getByText("Nómina septiembre 2026").closest("li")!;
    fireEvent.click(within(row).getByRole("button", {name: /^Acciones para/}));
    expect(within(row).getByRole("button", {name: "Editar Nómina septiembre 2026"})).toBeInTheDocument();
    expect(row.querySelector("small")).toBeNull();
    fireEvent.click(within(row).getByRole("button", {name: "Editar Nómina septiembre 2026"}));
    expect(row.querySelector(".ui-overflow-menu.is-open")).toBeNull();
    expect(screen.getByText("Editar ledger-1 se probaría sin modificar datos.")).toHaveAttribute("role", "status");
  });
});

describe("revisión del contrato M7", () => {
  it.each(["empty", "loading", "error"])("no monta chrome de selección cuando el estado es %s", (state) => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);
    openLabTools();
    fireEvent.change(screen.getByRole("combobox", {name: "Estado del ledger"}), {target: {value: state}});
    expect(screen.queryByRole("region", {name: "Selección de movimientos"})).not.toBeInTheDocument();
    expect(screen.queryByRole("region", {name: "Acciones de selección"})).not.toBeInTheDocument();
    expect(document.querySelector(".ui-selection-toolbar")).not.toBeInTheDocument();
  });

  it("conserva el mismo CTA y foco al seleccionar y cancelar", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);
    const button = screen.getByRole("button", {name: "Seleccionar"});
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("region", {name: "Acciones de selección"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Cancelar selección"})).toBe(button);
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button.closest(".ui-selection-toolbar")).not.toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole("button", {name: "Seleccionar"})).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.queryByRole("region", {name: "Acciones de selección"})).not.toBeInTheDocument();
  });

  it("el stress visual no altera opciones, filtros, selección, paginación ni resumen", () => {
    window.location.hash = "#ledger-archetype";
    render(<UiLabApp />);
    const filters = document.querySelector(".ui-ledger-filter-strip")!;
    const options = [...filters.querySelectorAll("option")].map((option) => option.outerHTML);
    const header = document.querySelector(".ui-ledger-header")!;
    const summary = header.textContent;
    const rowSnapshot = () => [...document.querySelectorAll(".ui-statement-ledger__row")].map((row) => ({row, actions: [...row.querySelectorAll("details button")].map((button) => button.textContent)}));
    fireEvent.click(screen.getByRole("button", {name: "Página siguiente"}));
    const rowsBeforeStress = rowSnapshot();
    fireEvent.click(screen.getByRole("button", {name: "Probar contenido largo"}));
    expect(screen.getByRole("button", {name: "Ir a página 2"})).toHaveAttribute("aria-current", "page");
    expect(rowSnapshot()).toEqual(rowsBeforeStress);
    expect(header.textContent).toBe(summary);
    expect([...filters.querySelectorAll("option")].map((option) => option.outerHTML)).toEqual(options);
    expect(screen.getByText(/Ingreso extraordinario con una descripción/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {target: {value: "Nómina"}});
    expect(screen.getByLabelText("Resultados del ledger").querySelectorAll("li")).toHaveLength(4);
    const filteredSummary = header.textContent;
    fireEvent.click(screen.getByRole("button", {name: "Seleccionar"}));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", {name: "Restablecer contenido"}));
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(screen.getByRole("searchbox")).toHaveValue("Nómina");
    fireEvent.click(screen.getByRole("button", {name: "Cancelar selección"}));
    expect(header.textContent).toBe(filteredSummary);
    expect(screen.getByLabelText("Resultados del ledger").querySelectorAll("li")).toHaveLength(4);
  });
});
