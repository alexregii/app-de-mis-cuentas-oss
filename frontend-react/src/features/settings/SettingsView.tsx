import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {ArrowLeft} from "lucide-react";
import {ErrorBanner, LoadingPanel, StatusBanner} from "../../shared/components/ui";
import {ViewLoadError} from "../../shared/components/ViewLoadError";
import {AdvancedCatalog} from "./AdvancedCatalog";
import {AutomationsView} from "./AutomationsView";
import {CategorySettingsPanels} from "./CategorySettingsPanels";
import {settingsApi} from "./api";
import {CsvProfilesPanel} from "./CsvProfilesPanel";
import {OfflineDataPanel} from "./OfflineDataPanel";
import {RecoveryPanel} from "./RecoveryPanel";
import {useSettingsData} from "./useSettingsData";
import type {Category} from "../../shared/model/categories";
import type {Account, Connection} from "../../shared/model/accounts";
import {PageHeader} from "../../ui/layout/PageHeader";
import type {GlobalPreferencesPanelProps} from "./GlobalPreferencesPanel";
import {GlobalPreferencesPanel} from "./GlobalPreferencesPanel";
import {Button} from "../../ui/controls/Button";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {indexSelector, routeState, sections, type ClassificationView, type SettingsSection} from "./settingsRoute";
import {useCategorySearchRoute} from "./useCategorySearchRoute";
import {OperationalStatusPanel} from "./OperationalStatusPanel";

type SettingsViewProps = {
  categories?: Category[];
  accounts?: Account[];
  connections?: Connection[];
  routeKey?: string;
  navigateSettings?: (search: URLSearchParams, history?: "push" | "replace") => void;
  onCategoriesChanged?: () => Promise<void>;
  globalPreferences?: GlobalPreferencesPanelProps;
};

export function SettingsView({categories = [], accounts = [], connections = [], routeKey = "", navigateSettings = () => undefined, onCategoriesChanged = async () => undefined, globalPreferences}: SettingsViewProps) {
  const initial = routeState(routeKey);
  const categoryRoute = useCategorySearchRoute(initial, categories);
  const routeCategories = categoryRoute.categories;
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(initial.section);
  const [classificationView, setClassificationView] = useState<ClassificationView>(initial.classification);
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSection>>(() => new Set(initial.section ? [initial.section] : []));
  const [visitedClassification, setVisitedClassification] = useState<Set<ClassificationView>>(() => new Set(initial.section === "classification" ? [initial.classification] : []));
  const [categoryIntent, setCategoryIntent] = useState<{id: number | null; token: number}>();
  const [categoryActiveOverrides, setCategoryActiveOverrides] = useState<Record<number, boolean>>({});
  const categoriesReadRef = useRef(routeCategories);
  const categoriesRef = useRef(routeCategories);
  const categoryActiveOverridesRef = useRef(categoryActiveOverrides);
  const categoryActiveRevisionRef = useRef<Record<number, number>>({});
  const categoryFreshReadsPendingRef = useRef(0);
  const returnFocusSection = useRef<SettingsSection | null>(null);
  const previousSection = useRef<SettingsSection | null>(initial.section);
  const openedFromIndex = useRef(false);
  const {imports: csvImports, status, setStatus, error, loading, load, retry} = useSettingsData(visitedSections.has("imports"));
  categoriesRef.current = routeCategories;
  const effectiveCategories = useMemo(() => routeCategories.map((category) => categoryActiveOverrides[category.id] === undefined ? category : {...category, active: categoryActiveOverrides[category.id]}), [routeCategories, categoryActiveOverrides]);

  useEffect(() => {
    if (categoriesReadRef.current === routeCategories) return;
    categoriesReadRef.current = routeCategories;
    if (categoryFreshReadsPendingRef.current) return;
    setCategoryActiveOverrides((current) => {
      const next = {...current};
      for (const [id, active] of Object.entries(current)) {
        if (routeCategories.find((category) => category.id === Number(id))?.active === active) delete next[Number(id)];
      }
      categoryActiveOverridesRef.current = next;
      return Object.entries(current).every(([id, active]) => next[Number(id)] === active) ? current : next;
    });
  }, [routeCategories]);
  useEffect(() => { categoryActiveOverridesRef.current = categoryActiveOverrides; }, [categoryActiveOverrides]);

  useEffect(() => {
    const next = routeState(routeKey);
    setActiveSection(next.section);
    setClassificationView(next.classification);
    if (next.section) setVisitedSections((current) => new Set(current).add(next.section!));
    if (next.section === "classification") setVisitedClassification((current) => new Set(current).add(next.classification));
  }, [routeKey]);

  useLayoutEffect(() => {
    if (activeSection === null) {
      const target = returnFocusSection.current || previousSection.current;
      if (target) document.querySelector<HTMLButtonElement>(indexSelector(target))?.focus({preventScroll: true});
      returnFocusSection.current = null;
      previousSection.current = null;
      openedFromIndex.current = false;
      return;
    }
    if (initial.categoryRequested) {
      if (categoryRoute.categoryId !== null) document.querySelector<HTMLElement>(`.catalog-row[data-category-id="${categoryRoute.categoryId}"]`)?.focus();
      else if (categoryRoute.status === "missing" || categoryRoute.status === "error") document.querySelector<HTMLButtonElement>("[data-category-route-recovery]")?.focus({preventScroll: true});
      previousSection.current = activeSection;
      openedFromIndex.current = false;
      return;
    }
    if (activeSection !== previousSection.current) {
      if (openedFromIndex.current) {
        const mobile = window.matchMedia?.("(max-width: 48rem)").matches;
        const target = mobile
          ? document.querySelector<HTMLButtonElement>(".settings-back")
          : document.querySelector<HTMLButtonElement>(`.settings-secondary-nav [data-settings-section="${activeSection}"]`);
        target?.focus({preventScroll: true});
        openedFromIndex.current = false;
      } else if (window.matchMedia?.("(max-width: 48rem)").matches) {
        document.querySelector<HTMLButtonElement>(".settings-back")?.focus({preventScroll: true});
      }
    }
    previousSection.current = activeSection;
  }, [activeSection, categoryRoute.categoryId, categoryRoute.status, initial.categoryRequested, routeKey]);

  const updateCategoryActive = (category: Category) => {
    const current = categoryActiveOverridesRef.current;
    categoryActiveRevisionRef.current[category.id] = (categoryActiveRevisionRef.current[category.id] || 0) + 1;
    if ((current[category.id] ?? categoriesRef.current.find((item) => item.id === category.id)?.active) === category.active) return;
    const next = {...current, [category.id]: category.active};
    categoryActiveOverridesRef.current = next;
    setCategoryActiveOverrides(next);
  };
  const refreshCategories = async () => {
    categoryFreshReadsPendingRef.current += 1;
    let refreshFailed = false;
    let refreshError: unknown;
    try {
      await onCategoriesChanged();
    } catch (error) {
      refreshFailed = true;
      refreshError = error;
    }
    const overridesAtReadStart = {...categoryActiveOverridesRef.current};
    const revisionsAtReadStart = {...categoryActiveRevisionRef.current};
    if (Object.keys(overridesAtReadStart).length) {
      try {
        const {categories: latest} = await settingsApi.categories({cache: "no-store"});
        setCategoryActiveOverrides((current) => {
          const next = {...current};
          for (const [id, activeAtReadStart] of Object.entries(overridesAtReadStart)) {
            if (current[Number(id)] !== activeAtReadStart || categoryActiveRevisionRef.current[Number(id)] !== revisionsAtReadStart[Number(id)]) continue;
            const fresh = latest.find((item) => item.id === Number(id));
            if (!fresh || categoriesRef.current.find((item) => item.id === fresh.id)?.active === fresh.active) delete next[Number(id)];
            else next[Number(id)] = fresh.active;
          }
          categoryActiveOverridesRef.current = next;
          return Object.entries(current).every(([id, active]) => next[Number(id)] === active) ? current : next;
        });
      } catch (error) {
        if (!refreshFailed) {
          refreshFailed = true;
          refreshError = error;
        }
      }
    }
    categoryFreshReadsPendingRef.current -= 1;
    if (refreshFailed) throw refreshError;
  };
  const openSection = (section: SettingsSection) => {
    const fromIndex = activeSection === null;
    if (fromIndex) {
      openedFromIndex.current = true;
      returnFocusSection.current = section;
    }
    setActiveSection(section);
    setVisitedSections((current) => new Set(current).add(section));
    if (section === "classification" && fromIndex) {
      setClassificationView("categories");
      setVisitedClassification((current) => new Set(current).add("categories"));
    }
    navigateSettings(new URLSearchParams([["settings_section", section]]), fromIndex ? "push" : "replace");
  };
  const setClassView = (view: ClassificationView) => {
    setClassificationView(view);
    setVisitedClassification((current) => new Set(current).add(view));
    const params = new URLSearchParams([["settings_section", "classification"]]);
    if (view === "rules") params.set("focus", "rules");
    navigateSettings(params, "replace");
  };
  const backToIndex = () => {
    if (activeSection) returnFocusSection.current = activeSection;
    openedFromIndex.current = false;
    setActiveSection(null);
    navigateSettings(new URLSearchParams(), "replace");
  };

  return (
    <div className="view-stack settings-view" aria-busy={activeSection === "imports" && loading}>
      <PageHeader title="Ajustes" />
      {activeSection === "imports" && error && csvImports ? <ErrorBanner message={error} /> : null}
      {status ? <StatusBanner message={status} /> : null}
      <nav className="settings-index" aria-label="Secciones de ajustes" hidden={activeSection !== null} aria-hidden={activeSection !== null} inert={activeSection !== null}>
        {sections.map((section) => (
          <button
            type="button"
            className="settings-index-link"
            data-settings-index-section={section.id}
            key={section.id}
            onClick={() => openSection(section.id)}
          >
            <span><strong>{section.title}</strong><small>{section.description}</small></span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </nav>
      <div className="settings-detail-shell" hidden={activeSection === null} aria-hidden={activeSection === null} inert={activeSection === null}>
        <Button variant="secondary" className="settings-back" onClick={backToIndex}>
          <ArrowLeft aria-hidden="true" />Volver a Ajustes
        </Button>
        <div className="settings-detail-layout">
            <nav className="settings-secondary-nav" aria-label="Secciones de ajustes">
              {sections.map((section) => (
                <button
                  type="button"
                  data-settings-section={section.id}
                  key={section.id}
                  aria-current={activeSection === section.id ? "page" : undefined}
                  onClick={() => openSection(section.id)}
                >
                  <strong>{section.title}</strong><small>{section.description}</small>
                </button>
              ))}
            </nav>
            <div className="settings-detail-content">
              {visitedSections.has("general") ? (
                <section hidden={activeSection !== "general"} aria-label="General" aria-hidden={activeSection !== "general"} inert={activeSection !== "general"}>
                  {globalPreferences ? <GlobalPreferencesPanel {...globalPreferences} /> : null}
                </section>
              ) : null}
              {visitedSections.has("classification") ? (
                <section hidden={activeSection !== "classification"} aria-label="Clasificación" aria-hidden={activeSection !== "classification"} inert={activeSection !== "classification"}>
                  <SegmentedControl className="settings-classification-switch" aria-label="Vistas de clasificación">
                    <SegmentedItem selected={classificationView === "categories"} onClick={() => setClassView("categories")}>Categorías</SegmentedItem>
                    <SegmentedItem selected={classificationView === "rules"} onClick={() => setClassView("rules")}>Reglas y sugerencias</SegmentedItem>
                  </SegmentedControl>
                  {visitedClassification.has("categories") ? (
                    <div hidden={classificationView !== "categories"} aria-hidden={classificationView !== "categories"} inert={classificationView !== "categories"} className="settings-catalog-context">
                      <h2>Categorías</h2>
                      {categoryRoute.status === "loading" ? <p className="sr-status" role="status">Cargando categoría…</p> : null}
                      {categoryRoute.status === "missing" || categoryRoute.status === "error" ? <div role="alert" className="inline-confirm"><p>{categoryRoute.status === "missing" ? "No se encontró esa categoría." : "No se pudo comprobar esa categoría."}</p><div className="inline-actions">{categoryRoute.status === "error" ? <Button variant="secondary" onClick={categoryRoute.retry}>Reintentar</Button> : null}<Button data-category-route-recovery variant="primary" onClick={() => {navigateSettings(new URLSearchParams([["settings_section", "classification"]]), "replace"); document.querySelector<HTMLElement>(".catalog-tree")?.focus({preventScroll: true});}}>Volver al catálogo</Button></div></div> : null}
                      <AdvancedCatalog
                        categories={effectiveCategories}
                        rules={[]}
                        onRefresh={refreshCategories}
                        onCategoryUpdated={updateCategoryActive}
                        setStatus={setStatus}
                        showRules={false}
                        focusCategoryId={categoryRoute.categoryId}
                        onCreateCategory={() => setCategoryIntent({id: null, token: Date.now()})}
                        onEditCategory={(category) => setCategoryIntent({id: category.id, token: Date.now()})}
                      />
                      <CategorySettingsPanels
                        categories={effectiveCategories}
                        accounts={accounts}
                        rules={[]}
                        load={refreshCategories}
                        setStatus={setStatus}
                        showCategories
                        showCategoryFormToggle={false}
                        showRules={false}
                        showCategoryList={false}
                        categoryIntent={categoryIntent}
                        onCategoryUpdated={updateCategoryActive}
                      />
                    </div>
                  ) : null}
                  {visitedClassification.has("rules") ? (
                    <div hidden={classificationView !== "rules"} aria-hidden={classificationView !== "rules"} inert={classificationView !== "rules"}>
                      <AutomationsView
                        categories={effectiveCategories}
                        accounts={accounts}
                        routeKey={routeKey}
                        embedded
                        showCategorySettings={false}
                        showCategoryList={false}
                        onCategoriesChanged={onCategoriesChanged}
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}
              {visitedSections.has("imports") ? (
                <section hidden={activeSection !== "imports"} aria-label="Importación" aria-hidden={activeSection !== "imports"} inert={activeSection !== "imports"}>
                  {csvImports ? <CsvProfilesPanel imports={csvImports} load={load} setStatus={setStatus} /> : error ? <ViewLoadError title="Importación CSV" message={error} onRetry={retry} /> : <LoadingPanel label="Cargando perfiles CSV…" />}
                </section>
              ) : null}
              {visitedSections.has("data") ? (
                <section hidden={activeSection !== "data"} aria-label="Datos y recuperación" aria-hidden={activeSection !== "data"} inert={activeSection !== "data"}>
                  <OperationalStatusPanel connections={connections} /><OfflineDataPanel setStatus={setStatus} /><RecoveryPanel />
                </section>
              ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}
