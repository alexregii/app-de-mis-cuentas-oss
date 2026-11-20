import {useEffect, useRef} from "react";
import {motion, useReducedMotion} from "motion/react";
import {createPortal} from "react-dom";
import {ArrowDown, ArrowUp, X} from "lucide-react";
import {dashboardWidgetDefinition, dashboardWidgetTitle} from "../widgets/dashboardWidgetRegistry";
import {Button, IconButton, TextButton} from "../../../ui/controls/Button";
import {wrapTabFocus} from "../../../ui/controls/wrapTabFocus";
import {motionEase} from "../../../shared/lib/motion";

export function DashboardCustomizer({
  order,
  hidden,
  onClose,
  onMove,
  canMove,
  onToggle,
  onReset,
}: {
  order: string[];
  hidden: string[];
  onClose: () => void;
  onMove: (id: string, direction: -1 | 1) => void;
  canMove: (id: string, direction: -1 | 1) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  const layoutTransition = reduceMotion ? {duration: 0} : {layout: {duration: 0.18, ease: motionEase}};
  const moveWidget = (id: string, direction: -1 | 1, button: HTMLButtonElement) => {
    const row = button.closest(".editor-row");
    onMove(id, direction);
    window.requestAnimationFrame(() => {
      const target = button.disabled
        ? Array.from(row?.querySelectorAll<HTMLButtonElement>("button") || []).find((candidate) => candidate !== button && candidate.getAttribute("aria-label")?.includes(dashboardWidgetTitle(id) || "") && !candidate.disabled)
        : button;
      target?.focus({preventScroll: true});
    });
  };

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const closeButton = dialog?.querySelector<HTMLButtonElement>("[data-dashboard-close]");
    closeButton?.focus({preventScroll: true});
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      wrapTabFocus(event, Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")), true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus({preventScroll: true});
    };
  }, [onClose]);

  return createPortal(
    <div className="dashboard-editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} className="dashboard-editor" role="dialog" aria-modal="true" aria-labelledby="dashboard-editor-title">
        <div className="dashboard-editor-head">
          <div><h2 id="dashboard-editor-title">Personalizar resumen</h2></div>
          <IconButton
            data-dashboard-close
            onClick={onClose}
            aria-label="Cerrar personalización"
            title="Cerrar personalización"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <p className="editor-help">
          Ordena los módulos secundarios. Ocultar un módulo solo cambia su presentación: las alertas operativas siguen visibles en Ahora y Pendientes de atención.
        </p>
        <div className="editor-list">
          {order.map((id) => {
            const definition = dashboardWidgetDefinition(id);
            const title = dashboardWidgetTitle(id) || "Módulo retirado";
            return (
              <motion.div className="editor-row" key={id} layout="position" transition={layoutTransition}>
                <strong>{title}</strong>
                <div className="editor-row-actions">
                  <IconButton
                    onClick={(event) => moveWidget(id, -1, event.currentTarget)}
                    disabled={!canMove(id, -1)}
                    aria-label={`Subir ${title}`}
                    title={`Subir ${title}`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    onClick={(event) => moveWidget(id, 1, event.currentTarget)}
                    disabled={!canMove(id, 1)}
                    aria-label={`Bajar ${title}`}
                    title={`Bajar ${title}`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </IconButton>
                  {definition?.hideable ? (
                    <IconButton
                      onClick={() => onToggle(id)}
                      aria-label={`${hidden.includes(id) ? "Mostrar" : "Ocultar"} ${title}`}
                      title={`${hidden.includes(id) ? "Mostrar" : "Ocultar"} ${title}`}
                    >
                      <span aria-hidden="true">{hidden.includes(id) ? "◉" : "◌"}</span>
                    </IconButton>
                  ) : <span className="critical-label">Fijo</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="hidden-widgets">
          <strong>Módulos ocultos</strong>
          {hidden.length ? hidden.map((id) => (
            <TextButton key={id} onClick={() => onToggle(id)}>
              Mostrar {dashboardWidgetTitle(id) || "módulo retirado"}
            </TextButton>
          )) : <span>Ninguno</span>}
        </div>
        <div className="editor-footer">
          <Button variant="secondary" onClick={onReset}>Restaurar orden inicial</Button>
          <Button variant="primary" onClick={onClose}>Listo</Button>
        </div>
      </div>
    </div>
    , document.body,
  );
}
