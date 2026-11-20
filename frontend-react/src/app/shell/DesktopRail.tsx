import {Eye, EyeOff, LogOut, PanelLeftClose, PanelLeftOpen, RefreshCw, WifiOff} from "lucide-react";
import type {SectionAction, SectionActionRuntime, SectionDefinition, Tab} from "../contracts";

export function DesktopRail({
  sections,
  activeTab,
  offlineMessage,
  pwaUpdate,
  navigate,
  preload,
  action,
  actionRuntime,
  collapsed,
  toggleCollapsed,
  privacyMode,
  togglePrivacyMode,
  onLogout,
}: {
  sections: readonly SectionDefinition[];
  activeTab: Tab;
  offlineMessage: string;
  pwaUpdate: {applying: boolean; applyUpdate: () => void; hasDirtyForm: boolean; updateAvailable: boolean};
  navigate: (tab: Tab) => void;
  preload: (tab: Tab) => void;
  action: SectionAction;
  actionRuntime: SectionActionRuntime;
  collapsed: boolean;
  toggleCollapsed: () => void;
  privacyMode: boolean;
  togglePrivacyMode: () => void;
  onLogout: () => void;
}) {
  const toggleLabel = collapsed ? "Expandir barra lateral" : "Contraer barra lateral";
  const privacyLabel = privacyMode ? "Mostrar importes" : "Ocultar importes";
  const pwaUpdateMessage = pwaUpdate.applying
    ? "Aplicando la actualización."
    : pwaUpdate.hasDirtyForm
      ? "Hay una actualización disponible. Termina o descarta los cambios del formulario antes de actualizar."
      : "Hay una actualización disponible. Puedes aplicarla ahora.";
  const pwaActionLabel = pwaUpdate.applying
    ? "Actualizando aplicación"
    : pwaUpdate.hasDirtyForm
      ? "Actualizar aplicación no disponible mientras haya cambios sin guardar"
      : "Actualizar ahora";
  const ActionIcon = action.Icon;
  const primarySections = sections.filter(({navigationGroup}) => navigationGroup === "primary");
  const secondarySections = sections.filter(({navigationGroup}) => navigationGroup === "secondary");

  const renderSection = ({id, label, Icon}: SectionDefinition) => (
    <button key={id} type="button" className={activeTab === id ? "active" : ""} aria-label={label} aria-current={activeTab === id ? "page" : undefined} data-tooltip={label} onPointerDown={() => preload(id)} onMouseEnter={() => preload(id)} onFocus={() => preload(id)} onClick={() => navigate(id)}>
      <Icon aria-hidden="true" />
      <span className="rail-label" aria-hidden={collapsed}>{label}</span>
    </button>
  );

  return (
    <aside id="desktop-rail" className="desktop-rail">
      <button className="rail-brand" type="button" onClick={() => navigate("dashboard")} aria-label="Ir a resumen" data-tooltip="Ir a resumen">
        <span className="brand-icon" aria-hidden="true"><img src="/brand/logo.svg" alt="" /></span>
        <span className="rail-label rail-brand-copy" aria-hidden={collapsed}>
          <strong>Mis cuentas</strong>
          <small>Privado</small>
          </span>
      </button>
      <div className="rail-main">
        <button className="button primary full rail-new-movement" type="button" onClick={() => { void action.onClick(actionRuntime); }} aria-label={action.label} data-tooltip={action.label}>
          <ActionIcon aria-hidden="true" />
          <span className="rail-label" aria-hidden={collapsed}>{action.label}</span>
        </button>
        <nav className="rail-nav" aria-label="Navegación principal de escritorio">
          <div className="rail-nav-group">
            <h2 className="rail-nav-group-label rail-label" aria-hidden={collapsed}>Principal</h2>
            {primarySections.map(renderSection)}
          </div>
          <div className="rail-nav-group">
            <h2 className="rail-nav-group-label rail-label" aria-hidden={collapsed}>Más</h2>
            {secondarySections.map(renderSection)}
          </div>
        </nav>
      </div>
      <div className="rail-actions">
        {offlineMessage ? <div className="rail-offline-indicator" role="status" aria-label={offlineMessage} title={offlineMessage} data-tooltip="Sin conexión">
          <WifiOff aria-hidden="true" />
          <span className="rail-label" aria-hidden={collapsed}>Sin conexión</span>
        </div> : null}
        <button className="button secondary full" type="button" aria-label={privacyLabel} aria-pressed={privacyMode} data-tooltip={privacyLabel} onClick={togglePrivacyMode}>
          {privacyMode ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          <span className="rail-label" aria-hidden={collapsed}>{privacyLabel}</span>
        </button>
        <button className="button secondary full" type="button" aria-label="Cerrar sesión" data-tooltip="Cerrar sesión" onClick={onLogout}>
          <LogOut aria-hidden="true" />
          <span className="rail-label" aria-hidden={collapsed}>Cerrar sesión</span>
        </button>
        <button className="button secondary full rail-collapse-toggle" type="button" onClick={toggleCollapsed} aria-controls="desktop-rail" aria-expanded={!collapsed} aria-label={toggleLabel} data-tooltip={toggleLabel}>
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span className="rail-label" aria-hidden={collapsed}>{toggleLabel}</span>
        </button>
        {pwaUpdate.updateAvailable ? <button className="button secondary full rail-pwa-update-action" type="button" aria-label={pwaActionLabel} title={pwaUpdateMessage} data-tooltip={pwaUpdateMessage} disabled={pwaUpdate.hasDirtyForm} aria-disabled={pwaUpdate.applying || undefined} aria-busy={pwaUpdate.applying || undefined} onClick={() => {if (!pwaUpdate.applying && !pwaUpdate.hasDirtyForm) pwaUpdate.applyUpdate();}}>
          <RefreshCw aria-hidden="true" className={pwaUpdate.applying ? "spin" : undefined} />
          <span className="rail-label" aria-hidden={collapsed}>{pwaUpdate.applying ? "Actualizando…" : "Actualizar aplicación"}</span>
        </button> : null}
        {pwaUpdate.updateAvailable ? <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{pwaUpdateMessage}</span> : null}
      </div>
    </aside>
  );
}
