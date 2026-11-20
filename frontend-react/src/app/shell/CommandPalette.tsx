import {useEffect, useId, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Clock3, CornerDownLeft, Search} from "lucide-react";
import {commandSearchApi} from "../commandSearchApi";
import {useDebouncedValue} from "../../shared/hooks/useDebouncedValue";
import {wrapTabFocus} from "../../ui/controls/wrapTabFocus";
import {ensureCurrentHistoryEntryId, historyEntryId, historyParentEntryId} from "../navigation";
import type {SectionActionRuntime, SectionDefinition, Tab} from "../contracts";
import type {CommandSearchGroup} from "../../shared/model/search";

const recentCommandsKey = "app.command-palette.recent";
const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";
const childAfterAncestor = (parentByEntry: Map<string, string>, ancestorId: string, descendantId: string): string | null => {
  let childId = descendantId;
  const visited = new Set<string>();
  while (!visited.has(childId)) {
    visited.add(childId);
    const parentId = parentByEntry.get(childId);
    if (!parentId) return null;
    if (parentId === ancestorId) return childId;
    childId = parentId;
  }
  return null;
};

type PaletteItem = {
  id: string;
  title: string;
  detail: string;
  run: () => void;
  recent: boolean;
};

const readRecentCommandIds = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(recentCommandsKey) || "[]");
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
};

export function CommandPalette({
  open,
  onOpen,
  onClose,
  sections,
  runtime,
  routeKey,
  onNavigate,
  onOpenHref,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  sections: readonly SectionDefinition[];
  runtime: SectionActionRuntime;
  routeKey: string;
  onNavigate: (tab: Tab) => void;
  onOpenHref: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [remoteGroups, setRemoteGroups] = useState<CommandSearchGroup[]>([]);
  const [error, setError] = useState("");
  const [recentIds, setRecentIds] = useState(readRecentCommandIds);
  const [activeIndex, setActiveIndex] = useState(0);
  const effectiveQuery = useDebouncedValue(query.trim(), 200);
  const requestId = useRef(0);
  const openRef = useRef(open);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const skipFocusReturnRef = useRef(false);
  const categoryQueriesByEntryRef = useRef(new Map<string, string>());
  const parentEntryByIdRef = useRef(new Map<string, string>());
  const activeHistoryEntryIdRef = useRef<string | null>(historyEntryId());
  const listboxId = useId();
  openRef.current = open;
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;

  const localCommands = useMemo<PaletteItem[]>(() => {
    const navigation = sections.map((section) => ({
      id: `section:${section.id}`,
      title: section.label,
      detail: "Abrir sección",
      recent: true,
      run: () => onNavigate(section.id),
    }));
    const actions = sections.filter((section, index, all) => all.findIndex((candidate) => candidate.action.label === section.action.label) === index).map((section) => ({
      id: `action:${section.id}`,
      title: section.action.label,
      detail: `Acción de ${section.label}`,
      recent: true,
      run: () => { void section.action.onClick(runtime); },
    }));
    return [...navigation, ...actions];
  }, [onNavigate, runtime, sections]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const previousEntryId = activeHistoryEntryIdRef.current;
      const nextEntryId = historyEntryId(event.state);
      const nextParentId = historyParentEntryId(event.state);
      if (nextEntryId && nextParentId) parentEntryByIdRef.current.set(nextEntryId, nextParentId);

      if (previousEntryId && nextEntryId && previousEntryId !== nextEntryId) {
        const returningToAncestor = childAfterAncestor(parentEntryByIdRef.current, nextEntryId, previousEntryId);
        const sourceQuery = returningToAncestor ? categoryQueriesByEntryRef.current.get(returningToAncestor) : undefined;
        if (sourceQuery !== undefined) {
          setQuery(sourceQuery);
          onOpenRef.current();
        } else {
          const enteringDestination = childAfterAncestor(parentEntryByIdRef.current, previousEntryId, nextEntryId);
          if (enteringDestination && categoryQueriesByEntryRef.current.has(nextEntryId) && openRef.current) {
            skipFocusReturnRef.current = true;
            onCloseRef.current();
          }
        }
      }
      activeHistoryEntryIdRef.current = nextEntryId;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const entryId = ensureCurrentHistoryEntryId();
    const parentId = historyParentEntryId();
    if (parentId) parentEntryByIdRef.current.set(entryId, parentId);
    activeHistoryEntryIdRef.current = entryId;
  }, [routeKey]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      wrapTabFocus(event, Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (skipFocusReturnRef.current) {
        skipFocusReturnRef.current = false;
        return;
      }
      returnFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || effectiveQuery.length < 2) {
      setRemoteGroups([]);
      setError("");
      return;
    }
    const currentRequest = ++requestId.current;
    setError("");
    commandSearchApi.search(effectiveQuery)
      .then((payload) => {
        if (currentRequest === requestId.current) setRemoteGroups(payload.groups);
      })
      .catch(() => {
        if (currentRequest === requestId.current) setError("No se pudo buscar ahora.");
      });
  }, [effectiveQuery, open]);

  const localMatches = effectiveQuery.length
    ? localCommands.filter((item) => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(effectiveQuery.toLocaleLowerCase()))
    : localCommands;
  const recent = recentIds.map((id) => localCommands.find((item) => item.id === id)).filter((item): item is PaletteItem => Boolean(item));
  const groups: Array<{label: string; items: PaletteItem[]}> = effectiveQuery.length
    ? [
      ...(localMatches.length ? [{label: "Acciones y secciones", items: localMatches}] : []),
      ...remoteGroups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => ({...item, recent: false, run: () => onOpenHref(item.href)})),
      })),
    ]
    : [
      ...(recent.length ? [{label: "Recientes", items: recent}] : []),
      {label: "Acciones frecuentes", items: localCommands},
    ];
  const items = groups.flatMap((group) => group.items);

  useEffect(() => {
    setActiveIndex(0);
  }, [effectiveQuery, remoteGroups]);

  const run = (item: PaletteItem) => {
    const categorySourceEntryId = item.id.startsWith("category:") ? ensureCurrentHistoryEntryId() : null;
    if (item.recent) {
      const next = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, 5);
      setRecentIds(next);
      window.localStorage.setItem(recentCommandsKey, JSON.stringify(next));
    }
    onClose();
    item.run();
    if (categorySourceEntryId !== null && new URL(window.location.href).searchParams.has("category")) {
      const destinationEntryId = ensureCurrentHistoryEntryId();
      parentEntryByIdRef.current.set(destinationEntryId, categorySourceEntryId);
      categoryQueriesByEntryRef.current.set(destinationEntryId, query);
      activeHistoryEntryIdRef.current = destinationEntryId;
    }
  };

  if (!open) return null;
  return createPortal(
    <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Buscar y ejecutar">
        <label className="command-palette-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Buscar movimientos, cuentas, categorías…"
            aria-controls={listboxId}
            aria-activedescendant={items[activeIndex] ? `command-option-${items[activeIndex].id}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, Math.max(items.length - 1, 0))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
              if (event.key === "Enter" && items[activeIndex]) { event.preventDefault(); run(items[activeIndex]); }
            }}
          />
          <kbd>Ctrl K</kbd>
        </label>
        <div id={listboxId} className="command-palette-results" role="listbox" aria-label="Resultados de búsqueda">
          {groups.map((group) => <section key={group.label} className="command-palette-group"><h2>{group.label}</h2>{group.items.map((item) => {
            const index = items.indexOf(item);
            return <button id={`command-option-${item.id}`} key={item.id} className={index === activeIndex ? "active" : ""} role="option" aria-selected={index === activeIndex} type="button" onMouseMove={() => setActiveIndex(index)} onClick={() => run(item)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><CornerDownLeft aria-hidden="true" /></button>;
          })}</section>)}
          {!items.length && !error ? <p className="command-palette-empty">No hay resultados.</p> : null}
          {error ? <p className="command-palette-empty" role="alert">{error}</p> : null}
        </div>
        <footer><span><Clock3 aria-hidden="true" /> Solo se guardan accesos recientes, no resultados financieros.</span><span>↑ ↓ para elegir · Intro para abrir · Esc para cerrar</span></footer>
      </div>
    </div>,
    document.body,
  );
}
