import {useLayoutEffect, useMemo, useRef, useState, type CSSProperties} from "react";
import {motion, useReducedMotion} from "motion/react";
import {ChevronDown, ChevronUp, GripVertical, Pencil, Search, Star, RotateCcw, X} from "lucide-react";
import {euro} from "../../format";
import {settingsApi as api} from "./api";
import {ConfirmDialog} from "../../shared/components/ConfirmDialog";
import type {Category} from "../../shared/model/categories";
import type {CategoryRule, CategoryRuleApplyResult, CategoryRulePreview} from "./types";
import {Button, IconButton} from "../../ui/controls/Button";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {Input} from "../../ui/controls/FormField";
import {OverflowMenu, OverflowMenuItem} from "../../ui/controls/OverflowMenu";
import {CatalogMaintenancePanel} from "./CatalogMaintenancePanel";

type CatalogFeedback = {kind: "status" | "error"; message: string};
type ReactivationAnchor = {id: number; row: HTMLElement; element: HTMLElement; focusTarget: HTMLElement; top: number; scrollY: number; treeScrollTop: number; filter: string; query: string; trigger: HTMLButtonElement; focusWasInRow: boolean; ready: boolean};

export function AdvancedCatalog({categories, rules, onRefresh, onCategoryUpdated, setStatus, showRules = true, onCreateCategory = () => undefined, onEditCategory = () => undefined, focusCategoryId = null}: {categories: Category[]; rules: CategoryRule[]; onRefresh: () => Promise<void>; onCategoryUpdated?: (category: Category) => void; setStatus: (value: string) => void; showRules?: boolean; onCreateCategory?: () => void; onEditCategory?: (category: Category) => void; focusCategoryId?: number | null}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "favorite" | "unused">("active");
  const catalogTreeRef = useRef<HTMLElement>(null);
  const reactivationAnchorRef = useRef<ReactivationAnchor | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const [actionMenuPlacement, setActionMenuPlacement] = useState<"top" | "bottom">("bottom");
  const [actionMenuMaxHeight, setActionMenuMaxHeight] = useState(0);
  const actionMenuContextRef = useRef<{id: number; query: string; filter: typeof filter} | null>(null);
  const lastNonEmptyTreeHeight = useRef(0);
  const [preview, setPreview] = useState<{id: number; name: string; impact: Record<string, unknown>} | null>(null);
  const [deactivationFeedback, setDeactivationFeedback] = useState<CatalogFeedback | null>(null);
  const [rulePreview, setRulePreview] = useState<Record<number, CategoryRulePreview>>({});
  const [rulePendingApplication, setRulePendingApplication] = useState<{rule: CategoryRule; result: CategoryRulePreview} | null>(null);
  const [ruleApplication, setRuleApplication] = useState<{rule: CategoryRule; result: CategoryRuleApplyResult} | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [orderOverrides, setOrderOverrides] = useState<Record<number, Pick<Category, "parent_id" | "sort_order">>>({});
  const [orderSaving, setOrderSaving] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);
  const [favoriteSaving, setFavoriteSaving] = useState<Record<number, boolean>>({});
  const [rowFeedback, setRowFeedback] = useState<Record<number, CatalogFeedback | undefined>>({});
  const favoritePendingRef = useRef(new Set<number>());
  const favoriteRemovalFallbackRef = useRef(new Map<number, {trigger: HTMLButtonElement; message: string; ready: boolean; refreshDone: boolean}>());
  const [favoriteRefreshVersion, setFavoriteRefreshVersion] = useState(0);
  const [catalogFeedback, setCatalogFeedback] = useState<CatalogFeedback | null>(null);
  const reactivationPendingRef = useRef(false);
  const [previewPendingId, setPreviewPendingId] = useState<number | null>(null);
  const previewPendingRef = useRef(false);
  const [deactivationSaving, setDeactivationSaving] = useState(false);
  const deactivationPendingRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const orderedCategories = useMemo(() => categories.map((item) => ({...item, ...orderOverrides[item.id]})), [categories, orderOverrides]);
  const visible = useMemo(() => orderedCategories.filter((item) => {
    const matches = item.id === focusCategoryId || `${item.display_name} ${item.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const state = item.id === focusCategoryId || filter === "all" || (filter === "active" && item.active) || (filter === "inactive" && !item.active) || (filter === "favorite" && item.is_favorite) || (filter === "unused" && !(item.transaction_count || item.child_count));
    return matches && state;
  }).sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite) || a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name)), [orderedCategories, query, filter, focusCategoryId]);
  const visibleIds = useMemo(() => new Set(visible.map((item) => item.id)), [visible]);
  const roots = visible.filter((item) => !item.parent_id || !visibleIds.has(item.parent_id));
  useLayoutEffect(() => {
    if (openActionMenuId === null) return;
    const context = actionMenuContextRef.current;
    const row = catalogTreeRef.current?.querySelector<HTMLElement>(`.catalog-row[data-category-id="${openActionMenuId}"]`);
    const menu = row?.querySelector<HTMLElement>(".ui-overflow-menu.is-open");
    const trigger = menu?.querySelector<HTMLButtonElement>(".ui-overflow-menu__trigger");
    const panel = menu?.querySelector<HTMLElement>(".ui-overflow-menu__panel");
    const closeMenu = () => {
      actionMenuContextRef.current = null;
      setOpenActionMenuId(null);
      if (document.activeElement instanceof HTMLElement && menu?.contains(document.activeElement)) document.activeElement.blur();
    };
    if (!context || context.id !== openActionMenuId || context.query !== query || context.filter !== filter || !visibleIds.has(openActionMenuId) || !row || !trigger || !panel) {
      closeMenu();
      return;
    }
    const measure = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const navigation = document.querySelector<HTMLElement>(".bottom-nav");
      const navigationRect = navigation?.getBoundingClientRect();
      const navigationVisible = Boolean(navigation && navigationRect && navigationRect.height > 0 && getComputedStyle(navigation).display !== "none");
      const header = document.querySelector<HTMLElement>(".app-header");
      const headerRect = header?.getBoundingClientRect();
      const headerVisible = Boolean(header && headerRect && headerRect.height > 0 && getComputedStyle(header).display !== "none");
      const belowLimit = navigationVisible && navigationRect ? navigationRect.top : window.innerHeight;
      const aboveLimit = headerVisible && headerRect ? headerRect.bottom : 0;
      if (triggerRect.top < aboveLimit || triggerRect.bottom > belowLimit) {
        closeMenu();
        return;
      }
      const gap = 4;
      const below = Math.max(0, belowLimit - triggerRect.bottom - gap);
      const above = Math.max(0, triggerRect.top - aboveLimit - gap);
      const height = panel.scrollHeight;
      const place = height <= below || (height > above && below >= above) ? "bottom" : "top";
      setActionMenuPlacement(place);
      setActionMenuMaxHeight(place === "bottom" ? below : above);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [openActionMenuId, categories, filter, query, visibleIds]);
  useLayoutEffect(() => {
    if (preview && !visibleIds.has(preview.id)) setPreview(null);
  }, [preview, visibleIds]);
  useLayoutEffect(() => {
    if (roots.length && catalogTreeRef.current) lastNonEmptyTreeHeight.current = catalogTreeRef.current.getBoundingClientRect().height;
  }, [roots.length, visible]);
  useLayoutEffect(() => {
    for (const [id, pending] of favoriteRemovalFallbackRef.current) {
      if (!pending.ready) continue;
      if (pending.trigger.isConnected) {
        if (pending.refreshDone) favoriteRemovalFallbackRef.current.delete(id);
        continue;
      }
      favoriteRemovalFallbackRef.current.delete(id);
      setRowFeedback((current) => ({...current, [id]: undefined}));
      setCatalogFeedback((current) => ({kind: "status", message: [current?.message, pending.message].filter(Boolean).join(" ")}));
      catalogTreeRef.current?.focus({preventScroll: true});
    }
  }, [categories, favoriteRefreshVersion]);
  useLayoutEffect(() => {
    const pending = reactivationAnchorRef.current;
    if (!pending?.ready) return;
    if (pending.filter !== filter || pending.query !== query || visibleIds.has(pending.id)) {
      reactivationAnchorRef.current = null;
      return;
    }
    const focusUnchanged = pending.focusWasInRow && pending.row.contains(pending.trigger) && (document.activeElement === pending.trigger || (!pending.trigger.isConnected && document.activeElement === document.body));
    const scrollUnchanged = Math.abs(window.scrollY - pending.scrollY) <= 1 && (catalogTreeRef.current?.scrollTop ?? 0) === pending.treeScrollTop;
    if (!scrollUnchanged) {
      reactivationAnchorRef.current = null;
      return;
    }
    if (pending.element.isConnected) window.scrollBy(0, pending.element.getBoundingClientRect().top - pending.top);
    if (focusUnchanged && pending.focusTarget.isConnected) pending.focusTarget.focus({preventScroll: true});
    setCatalogFeedback({kind: "status", message: "Categoría reactivada."});
    reactivationAnchorRef.current = null;
  }, [categories, filter, query, visibleIds]);
  useLayoutEffect(() => {
    const pending = reactivationAnchorRef.current;
    if (pending && (pending.filter !== filter || pending.query !== query)) reactivationAnchorRef.current = null;
  }, [filter, query]);
  const emptyTreeMinHeight = roots.length ? undefined : lastNonEmptyTreeHeight.current || undefined;
  const childrenOf = (id: number) => visible.filter((item) => item.parent_id === id);
  const persistOrder = async (nextCategories: Category[]) => {
    const changed = nextCategories.reduce<Record<number, Pick<Category, "parent_id" | "sort_order">>>((result, item) => {
      result[item.id] = {parent_id: item.parent_id, sort_order: item.sort_order};
      return result;
    }, {});
    setCatalogFeedback(null);
    setOrderOverrides(changed);
    setOrderSaving(true);
    try {
      const parents = [...new Set(nextCategories.map((item) => item.parent_id))];
      const order = parents.flatMap((parentId) => nextCategories
        .filter((item) => item.parent_id === parentId)
        .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name))
        .map((item) => ({id: item.id, parent_id: item.parent_id})));
      await api.categoryOrder(order);
      setCatalogFeedback({kind: "status", message: "Orden de categorías guardado."});
      try {
        await onRefresh();
      } catch {
        setCatalogFeedback({kind: "error", message: "El orden se guardó, pero no se pudo actualizar la lista."});
      }
    } catch {
      setOrderOverrides({});
      setCatalogFeedback({kind: "error", message: "No se pudo guardar el orden. Se restauró la posición anterior."});
    } finally {
      setOrderSaving(false);
      setDraggedId(null);
    }
  };
  const moveTo = async (draggedId: number, targetId: number, insertAfterTarget = false) => {
    if (draggedId === targetId || orderSaving) return;
    const dragged = orderedCategories.find((item) => item.id === draggedId);
    const target = orderedCategories.find((item) => item.id === targetId);
    if (!dragged || !target) return;
    if (dragged.parent_id !== target.parent_id) {
      setDraggedId(null);
      setCatalogFeedback({kind: "error", message: "Solo puedes cambiar el orden dentro del mismo nivel."});
      return;
    }
    const source = orderedCategories.filter((item) => item.parent_id === dragged.parent_id && item.id !== dragged.id);
    const destination = (dragged.parent_id === target.parent_id ? source : orderedCategories.filter((item) => item.parent_id === target.parent_id)).slice();
    const targetIndex = destination.findIndex((item) => item.id === target.id);
    destination.splice(Math.max(targetIndex + Number(insertAfterTarget), 0), 0, {...dragged, parent_id: target.parent_id});
    const affectedParents = new Set([dragged.parent_id, target.parent_id]);
    const reordered = orderedCategories.map((item) => {
      if (!affectedParents.has(item.parent_id) && item.id !== dragged.id) return item;
      const group = dragged.parent_id === target.parent_id || item.parent_id === target.parent_id ? destination : source;
      const position = group.findIndex((candidate) => candidate.id === item.id);
      if (position < 0) return item;
      return {...item, parent_id: group[position].parent_id, sort_order: position};
    });
    const moved = reordered.map((item) => item.id === dragged.id
      ? {...item, parent_id: target.parent_id, sort_order: destination.findIndex((candidate) => candidate.id === dragged.id)}
      : item);
    await persistOrder(moved);
  };
  const toggleFavorite = async (item: Category, trigger: HTMLButtonElement) => {
    if (favoritePendingRef.current.has(item.id)) return;
    trigger.focus({preventScroll: true});
    favoritePendingRef.current.add(item.id);
    const successMessage = item.is_favorite ? "Categoría retirada de favoritas." : "Categoría marcada como favorita.";
    const removalFallback = filter === "favorite" && item.is_favorite
      ? {id: item.id, trigger, message: successMessage, ready: false, refreshDone: false}
      : null;
    if (removalFallback) favoriteRemovalFallbackRef.current.set(item.id, removalFallback);
    setCatalogFeedback(null);
    setRowFeedback((current) => ({...current, [item.id]: undefined}));
    setFavoriteSaving((current) => ({...current, [item.id]: true}));
    try {
      const response = await api.updateCategory(item.id, {is_favorite: !item.is_favorite});
      onCategoryUpdated?.(response.category);
      if (removalFallback) removalFallback.ready = true;
      setRowFeedback((current) => ({...current, [item.id]: {kind: "status", message: successMessage}}));
      try {
        await onRefresh();
        if (removalFallback) {
          removalFallback.refreshDone = true;
          setFavoriteRefreshVersion((current) => current + 1);
        }
      } catch {
        favoriteRemovalFallbackRef.current.delete(item.id);
        setRowFeedback((current) => ({...current, [item.id]: {kind: "error", message: "La categoría se actualizó, pero no se pudo refrescar la lista."}}));
      }
    } catch {
      favoriteRemovalFallbackRef.current.delete(item.id);
      setRowFeedback((current) => ({...current, [item.id]: {kind: "error", message: "No se pudo actualizar la categoría favorita."}}));
    } finally {
      favoritePendingRef.current.delete(item.id);
      setFavoriteSaving((current) => ({...current, [item.id]: false}));
    }
  };
  const previewDeactivation = async (item: Category, initiatingControl: HTMLButtonElement, trigger: HTMLButtonElement) => {
    if (previewPendingRef.current) return;
    const menuContext = actionMenuContextRef.current;
    if (!menuContext || menuContext.id !== item.id) return;
    initiatingControl.focus({preventScroll: true});
    previewPendingRef.current = true;
    setCatalogFeedback(null);
    setDeactivationFeedback(null);
    setRowFeedback((current) => ({...current, [item.id]: undefined}));
    setPreviewPendingId(item.id);
    try {
      const result = await api.previewDeactivateCategory(item.id);
      if (actionMenuContextRef.current === menuContext && document.activeElement === initiatingControl) setPreview({id: item.id, name: item.name, impact: result.impact});
    } catch {
      if (actionMenuContextRef.current === menuContext && document.activeElement === initiatingControl) {
        setRowFeedback((current) => ({...current, [item.id]: {kind: "error", message: "No se pudo calcular el impacto de la desactivación."}}));
      }
    } finally {
      previewPendingRef.current = false;
      setPreviewPendingId(null);
      if (menuContext && actionMenuContextRef.current === menuContext && document.activeElement === initiatingControl) {
        actionMenuContextRef.current = null;
        setOpenActionMenuId((current) => current === item.id ? null : current);
        trigger.focus({preventScroll: true});
      }
    }
  };
  const confirmDeactivation = async () => {
    if (!preview || deactivationPendingRef.current) return;
    deactivationPendingRef.current = true;
    setDeactivationFeedback(null);
    setDeactivationSaving(true);
    let completed = false;
    try {
      const response = await api.deactivateCategory(preview.id);
      onCategoryUpdated?.(response.category);
      completed = true;
      setPreview(null);
      setCatalogFeedback({kind: "status", message: "Categoría desactivada; el histórico se conserva."});
      try {
        await onRefresh();
      } catch {
        setCatalogFeedback({kind: "error", message: "La categoría se desactivó, pero no se pudo refrescar la lista."});
      }
    } catch {
      setDeactivationFeedback({kind: "error", message: "No se pudo desactivar la categoría. La confirmación sigue disponible."});
    } finally {
      deactivationPendingRef.current = false;
      setDeactivationSaving(false);
      if (completed) catalogTreeRef.current?.focus({preventScroll: true});
    }
  };
  const move = async (item: Category, direction: -1 | 1) => {
    if (orderSaving) return;
    const siblings = orderedCategories.filter((candidate) => candidate.parent_id === item.parent_id && candidate.active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    const other = siblings[index + direction];
    if (!other) return;
    await moveTo(item.id, other.id, direction === 1);
  };
  const reactivate = async (item: Category, trigger: HTMLButtonElement) => {
    if (reactivationPendingRef.current) return;
    const rows = Array.from(catalogTreeRef.current?.querySelectorAll<HTMLElement>(".catalog-row") ?? []);
    const rowIndex = rows.findIndex((row) => Number(row.dataset.categoryId) === item.id);
    const survivor = [rows[rowIndex + 1], rows[rowIndex - 1]].find((candidate) => {
      if (!candidate) return false;
      const {top, bottom} = candidate.getBoundingClientRect();
      return top >= 0 && bottom <= window.innerHeight;
    });
    const anchor = survivor ?? catalogTreeRef.current;
    const focusTarget = survivor?.querySelector<HTMLButtonElement>(".ui-overflow-menu__trigger") ?? catalogTreeRef.current;
    const row = trigger.closest<HTMLElement>(".catalog-row");
    if (filter === "inactive" && anchor && focusTarget && row) reactivationAnchorRef.current = {id: item.id, row, element: anchor, focusTarget, top: anchor.getBoundingClientRect().top, scrollY: window.scrollY, treeScrollTop: catalogTreeRef.current?.scrollTop ?? 0, filter, query, trigger, focusWasInRow: false, ready: false};
    reactivationPendingRef.current = true;
    setReactivatingId(item.id);
    setRowFeedback((current) => ({...current, [item.id]: undefined}));
    setCatalogFeedback(null);
    try {
      const response = await api.updateCategory(item.id, {active: true});
      if (reactivationAnchorRef.current?.id === item.id) {
        reactivationAnchorRef.current.focusWasInRow = document.activeElement === trigger;
        reactivationAnchorRef.current.ready = true;
      }
      onCategoryUpdated?.(response.category);
      if (!reactivationAnchorRef.current || reactivationAnchorRef.current.id !== item.id) setCatalogFeedback({kind: "status", message: "Categoría reactivada."});
      try {
        await onRefresh();
      } catch {
        setCatalogFeedback({kind: "error", message: "La categoría se reactivó, pero no se pudo actualizar la lista."});
      }
    } catch {
      reactivationAnchorRef.current = null;
      setRowFeedback((current) => ({...current, [item.id]: {kind: "error", message: "No se pudo reactivar la categoría."}}));
    } finally {
      reactivationPendingRef.current = false;
      setReactivatingId(null);
    }
  };
  const renderRow = (item: Category, depth = 0) => {
    const siblings = item.active ? orderedCategories.filter((candidate) => candidate.parent_id === item.parent_id && candidate.active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) : [];
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === item.id);
    return (
    <motion.div layout="position" transition={reduceMotion ? {duration: 0} : {layout: {duration: 0.2, ease: [0.16, 1, 0.3, 1]}}} className={`catalog-row ${!item.active ? "is-inactive" : ""} ${draggedId === item.id ? "is-dragging" : ""} ${focusCategoryId === item.id ? "is-route-target" : ""}`} data-category-id={item.id} aria-current={focusCategoryId === item.id ? "location" : undefined} tabIndex={focusCategoryId === item.id ? -1 : undefined} key={item.id} draggable={item.active && !orderSaving} onDragStart={() => setDraggedId(item.id)} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedId) void moveTo(draggedId, item.id); }} style={{"--catalog-depth": depth, ...(openActionMenuId === item.id ? {"--catalog-menu-max-height": `${actionMenuMaxHeight}px`} : {})} as CSSProperties}>
      <span className="catalog-grip" aria-hidden="true"><GripVertical size={18} /></span>
      <span className="category-swatch" style={{background: item.color}} aria-hidden="true" />
      <div className="catalog-name"><strong>{item.name}</strong><small>{!item.active ? "Inactiva · " : ""}{item.parent_id ? `Dentro de ${orderedCategories.find((candidate) => candidate.id === item.parent_id)?.name || "otra categoría"} · ` : ""}{item.kind === "income" ? "Ingreso" : "Gasto"} · {item.transaction_count || 0} {(item.transaction_count || 0) === 1 ? "movimiento" : "movimientos"}</small></div>
      <div className="catalog-row-actions" role="group" aria-label={`Acciones de ${item.name}`}>
        <IconButton variant="subtle" className={item.is_favorite ? "favorite-active" : ""} aria-label={item.is_favorite ? `Quitar ${item.name} de favoritas` : `Marcar ${item.name} como favorita`} title={item.is_favorite ? `Quitar ${item.name} de favoritas` : `Marcar ${item.name} como favorita`} aria-disabled={favoriteSaving[item.id] || undefined} aria-busy={favoriteSaving[item.id] || undefined} onClick={(event) => void toggleFavorite(item, event.currentTarget)}><Star size={16} fill={item.is_favorite ? "currentColor" : "none"} /></IconButton>
        <OverflowMenu
          label={`Acciones de ${item.name}`}
          compact
          open={openActionMenuId === item.id}
          onOpenChange={(open) => {
            if (open) {
              actionMenuContextRef.current = {id: item.id, query, filter};
              setActionMenuPlacement("bottom");
              setActionMenuMaxHeight(window.innerHeight);
              setOpenActionMenuId(item.id);
            } else if (openActionMenuId === item.id) {
              actionMenuContextRef.current = null;
              setOpenActionMenuId(null);
            }
          }}
          placement={openActionMenuId === item.id ? actionMenuPlacement : "bottom"}
        >
          <OverflowMenuItem onClick={() => onEditCategory(item)}><Pencil aria-hidden="true" />Editar</OverflowMenuItem>
          {item.active ? <>
              <OverflowMenuItem disabled={orderSaving || siblingIndex <= 0} onClick={() => void move(item, -1)}><ChevronUp aria-hidden="true" />Subir posición</OverflowMenuItem>
              <OverflowMenuItem disabled={orderSaving || siblingIndex === -1 || siblingIndex === siblings.length - 1} onClick={() => void move(item, 1)}><ChevronDown aria-hidden="true" />Bajar posición</OverflowMenuItem>
              <OverflowMenuItem keepOpen aria-disabled={previewPendingId !== null || undefined} aria-busy={previewPendingId === item.id || undefined} onClick={(event) => {
                const initiatingControl = event.currentTarget;
                const trigger = initiatingControl.closest(".catalog-row")?.querySelector<HTMLButtonElement>(".ui-overflow-menu__trigger");
                if (trigger) void previewDeactivation(item, initiatingControl, trigger);
              }}><X aria-hidden="true" />{previewPendingId === item.id ? "Calculando impacto" : "Desactivar"}</OverflowMenuItem>
            </> : <OverflowMenuItem disabled={reactivatingId !== null} aria-busy={reactivatingId === item.id || undefined} onClick={(event) => {
              const trigger = event.currentTarget.closest(".catalog-row")?.querySelector<HTMLButtonElement>(".ui-overflow-menu__trigger");
              if (trigger) void reactivate(item, trigger);
            }}><RotateCcw aria-hidden="true" />{reactivatingId === item.id ? "Reactivando…" : "Reactivar"}</OverflowMenuItem>}
        </OverflowMenu>
      </div>
      {rowFeedback[item.id] ? <motion.div className={`catalog-feedback ${rowFeedback[item.id]?.kind === "error" ? "is-error" : ""}`} role={rowFeedback[item.id]?.kind === "error" ? "alert" : "status"} aria-atomic="true" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: reduceMotion ? 0 : 0.16}}>{rowFeedback[item.id]?.message}</motion.div> : null}
      {preview?.id === item.id ? <motion.div className="inline-confirm catalog-row-confirm" initial={reduceMotion ? false : {height: 0, opacity: 0}} animate={{height: "auto", opacity: 1}} transition={{duration: reduceMotion ? 0 : 0.16}} style={{overflow: "hidden"}}>
        <strong>Desactivar «{preview.name}»?</strong>
        <span>{String(preview.impact.transactions || 0)} {(preview.impact.transactions || 0) === 1 ? "movimiento" : "movimientos"} · {String(preview.impact.budgets || 0)} {(preview.impact.budgets || 0) === 1 ? "presupuesto" : "presupuestos"} · {String(preview.impact.rules || 0)} {(preview.impact.rules || 0) === 1 ? "regla" : "reglas"} · {String(preview.impact.imports || 0)} {(preview.impact.imports || 0) === 1 ? "importación" : "importaciones"}</span>
        <div className="inline-actions">
          <Button variant="secondary" aria-disabled={deactivationSaving || undefined} onClick={() => {if (!deactivationPendingRef.current) setPreview(null);}}>Cancelar</Button>
          <Button variant="primary" aria-disabled={deactivationSaving || undefined} aria-busy={deactivationSaving || undefined} onClick={() => void confirmDeactivation()}>{deactivationSaving ? "Desactivando…" : "Confirmar desactivación"}</Button>
        </div>
        {deactivationFeedback ? <motion.div className={`catalog-inline-feedback ${deactivationFeedback.kind === "error" ? "is-error" : ""}`} role={deactivationFeedback.kind === "error" ? "alert" : "status"} aria-atomic="true" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: reduceMotion ? 0 : 0.16}}>{deactivationFeedback.message}</motion.div> : null}
      </motion.div> : null}
    </motion.div>
    );
  };
  return <div className="catalog-manager">
    <div className="catalog-toolbar"><div className="catalog-search"><Search size={17} aria-hidden="true" /><Input aria-label="Buscar categorías" placeholder="Buscar categoría…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><SegmentedControl className="catalog-filters" aria-label="Filtrar categorías">{(["active", "inactive", "favorite", "unused", "all"] as const).map((item) => <SegmentedItem key={item} selected={filter === item} onClick={() => setFilter(item)}>{item === "active" ? "Activas" : item === "inactive" ? "Inactivas" : item === "favorite" ? "Favoritas" : item === "unused" ? "Sin uso" : "Todas"}</SegmentedItem>)}</SegmentedControl><Button variant="secondary" onClick={onCreateCategory}>Nueva categoría</Button></div>
    {orderSaving ? <div className="catalog-order-status" role="status">Guardando nuevo orden…</div> : null}
    <div className="catalog-layout"><section ref={catalogTreeRef} className="catalog-tree" tabIndex={-1} aria-label="Árbol de categorías" style={emptyTreeMinHeight ? {minHeight: emptyTreeMinHeight} : undefined}>{roots.length ? roots.map((root) => <div key={root.id}>{renderRow(root, root.parent_id ? 1 : 0)}{childrenOf(root.id).map((child) => renderRow(child, 1))}</div>) : <div className="empty-state empty-state--plain">No hay categorías para este filtro.</div>}{catalogFeedback ? <motion.div className={`catalog-tree-feedback ${catalogFeedback.kind === "error" ? "is-error" : ""}`} role={catalogFeedback.kind === "error" ? "alert" : "status"} aria-atomic="true" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: reduceMotion ? 0 : 0.16}}>{catalogFeedback.message}</motion.div> : null}</section>
      <CatalogMaintenancePanel /></div>
    {showRules ? <><section className="rules-manager"><div className="rules-manager-head"><div><h3>Reglas por prioridad</h3><p>La prioridad menor se evalúa primero. Prueba antes de aplicar.</p></div><span className="status-chip">{rules.length} reglas</span></div>{rules.map((rule) => <div className="rule-row" key={rule.id}><span className="priority-number">{rule.priority}</span><div className="catalog-name"><strong>{rule.description}</strong><small>{rule.match_mode} · {rule.category.display_name}{rule.account ? ` · ${rule.account.name}` : ""}{rule.amount_min !== null || rule.amount_max !== null ? <> · {rule.amount_min === null ? "…" : euro(rule.amount_min)}–{rule.amount_max === null ? "…" : euro(rule.amount_max)}</> : ""}</small></div><span className="rule-count">{rule.last_test_result?.changes !== undefined ? `${String(rule.last_test_result.changes)} cambios` : "Sin probar"}</span><div className="rule-row-actions"><Button variant="secondary" className="compact-button" onClick={async () => {const data = await api.previewCategoryRule(rule.id); setRulePreview((current) => ({...current, [rule.id]: data.result}));}}>Probar</Button>{rulePreview[rule.id] ? <Button variant="primary" className="compact-button" disabled={!rulePreview[rule.id].changes} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setRulePendingApplication({rule, result: rulePreview[rule.id]});}}>Aplicar cambios</Button> : null}</div>{rulePreview[rule.id] ? <span className="rule-preview">{rulePreview[rule.id].total} coincidencias · {rulePreview[rule.id].changes} cambios · {rulePreview[rule.id].bank_rows + rulePreview[rule.id].csv_rows} pendientes{rulePreview[rule.id].examples.length ? ` · Ej.: ${rulePreview[rule.id].examples.slice(0, 3).map((item) => item.description).join(", ")}` : ""}</span> : null}</div>)}</section>
    {ruleApplication ? <div className="inline-confirm"><strong>Regla aplicada</strong><span>{ruleApplication.result.total} registros procesados. Puedes deshacer esta aplicación mientras no haya otro cambio sobre los mismos registros.</span><div className="inline-actions"><Button variant="secondary" onClick={async () => {const response = await api.undoCategoryRule(ruleApplication.rule.id, ruleApplication.result.application_id); setStatus(response.partial ? "Deshecha parcialmente: algunos registros habían cambiado después." : "Aplicación deshecha."); setRuleApplication(null); await onRefresh();}}>Deshacer aplicación</Button></div></div> : null}
    {rulePendingApplication ? <ConfirmDialog title={`¿Aplicar “${rulePendingApplication.rule.description}” al histórico?`} description={`Cambiará ${rulePendingApplication.result.changes} registros; incluye ${rulePendingApplication.result.bank_rows + rulePendingApplication.result.csv_rows} elementos pendientes de revisión, sin confirmarlos ni incorporarlos al ledger. Podrás deshacer esta aplicación.`} confirmLabel="Aplicar cambios" onCancel={() => setRulePendingApplication(null)} onConfirm={async () => {const result = (await api.applyCategoryRule(rulePendingApplication.rule.id)).result; setRuleApplication({rule: rulePendingApplication.rule, result}); setRulePendingApplication(null); setStatus(`Regla aplicada a ${result.total} registros.`); await onRefresh();}} /> : null}</> : null}
  </div>;
}
