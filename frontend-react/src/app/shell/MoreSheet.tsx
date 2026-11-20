import type {RefObject} from "react";
import {AnimatePresence, motion} from "motion/react";
import {LogOut, X} from "lucide-react";
import {motionEase} from "../../shared/lib/motion";
import type {SectionDefinition, Tab} from "../contracts";

export function MoreSheet({open, close, sheetRef, sections, activeTab, navigate, preload, reduceMotion, sheetTransition, onLogout}: {
  open: boolean;
  close: () => void;
  sheetRef: RefObject<HTMLElement | null>;
  sections: readonly SectionDefinition[];
  activeTab: Tab;
  navigate: (tab: Tab) => void;
  preload: (tab: Tab) => void;
  reduceMotion: boolean;
  sheetTransition: {duration: number} | {type: "spring"; stiffness: number; damping: number; mass: number};
  onLogout: () => void;
}) {
  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="sheet-backdrop open"
            aria-hidden="true"
            onClick={close}
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: reduceMotion ? 0 : 0.16}}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {open ? (
          <motion.aside
            ref={sheetRef}
            id="more-sheet"
            className="more-sheet open"
            role="dialog"
            aria-modal="true"
            aria-label="Más secciones"
            initial={reduceMotion ? {opacity: 1} : {y: "106%", opacity: 0.98}}
            animate={reduceMotion ? {opacity: 1} : {y: 0, opacity: 1}}
            exit={reduceMotion ? {opacity: 0} : {y: "106%", opacity: 0.98}}
            transition={sheetTransition}
          >
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <strong>Más</strong>
              <button autoFocus className="icon-button subtle" type="button" aria-label="Cerrar" title="Cerrar" onClick={close}>
                <X aria-hidden="true" />
              </button>
            </div>
            <motion.div
              className="sheet-nav"
              initial={reduceMotion ? false : "closed"}
              animate="open"
              variants={{
                open: {transition: {staggerChildren: 0.025, delayChildren: 0.04}},
                closed: {},
              }}
            >
              {sections.map(({id, label, Icon}) => (
                <motion.button
                  key={id}
                  type="button"
                  className={activeTab === id ? "active" : ""}
                  aria-current={activeTab === id ? "page" : undefined}
                  onPointerDown={() => preload(id)}
                  onMouseEnter={() => preload(id)}
                  onFocus={() => preload(id)}
                  onClick={() => navigate(id)}
                  variants={reduceMotion ? undefined : {
                    closed: {opacity: 0, y: 6},
                    open: {opacity: 1, y: 0, transition: {duration: 0.16, ease: motionEase}},
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </motion.button>
              ))}
              <motion.button
                type="button"
                onClick={onLogout}
                variants={reduceMotion ? undefined : {
                  closed: {opacity: 0, y: 6},
                  open: {opacity: 1, y: 0, transition: {duration: 0.16, ease: motionEase}},
                }}
              >
                <LogOut aria-hidden="true" />
                <span>Cerrar sesión</span>
              </motion.button>
            </motion.div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}
