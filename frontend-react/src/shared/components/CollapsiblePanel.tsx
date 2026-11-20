import {useLayoutEffect, useRef, useId, type ReactNode} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {ChevronDown} from "lucide-react";
import {Button} from "../../ui/controls/Button";
import {motionEase} from "../lib/motion";
import {Panel, SectionHeader} from "./ui";

export function CollapsiblePanel({
  title,
  detail,
  open,
  onToggle,
  children,
  className = "",
  summary,
  animate = true,
}: {
  title: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  summary?: ReactNode;
  animate?: boolean;
}) {
  const panelId = useId();
  const wasOpen = useRef(open);
  const lastFocusedContent = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const summaryTransition = reduceMotion ? {duration: 0} : {duration: 0.12, ease: motionEase};
  useLayoutEffect(() => {
    const wasOpenBefore = wasOpen.current;
    wasOpen.current = open;
    if (!wasOpenBefore || open) return;
    const lastFocused = lastFocusedContent.current;
    if (!lastFocused || (document.activeElement !== lastFocused && document.activeElement !== document.body && lastFocused.isConnected)) return;
    document.getElementById(panelId)?.querySelector<HTMLButtonElement>(".disclosure-button")?.focus({preventScroll: true});
    lastFocusedContent.current = null;
  }, [open, panelId]);
  const collapsedSummary = summary && detail ? (
    animate ? (
      <AnimatePresence initial={false}>
        {!open ? (
          <motion.span
            key="summary"
            className="collapsed-summary"
            initial={{height: 0, opacity: 0}}
            animate={{height: "auto", opacity: 1}}
            exit={{height: 0, opacity: 0}}
            transition={summaryTransition}
          >
            {summary}
          </motion.span>
        ) : null}
      </AnimatePresence>
    ) : !open ? <span className="collapsed-summary">{summary}</span> : null
  ) : summary && !open ? <span className="collapsed-summary">{summary}</span> : null;
  const headerDetail = detail ? <>{detail}{collapsedSummary}</> : collapsedSummary || undefined;
  return (
    <Panel id={panelId} className={`collapsible-panel ${open ? "open" : "closed"} ${className}`.trim()}>
      <SectionHeader
        title={title}
        detail={headerDetail}
        action={(
          <Button variant="secondary" className="disclosure-button" aria-label={`${open ? "Comprimir" : "Expandir"} ${title.toLowerCase()}`} title={`${open ? "Comprimir" : "Expandir"} ${title.toLowerCase()}`} aria-expanded={open} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); onToggle();}}>
            <ChevronDown aria-hidden="true" />
            {open ? "Comprimir" : "Expandir"}
          </Button>
        )}
      />
      {!animate ? (
        open ? <div className="collapsible-content" onFocusCapture={(event) => {lastFocusedContent.current = event.target as HTMLElement;}}>{children}</div> : null
      ) : <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="content"
            className="collapsible-content"
            initial={{height: 0, opacity: 0, y: -4}}
            animate={{height: "auto", opacity: 1, y: 0}}
            exit={{height: 0, opacity: 0, y: -4}}
            transition={transition}
            onFocusCapture={(event) => {lastFocusedContent.current = event.target as HTMLElement;}}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>}
    </Panel>
  );
}
