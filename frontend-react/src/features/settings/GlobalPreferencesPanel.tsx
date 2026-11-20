import {useRef, useState} from "react";
import type {AppPreferences, AppPreferencesWriteResult} from "../../app/preferences/appPreferences";
import {SectionHeader} from "../../shared/components/ui";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";

export type GlobalPreferencesPanelProps = {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => AppPreferencesWriteResult | Promise<AppPreferencesWriteResult>;
};

export function GlobalPreferencesPanel({preferences, onChange}: GlobalPreferencesPanelProps) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{message: string; error: boolean} | null>(null);
  const savingRef = useRef(false);

  const update = async (next: AppPreferences) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await onChange(next);
      setFeedback(result.persisted
        ? {message: "Preferencias guardadas en este dispositivo.", error: false}
        : {message: "No se pudieron guardar las preferencias. El cambio se mantiene durante esta sesión.", error: true});
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="settings-global-preferences" data-theme={preferences.theme}>
      <SectionHeader title="Apariencia y privacidad" detail="Preferencias de este dispositivo. No modifican tus datos financieros." />

      <div className="settings-preference-row">
        <div className="settings-preference-copy">
          <strong>Tema</strong>
          <span>Cambia la apariencia de toda la aplicación.</span>
        </div>
        <SegmentedControl aria-label="Tema de la aplicación">
          <SegmentedItem selected={preferences.theme === "mineral"} aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void update({...preferences, theme: "mineral"})}>Mineral</SegmentedItem>
          <SegmentedItem selected={preferences.theme === "basalt"} aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void update({...preferences, theme: "basalt"})}>Basalt</SegmentedItem>
        </SegmentedControl>
      </div>

      <div className="settings-preference-row">
        <div className="settings-preference-copy">
          <strong>Privacidad de importes</strong>
          <span>Oculta las cantidades sensibles en las superficies compatibles.</span>
        </div>
        <SegmentedControl aria-label="Privacidad de importes">
          <SegmentedItem selected={!preferences.privacyMode} aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void update({...preferences, privacyMode: false})}>Mostrar</SegmentedItem>
          <SegmentedItem selected={preferences.privacyMode} aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void update({...preferences, privacyMode: true})}>Ocultar</SegmentedItem>
        </SegmentedControl>
      </div>

      {feedback ? <p className={`settings-preferences-feedback${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}
    </section>
  );
}
