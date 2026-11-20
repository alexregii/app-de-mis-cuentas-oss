import {useState} from "react";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {displayEuro} from "../../format";
import {LabSection} from "../components/LabSection";

type AppTheme = "mineral" | "basalt";
type PersistenceFixture = "saved" | "restored" | "error" | "legacy" | "corrupt";

const persistenceCopy: Record<PersistenceFixture, string> = {
  saved: "Preferencias guardadas en este dispositivo.",
  restored: "Preferencias restauradas al recargar la aplicación.",
  error: "No se pudieron guardar las preferencias. El cambio se mantiene durante esta sesión.",
  legacy: "Privacidad recuperada de la configuración anterior. Se migrará al guardar.",
  corrupt: "Configuración guardada no válida. Se han restaurado los valores seguros.",
};

export function PreferencesScenario() {
  const [theme, setTheme] = useState<AppTheme>("mineral");
  const [privacyMode, setPrivacyMode] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceFixture>("saved");

  return (
    <LabSection title="Global preferences" detail="Tema y privacidad como configuración transversal, sin backend ni estado de feature.">
      <div className="preferences-scenario" data-theme={theme} aria-label="Arquetipo de preferencias globales">
        <div className="preferences-scenario-row">
          <div className="preferences-scenario-copy">
            <strong>Tema</strong>
            <span>Cambia los tokens globales sin alterar datos ni comportamiento.</span>
          </div>
          <SegmentedControl className="preferences-scenario-control" aria-label="Tema de la aplicación">
            <SegmentedItem className="preferences-scenario-control-item" selected={theme === "mineral"} disabled={disabled} onClick={() => setTheme("mineral")}>Mineral</SegmentedItem>
            <SegmentedItem className="preferences-scenario-control-item" selected={theme === "basalt"} disabled={disabled} onClick={() => setTheme("basalt")}>Basalt</SegmentedItem>
          </SegmentedControl>
        </div>

        <div className="preferences-scenario-row">
          <div className="preferences-scenario-copy">
            <strong>Privacidad de importes</strong>
            <span>Oculta las cantidades sensibles en todas las superficies compatibles.</span>
          </div>
          <SegmentedControl className="preferences-scenario-control" aria-label="Privacidad de importes">
            <SegmentedItem className="preferences-scenario-control-item" selected={!privacyMode} disabled={disabled} onClick={() => setPrivacyMode(false)}>Mostrar</SegmentedItem>
            <SegmentedItem className="preferences-scenario-control-item" selected={privacyMode} disabled={disabled} onClick={() => setPrivacyMode(true)}>Ocultar</SegmentedItem>
          </SegmentedControl>
        </div>

        <div className="preferences-scenario-preview" aria-label="Vista previa de preferencias">
          <span>Saldo de ejemplo</span>
          <strong>{displayEuro(1248.5, privacyMode)}</strong>
        </div>

        <p className={`preferences-scenario-status${persistence === "error" ? " is-error" : ""}`} role={persistence === "error" ? "alert" : "status"}>
          {persistenceCopy[persistence]}
        </p>
      </div>

      <details className="ui-lab-controls preferences-scenario-tools">
        <summary>Herramientas de prueba de preferencias</summary>
        <div className="ui-lab-controls__body" role="region" aria-label="Controles del Lab de preferencias">
          <label>
            Estado de persistencia
            <select value={persistence} onChange={(event) => setPersistence(event.target.value as PersistenceFixture)}>
              <option value="saved">Guardado correcto</option>
              <option value="restored">Restaurado tras recarga</option>
              <option value="error">Fallo al guardar</option>
              <option value="legacy">Privacidad legacy</option>
              <option value="corrupt">Documento corrupto</option>
            </select>
          </label>
          <label className="preferences-scenario-disable-control">
            <input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
            Deshabilitar preferencias
          </label>
        </div>
      </details>
    </LabSection>
  );
}
