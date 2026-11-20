import {useCallback, useEffect, useState} from "react";
import {Save} from "lucide-react";
import {CategorySettingsPanels} from "./CategorySettingsPanels";
import {CategoryRuleApplicationHistory} from "./CategoryRuleApplicationHistory";
import {settingsApi as api} from "./api";
import type {AutomationSettings, CategoryRule} from "./types";
import {consumeCategoryRuleDraftHandoff} from "../../shared/lib/categoryRuleDraftHandoff";
import {ErrorBanner, LoadingPanel, Panel, SectionHeader, StatusBanner} from "../../shared/components/ui";
import {ViewLoadError} from "../../shared/components/ViewLoadError";
import type {Category, CategoryRuleDraftInput} from "../../shared/model/categories";
import type {Account} from "../../shared/model/accounts";
import {PageHeader} from "../../ui/layout/PageHeader";
import {Button} from "../../ui/controls/Button";
import {FormField, Input} from "../../ui/controls/FormField";

type RuleConflict = {rule_a: CategoryRule; rule_b: CategoryRule; reason: string};

export function AutomationsView({categories, accounts = [], routeKey = "", embedded = false, showCategorySettings = true, showCategoryList = true, categoryIntent, onCategoriesChanged = async () => undefined}: {categories: Category[]; accounts?: Account[]; routeKey?: string; embedded?: boolean; showCategorySettings?: boolean; showCategoryList?: boolean; categoryIntent?: {id: number | null; token: number}; onCategoriesChanged?: () => Promise<void>}) {
  const routeSearchKey = routeKey || window.location.href;
  const routeSearch = new URL(routeSearchKey).searchParams;
  const hasNewRuleFocus = routeSearch.getAll("focus").includes("new-rule");
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [rules, setRules] = useState<CategoryRule[] | null>(null);
  const [conflicts, setConflicts] = useState<RuleConflict[]>([]);
  const [ruleDraftSuggestion, setRuleDraftSuggestion] = useState<CategoryRuleDraftInput | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const clearRuleDraftSuggestion = useCallback(() => setRuleDraftSuggestion(null), []);

  const load = useCallback(async () => {
    const [automationPayload, rulesPayload, conflictsPayload] = await Promise.all([
      api.automation(),
      api.categoryRules(),
      api.categoryRuleConflicts(),
    ]);
    setAutomation(automationPayload.automation);
    setRules(rulesPayload.rules);
    setConflicts(conflictsPayload.conflicts as RuleConflict[]);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar las automatizaciones.");
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasNewRuleFocus) return;
    const suggestion = consumeCategoryRuleDraftHandoff();
    if (suggestion) setRuleDraftSuggestion(suggestion);
  }, [hasNewRuleFocus, routeSearchKey]);

  if (!automation || !rules) return error
    ? <ViewLoadError title={embedded ? "Reglas de categoría" : "Automatizaciones"} message={error} onRetry={refresh} />
    : <LoadingPanel label={embedded ? "Cargando reglas y preferencias…" : "Cargando automatizaciones…"} />;

  const promotionStatus = automation.promotion_status ?? "NO_PROMOTION";
  const autoApplyEffective = automation.auto_apply_effective ?? false;
  const search = routeSearch;
  const selectedRuleValue = search.get("rule");
  const focuses = search.getAll("focus");
  const validRule = selectedRuleValue !== null && /^\d+$/.test(selectedRuleValue);
  const selectedRuleId = validRule ? Number(selectedRuleValue) : null;
  const openRule = !validRule && focuses.includes("new-rule");
  const openRuleList = (validRule && !rules.some((rule) => rule.id === selectedRuleId)) || (!validRule && !openRule && focuses.includes("rules"));
  const missingRule = validRule && !rules.some((rule) => rule.id === selectedRuleId);

  return (
    <div className={embedded ? "view-stack settings-category-rules-section" : "view-stack"} aria-busy={refreshing}>
      {!embedded ? <PageHeader title="Automatizaciones" description="Reglas explicables y reversibles para clasificar, sin confirmar pendientes ni modificar traspasos." /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {status ? <StatusBanner message={status} /> : null}
      {missingRule ? <p className="settings-rule-unavailable" role="status">Regla no disponible</p> : null}

      <CategorySettingsPanels
        categories={categories}
        accounts={accounts}
        rules={rules}
        load={async () => {await load(); await onCategoriesChanged(); setHistoryRefreshToken((value) => value + 1);}}
        setStatus={setStatus}
        showCategories={showCategorySettings}
        showCategoryList={showCategoryList}
        categoryIntent={categoryIntent}
        openRule={openRule}
        openRuleList={openRuleList}
        selectedRuleId={selectedRuleId}
        ruleDraftSuggestion={ruleDraftSuggestion}
        onRuleDraftSuggestionConsumed={clearRuleDraftSuggestion}
      />

      <CategoryRuleApplicationHistory refreshToken={historyRefreshToken} setStatus={setStatus} />

      <div className="settings-classification-preferences">
        <Panel className="settings-classification-preferences-panel">
          <SectionHeader title="Sugerencias y aplicación" detail="Las reglas activas clasifican movimientos coincidentes aunque la IA esté desactivada. Si no hay coincidencia, la IA solo sugiere. La confianza no es precisión medida y no basta para confirmar movimientos." />
          <form className="entry-form" onSubmit={async (event) => {
            event.preventDefault();
            await api.updateAutomation({
              llm_enabled: automation.llm_enabled,
              auto_apply_enabled: automation.auto_apply_enabled,
              confidence_threshold: String(automation.confidence_threshold),
            });
            setStatus("Automatización actualizada.");
            await refresh();
          }}>
            <label className="check-row"><input type="checkbox" checked={automation.llm_enabled} onChange={(event) => setAutomation((current) => current ? {...current, llm_enabled: event.target.checked} : current)} />IA para sugerencias</label>
            <label className="check-row"><input type="checkbox" checked={automation.auto_apply_enabled} disabled={promotionStatus !== "PROMOTED" && !automation.auto_apply_enabled} onChange={(event) => setAutomation((current) => current ? {...current, auto_apply_enabled: event.target.checked} : current)} />Autoaplicar sugerencias de IA</label>
            <p className="settings-promotion-status">{promotionStatus === "NO_PROMOTION"
              ? `NO_PROMOTION: autoaplicación inactiva; hace falta precisión validada ≥99% y cobertura publicada. ${automation.auto_apply_enabled && !autoApplyEffective ? "La preferencia guardada no confirma movimientos." : "Los pendientes siguen en Revisión."}`
              : autoApplyEffective
                ? "PROMOTED: la autoaplicación está activa bajo el umbral validado y las protecciones de duplicado/traspaso."
                : "PROMOTED: puedes activar la autoaplicación; el umbral debe mantenerse en al menos 99%."}</p>
            <FormField label="Umbral de confianza"><Input type="number" min="0" max="1" step="0.001" value={automation.confidence_threshold} onChange={(event) => setAutomation((current) => current ? {...current, confidence_threshold: Number(event.target.value)} : current)} /></FormField>
            <Button variant="primary" fullWidth type="submit"><Save aria-hidden="true" />Guardar automatización</Button>
          </form>
        </Panel>

      </div>

      {conflicts.length ? <Panel><SectionHeader title="Conflictos a revisar" detail="Dos reglas pueden clasificar el mismo movimiento en categorías distintas." /><div className="stack-list compact-stack">{conflicts.map((conflict) => <div className="list-card" key={`${conflict.rule_a.id}-${conflict.rule_b.id}`}><strong>{conflict.rule_a.description} ↔ {conflict.rule_b.description}</strong><span>{conflict.reason} Prioridad actual: {conflict.rule_a.priority} y {conflict.rule_b.priority}.</span></div>)}</div></Panel> : null}
    </div>
  );
}
