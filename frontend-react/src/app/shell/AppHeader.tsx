import {CircleAlert, Eye, EyeOff, RefreshCw, Search, WifiOff} from "lucide-react";
import {Button, IconButton} from "../../ui/controls/Button";

export function AppHeader({activeLabel, offlineMessage, appError, refreshError, pwaUpdate, openDashboard, openCommandPalette, privacyMode, togglePrivacyMode}: {activeLabel: string; offlineMessage: string; appError: string; refreshError: string; pwaUpdate: {applying: boolean; applyUpdate: () => void; hasDirtyForm: boolean; updateAvailable: boolean}; openDashboard: () => void; openCommandPalette: () => void; privacyMode: boolean; togglePrivacyMode: () => void}) {
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
  return (
    <header className="app-header">
      <button className="brand-button" type="button" onClick={openDashboard} aria-label="Ir a resumen" title="Ir a resumen">
        <span className="brand-icon" aria-hidden="true"><img src="/brand/logo.svg" alt="" /></span>
        <strong>Mis cuentas</strong>
      </button>
      <div className="app-header-context">
        <span className="app-header-context-label">{activeLabel}</span>
        {appError ? <span className="app-offline-indicator app-global-error-indicator" role="alert" aria-label={appError} aria-atomic="true" title={appError}>
          <CircleAlert aria-hidden="true" />
          <span className="app-offline-indicator-label">Error en app</span>
          <span className="sr-only">{appError}</span>
        </span> : refreshError ? <span className="app-offline-indicator app-refresh-error-indicator" role="status" aria-label={`${refreshError} Desliza desde arriba para volver a intentarlo.`} aria-atomic="true" title={refreshError}>
          <CircleAlert aria-hidden="true" />
          <span className="app-offline-indicator-label">No se actualizó</span>
        </span> : offlineMessage ? <span className="app-offline-indicator" role="status" aria-label={offlineMessage} title={offlineMessage}>
          <WifiOff aria-hidden="true" />
          <span className="app-offline-indicator-label">Sin conexión</span>
        </span> : null}
      </div>
      <div className="header-actions">
        {pwaUpdate.updateAvailable ? <Button variant="secondary" className="app-pwa-update-action" aria-label={pwaActionLabel} title={pwaUpdateMessage} disabled={pwaUpdate.hasDirtyForm} aria-disabled={pwaUpdate.applying || undefined} aria-busy={pwaUpdate.applying || undefined} onClick={() => {if (!pwaUpdate.applying && !pwaUpdate.hasDirtyForm) pwaUpdate.applyUpdate();}}>{pwaUpdate.applying ? "Actualizando" : "Actualizar"}</Button> : null}
        <IconButton variant="subtle" aria-label={privacyLabel} aria-pressed={privacyMode} title={privacyLabel} onClick={togglePrivacyMode}>{privacyMode ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</IconButton>
        <IconButton variant="subtle" className="app-command-trigger" aria-label="Buscar y ejecutar" title="Buscar y ejecutar (Ctrl+K)" onClick={openCommandPalette}><Search aria-hidden="true" /></IconButton>
      </div>
      {pwaUpdate.updateAvailable ? <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{pwaUpdateMessage}</span> : null}
    </header>
  );
}
