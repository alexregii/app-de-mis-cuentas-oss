export type SettingsSection = "general" | "classification" | "imports" | "data";
export type ClassificationView = "categories" | "rules";
export type SettingsRouteState = {section: SettingsSection | null; classification: ClassificationView; categoryRequested: boolean; categoryId: number | null};

export const sections: Array<{id: SettingsSection; title: string; description: string}> = [
  {id: "general", title: "General", description: "Apariencia y privacidad"},
  {id: "classification", title: "Clasificación", description: "Categorías, reglas y sugerencias"},
  {id: "imports", title: "Importación", description: "Perfiles para archivos CSV"},
  {id: "data", title: "Datos y recuperación", description: "Conexión, copias y restauración"},
];

export function routeState(routeKey: string): SettingsRouteState {
  const search = new URL(routeKey || window.location.href).searchParams;
  const rule = search.get("rule");
  const categories = search.getAll("category");
  const categoryRequested = categories.length > 0;
  const rawCategoryId = categories.length === 1 ? categories[0] : "";
  const parsedCategoryId = /^\d+$/.test(rawCategoryId) ? Number(rawCategoryId) : NaN;
  const categoryId = Number.isSafeInteger(parsedCategoryId) && parsedCategoryId > 0 ? parsedCategoryId : null;
  const focuses = search.getAll("focus");
  const hasRule = rule !== null && /^\d+$/.test(rule);
  const classification = hasRule || focuses.includes("new-rule") || focuses.includes("rules") ? "rules" : "categories";
  if (hasRule || focuses.includes("new-rule") || focuses.includes("rules")) return {section: "classification", classification, categoryRequested: false, categoryId: null};
  if (categoryRequested) return {section: "classification", classification: "categories", categoryRequested, categoryId};
  const value = search.get("settings_section");
  return {section: sections.find((item) => item.id === value)?.id || null, classification, categoryRequested: false, categoryId: null};
}

export function indexSelector(section: SettingsSection) {
  return `[data-settings-index-section="${section}"]`;
}
