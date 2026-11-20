import {describe, expect, it} from "vitest";
import {compactEuro, dateInputValue, displayEuro, euro, formatDate, formatDateTimeShort, parseMoneyInput} from "../format";
import {setPrivacyMode} from "../shared/lib/privacy";

describe("format helpers", () => {
  it("formats euro values for Spanish locale", () => {
    setPrivacyMode(false);
    expect(euro(1234.5)).toContain("1234,50");
  });

  it("redacts formatted amounts while privacy mode is active", () => {
    setPrivacyMode(true);
    expect(euro(1234.5)).toBe("•••• €");
    expect(displayEuro(1234.5, false)).toContain("1234,50");
    expect(displayEuro(1234.5, true)).toBe("••••••");
    setPrivacyMode(false);
  });

  it("formats compact euro values", () => {
    expect(compactEuro(1200)).toContain("€");
  });

  it.each([
    ["12,50", 12.5],
    ["12.50", 12.5],
    ["1.234,56", 1234.56],
  ])("parses localized money input %s", (raw, expected) => {
    expect(parseMoneyInput(raw)).toBe(expected);
  });

  it.each(["", "abc", "12,50,00"])("rejects invalid money input %s", (raw) => {
    expect(parseMoneyInput(raw)).toBeNull();
  });

  it("formats iso dates without hardcoded string slicing", () => {
    expect(formatDate("2026-06-30")).toBe("30/06/2026");
  });

  it("supports API datetimes and handles malformed dates", () => {
    expect(formatDate("2026-06-30T12:00:00+02:00")).toBe("30/06/2026");
    expect(formatDate("not-a-date")).toBe("Fecha no disponible");
  });

  it("preserves the shared short Spanish date-time format", () => {
    const value = new Date("2026-06-30T12:00:00+02:00");
    const expected = new Intl.DateTimeFormat("es-ES", {dateStyle: "short", timeStyle: "short"}).format(value);

    expect(formatDateTimeShort(value)).toBe(expected);
  });

  it("uses the local calendar date for form inputs", () => {
    expect(dateInputValue(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });
});
