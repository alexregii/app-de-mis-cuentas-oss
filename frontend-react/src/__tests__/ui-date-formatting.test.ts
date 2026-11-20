// @vitest-environment node
import {describe, expect, it} from "vitest";
import {formatMonthTitle} from "../ui/formatMonthTitle";

describe("stable UI date formatting", () => {
  it("formats a Spanish month title with its initial capitalized", () => {
    expect(formatMonthTitle(new Date(2026, 8, 1, 12))).toBe("Septiembre de 2026");
  });
});
