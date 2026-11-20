export type AppTheme = "mineral" | "basalt";

export interface AppPreferences {
  theme: AppTheme;
  privacyMode: boolean;
}

export type AppPreferencesSource = "stored" | "legacy" | "default";

export interface AppPreferencesReadResult {
  preferences: AppPreferences;
  source: AppPreferencesSource;
  recovered: boolean;
}

export interface AppPreferencesWriteResult {
  preferences: AppPreferences;
  persisted: boolean;
}

export type AppPreferencesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const APP_PREFERENCES_STORAGE_KEY = "app.preferences.v1";
export const LEGACY_PRIVACY_STORAGE_KEY = "app.privacy-mode";
export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = {
  theme: "mineral",
  privacyMode: false,
};

interface StoredAppPreferencesV1 {
  version: 1;
  theme: AppTheme;
  privacyMode: boolean;
}

function browserStorage(): AppPreferencesStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isStoredPreferences(value: unknown): value is StoredAppPreferencesV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredAppPreferencesV1>;
  return candidate.version === 1
    && (candidate.theme === "mineral" || candidate.theme === "basalt")
    && typeof candidate.privacyMode === "boolean";
}

function readStorageValue(storage: AppPreferencesStorage, key: string) {
  try {
    return {value: storage.getItem(key), failed: false};
  } catch {
    return {value: null, failed: true};
  }
}

export function readAppPreferences(storage: AppPreferencesStorage | null = browserStorage()): AppPreferencesReadResult {
  if (!storage) return {preferences: {...DEFAULT_APP_PREFERENCES}, source: "default", recovered: true};

  let recovered = false;
  const stored = readStorageValue(storage, APP_PREFERENCES_STORAGE_KEY);
  recovered ||= stored.failed;

  if (stored.value !== null) {
    try {
      const parsed: unknown = JSON.parse(stored.value);
      if (isStoredPreferences(parsed)) {
        return {
          preferences: {theme: parsed.theme, privacyMode: parsed.privacyMode},
          source: "stored",
          recovered,
        };
      }
      recovered = true;
    } catch {
      recovered = true;
    }
  }

  const legacy = readStorageValue(storage, LEGACY_PRIVACY_STORAGE_KEY);
  recovered ||= legacy.failed;
  if (legacy.value === "true" || legacy.value === "false") {
    return {
      preferences: {...DEFAULT_APP_PREFERENCES, privacyMode: legacy.value === "true"},
      source: "legacy",
      recovered,
    };
  }

  return {preferences: {...DEFAULT_APP_PREFERENCES}, source: "default", recovered};
}

export function writeAppPreferences(
  preferences: AppPreferences,
  storage: AppPreferencesStorage | null = browserStorage(),
): AppPreferencesWriteResult {
  const snapshot = {...preferences};
  if (!storage) return {preferences: snapshot, persisted: false};

  const document: StoredAppPreferencesV1 = {version: 1, ...snapshot};
  try {
    storage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(document));
  } catch {
    return {preferences: snapshot, persisted: false};
  }

  try {
    storage.removeItem(LEGACY_PRIVACY_STORAGE_KEY);
  } catch {
    // The v1 document already owns the value. Legacy cleanup is best effort.
  }
  return {preferences: snapshot, persisted: true};
}
