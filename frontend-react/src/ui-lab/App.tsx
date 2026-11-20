import {useEffect, useState} from "react";
import {useInputModality} from "../ui/foundations/useInputModality";
import {defaultScenarioId, findScenario, scenarios, type ScenarioId} from "./scenarios/registry";

const themes = [
  {id: "mineral", label: "Mineral", mode: "LIGHT"},
  {id: "basalt", label: "Basalt", mode: "DARK"},
] as const;

type ThemeId = typeof themes[number]["id"];

function scenarioIdFromHash(hash = window.location.hash): ScenarioId {
  return findScenario(hash.slice(1))?.id ?? defaultScenarioId;
}

export function UiLabApp() {
  const inputModalityRef = useInputModality();
  const [theme, setTheme] = useState<ThemeId>("mineral");
  const [scenarioId, setScenarioId] = useState<ScenarioId>(() => scenarioIdFromHash());
  const activeScenario = findScenario(scenarioId) ?? findScenario(defaultScenarioId)!;
  const ActiveScenario = activeScenario.component;

  useEffect(() => {
    const syncScenarioFromHash = () => setScenarioId(scenarioIdFromHash());
    window.addEventListener("hashchange", syncScenarioFromHash);
    return () => window.removeEventListener("hashchange", syncScenarioFromHash);
  }, []);

  const selectScenario = (id: ScenarioId) => { setScenarioId(id); window.location.hash = id; };

  return (
    <main ref={inputModalityRef} className="ui-lab" data-theme={theme}>
      <header>
        <h1>UI Lab</h1>
        <p>Catálogo aislado para diseñar y comprobar objetos visuales de Mis cuentas sin backend, routing ni CSS de features.</p>
        <label className="ui-lab-palette-picker">Tema del experimento
          <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeId)}>
            {(["BASELINE", "LIGHT", "DARK"] as const).map((mode) => <optgroup key={mode} label={mode}>{themes.filter((candidate) => candidate.mode === mode).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</optgroup>)}
          </select>
        </label>
      </header>
      <div className="ui-lab-catalog-layout">
        <nav className="ui-lab-catalog" aria-label="Catálogo de escenarios">
          {scenarios.map((scenario) => <a key={scenario.id} href={`#${scenario.id}`} aria-current={scenario.id === activeScenario.id ? "page" : undefined}><small>{scenario.group}</small>{scenario.label}</a>)}
        </nav>
        <label className="ui-lab-scenario-picker">Escenario
          <select value={activeScenario.id} onChange={(event) => selectScenario(event.target.value as ScenarioId)}>
            {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.group} · {scenario.label}</option>)}
          </select>
        </label>
        <div className="ui-lab-active-scenario"><ActiveScenario /></div>
      </div>
    </main>
  );
}
