import {useEffect, useLayoutEffect, useRef, useState, type FormEvent} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {ChevronDown, Save} from "lucide-react";
import {settingsApi as api} from "./api";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {ConfirmDialog} from "../../shared/components/ConfirmDialog";
import {ErrorBanner, Panel, SectionHeader} from "../../shared/components/ui";
import {Button} from "../../ui/controls/Button";
import {motionEase} from "../../shared/lib/motion";
import type {Category, CategoryRuleDraftInput} from "../../shared/model/categories";
import type {Account} from "../../shared/model/accounts";
import type {CategoryRule, CategoryRuleApplyResult, CategoryRulePreview} from "./types";
import {CategoryRuleEditorPanel} from "./CategoryRuleEditorPanel";
import {emptyCategoryRuleForm, hasCategoryRuleDraftContent, matchModeLabel, ruleCountLabel, ruleDraftValuesFromSuggestion, ruleFormValues, ruleScope, sameCategoryRuleDraft, type CategoryRuleFormValues, type CategorySettingsPanelsProps} from "./CategorySettingsModel";
import {CategoryFormFields} from "./CategoryFormFields";
import {notifyCategoryRuleDraftSaved, removeSavedCategoryRuleDraft, restoreCategoryRuleDrafts, storeCategoryRuleDrafts, subscribeToCategoryRuleDraftSaved} from "./categoryRuleDraftStorage";
import {revealEditorForm as revealForm, useCategoryEditor} from "./useCategoryEditor";

export function CategorySettingsPanels({categories, rules, load, setStatus, accounts = [], showCategories = true, showRules = true, showCategoryFormToggle = true, showCategoryList = true, categoryIntent, openRule = false, openRuleList = false, selectedRuleId = null, ruleDraftSuggestion, onRuleDraftSuggestionConsumed, onCategoryUpdated}: CategorySettingsPanelsProps) {
  const {
    editingCategoryId,
    categoryForm,
    savingCategory,
    categoryError,
    categoryFormRef,
    categoryPanelOpen,
    toggleCategoryForm,
    editCategory,
    updateCategoryForm,
    saveCategory,
  } = useCategoryEditor({categories, load, setStatus, categoryIntent, onCategoryUpdated});
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [categoryRuleFormOpen, setCategoryRuleFormOpen] = useState(openRule);
  const [ruleEditorHidden, setRuleEditorHidden] = useState(false);
  const [categoryListOpen, setCategoryListOpen] = useState(openRuleList);
  const [ruleForm, setRuleForm] = useState(emptyCategoryRuleForm);
  const currentRuleFormRef = useRef(ruleForm);
  currentRuleFormRef.current = ruleForm;
  const [savingRule, setSavingRule] = useState(false);
  const ruleSavePendingRef = useRef(false);
  const [ruleSaveError, setRuleSaveError] = useState("");
  const [lastSavedRuleId, setLastSavedRuleId] = useState<number | null>(null);
  const [rulePendingDeletion, setRulePendingDeletion] = useState<CategoryRule | null>(null);
  const [rulePreview, setRulePreview] = useState<{rule: CategoryRule; result: CategoryRulePreview} | null>(null);
  const [rulePreviewPendingId, setRulePreviewPendingId] = useState<number | null>(null);
  const rulePreviewPendingRef = useRef(false);
  const [rulePendingApplication, setRulePendingApplication] = useState<{rule: CategoryRule; result: CategoryRulePreview} | null>(null);
  const [ruleUndoPending, setRuleUndoPending] = useState(false);
  const ruleUndoPendingRef = useRef(false);
  const ruleFormRef = useRef<HTMLFormElement>(null);
  const ruleListRef = useRef<HTMLDivElement>(null);
  const ruleListPanelRef = useRef<HTMLDivElement>(null);
  const ruleDraftsRef = useRef(new Map<number | "new", CategoryRuleFormValues>());
  const ruleDraftsRestoredRef = useRef(false);
  const appliedRuleDraftSuggestionRef = useRef<CategoryRuleDraftInput | null>(null);
  const editingRuleIdRef = useRef(editingRuleId);
  editingRuleIdRef.current = editingRuleId;
  const loadRef = useRef(load);
  loadRef.current = load;
  useLayoutEffect(() => {
    if (ruleDraftsRestoredRef.current) return;
    ruleDraftsRestoredRef.current = true;
    const restoredDrafts = restoreCategoryRuleDrafts();
    restoredDrafts.forEach((draft, key) => ruleDraftsRef.current.set(key, draft));
    const newDraft = restoredDrafts.get("new");
    if (newDraft) {
      setRuleForm(newDraft);
      setCategoryRuleFormOpen(true);
      setStatus("Se recuperó un borrador de regla sin guardar.");
    }
  }, [setStatus]);
  useEffect(() => () => storeCategoryRuleDrafts(ruleDraftsRef.current), []);
  useEffect(() => subscribeToCategoryRuleDraftSaved(({key, submittedDraft, origin}) => {
    if (origin === ruleDraftsRef.current) return;
    const matchingDraft = sameCategoryRuleDraft(ruleDraftsRef.current.get(key), submittedDraft);
    if (matchingDraft) {
      ruleDraftsRef.current.delete(key);
      const activeKey = editingRuleIdRef.current ?? "new";
      if (activeKey === key && sameCategoryRuleDraft(currentRuleFormRef.current, submittedDraft)) {
        setRuleForm(emptyCategoryRuleForm());
        if (key === "new") setCategoryRuleFormOpen(false);
        else setEditingRuleId(null);
      }
    }
    void loadRef.current().then(() => setStatus(matchingDraft
      ? "Regla guardada y lista actualizada."
      : "Regla guardada; se conservó el borrador más reciente."))
      .catch(() => setStatus("La regla se guardó, pero no se pudo actualizar la lista."));
  }), [setStatus]);
  const [ruleApplication, setRuleApplication] = useState<{rule: CategoryRule; result: CategoryRuleApplyResult} | null>(null);
  const lastRouteRuleId = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
  const categoryRulePanelOpen = !ruleEditorHidden && (categoryRuleFormOpen || Boolean(editingRuleId));
  const disclosureTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const focusRuleTrigger = (ruleId: number) => {
    const trigger = ruleListRef.current?.querySelector<HTMLButtonElement>(`button[data-rule-preview-id="${ruleId}"]`);
    if (!trigger) return;
    trigger.focus({preventScroll: true});
    const {top, bottom} = trigger.getBoundingClientRect();
    if ((top < 0 || bottom > window.innerHeight) && typeof trigger.scrollIntoView === "function") trigger.scrollIntoView({block: "nearest", behavior: reduceMotion ? "auto" : "smooth"});
  };
  const previewRule = async (rule: CategoryRule, trigger: HTMLButtonElement) => {
    if (rulePreviewPendingRef.current) return;
    trigger.focus({preventScroll: true}); rulePreviewPendingRef.current = true; setRulePreviewPendingId(rule.id); setRulePreview(null);
    try {
      setRulePreview({rule, result: (await api.previewCategoryRule(rule.id)).result});
    } catch {setStatus("No se pudo probar la regla. Puedes volver a intentarlo.");}
    finally {rulePreviewPendingRef.current = false; setRulePreviewPendingId(null);}
  };
  const undoRuleApplication = async (trigger: HTMLButtonElement) => {
    if (!ruleApplication || ruleUndoPendingRef.current) return;
    trigger.focus({preventScroll: true}); ruleUndoPendingRef.current = true; setRuleUndoPending(true);
    let completed = false;
    try {
      const response = await api.undoCategoryRule(ruleApplication.rule.id, ruleApplication.result.application_id);
      completed = true;
      setStatus(response.partial ? "Deshecha parcialmente: algunos registros habían cambiado después." : "Aplicación deshecha.");
      setRuleApplication(null);
      await load().catch(() => setStatus("La aplicación se deshizo, pero no se pudo actualizar la lista."));
    } catch {setStatus("No se pudo deshacer la aplicación. Puedes volver a intentarlo.");}
    finally {
      ruleUndoPendingRef.current = false;
      setRuleUndoPending(false);
      if (completed) focusRuleTrigger(ruleApplication.rule.id);
    }
  };
  const saveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const trigger = submitter instanceof HTMLButtonElement ? submitter : ruleFormRef.current?.querySelector<HTMLButtonElement>("button[type=submit]");
    trigger?.focus({preventScroll: true});
    if (ruleSavePendingRef.current) return;
    ruleSavePendingRef.current = true; setSavingRule(true);
    const ruleId = editingRuleId;
    const wasEditing = ruleId !== null;
    const draftKey = ruleId ?? "new";
    const submittedDraft = {...ruleForm};
    let completed = false;
    try {
      const response = ruleId === null ? await api.createCategoryRule(submittedDraft) : await api.updateCategoryRule(ruleId, submittedDraft);
      completed = true;
      ruleDraftsRef.current.delete(draftKey);
      removeSavedCategoryRuleDraft(draftKey, submittedDraft);
      notifyCategoryRuleDraftSaved({key: draftKey, submittedDraft, origin: ruleDraftsRef.current});
      setLastSavedRuleId(response.rule.id); setRuleSaveError(""); setEditingRuleId(null); setRuleForm(emptyCategoryRuleForm());
      setStatus(wasEditing ? "Regla de categoría actualizada." : "Regla de categoría creada.");
      await load().catch(() => setStatus("La regla se guardó, pero no se pudo actualizar la lista."));
    } catch {setRuleSaveError("No se pudo guardar la regla. Puedes volver a intentarlo.");}
    finally {ruleSavePendingRef.current = false; setSavingRule(false); if (completed && wasEditing) window.requestAnimationFrame(() => ruleFormRef.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus({preventScroll: true}));}
  };

  useEffect(() => {
    if (!openRule) return;
    if (ruleDraftSuggestion && appliedRuleDraftSuggestionRef.current === ruleDraftSuggestion) return;
    setRuleEditorHidden(false);
    setEditingRuleId(null);
    const existingDraft = ruleDraftsRef.current.get("new");
    if (ruleDraftSuggestion) {
      appliedRuleDraftSuggestionRef.current = ruleDraftSuggestion;
      if (hasCategoryRuleDraftContent(existingDraft)) {
        setRuleForm(existingDraft ?? emptyCategoryRuleForm());
        setStatus("Se conservó tu borrador de regla. Vuelve a Plan después para usar esta sugerencia.");
      } else {
        const preparedDraft = ruleDraftValuesFromSuggestion(ruleDraftSuggestion);
        ruleDraftsRef.current.set("new", preparedDraft);
        setRuleForm(preparedDraft);
        setStatus("Sugerencia preparada. Revisa descripción, categoría y condiciones antes de guardar.");
      }
      onRuleDraftSuggestionConsumed?.();
    } else {
      setRuleForm(existingDraft || emptyCategoryRuleForm());
    }
    setCategoryRuleFormOpen(true);
  }, [openRule, onRuleDraftSuggestionConsumed, ruleDraftSuggestion, setStatus]);

  useEffect(() => {
    if (!openRuleList) return;
    setRuleEditorHidden(true);
    setCategoryListOpen(true);
  }, [openRuleList]);

  useLayoutEffect(() => {
    if (openRuleList && categoryListOpen) {
      const trigger = ruleListPanelRef.current?.querySelector<HTMLButtonElement>("button.disclosure-button");
      trigger?.focus({preventScroll: true});
      if (trigger && typeof trigger.scrollIntoView === "function") trigger.scrollIntoView({block: "nearest", behavior: reduceMotion ? "auto" : "smooth"});
    }
  }, [categoryListOpen, openRuleList, reduceMotion]);

  useLayoutEffect(() => {
    if (categoryRulePanelOpen && (openRule || selectedRuleId !== null)) {
      revealForm(ruleFormRef.current);
      ruleFormRef.current?.querySelector<HTMLInputElement>("input:not([type=checkbox])")?.focus({preventScroll: true});
    }
  }, [categoryRulePanelOpen, openRule, selectedRuleId]);

  useEffect(() => {
    if (selectedRuleId === lastRouteRuleId.current) return;
    if (editingRuleId !== null) ruleDraftsRef.current.set(editingRuleId, ruleForm);
    lastRouteRuleId.current = selectedRuleId;
    if (selectedRuleId === null) return;
    const selectedRule = rules.find((rule) => rule.id === selectedRuleId);
    if (!selectedRule) {
      setRuleEditorHidden(true);
      setCategoryListOpen(true);
      return;
    }
    setRuleEditorHidden(false);
    setEditingRuleId(selectedRule.id);
    setCategoryRuleFormOpen(true);
    setRuleForm(ruleDraftsRef.current.get(selectedRule.id) || ruleFormValues(selectedRule));
  }, [editingRuleId, rules, ruleForm, selectedRuleId]);

  return (
    <>
      <div className={showCategories && showRules ? "dual-grid" : "automation-rule-entry"}>
        {showCategories && (showCategoryFormToggle || categoryPanelOpen) ? <CollapsiblePanel
          title={editingCategoryId ? "Editar categoría" : "Nueva categoría"}
          detail="Catálogo usado por movimientos, presupuestos y estadísticas."
          open={categoryPanelOpen}
          onToggle={toggleCategoryForm}
          summary={<span>{categories.length} categorías · {categories.filter((item) => item.active).length} activas</span>}
        >
          {categoryError ? <ErrorBanner message={categoryError} /> : null}
          <form ref={categoryFormRef} className="entry-form" aria-busy={savingCategory} onSubmit={saveCategory}>
            <CategoryFormFields categories={categories} value={categoryForm} disabled={savingCategory} onChange={updateCategoryForm} />
            <Button variant="primary" fullWidth type="submit" disabled={!categoryForm.name.trim()} aria-disabled={savingCategory || !categoryForm.name.trim()} onClick={(event) => event.currentTarget.focus({preventScroll: true})}><Save aria-hidden="true" /> {savingCategory ? "Guardando categoría…" : "Guardar categoría"}</Button>
          </form>
        </CollapsiblePanel> : null}

        {showRules ? <CategoryRuleEditorPanel
          key={editingRuleId ?? "new-rule"}
          categories={categories}
          accounts={accounts}
          count={rules.length}
          editing={Boolean(editingRuleId)}
          open={categoryRulePanelOpen}
          saving={savingRule}
          error={ruleSaveError}
          form={ruleForm}
          formRef={ruleFormRef}
          summary={ruleCountLabel(rules.length)}
          onToggle={() => {
            if (savingRule) return;
            const returningToNewRule = editingRuleId !== null;
            if (returningToNewRule) {
              ruleDraftsRef.current.set(editingRuleId, ruleForm);
              setEditingRuleId(null);
              setRuleForm(ruleDraftsRef.current.get("new") || emptyCategoryRuleForm());
            }
            setRuleEditorHidden(false);
            setCategoryRuleFormOpen(!categoryRulePanelOpen);
            if (returningToNewRule) window.requestAnimationFrame(() => {
              document.querySelector<HTMLButtonElement>('.collapsible-panel .disclosure-button[aria-label="Expandir nueva regla"]')?.focus({preventScroll: true});
            });
          }}
          onSubmit={saveRule}
          onChange={(patch) => {
            setRuleSaveError("");
            setRuleForm((current) => {
              const next = {...current, ...patch};
              ruleDraftsRef.current.set(editingRuleId ?? "new", next);
              return next;
            });
          }}
        /> : null}
      </div>

      <div ref={ruleListPanelRef} className={showCategories ? "dual-grid" : "automation-rule-list"}>
        {(showCategoryList || showRules) ? <Panel>
          <SectionHeader
            title={showCategoryList && showCategories && showRules ? "Categorías y reglas" : showCategoryList && showCategories ? "Categorías" : "Reglas"}
            detail={showCategoryList && showCategories && showRules ? `${categories.length} categorías · ${ruleCountLabel(rules.length)}.` : showCategoryList && showCategories ? `${categories.length} categorías.` : rules.length ? `${ruleCountLabel(rules.length)}.` : undefined}
            action={(
              <Button variant="secondary" className="disclosure-button" aria-expanded={categoryListOpen} onClick={() => setCategoryListOpen((value) => !value)}>
                <ChevronDown aria-hidden="true" />
                {categoryListOpen ? "Comprimir" : "Expandir"}
              </Button>
            )}
          />
          <AnimatePresence initial={false}>
            {!categoryListOpen ? (
              <motion.div
                key="category-summary"
                className="collapsed-summary"
                initial={reduceMotion ? false : {height: 0, opacity: 0, y: -2}}
                animate={{height: "auto", opacity: 1, y: 0}}
                exit={{height: 0, opacity: 0, y: -2}}
                transition={disclosureTransition}
              >
                <span>{showCategories && showRules ? "Muestra compacta. Expande para editar categorías y reglas guardadas." : showCategories ? "Muestra compacta. Expande para editar categorías." : "Muestra compacta. Expande para editar reglas guardadas."}</span>
              </motion.div>
            ) : (
              <motion.div
                key="category-list"
                className="collapsible-content"
                initial={reduceMotion ? false : {height: 0, opacity: 0, y: -4}}
                animate={{height: "auto", opacity: 1, y: 0}}
                exit={{height: 0, opacity: 0, y: -4}}
                transition={disclosureTransition}
              >
                {showCategoryList && showCategories && (categories.length ? (
                  <div className="stack-list compact-stack">
                    {categories.slice().sort((a, b) => a.display_name.localeCompare(b.display_name)).map((category) => (
                      <div className="list-card" key={`category-${category.id}`}>
                        <strong>{category.display_name}</strong>
                        <span>{category.kind === "expense" ? "Gasto" : "Ingreso"}{category.exclude_from_analytics ? " · Excluida de estadísticas" : ""}</span>
                        <div className="inline-actions">
                          <Button variant="secondary" onClick={(event) => {
                            event.currentTarget.focus({preventScroll: true});
                            editCategory(category);
                            window.requestAnimationFrame(() => revealForm(categoryFormRef.current));
                          }}>Editar</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-state empty-state--plain">No hay categorías todavía.</div>)}
                {showRules && (rules.length ? (
                  <div ref={ruleListRef} className="stack-list compact-stack top-gap">
                    {rules.map((rule) => (
                      <motion.div layout transition={disclosureTransition} initial={lastSavedRuleId === rule.id && !reduceMotion ? {height: 0, opacity: 0} : false} animate={{height: "auto", opacity: 1}} className={`list-card ${lastSavedRuleId === rule.id ? "category-rule-entry-motion" : ""}`} key={rule.id}>
                        <strong>Si la descripción {matchModeLabel(rule.match_mode)} “{rule.description}” → {rule.category.display_name}</strong>
                        <span>{ruleScope(rule)}</span>
                        <div className="inline-actions">
                          <Button variant="secondary" onClick={(event) => {
                            event.currentTarget.focus({preventScroll: true});
                            if (editingRuleId !== null) ruleDraftsRef.current.set(editingRuleId, ruleForm);
                            setEditingRuleId(rule.id);
                            setCategoryRuleFormOpen(true);
                            setRuleEditorHidden(false);
                            setRuleForm(ruleDraftsRef.current.get(rule.id) || ruleFormValues(rule));
                            window.requestAnimationFrame(() => revealForm(ruleFormRef.current));
                          }}>Editar</Button>
                          <Button data-rule-preview-id={rule.id} variant="secondary" aria-disabled={rulePreviewPendingId !== null || undefined} aria-busy={rulePreviewPendingId === rule.id || undefined} onClick={(event) => void previewRule(rule, event.currentTarget)}>{rulePreviewPendingId === rule.id ? "Probando…" : "Probar"}</Button>
                          <Button variant="secondary" onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setRulePendingDeletion(rule);}}>Eliminar</Button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : <div className="empty-state empty-state--plain top-gap">Crea una regla arriba para asignar categorías según la descripción del movimiento.</div>)}
              </motion.div>
            )}
          </AnimatePresence>
        </Panel> : null}

      </div>
      <AnimatePresence initial={false} mode="wait">
        {rulePreview ? <motion.div key="rule-preview" className="top-gap category-rule-result-motion" initial={reduceMotion ? false : {height: 0, opacity: 0}} animate={{height: "auto", opacity: 1}} exit={{height: 0, opacity: 0}} transition={disclosureTransition}>
          <Panel><SectionHeader title={`Vista previa: ${rulePreview.rule.description}`} detail={`Si descripción ${rulePreview.rule.match_mode === "exact" ? "es" : rulePreview.rule.match_mode === "contains" ? "contiene" : rulePreview.rule.match_mode === "starts_with" ? "empieza por" : "termina en"} “${rulePreview.rule.description}” → ${rulePreview.rule.category.display_name}.`} /><p aria-live="polite">{rulePreview.result.changes} cambios de {rulePreview.result.total} coincidencias: {rulePreview.result.transactions} movimientos, {rulePreview.result.bank_rows} pendientes de banco y {rulePreview.result.csv_rows} pendientes CSV. {rulePreview.result.already_categorized ? `${rulePreview.result.already_categorized} ya tenían esa categoría.` : ""}</p>{rulePreview.result.examples.length ? <ul className="compact-list">{rulePreview.result.examples.slice(0, 5).map((item, index) => <li key={`${item.description}-${index}`}>{item.description}</li>)}</ul> : null}<div className="inline-actions"><Button variant="secondary" onClick={() => {focusRuleTrigger(rulePreview.rule.id); setRulePreview(null);}}>Cerrar</Button><Button variant="primary" disabled={!rulePreview.result.changes} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setRulePendingApplication(rulePreview);}}>Aplicar cambios</Button></div></Panel>
        </motion.div> : ruleApplication ? <motion.div key="rule-application" className="top-gap category-rule-result-motion" initial={reduceMotion ? false : {height: 0, opacity: 0}} animate={{height: "auto", opacity: 1}} exit={{height: 0, opacity: 0}} transition={disclosureTransition}>
          <Panel><SectionHeader title="Regla aplicada" detail={`${ruleApplication.result.total} registros procesados. Puedes deshacer esta aplicación mientras no haya otro cambio sobre los mismos registros.`} /><div className="inline-actions"><Button variant="secondary" aria-disabled={ruleUndoPending || undefined} aria-busy={ruleUndoPending || undefined} onClick={(event) => void undoRuleApplication(event.currentTarget)}>{ruleUndoPending ? "Deshaciendo…" : "Deshacer aplicación"}</Button></div></Panel>
        </motion.div> : null}
      </AnimatePresence>
      {rulePendingDeletion ? (
        <ConfirmDialog
          title={`¿Eliminar la regla “${rulePendingDeletion.description}”?`}
          description="La automatización dejará de clasificar movimientos futuros. Los movimientos ya clasificados no cambiarán."
          confirmLabel="Eliminar regla"
          onCancel={() => setRulePendingDeletion(null)}
          onConfirm={async () => {
            await api.deleteCategoryRule(rulePendingDeletion.id);
            setStatus("Regla eliminada.");
            await load();
          }}
        />
      ) : null}
      {rulePendingApplication ? <ConfirmDialog title={`¿Aplicar “${rulePendingApplication.rule.description}” al histórico?`} description={`Cambiará ${rulePendingApplication.result.changes} registros; incluye ${rulePendingApplication.result.bank_rows + rulePendingApplication.result.csv_rows} elementos pendientes de revisión, sin confirmarlos ni incorporarlos al ledger. Podrás deshacer esta aplicación.`} confirmLabel="Aplicar cambios" onCancel={() => setRulePendingApplication(null)} onConfirm={async () => {const result = (await api.applyCategoryRule(rulePendingApplication.rule.id)).result; setRuleApplication({rule: rulePendingApplication.rule, result}); setRulePreview(null); setRulePendingApplication(null); setStatus(`Regla aplicada a ${result.total} registros.`); await load();}} /> : null}
    </>
  );
}
