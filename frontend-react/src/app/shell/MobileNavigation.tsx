import {MoreHorizontal} from "lucide-react";
import type {RefObject} from "react";
import type {SectionAction, SectionActionRuntime, SectionDefinition, Tab} from "../contracts";

export function MobileNavigation({primarySections, activeTab, navigate, preload, action, runtime, moreOpen, moreIsActive, toggleMore, moreTriggerRef}: {
  primarySections: readonly SectionDefinition[];
  activeTab: Tab;
  navigate: (tab: Tab) => void;
  preload: (tab: Tab) => void;
  action: SectionAction;
  runtime: SectionActionRuntime;
  moreOpen: boolean;
  moreIsActive: boolean;
  toggleMore: () => void;
  moreTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const ContextIcon = action.Icon;
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {primarySections.map(({id, label, shortLabel, Icon}) => (
        <button key={id} type="button" className={activeTab === id ? "active" : ""} aria-label={label} aria-current={activeTab === id ? "page" : undefined} title={label} onPointerDown={() => preload(id)} onMouseEnter={() => preload(id)} onFocus={() => preload(id)} onClick={() => navigate(id)}>
          <Icon aria-hidden="true" />
          <span>{shortLabel || label}</span>
        </button>
      ))}
      <button type="button" className="bottom-add" aria-label={action.label} title={action.label} onClick={() => { void action.onClick(runtime); }}>
        <ContextIcon aria-hidden="true" />
      </button>
      <button ref={moreTriggerRef} type="button" className={moreIsActive || moreOpen ? "active" : ""} aria-expanded={moreOpen} aria-controls="more-sheet" title="Más secciones" onClick={toggleMore}>
        <MoreHorizontal aria-hidden="true" />
        <span>Más</span>
      </button>
    </nav>
  );
}
