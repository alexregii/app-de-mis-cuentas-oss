import {useRef, useState} from "react";
import {motion, useReducedMotion} from "motion/react";
import {Button} from "../../ui/controls/Button";
import {settingsApi as api} from "./api";

type MaintenanceFeedback = {kind: "status" | "error"; message: string};

export function CatalogMaintenancePanel() {
  const [pending, setPending] = useState<"duplicates" | "unused" | null>(null);
  const [feedback, setFeedback] = useState<MaintenanceFeedback | null>(null);
  const pendingRef = useRef(false);
  const reduceMotion = useReducedMotion();

  const run = async (action: "duplicates" | "unused", trigger: HTMLButtonElement) => {
    if (pendingRef.current) return;
    trigger.focus({preventScroll: true});
    pendingRef.current = true;
    setFeedback(null);
    setPending(action);
    try {
      if (action === "duplicates") {
        const {groups} = await api.categoryDuplicates();
        const count = groups.length;
        setFeedback({kind: "status", message: `${count} posible${count === 1 ? "" : "s"} grupo${count === 1 ? "" : "s"} duplicado${count === 1 ? "" : "s"} detectado${count === 1 ? "" : "s"}.`});
      } else {
        const {categories} = await api.categoryUnused();
        const count = categories.length;
        setFeedback({kind: "status", message: `${count} categor${count === 1 ? "ía" : "ías"} sin uso.`});
      }
    } catch {
      setFeedback({kind: "error", message: action === "duplicates" ? "No se pudieron detectar duplicados." : "No se pudieron revisar las categorías sin uso."});
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  return <aside className="catalog-maintenance">
    <h3>Mantenimiento</h3>
    <p>Las operaciones de impacto se calculan antes de confirmar.</p>
    <Button variant="secondary" fullWidth aria-disabled={pending !== null || undefined} aria-busy={pending === "duplicates" || undefined} onClick={(event) => void run("duplicates", event.currentTarget)}>{pending === "duplicates" ? "Detectando duplicados…" : "Detectar duplicados"}</Button>
    <Button variant="secondary" fullWidth aria-disabled={pending !== null || undefined} aria-busy={pending === "unused" || undefined} onClick={(event) => void run("unused", event.currentTarget)}>{pending === "unused" ? "Revisando categorías…" : "Revisar sin uso"}</Button>
    {feedback ? <motion.div className={`catalog-maintenance-feedback ${feedback.kind === "error" ? "is-error" : ""}`} role={feedback.kind === "error" ? "alert" : "status"} aria-atomic="true" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: reduceMotion ? 0 : 0.16}}>{feedback.message}</motion.div> : null}
  </aside>;
}
