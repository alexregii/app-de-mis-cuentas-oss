import {act, renderHook} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const sectionByIdMock = vi.hoisted(() => vi.fn());

vi.mock("../app/sections", async (importOriginal) => {
  const original = await importOriginal<typeof import("../app/sections")>();
  return {...original, sectionById: sectionByIdMock};
});

import {useAppNavigation} from "../app/hooks/useAppNavigation";

describe("navigation preloading", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    sectionByIdMock.mockReset();
  });

  it("starts preloading before navigation and absorbs an async failure", async () => {
    const events: string[] = [];
    sectionByIdMock.mockReturnValue({preload: () => {
      events.push("preload");
      return Promise.reject(new Error("chunk unavailable"));
    }});
    const onNavigate = vi.fn(() => events.push("navigate"));
    const {result} = renderHook(() => useAppNavigation({ready: true, onNavigate, onOpenNewMovement: vi.fn()}));

    act(() => result.current.navigate("statistics"));
    await act(async () => Promise.resolve());

    expect(events).toEqual(["preload", "navigate"]);
    expect(result.current.activeTab).toBe("statistics");
  });

  it("also absorbs a synchronous preload failure", () => {
    sectionByIdMock.mockReturnValue({preload: () => {
      throw new Error("synchronous importer failure");
    }});
    const onNavigate = vi.fn();
    const {result} = renderHook(() => useAppNavigation({ready: true, onNavigate, onOpenNewMovement: vi.fn()}));

    act(() => result.current.navigate("statistics"));

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(result.current.activeTab).toBe("statistics");
  });

  it("restores the section when browser history changes", () => {
    sectionByIdMock.mockReturnValue({});
    const onNavigate = vi.fn();
    const {result} = renderHook(() => useAppNavigation({ready: true, onNavigate, onOpenNewMovement: vi.fn()}));

    act(() => {
      window.history.replaceState({}, "", "/?tab=review");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.activeTab).toBe("review");
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("opens a filtered movements intent through one canonical history transition", () => {
    sectionByIdMock.mockReturnValue({});
    const onNavigate = vi.fn();
    const {result} = renderHook(() => useAppNavigation({ready: true, onNavigate, onOpenNewMovement: vi.fn()}));

    act(() => result.current.openTransactionIntent({category: 14, kind: "expense", analytics: "included"}));

    expect(result.current.activeTab).toBe("transactions");
    expect(window.location.search).toBe("?kind=expense&category=14&analytics=included&tab=transactions");
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
