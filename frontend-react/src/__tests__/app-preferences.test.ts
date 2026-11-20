import {describe, expect, it, vi} from "vitest";
import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  LEGACY_PRIVACY_STORAGE_KEY,
  readAppPreferences,
  writeAppPreferences,
  type AppPreferencesStorage,
} from "../app/preferences/appPreferences";

function memoryStorage(initial: Record<string, string> = {}): AppPreferencesStorage & {data: Map<string, string>} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  };
}

describe("app preferences storage", () => {
  it("uses safe defaults when no stored preference exists", () => {
    expect(readAppPreferences(memoryStorage())).toEqual({
      preferences: DEFAULT_APP_PREFERENCES,
      source: "default",
      recovered: false,
    });
  });

  it("reads a valid versioned document", () => {
    const storage = memoryStorage({
      [APP_PREFERENCES_STORAGE_KEY]: JSON.stringify({version: 1, theme: "basalt", privacyMode: true}),
    });
    expect(readAppPreferences(storage)).toEqual({
      preferences: {theme: "basalt", privacyMode: true},
      source: "stored",
      recovered: false,
    });
  });

  it("recovers legacy privacy when the versioned document is absent", () => {
    const result = readAppPreferences(memoryStorage({[LEGACY_PRIVACY_STORAGE_KEY]: "true"}));
    expect(result).toEqual({
      preferences: {theme: "mineral", privacyMode: true},
      source: "legacy",
      recovered: false,
    });
  });

  it("falls back through legacy privacy when the versioned document is corrupt", () => {
    const result = readAppPreferences(memoryStorage({
      [APP_PREFERENCES_STORAGE_KEY]: "{broken",
      [LEGACY_PRIVACY_STORAGE_KEY]: "true",
    }));
    expect(result).toEqual({
      preferences: {theme: "mineral", privacyMode: true},
      source: "legacy",
      recovered: true,
    });
  });

  it("rejects an invalid versioned shape", () => {
    const result = readAppPreferences(memoryStorage({
      [APP_PREFERENCES_STORAGE_KEY]: JSON.stringify({version: 1, theme: "unknown", privacyMode: true}),
    }));
    expect(result).toEqual({
      preferences: DEFAULT_APP_PREFERENCES,
      source: "default",
      recovered: true,
    });
  });

  it("writes v1 and retires the legacy privacy key", () => {
    const storage = memoryStorage({[LEGACY_PRIVACY_STORAGE_KEY]: "true"});
    const result = writeAppPreferences({theme: "basalt", privacyMode: false}, storage);
    expect(result).toEqual({preferences: {theme: "basalt", privacyMode: false}, persisted: true});
    expect(JSON.parse(storage.data.get(APP_PREFERENCES_STORAGE_KEY)!)).toEqual({version: 1, theme: "basalt", privacyMode: false});
    expect(storage.data.has(LEGACY_PRIVACY_STORAGE_KEY)).toBe(false);
  });

  it("keeps the in-memory snapshot observable when persistence fails", () => {
    const storage = memoryStorage();
    storage.setItem = vi.fn(() => { throw new Error("storage blocked"); });
    expect(writeAppPreferences({theme: "basalt", privacyMode: true}, storage)).toEqual({
      preferences: {theme: "basalt", privacyMode: true},
      persisted: false,
    });
  });

  it("recovers safe defaults when storage reads fail", () => {
    const storage = memoryStorage();
    storage.getItem = vi.fn(() => { throw new Error("storage blocked"); });
    expect(readAppPreferences(storage)).toEqual({
      preferences: DEFAULT_APP_PREFERENCES,
      source: "default",
      recovered: true,
    });
  });
});
