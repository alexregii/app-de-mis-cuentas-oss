import {fireEvent, render, screen, within, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vitest";
import {UiLabApp} from "../App";
import {hasConsistentReviewFixture, reviewC3Fixtures} from "../fixtures/review-c3-correctives";
import {reviewFixtures} from "../fixtures/review";

afterEach(() => {
  window.location.hash = "";
});

function openReviewLab() {
  window.location.hash = "#review-archetype";
  render(<UiLabApp />);
  return screen.getByRole("region", {name: "Escenario de Revisión"});
}

function reviewCard(review: HTMLElement, id: string) {
  return review.querySelector<HTMLElement>(`[data-review-item="${id}"]`)!;
}

describe("Review Decision Queue UI Lab", () => {
  it("mantiene R0 congelada y aplica el correctivo C3 de la fecha de la fixture bloqueada", () => {
    const original = reviewFixtures.find((item) => item.id === "review-blocked")!;
    const corrected = reviewC3Fixtures.find((item) => item.id === "review-blocked")!;
    expect(original.transaction.date).toBe("2026-09-06");
    expect(corrected.transaction.date).toBe("");
    expect(corrected.attentionIssues.map((issue) => issue.code)).toContain("category-missing");
    expect(reviewC3Fixtures.every(hasConsistentReviewFixture)).toBe(true);
  });

  it("mantiene las etiquetas de la evidencia en la fixture correctiva y no en el dato R0", () => {
    expect(reviewFixtures.find((item) => item.id === "review-new-prepared")!.transaction.tags).toEqual([]);
    expect(reviewC3Fixtures.find((item) => item.id === "review-new-prepared")!.transaction.tags).toEqual(["casa", "anual"]);
  });

  it("renderiza una única cola cronológica y conserva las capas de decisión", () => {
    const review = openReviewLab();
    expect(review).toHaveTextContent("13 preparados · 3 por revisar · 2 bloqueados");
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(18);
    expect(review.querySelectorAll("[data-review-source]")).toHaveLength(0);
    expect([...review.querySelectorAll<HTMLElement>("[data-review-item]")].map((item) => item.dataset.reviewItem)).toEqual([
      "review-blocked", "review-new-prepared", "review-category-change", "review-modified-prepared", "review-account-missing", "review-uncategorized", "review-description-attention", "review-description-change", "review-transfer", "review-transfer-invalid", "review-batch-a", "review-batch-b", "review-extreme-amount", "review-long-description", "review-prepared-pending", "review-private-amount", "review-reopened", "review-refund-dependent",
    ]);
    const item = reviewCard(review, "review-new-prepared");
    expect(item).toHaveAttribute("data-review-history", "new");
    expect(item).toHaveAttribute("data-review-preparation", "prepared");
    expect(item).toHaveAttribute("data-review-decision", "pending");
    expect(item).toHaveTextContent("Nuevo");
    expect(item).not.toHaveTextContent("Preparado");
    expect(item).not.toHaveTextContent("Pendiente");
  });

  it("expone sincronización, cambios y origen sin convertir la cola en un ledger", () => {
    const review = openReviewLab();
    expect(within(review).getByText("Sincronizado")).toBeInTheDocument();
    expect(within(review).getByText("· 8 sep, 17:32")).toBeInTheDocument();
    expect(within(review).getByText("7 cambios desde sincronización")).toBeInTheDocument();
    expect(within(review).getByText("1 reabierto")).toBeInTheDocument();
    expect(review.querySelectorAll(".ui-review-source")).toHaveLength(0);
    expect(review.querySelector(".ui-ledger-archetype")).not.toBeInTheDocument();
  });

  it("cubre carga, error, vacío y muchos elementos", () => {
    const review = openReviewLab();
    fireEvent.click(within(review).getByText("Probar estados del arquetipo"));
    const state = within(review).getByRole("combobox", {name: "Estado de página"});
    fireEvent.change(state, {target: {value: "loading"}});
    expect(review).toHaveAttribute("aria-busy", "true");
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(0);
    fireEvent.change(state, {target: {value: "error"}});
    expect(within(review).getByRole("alert")).toHaveTextContent("No se pudo cargar la cola de Revisión.");
    fireEvent.click(within(review).getByRole("button", {name: "Reintentar"}));
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(18);
    fireEvent.change(state, {target: {value: "empty"}});
    expect(within(review).getByText("No hay movimientos pendientes de revisión.")).toBeInTheDocument();
    fireEvent.click(within(review).getByRole("button", {name: "Mostrar datos de ejemplo"}));
    fireEvent.change(state, {target: {value: "many"}});
    expect(review).toHaveTextContent("26 preparados · 6 por revisar · 4 bloqueados");
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(36);
  });

  it("filtra sin reordenar la cola", () => {
    const review = openReviewLab();
    fireEvent.click(within(review).getByRole("button", {name: "Necesitan atención"}));
    expect([...review.querySelectorAll<HTMLElement>("[data-review-item]")].map((item) => item.dataset.reviewItem)).toEqual(["review-blocked", "review-account-missing", "review-uncategorized", "review-description-attention", "review-transfer-invalid"]);
    fireEvent.click(within(review).getByRole("button", {name: "Preparados"}));
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(13);
    expect(review.querySelector('[data-review-item="review-blocked"]')).not.toBeInTheDocument();
  });

  it("abre categoría, cuenta, tipo y fecha en el primer gesto", () => {
    const review = openReviewLab();
    const categoryCard = reviewCard(review, "review-uncategorized");
    fireEvent.click(within(categoryCard).getByRole("button", {name: "Categoría: Sin categoría"}));
    expect(within(categoryCard).getByRole("combobox", {name: "Categoría"})).toBeInTheDocument();
    expect(within(categoryCard).getByRole("listbox", {name: "Categorías disponibles"})).toBeInTheDocument();
    fireEvent.keyDown(within(categoryCard).getByRole("combobox", {name: "Categoría"}), {key: "Escape"});
    expect(within(categoryCard).getByRole("button", {name: "Categoría: Sin categoría"})).toHaveFocus();
    fireEvent.click(within(categoryCard).getByRole("button", {name: "Categoría: Sin categoría"}));
    fireEvent.click(within(categoryCard).getByRole("option", {name: "Restaurantes"}));
    expect(categoryCard).toHaveAttribute("data-review-preparation", "prepared");

    const accountCard = reviewCard(review, "review-account-missing");
    fireEvent.click(within(accountCard).getByRole("button", {name: "Cuenta: Sin cuenta"}));
    expect(within(accountCard).getByRole("combobox", {name: "Cuenta"})).toBeInTheDocument();
    expect(within(accountCard).getByRole("combobox", {name: "Cuenta"})).toHaveValue("");
    fireEvent.click(within(accountCard).getByRole("option", {name: "Santander"}));
    expect(accountCard).toHaveAttribute("data-review-preparation", "prepared");

    const prepared = reviewCard(review, "review-prepared-pending");
    fireEvent.click(within(prepared).getByRole("button", {name: "Tipo: Gasto"}));
    expect(within(prepared).getByRole("listbox", {name: "Tipo disponibles"})).toBeInTheDocument();
    fireEvent.keyDown(within(prepared).getByRole("combobox", {name: "Tipo"}), {key: "Escape"});
    fireEvent.click(within(prepared).getByRole("button", {name: "Fecha: 08/09/2026"}));
    expect(within(prepared).getByLabelText("Fecha")).toHaveFocus();
  }, 15_000);

  it("guarda una edición decimal introducida con coma local", () => {
    const review = openReviewLab();
    const decimalCard = reviewCard(review, "review-batch-a");
    fireEvent.click(within(decimalCard).getByRole("button", {name: "Importe: -9,20 €"}));
    const decimal = within(decimalCard).getByLabelText("Importe");
    fireEvent.change(decimal, {target: {value: "12,50"}});
    fireEvent.keyDown(decimal, {key: "Enter"});
    expect(within(decimalCard).getByRole("button", {name: "Importe: -12,50 €"})).toBeInTheDocument();
  });

  it("no anuncia cambios al salir de editores con el valor original", () => {
    const review = openReviewLab();
    const concept = reviewCard(review, "review-new-prepared");
    fireEvent.click(within(concept).getByRole("button", {name: "Concepto: Nómina septiembre 2026"}));
    fireEvent.blur(within(concept).getByLabelText("Concepto"));
    expect(within(review).queryByText(/^Dato corregido\./)).not.toBeInTheDocument();

    const account = reviewCard(review, "review-account-missing");
    fireEvent.click(within(account).getByRole("button", {name: "Cuenta: Sin cuenta"}));
    fireEvent.click(within(account).getByRole("option", {name: "Sin cuenta"}));
    expect(within(review).queryByText(/^Dato corregido\./)).not.toBeInTheDocument();
  });

  it("mantiene los errores junto al campo y deja la relación transversal abajo", () => {
    const review = openReviewLab();
    const blocked = reviewCard(review, "review-blocked");
    expect(blocked.querySelectorAll('.ui-review-inline__issues:not([data-review-blocking-summary]):not([data-review-attention-summary])')).toHaveLength(0);
    expect(blocked.querySelectorAll(".ui-review-inline__field-error")).toHaveLength(4);
    const account = within(blocked).getByRole("button", {name: "Cuenta: Sin cuenta"});
    const amount = within(blocked).getByRole("button", {name: "Importe: 0,00 €"});
    expect(account.getAttribute("aria-describedby")).not.toBe(amount.getAttribute("aria-describedby"));
    expect(blocked).toHaveTextContent("Sin cuenta");
    expect(blocked).toHaveTextContent("Sin fecha");
    expect(blocked).toHaveTextContent("Falta la cuenta.");
    expect(blocked).toHaveTextContent("Falta la fecha de origen.");
    expect(blocked).toHaveTextContent("Falta categoría.");
    expect(blocked).toHaveTextContent("El importe debe ser mayor que 0.");
    expect(blocked.querySelector("[data-review-blocking-summary]")).toHaveTextContent("Hay 3 problemas que impiden incorporar");
    expect(blocked.querySelector("[data-review-attention-summary]")).not.toBeInTheDocument();
    expect(blocked.querySelector('[data-review-inline-field="date"]')).toHaveClass("ui-review-inline__field--blocking");
    expect(blocked.querySelector('[data-review-inline-field="account"]')).toHaveClass("ui-review-inline__field--blocking");
    expect(blocked.querySelector('[data-review-inline-field="category"]')).toHaveClass("ui-review-inline__field--attention");
    expect(blocked.querySelector('[data-review-inline-field="category"]')).not.toHaveClass("ui-review-inline__field--blocking");

    const transfer = reviewCard(review, "review-transfer-invalid");
    expect(transfer).toHaveTextContent("Sin cuenta");
    expect(transfer).toHaveTextContent("Falta la cuenta de destino.");
    expect(transfer.querySelector('.ui-review-inline__issues:not([data-review-blocking-summary])')).not.toBeInTheDocument();
    expect(transfer.querySelector("[data-review-blocking-summary]")).toHaveTextContent("Hay 1 problema que impide incorporar");

    const detailsButton = within(blocked).getByRole("button", {name: "Más detalles"});
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailsButton);
    expect(within(blocked).getByRole("button", {name: "Cerrar detalles"})).toHaveAttribute("aria-expanded", "true");
    expect(within(blocked).queryByRole("heading", {name: "Más detalles"})).not.toBeInTheDocument();
    expect(within(blocked).getByRole("heading", {name: "Información adicional"})).toBeInTheDocument();
    expect(blocked).toHaveTextContent("Notas y etiquetas opcionales.");
    fireEvent.click(within(blocked).getByRole("button", {name: "Guardar detalles"}));
    expect(within(blocked).getByRole("button", {name: "Más detalles"})).toHaveAttribute("aria-expanded", "false");
    expect(within(blocked).queryByText("Selecciona una fecha.")).not.toBeInTheDocument();
  });

  it("corrige una excepción dentro de Atención sin borrarla de la cola y mantiene el editor completo como secundario", async () => {
    const review = openReviewLab();
    fireEvent.click(within(review).getByRole("button", {name: "Necesitan atención"}));
    const card = reviewCard(review, "review-description-attention");
    fireEvent.click(within(card).getByRole("button", {name: "Concepto: RESTAURANTE 024"}));
    const concept = within(card).getByLabelText("Concepto");
    fireEvent.change(concept, {target: {value: "Restaurante confirmado"}});
    fireEvent.keyDown(concept, {key: "Enter"});
    expect(card).toHaveAttribute("data-review-preparation", "prepared");
    await waitFor(() => expect(review.querySelector('[data-review-item="review-description-attention"]')).not.toBeInTheDocument());
    fireEvent.click(within(review).getByRole("button", {name: "Todos"}));
    const corrected = reviewCard(review, "review-description-attention");
    expect(corrected).toBeInTheDocument();
    expect(corrected).toHaveAttribute("data-review-preparation", "prepared");
    expect(corrected).toHaveAttribute("data-review-decision", "pending");
    fireEvent.click(within(corrected).getByRole("button", {name: "Más detalles"}));
    expect(within(corrected).queryByRole("heading", {name: "Más detalles"})).not.toBeInTheDocument();
    expect(within(corrected).getByRole("heading", {name: "Información adicional"})).toBeInTheDocument();
    expect(within(corrected).queryByRole("combobox", {name: "Tipo"})).not.toBeInTheDocument();
    fireEvent.click(within(corrected).getByRole("button", {name: "Cerrar detalles"}));
  });

  it("incorpora con guardado simulado, elimina la tarjeta y mantiene el foco en la cola", async () => {
    const review = openReviewLab();
    const prepared = reviewCard(review, "review-prepared-pending");
    fireEvent.click(within(prepared).getByRole("button", {name: "Incorporar"}));
    expect(review.querySelector("[data-review-status]")).toHaveTextContent("movimiento listo para incorporar");
    await waitFor(() => expect(review.querySelector('[data-review-item="review-prepared-pending"]')).not.toBeInTheDocument());
    expect(review.querySelector("[data-review-status]")).toHaveTextContent("movimiento incorporado");
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(17);
  });

  it("conserva la tarjeta y recupera la CTA si la incorporación simulada falla", async () => {
    const review = openReviewLab();
    fireEvent.click(within(review).getByText("Probar estados del arquetipo"));
    fireEvent.click(within(review).getByLabelText("Simular fallo de incorporación"));
    const prepared = reviewCard(review, "review-prepared-pending");
    fireEvent.click(within(prepared).getByRole("button", {name: "Incorporar"}));
    expect(review.querySelector("[data-review-status]")).toHaveTextContent("movimiento listo para incorporar");
    await waitFor(() => expect(review.querySelector("[data-review-status]")).toHaveTextContent("Sigue pendiente de revisión."));
    expect(review.querySelector('[data-review-item="review-prepared-pending"]')).toBeInTheDocument();
    expect(within(reviewCard(review, "review-prepared-pending")).getByRole("button", {name: "Incorporar"})).toBeEnabled();
  });

  it("bloquea un reembolso hasta incorporar su movimiento original", async () => {
    const review = openReviewLab();
    const refund = reviewCard(review, "review-refund-dependent");
    expect(refund).toHaveTextContent("Pendiente de incorporar");
    expect(within(refund).getByRole("button", {name: "Incorporar"})).toBeDisabled();
    const parent = reviewCard(review, "review-prepared-pending");
    fireEvent.click(within(parent).getByRole("button", {name: "Concepto: Factura electricidad"}));
    const parentConcept = within(parent).getByLabelText("Concepto");
    fireEvent.change(parentConcept, {target: {value: "Factura electricidad revisada"}});
    fireEvent.keyDown(parentConcept, {key: "Enter"});
    fireEvent.click(within(parent).getByRole("button", {name: "Incorporar"}));
    await waitFor(() => expect(review.querySelector('[data-review-item="review-prepared-pending"]')).not.toBeInTheDocument());
    expect(refund).toHaveTextContent("Disponible");
    expect(refund).toHaveTextContent("Factura electricidad revisada");
    expect(within(refund).getByRole("button", {name: "Incorporar"})).toBeEnabled();
  });

  it("permite batch sólo en preparados y elimina una sola composición", async () => {
    const review = openReviewLab();
    fireEvent.click(within(review).getByRole("button", {name: "Seleccionar"}));
    const first = reviewCard(review, "review-batch-a"); const second = reviewCard(review, "review-batch-b");
    fireEvent.click(within(first).getByRole("checkbox", {name: "Seleccionar Compra batch A"}));
    fireEvent.click(within(second).getByRole("checkbox", {name: "Seleccionar Compra batch B"}));
    fireEvent.click(within(review).getByRole("button", {name: "Incorporar 2"}));
    await waitFor(() => expect(review.querySelector('[data-review-item="review-batch-a"]')).not.toBeInTheDocument());
    expect(review.querySelector('[data-review-item="review-batch-b"]')).not.toBeInTheDocument();
    expect(review.querySelectorAll("[data-review-item]")).toHaveLength(16);
  });

  it("cancela la selección al cambiar de filtro y deja Muchos elementos en modo estrés visual", () => {
    const review = openReviewLab();
    fireEvent.click(within(review).getByRole("button", {name: "Seleccionar"}));
    expect(within(review).queryByRole("button", {name: "Más detalles"})).not.toBeInTheDocument();
    fireEvent.click(within(review).getByRole("button", {name: "Necesitan atención"}));
    expect(within(review).getByRole("button", {name: "Seleccionar"})).toBeInTheDocument();
    expect(within(review).queryByRole("button", {name: "Incorporar 1"})).not.toBeInTheDocument();
    fireEvent.click(within(review).getByText("Probar estados del arquetipo"));
    fireEvent.change(within(review).getByRole("combobox", {name: "Estado de página"}), {target: {value: "many"}});
    expect(within(review).queryByRole("button", {name: "Seleccionar"})).not.toBeInTheDocument();
    expect(review.querySelectorAll("[data-review-decision-action]")).toHaveLength(0);
    expect(within(review).getByText(/estado de estrés visual/)).toBeInTheDocument();
  });

  it("edita origen y destino de una transferencia con listboxes accesibles", () => {
    const review = openReviewLab();
    const transfer = reviewCard(review, "review-transfer");
    fireEvent.click(within(transfer).getByRole("button", {name: "Destino: Cuenta ahorro"}));
    expect(within(transfer).getByRole("listbox", {name: "Cuenta de destino disponibles"})).toBeInTheDocument();
    fireEvent.click(within(transfer).getByRole("option", {name: "Revolut"}));
    expect(within(transfer).getByRole("button", {name: "Destino: Revolut"})).toBeInTheDocument();
    expect(within(transfer).getByRole("button", {name: "Incorporar"})).toBeInTheDocument();
  });
});
