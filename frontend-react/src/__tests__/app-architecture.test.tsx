import {act, renderHook, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useAppNavigation} from "../app/hooks/useAppNavigation";
import {useMoreSheet} from "../app/hooks/useMoreSheet";
import {useOfflineStatus} from "../app/hooks/useOfflineStatus";
import {useUnhandledAppError} from "../app/hooks/useUnhandledAppError";
import {sectionDefinitions} from "../app/sections";
import type {SectionRuntime} from "../app/contracts";

describe("app architecture", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers every section, navigation group and contextual action in one place", async () => {
    expect(sectionDefinitions.map(({id, navigationGroup, action}) => ({id, navigationGroup, action: action.label}))).toEqual([
      {id: "dashboard", navigationGroup: "primary", action: "Añadir movimiento"},
      {id: "transactions", navigationGroup: "primary", action: "Añadir movimiento"},
      {id: "review", navigationGroup: "primary", action: "Revisar banco"},
      {id: "planning", navigationGroup: "secondary", action: "Añadir al plan"},
      {id: "accounts", navigationGroup: "secondary", action: "Actualizar cuentas"},
      {id: "statistics", navigationGroup: "primary", action: "Ver movimientos"},
      {id: "settings", navigationGroup: "secondary", action: "Añadir movimiento"},
    ]);

    const runtime = {
      openNewMovement: vi.fn(),
      navigate: vi.fn(),
      reload: vi.fn(async () => undefined),
    } as unknown as SectionRuntime;
    await sectionDefinitions[0].action.onClick(runtime);
    await sectionDefinitions[4].action.onClick(runtime);
    await sectionDefinitions[5].action.onClick(runtime);
    expect(runtime.openNewMovement).toHaveBeenCalledOnce();
    expect(runtime.reload).toHaveBeenCalledOnce();
    expect(runtime.navigate).toHaveBeenCalledWith("transactions");
  });

  it("keeps deep links and applies initial action/focus only when bootstrap is ready", async () => {
    window.history.replaceState({}, "", "/?tab=settings&action=new-expense&focus=bank");
    const onNavigate = vi.fn();
    const {result, rerender} = renderHook(({ready}) => useAppNavigation({ready, onNavigate, onOpenNewMovement: onNavigate}), {initialProps: {ready: false}});
    expect(result.current.activeTab).toBe("settings");

    rerender({ready: true});
    await waitFor(() => expect(result.current.activeTab).toBe("review"));
    expect(result.current.newMovementToken).toBe(1);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("review");
  });

  it("reports live offline/cache state and clears it online", () => {
    const {result} = renderHook(() => useOfflineStatus());
    act(() => window.dispatchEvent(new CustomEvent("miscuentas:offline-cache", {detail: {cachedAt: "2026-07-13T10:00:00Z"}})));
    expect(result.current.message).toContain("Sin conexión. Mostrando datos guardados del");
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current.message).toBe("");
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.message).toContain("Puedes consultar datos recientes");
  });

  it("locks the page while More is open and restores focus on Escape", async () => {
    const trigger = document.createElement("button");
    const sheet = document.createElement("aside");
    sheet.append(document.createElement("button"));
    document.body.append(trigger, sheet);
    const {result} = renderHook(() => useMoreSheet());
    result.current.triggerRef.current = trigger;
    result.current.sheetRef.current = sheet;
    act(() => result.current.toggle());
    expect(document.body.style.position).toBe("fixed");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"})));
    await waitFor(() => expect(result.current.open).toBe(false));
    expect(document.body.style.position).toBe("");
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    sheet.remove();
  });

  it("turns rejected Error promises into the shared app error", () => {
    const reportError = vi.fn();
    renderHook(() => useUnhandledAppError(reportError));
    const event = new Event("unhandledrejection", {cancelable: true}) as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", {value: new Error("Operación fallida")});
    act(() => window.dispatchEvent(event));
    expect(reportError).toHaveBeenCalledWith("Operación fallida");
    expect(event.defaultPrevented).toBe(true);
  });
});
