import {createElement} from "react";
import {render} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {useReducedMotion} from "motion/react";
import {StatementLedger} from "../ui/finance/StatementLedger";
import {ledgerFixtures} from "../test-fixtures/ledger";

vi.mock("motion/react", () => ({
  motion: {
    li: ({transition, layout: _layout, ...props}: {transition: {layout: {duration: number}}; layout: string; [key: string]: unknown}) =>
      createElement("li", {...props, "data-layout-duration": transition.layout.duration}),
  },
  useReducedMotion: vi.fn(),
}));

describe("StatementLedger row motion", () => {
  beforeEach(() => vi.mocked(useReducedMotion).mockReset());

  it.each([
    {reduced: true, duration: "0"},
    {reduced: false, duration: "0.18"},
  ])("uses $duration seconds for layout under reduced motion=$reduced", ({reduced, duration}) => {
    vi.mocked(useReducedMotion).mockReturnValue(reduced);
    const {container} = render(<StatementLedger
      items={ledgerFixtures.slice(0, 2)}
      capabilitiesFor={() => ({edit: true, archive: true, reopen: true})}
      privateAmounts={false}
      selectionMode={false}
      selectedIds={[]}
      onSelect={() => undefined}
    />);

    expect(container.querySelectorAll("[data-ledger-item-id]")).toHaveLength(2);
    for (const row of container.querySelectorAll("[data-ledger-item-id]")) {
      expect(row).toHaveAttribute("data-layout-duration", duration);
    }
  });
});
