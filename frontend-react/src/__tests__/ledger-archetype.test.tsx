import {render, within} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {LedgerArchetype} from "../ui/finance/LedgerArchetype";

describe("LedgerArchetype", () => {
  it("mantiene la composición estable y no añade una superficie de Panel", () => {
    const {container} = render(
      <LedgerArchetype
        header={<div>header</div>}
        selection={<div>selection</div>}
        filterSlot={<div>filter</div>}
        results={<div>results</div>}
        pagination={<div>pagination</div>}
      />,
    );

    const archetype = container.querySelector("[data-ledger-archetype]");
    expect(archetype).not.toBeNull();
    expect([...archetype!.children].map((child) => child.getAttribute("data-ledger-slot"))).toEqual([
      "header",
      "selection",
      "filter",
      "results",
    ]);
    expect(archetype!.querySelector(".panel")).not.toBeInTheDocument();
    expect(within(archetype as HTMLElement).getByRole("region", {name: "Resultados del ledger"})).toHaveTextContent("results");
    expect(archetype).toHaveTextContent("pagination");
  });
});
