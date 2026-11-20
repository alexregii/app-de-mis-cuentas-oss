import {useCallback, useState} from "react";

export function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "true";
    } catch {
      return initial;
    }
  });

  const update = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (current: boolean) => boolean)(current) : next;
      try {
        window.localStorage.setItem(key, String(resolved));
      } catch {
        // Preferences are local convenience only.
      }
      return resolved;
    });
  }, [key]);

  return [value, update] as const;
}
