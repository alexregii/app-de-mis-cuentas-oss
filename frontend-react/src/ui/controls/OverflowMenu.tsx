import {createContext, useCallback, useContext, useEffect, useId, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode} from "react";
import {Ellipsis} from "lucide-react";
import {flushSync} from "react-dom";

const closeMenuContext = createContext<() => void>(() => undefined);
type OverflowMenuItemProps = {keepOpen?: boolean} & (
  | ({as?: "button"} & ButtonHTMLAttributes<HTMLButtonElement>)
  | ({as: "a"} & AnchorHTMLAttributes<HTMLAnchorElement>)
);

export function OverflowMenuItem(props: OverflowMenuItemProps) {
  const closeMenu = useContext(closeMenuContext);
  if (props.as === "a") {
    const {as, keepOpen, onClick, className, ...linkProps} = props;
    return <a {...linkProps} className={["ui-overflow-menu__item", className].filter(Boolean).join(" ")} onClick={(event) => { if (!keepOpen) closeMenu(); onClick?.(event); }} />;
  }
  const {as, keepOpen, onClick, className, ...buttonProps} = props;
  return <button {...buttonProps} type={buttonProps.type || "button"} className={["ui-overflow-menu__item", className].filter(Boolean).join(" ")} onClick={(event) => { if (!keepOpen) closeMenu(); onClick?.(event); }} />;
}

export function OverflowMenu({label, children, className, triggerText, open, onOpenChange, suspended = false, compact = false, align = "end", placement = "bottom"}: {
  label: string;
  children: ReactNode;
  className?: string;
  triggerText?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  suspended?: boolean;
  compact?: boolean;
  align?: "start" | "end";
  placement?: "top" | "bottom";
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = open !== undefined;
  const expanded = !suspended && (open ?? internalOpen);

  const setExpanded = useCallback((next: boolean) => {
    if (suspended) return;
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange, suspended]);

  const closeAndRestoreFocus = useCallback(() => {
    flushSync(() => setExpanded(false));
    triggerRef.current?.focus({preventScroll: true});
  }, [setExpanded]);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest("dialog[open]"))) return;
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeAndRestoreFocus, expanded, setExpanded]);

  return <div
    ref={rootRef}
    className={["ui-overflow-menu", compact && "ui-overflow-menu--compact", suspended && "is-suspended", expanded && "is-open", className].filter(Boolean).join(" ")}
    data-align={align}
    data-placement={placement}
    data-trigger={triggerText ? "text" : "icon"}
    aria-hidden={suspended || undefined}
  >
    <button
      ref={triggerRef}
      type="button"
      className="ui-overflow-menu__trigger"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={panelId}
      tabIndex={suspended ? -1 : undefined}
      onClick={() => setExpanded(!expanded)}
    >
      {triggerText ?? <Ellipsis aria-hidden="true" />}
    </button>
    <div
      id={panelId}
      className="ui-overflow-menu__panel"
      role="group"
      aria-label={label}
      hidden={!expanded}
    ><closeMenuContext.Provider value={closeAndRestoreFocus}>{children}</closeMenuContext.Provider></div>
  </div>;
}
