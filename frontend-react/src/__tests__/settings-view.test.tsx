import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {AdvancedCatalog} from "../features/settings/AdvancedCatalog";
import {AutomationsView} from "../features/settings/AutomationsView";
import {CategorySettingsPanels} from "../features/settings/CategorySettingsPanels";
import {CsvProfilesPanel} from "../features/settings/CsvProfilesPanel";
import {SettingsView} from "../features/settings/SettingsView";
import type {AutomationSettings, CategoryRule, CategoryRuleApplication} from "../features/settings/types";
import type {Account, Connection} from "../shared/model/accounts";
import type {Category} from "../shared/model/categories";
import type {ImportPayload} from "../shared/model/imports";
import type {AppPreferences} from "../app/preferences/appPreferences";
import {setPrivacyMode} from "../shared/lib/privacy";

const apiMock = vi.hoisted(() => ({
  applyCategoryRule: vi.fn(),
  automation: vi.fn(),
  categories: vi.fn(),
  categoryDuplicates: vi.fn(),
  categoryOrder: vi.fn(),
  categoryRules: vi.fn(),
  categoryRuleConflicts: vi.fn(),
  categoryRuleApplications: vi.fn(),
  categoryUnused: vi.fn(),
  createCategory: vi.fn(),
  createCategoryRule: vi.fn(),
  createImportProfile: vi.fn(),
  createBackup: vi.fn(),
  deactivateCategory: vi.fn(),
  deleteCategoryRule: vi.fn(),
  imports: vi.fn(),
  previewCategoryRule: vi.fn(),
  previewDeactivateCategory: vi.fn(),
  previewRestore: vi.fn(),
  recovery: vi.fn(),
  runtimeHealth: vi.fn(),
  restore: vi.fn(),
  updateAutomation: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryRule: vi.fn(),
  undoCategoryRule: vi.fn(),
  uploadImport: vi.fn(),
}));

vi.mock("../features/settings/api", () => ({settingsApi: apiMock}));
vi.mock("../shared/api/imports", () => ({importsApi: apiMock}));

beforeEach(() => {
  vi.resetAllMocks();
  setPrivacyMode(false);
  apiMock.categoryRuleApplications.mockResolvedValue({applications: [], next_offset: null});
});

afterEach(() => setPrivacyMode(false));

Object.defineProperty(window, "scrollTo", {value: vi.fn(), writable: true});

const bankConnection: Connection = {
  id: 8,
  bank_name: "Banco principal",
  bank_country: "ES",
  status: "authorized",
  status_display: "Autorizada",
  sync_status: "idle",
  sync_status_display: "Sincronizada",
  sync_started_at: "",
  sync_started_at_display: "",
  last_synced_at: "2026-10-20T10:00:00Z",
  last_synced_at_display: "20/10/2026 10:00",
  last_error: "",
  authorized_until: "",
  accounts: [],
};

const account: Account = {
  id: 1,
  name: "Cuenta diaria",
  kind: "checking",
  kind_display: "Cuenta corriente",
  balance: 1250,
  opening_balance: 1000,
  color: "#3478f6",
  active: true,
  bank_link: null,
};

const category: Category = {
  id: 2,
  name: "Comida",
  display_name: "Comida",
  kind: "expense",
  color: "#ff9500",
  icon: "",
  active: true,
  parent_id: null,
  exclude_from_analytics: false,
  sort_order: 1,
  is_favorite: false,
  transaction_count: 4,
  child_count: 0,
};

const secondCategory: Category = {...category, id: 4, name: "Hogar", display_name: "Hogar", sort_order: 2};

const rule: CategoryRule = {
  id: 3,
  description: "Supermercado",
  kind: "expense",
  category,
  active: true,
  updated_at: "2026-07-01T00:00:00Z",
  priority: 1,
  match_mode: "contains",
  account: null,
  amount_min: null,
  amount_max: null,
  last_tested_at: "",
  last_test_result: {},
  application_count: 0,
};

const automation: AutomationSettings = {
  id: 1,
  llm_enabled: false,
  auto_apply_enabled: false,
  auto_apply_effective: false,
  promotion_status: "NO_PROMOTION",
  confidence_threshold: 0.8,
  updated_at: "2026-07-01T00:00:00Z",
};

const imports: ImportPayload = {
  profiles: [],
  default_profile_id: 0,
  batches: [],
  accounts: [account],
};

const csvProfile: ImportPayload["profiles"][number] = {
  id: 5,
  name: "Extracto de pruebas",
  delimiter: ",",
  date_format: "%Y-%m-%d",
  date_column: "date",
  description_column: "description",
  amount_column: "amount",
  category_column: "category",
  subcategory_column: "subcategory",
};

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/?tab=settings");
    apiMock.automation.mockResolvedValue({ok: true, automation});
    apiMock.categories.mockResolvedValue({categories: [category], roots: [{...category, children: []}]});
    apiMock.categoryRules.mockResolvedValue({rules: [rule]});
    apiMock.categoryRuleConflicts.mockResolvedValue({conflicts: []});
    apiMock.imports.mockResolvedValue(imports);
    apiMock.runtimeHealth.mockResolvedValue({status: "ok", date: "2026-10-21"});
    apiMock.recovery.mockResolvedValue({ok: true, latest_backup: null, backup_status: {
  worker: "healthy",
  schedule: "missing",
  heartbeat_at: "2026-10-21T10:00:00Z",
  last_failure_at: null,
  last_success_at: null,
}, restore: {available: true, status: null}});
  });

  it("separa la respuesta HTTP de la frescura bancaria y no muestra errores del proveedor", async () => {
    const rawProviderError = "Bearer SECRET_TOKEN from provider.internal";
    render(<SettingsView connections={[{...bankConnection, last_error: rawProviderError}]} />);
    fireEvent.click(screen.getByRole("button", {name: /Datos y recuperación/}));

    expect(await screen.findByText("Disponible")).toBeInTheDocument();
    expect(screen.getByText("Servicio HTTP")).toBeInTheDocument();
    expect(screen.getByText("Frescura bancaria")).toBeInTheDocument();
    expect(screen.getByText("Una conexión requiere revisión")).toBeInTheDocument();
    expect(screen.getByText(/Última sincronización completada: 20\/10\/2026 10:00/)).toBeInTheDocument();
    expect(screen.queryByText(rawProviderError)).not.toBeInTheDocument();
  });

  it("mantiene separada la fecha bancaria cuando el health HTTP falla y permite reintentar", async () => {
    const rawProviderError = "Bearer SECRET_TOKEN from provider.internal";
    apiMock.runtimeHealth.mockRejectedValueOnce(new Error(rawProviderError)).mockResolvedValueOnce({status: "ok", date: "2026-10-21"});
    render(<SettingsView connections={[bankConnection]} />);
    fireEvent.click(screen.getByRole("button", {name: /Datos y recuperación/}));

    expect(await screen.findByText("No se pudo comprobar")).toBeInTheDocument();
    expect(screen.getByText("20/10/2026 10:00")).toBeInTheDocument();
    expect(screen.queryByText(rawProviderError)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Reintentar comprobación"}));
    expect(await screen.findByText("Disponible")).toBeInTheDocument();
  });

  it("muestra cuatro destinos compactos y carga perfiles solo al entrar en Importación", async () => {
    render(<SettingsView categories={[category]} />);
    expect(await screen.findByRole("heading", {name: "Ajustes"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: /General/})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Clasificación/})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Importación/})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Datos y recuperación/})).toBeInTheDocument();
    expect(screen.queryByLabelText("Porcentaje")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Archivo CSV")).not.toBeInTheDocument();
    expect(apiMock.imports).not.toHaveBeenCalled();
    expect(apiMock.automation).not.toHaveBeenCalled();
    expect(apiMock.recovery).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: /Importación/}));
    expect(await screen.findByRole("button", {name: /perfiles csv/i})).toBeInTheDocument();
    await waitFor(() => expect(apiMock.imports).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText("Archivo CSV")).not.toBeInTheDocument();
  });
  it("sincroniza los destinos internos y devuelve foco al índice", async () => {
    const navigateSettings = vi.fn();
    render(<SettingsView navigateSettings={navigateSettings} />);
    fireEvent.click(screen.getByRole("button", {name: /Importación/}));
    expect(navigateSettings.mock.calls[0][0].toString()).toBe("settings_section=imports");
    expect(navigateSettings.mock.calls[0][1]).toBe("push");

    const secondary = screen.getByRole("navigation", {name: "Secciones de ajustes"});
    fireEvent.click(within(secondary).getByRole("button", {name: /Datos y recuperación/}));
    expect(navigateSettings.mock.calls[1][0].toString()).toBe("settings_section=data");
    expect(navigateSettings.mock.calls[1][1]).toBe("replace");

    fireEvent.click(screen.getByRole("button", {name: "Volver a Ajustes"}));
    expect(navigateSettings.mock.calls[2][0].toString()).toBe("");
    expect(navigateSettings.mock.calls[2][1]).toBe("replace");
    expect(screen.getByRole("button", {name: /Datos y recuperación/})).toHaveFocus();
  });

  it("un enlace de regla prevalece a una sección contradictoria y abre el ID pedido", async () => {
    window.history.replaceState({}, "", "/?tab=automations&settings_section=data&focus=new-rule&focus=rules&rule=3");
    render(<SettingsView categories={[category]} accounts={[account]} />);
    const description = await screen.findByLabelText("Texto a reconocer");
    expect(description).toHaveValue("Supermercado");
    expect(description).toHaveFocus();
    expect(screen.queryByRole("heading", {name: "Datos y recuperación"})).not.toBeInTheDocument();
  });

  it("un ID de regla inexistente conserva la lista y muestra un aviso sin crear otra", async () => {
    window.history.replaceState({}, "", "/?tab=settings&settings_section=general&focus=new-rule&rule=999");
    render(<SettingsView categories={[category]} accounts={[account]} />);
    expect(await screen.findByText("Regla no disponible")).toBeInTheDocument();
    expect(screen.queryByLabelText("Texto a reconocer")).not.toBeInTheDocument();
    expect(await screen.findByText("Si la descripción contiene “Supermercado” → Comida")).toBeInTheDocument();
  });

  it("resuelve y enfoca el ID exacto de una categoría inactiva fuera del bootstrap", async () => {
    const inactive = {...category, id: 9, name: "Archivada", display_name: "Archivada", active: false};
    apiMock.categories.mockResolvedValueOnce({categories: [inactive], roots: [{...inactive, children: []}]});
    window.history.replaceState({}, "", `/?tab=settings&settings_section=general&category=${inactive.id}`);

    render(<SettingsView categories={[category]} accounts={[account]} />);

    const row = (await screen.findByText("Archivada")).closest<HTMLElement>(".catalog-row");
    expect(row).not.toBeNull();
    expect(row).toBeVisible();
    expect(row).toHaveAttribute("aria-current", "location");
    expect(row).toHaveFocus();
    expect(apiMock.categories).toHaveBeenCalledWith({cache: "no-store"});
    expect(screen.getByRole("heading", {name: "Categorías"})).toBeVisible();
  });

  it("un ID de categoría inexistente ofrece recuperación al catálogo", async () => {
    const navigateSettings = vi.fn();
    window.history.replaceState({}, "", "/?tab=settings&category=9999");
    render(<SettingsView categories={[category]} navigateSettings={navigateSettings} />);

    const recovery = await screen.findByRole("button", {name: "Volver al catálogo"});
    expect(screen.getByText("No se encontró esa categoría.")).toBeVisible();
    expect(recovery).toHaveFocus();
    fireEvent.click(recovery);

    expect(navigateSettings).toHaveBeenCalledWith(new URLSearchParams([["settings_section", "classification"]]), "replace");
  });

  it("usa push al entrar en un destino y replace al cambiar y volver", async () => {
    const navigateSettings = vi.fn();
    render(<SettingsView navigateSettings={navigateSettings} />);
    fireEvent.click(screen.getByRole("button", {name: /Importación/}));
    expect(navigateSettings.mock.calls[0][0].toString()).toBe("settings_section=imports");
    expect(navigateSettings.mock.calls[0][1]).toBe("push");

    const secondary = screen.getByRole("navigation", {name: "Secciones de ajustes"});
    fireEvent.click(within(secondary).getByRole("button", {name: /Datos y recuperación/}));
    expect(navigateSettings.mock.calls[1][0].toString()).toBe("settings_section=data");
    expect(navigateSettings.mock.calls[1][1]).toBe("replace");

    fireEvent.click(screen.getByRole("button", {name: "Volver a Ajustes"}));
    expect(navigateSettings.mock.calls[2][0].toString()).toBe("");
    expect(navigateSettings.mock.calls[2][1]).toBe("replace");
    expect(screen.getByRole("button", {name: /Datos y recuperación/})).toHaveFocus();
  });

  it("prioriza un deep-link de regla ante una subsección contradictoria", async () => {
    window.history.replaceState({}, "", "/?tab=automations&settings_section=data&focus=new-rule&focus=rules&rule=3");
    render(<SettingsView categories={[category]} accounts={[account]} />);

    const description = await screen.findByLabelText("Texto a reconocer");
    expect(description).toHaveValue("Supermercado");
    expect(description).toHaveFocus();
    expect(screen.queryByRole("heading", {name: "Datos y recuperación"})).not.toBeInTheDocument();
  });

  it("muestra aviso y listado para un ID de regla inexistente sin abrir creación", async () => {
    window.history.replaceState({}, "", "/?tab=settings&settings_section=general&focus=new-rule&rule=999");
    render(<SettingsView categories={[category]} accounts={[account]} />);

    expect(await screen.findByText("Regla no disponible")).toBeInTheDocument();
    expect(screen.queryByLabelText("Texto a reconocer")).not.toBeInTheDocument();
    expect(await screen.findByText("Si la descripción contiene “Supermercado” → Comida")).toBeInTheDocument();
  });

  it("mantiene el borrador de categoría al alternar entre vistas de Clasificación", async () => {
    render(<SettingsView categories={[category]} />);
    fireEvent.click(screen.getByRole("button", {name: /Clasificación/}));
    fireEvent.click(await screen.findByRole("button", {name: "Nueva categoría"}));
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, {target: {value: "Casa nueva"}});

    fireEvent.click(screen.getByRole("button", {name: "Reglas y sugerencias"}));
    expect(await screen.findByLabelText("IA para sugerencias")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Categorías"}));

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Casa nueva");
    expect(screen.getAllByRole("region", {name: "Árbol de categorías"})).toHaveLength(1);
  });

  it("conserva una aplicación histórica y su deshacer al volver al índice", async () => {
    apiMock.previewCategoryRule.mockResolvedValue({ok: true, result: {transactions: 1, bank_rows: 0, csv_rows: 0, total: 1, changes: 1, already_categorized: 0, examples: []}});
    apiMock.applyCategoryRule.mockResolvedValue({ok: true, result: {application_id: 9, transactions: 1, bank_rows: 0, csv_rows: 0, total: 1}});
    render(<SettingsView categories={[category]} accounts={[account]} />);
    fireEvent.click(screen.getByRole("button", {name: /Clasificación/}));
    fireEvent.click(screen.getByRole("button", {name: "Reglas y sugerencias"}));
    const rulesHeading = await screen.findByRole("heading", {name: "Sugerencias y aplicación"});
    expect(rulesHeading).toBeInTheDocument();
    const rules = within(rulesHeading.closest(".settings-category-rules-section") as HTMLElement);
    const ruleList = document.querySelector(".automation-rule-list") as HTMLElement;
    fireEvent.click(within(ruleList).getByRole("button", {name: "Expandir"}));
    fireEvent.click(rules.getByRole("button", {name: "Probar"}));
    fireEvent.click(await rules.findByRole("button", {name: "Aplicar cambios"}));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Aplicar cambios"}));
    expect(await rules.findByRole("button", {name: "Deshacer aplicación"})).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Volver a Ajustes"}));
    fireEvent.click(screen.getByRole("button", {name: /Clasificación/}));
    fireEvent.click(await screen.findByRole("button", {name: "Reglas y sugerencias"}));

    expect(await rules.findByRole("heading", {name: "Regla aplicada"})).toBeInTheDocument();
    expect(rules.getByRole("button", {name: "Deshacer aplicación"})).toBeInTheDocument();
    expect(apiMock.applyCategoryRule).toHaveBeenCalledOnce();
  });

  it("permite editar categorías desde el único árbol del destino", async () => {
    render(<SettingsView categories={[category]} />);
    fireEvent.click(screen.getByRole("button", {name: /Clasificación/}));
    fireEvent.click(await screen.findByRole("button", {name: "Acciones de Comida"}));
    fireEvent.click(screen.getByRole("button", {name: "Editar"}));

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Comida");
    expect(screen.getAllByRole("region", {name: "Árbol de categorías"})).toHaveLength(1);
    expect(screen.queryByText("Catálogo avanzado")).not.toBeInTheDocument();
  });

  it("recarga las categorías globales después de crear una categoría en Ajustes", async () => {
    const onCategoriesChanged = vi.fn(async () => undefined);
    apiMock.createCategory.mockResolvedValue({ok: true, category: {...category, id: 8, name: "Hogar", display_name: "Hogar"}});
    render(<SettingsView categories={[category]} onCategoriesChanged={onCategoriesChanged} />);
    expect(await screen.findByRole("heading", {name: "Ajustes"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: /Clasificación/}));

    fireEvent.click(await screen.findByRole("button", {name: "Nueva categoría"}));
    fireEvent.change(await screen.findByLabelText("Nombre"), {target: {value: "Hogar"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar categoría"}));

    await waitFor(() => expect(apiMock.createCategory).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCategoriesChanged).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("Categoría creada.");
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
  });

  it("mantiene disponible el índice y permite reintentar la carga de perfiles", async () => {
    apiMock.imports.mockRejectedValueOnce(new Error("Perfiles no disponibles"));
    render(<SettingsView />);
    expect(await screen.findByRole("heading", {name: "Ajustes"})).toBeInTheDocument();
    expect(apiMock.imports).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: /Importación/}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Perfiles no disponibles");
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));
    expect(await screen.findByRole("button", {name: /perfiles csv/i})).toBeInTheDocument();
    expect(apiMock.imports).toHaveBeenCalledTimes(2);
  });
  it("integra preferencias globales sin alterar los ajustes de dominio", async () => {
    let preferences: AppPreferences = {theme: "mineral", privacyMode: false};
    const onChange = vi.fn(async (next: AppPreferences) => {
      preferences = next;
      return {preferences: next, persisted: true};
    });
    const {rerender} = render(<SettingsView categories={[category]} globalPreferences={{preferences, onChange}} />);
    fireEvent.click(screen.getByRole("button", {name: /General/}));

    expect(await screen.findByRole("heading", {name: "Apariencia y privacidad"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Basalt"}));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({theme: "basalt", privacyMode: false}));
    rerender(<SettingsView categories={[category]} globalPreferences={{preferences, onChange}} />);
    expect(screen.getByRole("button", {name: "Basalt"})).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("status")).toHaveTextContent("Preferencias guardadas en este dispositivo.");

    fireEvent.click(screen.getByRole("button", {name: "Ocultar"}));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({theme: "basalt", privacyMode: true}));
    expect(screen.queryByText("Objetivo de ahorro")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Clasificación/})).toBeInTheDocument();
  });

  it("retiene el foco de preferencias globales mientras guarda y evita activaciones repetidas", async () => {
    const preferences: AppPreferences = {theme: "mineral", privacyMode: false};
    let finishWrite!: () => void;
    const onChange = vi.fn((next: AppPreferences) => new Promise<{preferences: AppPreferences; persisted: boolean}>((resolve) => {
      finishWrite = () => resolve({preferences: next, persisted: true});
    }));
    render(<SettingsView globalPreferences={{preferences, onChange}} />);
    fireEvent.click(screen.getByRole("button", {name: /General/}));

    expect(await screen.findByRole("heading", {name: "Apariencia y privacidad"})).toBeInTheDocument();
    const basalt = screen.getByRole("button", {name: "Basalt"});
    basalt.focus();
    fireEvent.click(basalt);
    try {
      await waitFor(() => expect(basalt).toHaveAttribute("aria-disabled", "true"));
      expect(basalt).toHaveAttribute("aria-busy", "true");
      expect(basalt).not.toBeDisabled();
      expect(basalt).toHaveFocus();
      fireEvent.click(basalt);
      expect(onChange).toHaveBeenCalledOnce();
    } finally {
      await act(async () => {finishWrite?.();});
    }

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preferencias guardadas en este dispositivo."));
    expect(basalt).toHaveFocus();
  });

  it("expone el fallo de persistencia sin bloquear el cambio de sesión", async () => {
    let preferences: AppPreferences = {theme: "mineral", privacyMode: false};
    const onChange = vi.fn(async (next: AppPreferences) => {
      preferences = next;
      return {preferences: next, persisted: false};
    });
    const {rerender} = render(<SettingsView globalPreferences={{preferences, onChange}} />);
    fireEvent.click(screen.getByRole("button", {name: /General/}));

    expect(await screen.findByRole("heading", {name: "Apariencia y privacidad"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Ocultar"}));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({theme: "mineral", privacyMode: true}));
    rerender(<SettingsView globalPreferences={{preferences, onChange}} />);

    expect(screen.getByRole("button", {name: "Ocultar"})).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("alert")).toHaveTextContent("El cambio se mantiene durante esta sesión");
  });


});

describe("CsvProfilesPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exige nombre y campos de mapeo obligatorios antes de guardar", async () => {
    render(<CsvProfilesPanel imports={imports} load={vi.fn(async () => undefined)} setStatus={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir perfiles csv"}));

    expect(await screen.findByLabelText("Nombre")).toBeRequired();
    expect(screen.getByLabelText("Separador")).toBeRequired();
    expect(screen.getByLabelText("Formato fecha")).toBeRequired();
    expect(screen.getByLabelText("Columna fecha")).toBeRequired();
    expect(screen.getByLabelText("Columna concepto")).toBeRequired();
    expect(screen.getByLabelText("Columna importe")).toBeRequired();
    expect(screen.getByRole("button", {name: "Guardar perfil"})).toBeDisabled();
    expect(apiMock.createImportProfile).not.toHaveBeenCalled();
  });

  it("bloquea ediciones duplicadas mientras crea un perfil y restablece el formulario al completar", async () => {
    let completeCreate!: () => void;
    const setStatus = vi.fn();
    const load = vi.fn(async () => undefined);
    apiMock.createImportProfile.mockImplementation(() => new Promise((resolve) => {
      completeCreate = () => resolve({ok: true, profile: csvProfile});
    }));
    render(<CsvProfilesPanel imports={imports} load={load} setStatus={setStatus} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir perfiles csv"}));
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, {target: {value: "Perfil nuevo"}});
    const save = screen.getByRole("button", {name: "Guardar perfil"});
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(apiMock.createImportProfile).toHaveBeenCalledOnce());
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    expect(save).toHaveTextContent("Guardando perfil");
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    fireEvent.click(save);
    expect(apiMock.createImportProfile).toHaveBeenCalledOnce();
    completeCreate();

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Perfil CSV creado."));
    expect(load).toHaveBeenCalledOnce();
    await waitFor(() => expect(name).toHaveValue(""));
    await waitFor(() => expect(name).toHaveFocus());
    expect(screen.getByRole("button", {name: "Guardar perfil"})).toBeDisabled();
  });

  it("presenta el rechazo del servidor y conserva los datos para corregir y reintentar", async () => {
    apiMock.createImportProfile.mockRejectedValueOnce(new Error("Ya existe un perfil con ese nombre."));
    render(<CsvProfilesPanel imports={imports} load={vi.fn(async () => undefined)} setStatus={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir perfiles csv"}));
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, {target: {value: "Perfil duplicado"}});
    const save = screen.getByRole("button", {name: "Guardar perfil"});
    save.focus();
    fireEvent.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un perfil con ese nombre.");
    expect(name).toHaveValue("Perfil duplicado");
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
  });

  it("distingue el perfil creado de un fallo al refrescar la lista y evita repetir el POST", async () => {
    const setStatus = vi.fn();
    const load = vi.fn().mockRejectedValue(new Error("El refresco falló."));
    apiMock.createImportProfile.mockResolvedValue({ok: true, profile: csvProfile});
    render(<CsvProfilesPanel imports={imports} load={load} setStatus={setStatus} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir perfiles csv"}));
    fireEvent.change(await screen.findByLabelText("Nombre"), {target: {value: "Perfil guardado"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar perfil"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("El perfil se creó, pero no se pudo actualizar la lista.");
    expect(setStatus).toHaveBeenCalledWith("Perfil CSV creado.");
    expect(apiMock.createImportProfile).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByRole("button", {name: "Guardar perfil"})).toBeDisabled();
  });

  it("crea un perfil desde el estado vacío y presenta el perfil y lote recibidos", async () => {
    const load = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const profile = {
      id: 10,
      name: "Extracto banco",
      delimiter: ";",
      date_format: "%d/%m/%Y",
      date_column: "fecha",
      description_column: "concepto",
      amount_column: "importe",
      category_column: "categoria",
      subcategory_column: "subcategoria",
    };
    apiMock.createImportProfile.mockResolvedValue({ok: true, profile});
    const {rerender} = render(<CsvProfilesPanel imports={{...imports, profiles: [], batches: []}} load={load} setStatus={setStatus} />);

    expect(screen.getByText("0 perfiles guardados")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Expandir perfiles csv"}));
    fireEvent.change(await screen.findByLabelText("Nombre"), {target: {value: profile.name}});
    fireEvent.change(screen.getByLabelText("Separador"), {target: {value: profile.delimiter}});
    fireEvent.change(screen.getByLabelText("Formato fecha"), {target: {value: profile.date_format}});
    fireEvent.change(screen.getByLabelText("Columna fecha"), {target: {value: profile.date_column}});
    fireEvent.change(screen.getByLabelText("Columna concepto"), {target: {value: profile.description_column}});
    fireEvent.change(screen.getByLabelText("Columna importe"), {target: {value: profile.amount_column}});
    fireEvent.change(screen.getByLabelText("Columna categoría"), {target: {value: profile.category_column}});
    fireEvent.change(screen.getByLabelText("Columna subcategoría"), {target: {value: profile.subcategory_column}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar perfil"}));

    await waitFor(() => expect(apiMock.createImportProfile).toHaveBeenCalledWith({
      name: "Extracto banco",
      delimiter: ";",
      date_format: "%d/%m/%Y",
      date_column: "fecha",
      description_column: "concepto",
      amount_column: "importe",
      category_column: "categoria",
      subcategory_column: "subcategoria",
    }));
    expect(setStatus).toHaveBeenCalledWith("Perfil CSV creado.");
    expect(load).toHaveBeenCalledOnce();

    const batch = {id: 21, filename: "septiembre.csv", account, profile, status: "pending", status_display: "Pendiente", created_at: "2026-09-24T00:00:00Z", pending_count: 2, row_count: 2};
    rerender(<CsvProfilesPanel imports={{...imports, profiles: [profile], batches: [batch]}} load={load} setStatus={setStatus} />);
    fireEvent.click(screen.getByRole("button", {name: "Comprimir perfiles csv"}));
    expect(await screen.findByText("1 perfil guardado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Expandir perfiles csv"}));
    expect(await screen.findByText("Extracto banco")).toBeInTheDocument();
    expect(screen.getByText("fecha · concepto · importe")).toBeInTheDocument();
    expect(screen.queryByText("septiembre.csv")).not.toBeInTheDocument();
  });
});

describe("AdvancedCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/?tab=settings");
    apiMock.updateCategory.mockResolvedValue({ok: true, category});
    apiMock.previewDeactivateCategory.mockResolvedValue({
      ok: true,
      impact: {transactions: 4, budgets: 1, rules: 1, imports: 0},
    });
    apiMock.deactivateCategory.mockResolvedValue({ok: true, category: {...category, active: false}});
    apiMock.previewCategoryRule.mockResolvedValue({ok: true, result: {transactions: 1, bank_rows: 1, csv_rows: 1, total: 3, changes: 2, already_categorized: 1, examples: [{description: "Supermercado", amount: ""}]}});
    apiMock.applyCategoryRule.mockResolvedValue({ok: true, result: {application_id: 7, transactions: 1, bank_rows: 1, csv_rows: 1, total: 3}});
    apiMock.undoCategoryRule.mockResolvedValue({ok: true, partial: false});
  });

  it("redacta los límites monetarios de una regla con privacidad activa", () => {
    const protectedRule = {...rule, description: "Regla protegida", amount_min: 12.34, amount_max: 45.67};
    const commonProps = {categories: [category], rules: [protectedRule], onRefresh: vi.fn(async () => undefined), setStatus: vi.fn()};

    setPrivacyMode(false);
    const visibleView = render(<AdvancedCatalog {...commonProps} />);
    expect(screen.getByText("Regla protegida").closest(".rule-row")).toHaveTextContent(/12,34.*45,67/u);
    visibleView.unmount();

    setPrivacyMode(true);
    render(<AdvancedCatalog {...commonProps} />);
    const ruleRow = screen.getByText("Regla protegida").closest(".rule-row");
    expect(ruleRow).toHaveTextContent("•••• €");
    expect(ruleRow).not.toHaveTextContent(/12,34|45,67/u);
  });

  it("aplica los filtros activo, inactivo, favorito, sin uso y todas", () => {
    const favorite = {...secondCategory, id: 5, name: "Favorita", display_name: "Favorita", is_favorite: true, transaction_count: 2};
    const inactive = {...secondCategory, id: 6, name: "Inactiva", display_name: "Inactiva", active: false, transaction_count: 1};
    const unused = {...secondCategory, id: 7, name: "Sin uso", display_name: "Sin uso", transaction_count: 0, child_count: 0};
    render(<AdvancedCatalog categories={[category, favorite, inactive, unused]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);

    expect(screen.getByText("Comida")).toBeInTheDocument();
    expect(screen.getByText("Favorita")).toBeInTheDocument();
    expect(screen.queryByText("Inactiva")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Inactivas"}));
    expect(screen.getAllByText("Inactiva")).toHaveLength(1);
    expect(screen.queryByText("Comida")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Favoritas"}));
    expect(screen.getByText("Favorita")).toBeInTheDocument();
    expect(screen.queryByText("Inactiva")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Sin uso"}));
    expect(screen.getAllByText("Sin uso")).toHaveLength(2);
    expect(screen.queryByText("Comida")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Todas"}));
    expect(screen.getByText("Comida")).toBeInTheDocument();
    expect(screen.getByText("Favorita")).toBeInTheDocument();
    expect(screen.getAllByText("Inactiva")).toHaveLength(1);
    expect(screen.getAllByText("Sin uso")).toHaveLength(2);
  });

  it("busca categorías y comunica el resultado vacío", () => {
    render(<AdvancedCatalog categories={[category, secondCategory]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);
    const search = screen.getByLabelText("Buscar categorías");

    fireEvent.change(search, {target: {value: "Hogar"}});
    expect(screen.getByText("Hogar")).toBeInTheDocument();
    expect(screen.queryByText("Comida")).not.toBeInTheDocument();
    fireEvent.change(search, {target: {value: "No existe"}});
    expect(screen.getByText("No hay categorías para este filtro.")).toBeInTheDocument();
  });

  it("presenta subcategorías anidadas bajo su categoría principal", () => {
    const child = {...secondCategory, id: 5, name: "Gas", display_name: "Comida · Gas", parent_id: category.id, transaction_count: 0, child_count: 0};
    render(<AdvancedCatalog categories={[category, child]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);

    const rows = document.querySelectorAll(".catalog-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Comida");
    expect(rows[1]).toHaveTextContent("Gas");
    expect(rows[1]).toHaveStyle({"--catalog-depth": "1"});
  });

  it("mantiene visible una subcategoría coincidente aunque su principal quede fuera del filtro", () => {
    const child = {...secondCategory, id: 5, name: "Gas", display_name: "Comida · Gas", parent_id: category.id, transaction_count: 0, child_count: 0};
    render(<AdvancedCatalog categories={[category, child]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Sin uso"}));

    const rows = document.querySelectorAll(".catalog-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Gas");
    expect(rows[0]).toHaveTextContent("Dentro de Comida");
    expect(rows[0]).toHaveStyle({"--catalog-depth": "1"});
  });

  it("mantiene favoritas y la confirmación previa a desactivar", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);
    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;

    fireEvent.click(screen.getByRole("button", {name: "Marcar Comida como favorita"}));
    await waitFor(() => expect(apiMock.updateCategory).toHaveBeenCalledWith(2, {is_favorite: true}));
    await waitFor(() => expect(within(categoryRow).getByRole("status")).toHaveTextContent("Categoría marcada como favorita."));
    expect(setStatus).not.toHaveBeenCalledWith("Categoría marcada como favorita.");

    fireEvent.click(within(categoryRow).getByRole("button", {name: "Acciones de Comida"}));
    const deactivate = within(categoryRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    expect(await screen.findByText("Desactivar «Comida»?")).toBeInTheDocument();
    expect(screen.getByText("4 movimientos · 1 presupuesto · 1 regla · 0 importaciones")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Confirmar desactivación"}));

    await waitFor(() => expect(apiMock.deactivateCategory).toHaveBeenCalledWith(2));
    await waitFor(() => expect(within(screen.getByRole("region", {name: "Árbol de categorías"})).getByRole("status")).toHaveTextContent("Categoría desactivada; el histórico se conserva."));
    expect(setStatus).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("al quitar la última favorita transfiere el foco al árbol y anuncia el resultado allí", async () => {
    const favoriteCategory = {...category, is_favorite: true};
    const setStatus = vi.fn();
    let view!: ReturnType<typeof render>;
    const onRefresh = vi.fn(async () => {
      await act(async () => {
        view.rerender(<AdvancedCatalog categories={[]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);
      });
    });
    view = render(<AdvancedCatalog categories={[favoriteCategory]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);

    fireEvent.click(screen.getByRole("button", {name: "Favoritas"}));
    const favoriteButton = screen.getByRole("button", {name: "Quitar Comida de favoritas"});
    favoriteButton.focus();
    fireEvent.click(favoriteButton);

    const tree = screen.getByRole("region", {name: "Árbol de categorías"});
    await waitFor(() => expect(tree).toHaveFocus());
    expect(await screen.findByText("Categoría retirada de favoritas.")).toBeInTheDocument();
    expect(within(tree).getByRole("status")).toHaveTextContent("Categoría retirada de favoritas.");
    expect(screen.getByText("No hay categorías para este filtro.")).toBeInTheDocument();
    expect(favoriteButton).not.toBeInTheDocument();
    expect(apiMock.updateCategory).toHaveBeenCalledWith(category.id, {is_favorite: false});
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("bloquea cambios de favorita mientras se guardan y presenta errores sin perder el estado", async () => {
    let finishUpdate!: (value: {ok: true; category: Category}) => void;
    apiMock.updateCategory.mockImplementationOnce(() => new Promise((resolve) => {finishUpdate = resolve;}));
    const setStatus = vi.fn();
    const onRefresh = vi.fn().mockRejectedValueOnce(new Error("Refresh agotado."));
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);
    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;
    const favoriteButton = screen.getByRole("button", {name: "Marcar Comida como favorita"});

    favoriteButton.focus();
    fireEvent.click(favoriteButton);
    expect(favoriteButton).toHaveAttribute("aria-disabled", "true");
    expect(favoriteButton).toHaveAttribute("aria-busy", "true");
    expect(favoriteButton).not.toBeDisabled();
    expect(favoriteButton).toHaveFocus();
    fireEvent.click(favoriteButton);
    expect(apiMock.updateCategory).toHaveBeenCalledOnce();
    finishUpdate({ok: true, category: {...category, is_favorite: true}});
    await waitFor(() => expect(within(categoryRow).getByRole("alert")).toHaveTextContent("La categoría se actualizó, pero no se pudo refrescar la lista."));
    await waitFor(() => expect(favoriteButton).toHaveFocus());

    apiMock.updateCategory.mockRejectedValueOnce(new Error("Guardado rechazado."));
    fireEvent.click(favoriteButton);
    await waitFor(() => expect(within(categoryRow).getByRole("alert")).toHaveTextContent("No se pudo actualizar la categoría favorita."));
    expect(apiMock.updateCategory).toHaveBeenCalledTimes(2);
    expect(favoriteButton).toHaveAccessibleName("Marcar Comida como favorita");
    expect(favoriteButton).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("exige confirmar la aplicación de una regla y permite deshacerla", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    render(<AdvancedCatalog categories={[category]} rules={[rule]} onRefresh={onRefresh} setStatus={setStatus} />);

    fireEvent.click(screen.getByRole("button", {name: "Probar"}));
    expect(await screen.findByText("3 coincidencias · 2 cambios · 2 pendientes · Ej.: Supermercado")).toBeInTheDocument();
    expect(apiMock.applyCategoryRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "Aplicar cambios"}));
    expect(await screen.findByText("¿Aplicar “Supermercado” al histórico?")).toBeInTheDocument();
    expect(apiMock.applyCategoryRule).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Aplicar cambios"}));

    await waitFor(() => expect(apiMock.applyCategoryRule).toHaveBeenCalledWith(3));
    expect(setStatus).toHaveBeenCalledWith("Regla aplicada a 3 registros.");
    expect(onRefresh).toHaveBeenCalledOnce();

    fireEvent.click(await screen.findByRole("button", {name: "Deshacer aplicación"}));
    await waitFor(() => expect(apiMock.undoCategoryRule).toHaveBeenCalledWith(3, 7));
    expect(setStatus).toHaveBeenCalledWith("Aplicación deshecha.");
  });

  it("reordena la categoría al soltarla y persiste el orden completo", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    apiMock.categoryOrder.mockResolvedValue({ok: true});
    render(<AdvancedCatalog categories={[category, secondCategory]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);

    const rows = document.querySelectorAll(".catalog-row");
    fireEvent.dragStart(rows[1]);
    fireEvent.drop(rows[0]);

    await waitFor(() => expect(apiMock.categoryOrder).toHaveBeenCalledWith([
      {id: 4, parent_id: null},
      {id: 2, parent_id: null},
    ]));
    const tree = screen.getByRole("region", {name: "Árbol de categorías"});
    expect(document.querySelectorAll(".catalog-row")[0]).toHaveTextContent("Hogar");
    await waitFor(() => expect(within(tree).getByRole("status")).toHaveTextContent("Orden de categorías guardado."));
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("restaura el orden anterior y bloquea nuevos movimientos mientras persiste", async () => {
    let finishOrder!: (value: {ok: true}) => void;
    const setStatus = vi.fn();
    apiMock.categoryOrder.mockImplementationOnce(() => new Promise((resolve) => {finishOrder = resolve;}));
    render(<AdvancedCatalog categories={[category, secondCategory]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={setStatus} />);

    let rows = document.querySelectorAll(".catalog-row");
    fireEvent.dragStart(rows[1]);
    fireEvent.drop(rows[0]);
    expect(screen.getByRole("status")).toHaveTextContent("Guardando nuevo orden");
    const categoryRow = document.querySelector('.catalog-row[data-category-id="2"]') as HTMLElement;
    const menuTrigger = within(categoryRow).getByRole("button", {name: "Acciones de Comida"});
    fireEvent.click(menuTrigger);
    const moveUp = screen.getByRole("button", {name: "Subir posición"});
    const moveDown = screen.getByRole("button", {name: "Bajar posición"});
    expect(moveUp).toBeDisabled();
    expect(moveDown).toBeDisabled();
    menuTrigger.focus();
    fireEvent.click(moveUp);
    expect(menuTrigger).toHaveFocus();
    fireEvent.dragStart(rows[0]);
    fireEvent.drop(rows[1]);
    expect(apiMock.categoryOrder).toHaveBeenCalledOnce();
    finishOrder({ok: true});
    const tree = screen.getByRole("region", {name: "Árbol de categorías"});
    await waitFor(() => expect(within(tree).getByRole("status")).toHaveTextContent("Orden de categorías guardado."));

    apiMock.categoryOrder.mockRejectedValueOnce(new Error("Orden rechazado."));
    rows = document.querySelectorAll(".catalog-row");
    fireEvent.dragStart(rows[1]);
    fireEvent.drop(rows[0]);
    await waitFor(() => expect(within(tree).getByRole("alert")).toHaveTextContent("No se pudo guardar el orden. Se restauró la posición anterior."));
    rows = document.querySelectorAll(".catalog-row");
    expect(rows[0]).toHaveTextContent("Comida");
    expect(rows[1]).toHaveTextContent("Hogar");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("retiene el orden guardado cuando falla la recarga de categorías", async () => {
    const setStatus = vi.fn();
    const onRefresh = vi.fn().mockRejectedValueOnce(new Error("Recarga agotada."));
    apiMock.categoryOrder.mockResolvedValueOnce({ok: true});
    render(<AdvancedCatalog categories={[category, secondCategory]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);

    const rows = document.querySelectorAll(".catalog-row");
    fireEvent.dragStart(rows[1]);
    fireEvent.drop(rows[0]);

    const tree = screen.getByRole("region", {name: "Árbol de categorías"});
    await waitFor(() => expect(within(tree).getByRole("alert")).toHaveTextContent("El orden se guardó, pero no se pudo actualizar la lista."));
    expect(apiMock.categoryOrder).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".catalog-row")[0]).toHaveTextContent("Hogar");
    expect(document.querySelectorAll(".catalog-row")[1]).toHaveTextContent("Comida");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("resume mantenimiento vacío/poblado y conserva el fallo en el panel local", async () => {
    const setStatus = vi.fn();
    apiMock.categoryDuplicates.mockResolvedValueOnce({groups: []});
    apiMock.categoryUnused.mockResolvedValueOnce({categories: [secondCategory]});
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={setStatus} />);
    const maintenance = document.querySelector(".catalog-maintenance") as HTMLElement;

    fireEvent.click(screen.getByRole("button", {name: "Detectar duplicados"}));
    await waitFor(() => expect(within(maintenance).getByRole("status")).toHaveTextContent("0 posibles grupos duplicados detectados."));
    fireEvent.click(screen.getByRole("button", {name: "Revisar sin uso"}));
    await waitFor(() => expect(within(maintenance).getByRole("status")).toHaveTextContent("1 categoría sin uso."));

    apiMock.categoryDuplicates.mockRejectedValueOnce(new Error("Mantenimiento sin conexión."));
    fireEvent.click(screen.getByRole("button", {name: "Detectar duplicados"}));
    await waitFor(() => expect(within(maintenance).getByRole("alert")).toHaveTextContent("No se pudieron detectar duplicados."));
    expect(apiMock.categoryDuplicates).toHaveBeenCalledTimes(2);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("bloquea doble mantenimiento, permite reintentar y localiza fallos de categorías sin uso", async () => {
    let finishDuplicates!: (value: {groups: unknown[]}) => void;
    apiMock.categoryDuplicates.mockImplementationOnce(() => new Promise((resolve) => {finishDuplicates = resolve;}));
    const setStatus = vi.fn();
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={setStatus} />);
    const maintenance = document.querySelector(".catalog-maintenance") as HTMLElement;
    const duplicates = screen.getByRole("button", {name: "Detectar duplicados"});
    const unused = screen.getByRole("button", {name: "Revisar sin uso"});

    duplicates.focus();
    fireEvent.click(duplicates);
    expect(duplicates).toHaveAttribute("aria-disabled", "true");
    expect(duplicates).toHaveAttribute("aria-busy", "true");
    expect(duplicates).not.toBeDisabled();
    expect(duplicates).toHaveFocus();
    expect(unused).toHaveAttribute("aria-disabled", "true");
    expect(unused).not.toBeDisabled();
    fireEvent.click(duplicates);
    fireEvent.click(unused);
    expect(apiMock.categoryDuplicates).toHaveBeenCalledOnce();
    expect(apiMock.categoryUnused).not.toHaveBeenCalled();
    finishDuplicates({groups: [{name: "Comida"}]});
    await waitFor(() => expect(within(maintenance).getByRole("status")).toHaveTextContent("1 posible grupo duplicado detectado."));
    expect(duplicates).toHaveFocus();

    apiMock.categoryUnused.mockRejectedValueOnce(new Error("Sin conexión."));
    unused.focus();
    fireEvent.click(unused);
    await waitFor(() => expect(within(maintenance).getByRole("alert")).toHaveTextContent("No se pudieron revisar las categorías sin uso."));
    expect(unused).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("permite cancelar una previsualización vacía y expone errores de preview y desactivación", async () => {
    const setStatus = vi.fn();
    let finishPreview!: (value: {ok: true; impact: Record<string, unknown>}) => void;
    apiMock.previewDeactivateCategory.mockImplementationOnce(() => new Promise((resolve) => {finishPreview = resolve;}));
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={setStatus} />);

    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;
    const menuTrigger = within(categoryRow).getByRole("button", {name: "Acciones de Comida"});
    fireEvent.click(menuTrigger);
    const deactivate = within(categoryRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    const previewButton = screen.getByRole("button", {name: "Calculando impacto"});
    expect(previewButton).toHaveAttribute("aria-disabled", "true");
    expect(previewButton).toHaveAttribute("aria-busy", "true");
    expect(previewButton).not.toBeDisabled();
    expect(previewButton).toHaveFocus();
    fireEvent.click(previewButton);
    expect(apiMock.previewDeactivateCategory).toHaveBeenCalledOnce();
    finishPreview({ok: true, impact: {transactions: 0, budgets: 0, rules: 0, imports: 0}});
    expect(await screen.findByText("0 movimientos · 0 presupuestos · 0 reglas · 0 importaciones")).toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
    fireEvent.click(screen.getByRole("button", {name: "Cancelar"}));
    expect(apiMock.deactivateCategory).not.toHaveBeenCalled();

    apiMock.previewDeactivateCategory.mockRejectedValueOnce(new Error("Preview no disponible."));
    fireEvent.click(menuTrigger);
    const retry = within(categoryRow).getByRole("button", {name: "Desactivar"});
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(within(categoryRow).getByRole("alert")).toHaveTextContent("No se pudo calcular el impacto de la desactivación."));
    expect(screen.queryByText("Desactivar «Comida»?")).not.toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("descarta una preview tardía si Escape cierra el menú mientras espera", async () => {
    let finishPreview!: (value: {ok: true; impact: Record<string, unknown>}) => void;
    apiMock.previewDeactivateCategory.mockImplementationOnce(() => new Promise((resolve) => {finishPreview = resolve;}));
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);

    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;
    const menuTrigger = within(categoryRow).getByRole("button", {name: "Acciones de Comida"});
    fireEvent.click(menuTrigger);
    const deactivate = within(categoryRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    expect(screen.getByRole("button", {name: "Calculando impacto"})).toHaveFocus();
    fireEvent.keyDown(deactivate, {key: "Escape"});
    expect(menuTrigger).toHaveFocus();

    finishPreview({ok: true, impact: {transactions: 3, budgets: 0, rules: 0, imports: 0}});
    await waitFor(() => expect(screen.queryByRole("button", {name: "Calculando impacto"})).not.toBeInTheDocument());
    expect(screen.queryByText("Desactivar «Comida»?")).not.toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
  });

  it("descarta una preview tardía si el usuario abre acciones de otra categoría", async () => {
    let finishPreview!: (value: {ok: true; impact: Record<string, unknown>}) => void;
    apiMock.previewDeactivateCategory.mockImplementationOnce(() => new Promise((resolve) => {finishPreview = resolve;}));
    render(<AdvancedCatalog categories={[category, secondCategory]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);

    const rows = document.querySelectorAll(".catalog-row");
    const [firstRow, secondRow] = Array.from(rows) as HTMLElement[];
    const firstTrigger = within(firstRow).getByRole("button", {name: "Acciones de Comida"});
    fireEvent.click(firstTrigger);
    const deactivate = within(firstRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    const secondTrigger = within(secondRow).getByRole("button", {name: "Acciones de Hogar"});
    secondTrigger.focus();
    fireEvent.click(secondTrigger);
    expect(within(secondRow).getByRole("button", {name: "Acciones de Hogar"})).toHaveFocus();

    finishPreview({ok: true, impact: {transactions: 3, budgets: 0, rules: 0, imports: 0}});
    await waitFor(() => expect(within(firstRow).queryByRole("button", {name: "Calculando impacto"})).not.toBeInTheDocument());
    expect(screen.queryByText("Desactivar «Comida»?")).not.toBeInTheDocument();
    expect(secondTrigger).toHaveFocus();
  });

  it("no roba el foco ni confirma una preview si el usuario sale de la acción", async () => {
    let finishPreview!: (value: {ok: true; impact: Record<string, unknown>}) => void;
    apiMock.previewDeactivateCategory.mockImplementationOnce(() => new Promise((resolve) => {finishPreview = resolve;}));
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={vi.fn()} />);

    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;
    fireEvent.click(within(categoryRow).getByRole("button", {name: "Acciones de Comida"}));
    const deactivate = within(categoryRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    const favoriteButton = within(categoryRow).getByRole("button", {name: "Marcar Comida como favorita"});
    favoriteButton.focus();

    finishPreview({ok: true, impact: {transactions: 3, budgets: 0, rules: 0, imports: 0}});
    await waitFor(() => expect(within(categoryRow).queryByRole("button", {name: "Calculando impacto"})).not.toBeInTheDocument());
    expect(screen.queryByText("Desactivar «Comida»?")).not.toBeInTheDocument();
    expect(favoriteButton).toHaveFocus();
  });

  it("bloquea confirmaciones duplicadas y conserva el diálogo si falla la desactivación", async () => {
    let finishDeactivation!: (value: {ok: true; category: Category}) => void;
    apiMock.deactivateCategory.mockImplementationOnce(() => new Promise((resolve) => {finishDeactivation = resolve;}));
    const setStatus = vi.fn();
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={vi.fn(async () => undefined)} setStatus={setStatus} />);

    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;
    const menuTrigger = within(categoryRow).getByRole("button", {name: "Acciones de Comida"});
    fireEvent.click(menuTrigger);
    const deactivate = within(categoryRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    const confirmButton = await screen.findByRole("button", {name: "Confirmar desactivación"});
    confirmButton.focus();
    fireEvent.click(confirmButton);
    const confirm = screen.getByRole("button", {name: "Desactivando…"});
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    const cancel = screen.getByRole("button", {name: "Cancelar"});
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    expect(screen.getByText("Desactivar «Comida»?")).toBeInTheDocument();
    expect(apiMock.deactivateCategory).toHaveBeenCalledOnce();
    finishDeactivation({ok: true, category: {...category, active: false}});
    const tree = screen.getByRole("region", {name: "Árbol de categorías"});
    await waitFor(() => expect(within(tree).getByRole("status")).toHaveTextContent("Categoría desactivada; el histórico se conserva."));
    await waitFor(() => expect(tree).toHaveFocus());

    apiMock.deactivateCategory.mockRejectedValueOnce(new Error("No se pudo guardar."));
    fireEvent.click(menuTrigger);
    const retry = within(categoryRow).getByRole("button", {name: "Desactivar"});
    retry.focus();
    fireEvent.click(retry);
    const retryConfirm = await screen.findByRole("button", {name: "Confirmar desactivación"});
    retryConfirm.focus();
    fireEvent.click(retryConfirm);
    await waitFor(() => expect(within(screen.getByText("Desactivar «Comida»?").closest(".inline-confirm") as HTMLElement).getByRole("alert")).toHaveTextContent("No se pudo desactivar la categoría. La confirmación sigue disponible."));
    expect(screen.getByText("Desactivar «Comida»?")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Confirmar desactivación"})).toHaveFocus();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("separa la desactivación confirmada de un fallo posterior al refrescar", async () => {
    const setStatus = vi.fn();
    const onRefresh = vi.fn().mockRejectedValue(new Error("Bootstrap sin conexión."));
    render(<AdvancedCatalog categories={[category]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);

    const categoryRow = document.querySelector(".catalog-row") as HTMLElement;
    fireEvent.click(within(categoryRow).getByRole("button", {name: "Acciones de Comida"}));
    const deactivate = within(categoryRow).getByRole("button", {name: "Desactivar"});
    deactivate.focus();
    fireEvent.click(deactivate);
    fireEvent.click(await screen.findByRole("button", {name: "Confirmar desactivación"}));
    const tree = screen.getByRole("region", {name: "Árbol de categorías"});
    await waitFor(() => expect(within(tree).getByRole("alert")).toHaveTextContent("La categoría se desactivó, pero no se pudo refrescar la lista."));
    await waitFor(() => expect(tree).toHaveFocus());
    expect(apiMock.deactivateCategory).toHaveBeenCalledOnce();
    expect(screen.queryByText("Impacto de desactivar")).not.toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("no permite convertir una categoría principal en su propia subcategoría", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const child = {...secondCategory, parent_id: category.id, sort_order: 1};
    render(<AdvancedCatalog categories={[category, child]} rules={[]} onRefresh={onRefresh} setStatus={setStatus} />);

    const rows = document.querySelectorAll(".catalog-row");
    fireEvent.dragStart(rows[0]);
    fireEvent.drop(rows[1]);

    expect(apiMock.categoryOrder).not.toHaveBeenCalled();
    expect(within(screen.getByRole("region", {name: "Árbol de categorías"})).getByRole("alert")).toHaveTextContent("Solo puedes cambiar el orden dentro del mismo nivel.");
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe("CategorySettingsPanels category form", () => {
  beforeEach(() => vi.clearAllMocks());

  const renderCategoryForm = (load = vi.fn(async () => undefined), setStatus = vi.fn()) => {
    render(<CategorySettingsPanels categories={[category]} rules={[]} load={load} setStatus={setStatus} showRules={false} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir nueva categoría"}));
    return {load, setStatus};
  };

  it("exige nombre y bloquea duplicados durante la creación", async () => {
    let completeCreate!: () => void;
    apiMock.createCategory.mockImplementation(() => new Promise((resolve) => {
      completeCreate = () => resolve({ok: true, category: {...category, name: "Hogar", display_name: "Hogar"}});
    }));
    const {load, setStatus} = renderCategoryForm();
    const name = await screen.findByLabelText("Nombre");
    const save = screen.getByRole("button", {name: "Guardar categoría"});

    expect(name).toBeRequired();
    expect(save).toBeDisabled();
    fireEvent.change(name, {target: {value: "Hogar"}});
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(apiMock.createCategory).toHaveBeenCalledOnce());
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toBeEnabled();
    expect(save).toHaveTextContent("Guardando categoría");
    fireEvent.click(save);
    expect(apiMock.createCategory).toHaveBeenCalledOnce();
    completeCreate();

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Categoría creada."));
    expect(load).toHaveBeenCalledOnce();
    expect(name).toHaveValue("");
  });

  it("guarda borradores separados cuando la intención pasa de alta a edición", async () => {
    const categories = [category, secondCategory];
    const load = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const renderWithIntent = (rerender: ReturnType<typeof render>["rerender"], id: number | null, token: number) => rerender(<CategorySettingsPanels categories={categories} rules={[]} load={load} setStatus={setStatus} showRules={false} categoryIntent={{id, token}} />);
    const {rerender} = render(<CategorySettingsPanels categories={categories} rules={[]} load={load} setStatus={setStatus} showRules={false} categoryIntent={{id: null, token: 1}} />);
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, {target: {value: "Borrador nuevo"}});

    renderWithIntent(rerender, category.id, 2);
    await waitFor(() => expect(name).toHaveValue("Comida"));
    renderWithIntent(rerender, secondCategory.id, 3);
    await waitFor(() => expect(name).toHaveValue("Hogar"));
    renderWithIntent(rerender, category.id, 4);
    await waitFor(() => expect(name).toHaveValue("Comida"));
    renderWithIntent(rerender, null, 5);

    await waitFor(() => expect(name).toHaveValue("Borrador nuevo"));
    expect(apiMock.createCategory).not.toHaveBeenCalled();
    expect(apiMock.updateCategory).not.toHaveBeenCalled();
  });

  it("no cambia la categoría activa durante un guardado pendiente", async () => {
    let completeCreate!: () => void;
    const setStatus = vi.fn();
    const load = vi.fn(async () => undefined);
    apiMock.createCategory.mockImplementationOnce(() => new Promise((resolve) => {
      completeCreate = () => resolve({ok: true, category: {...category, id: 8, name: "Nueva", display_name: "Nueva"}});
    }));
    const props = {categories: [category], rules: [], load, setStatus, showRules: false};
    const {rerender} = render(<CategorySettingsPanels {...props} categoryIntent={{id: null, token: 1}} />);
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, {target: {value: "Nueva"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar categoría"}));
    await waitFor(() => expect(apiMock.createCategory).toHaveBeenCalledOnce());

    rerender(<CategorySettingsPanels {...props} categoryIntent={{id: category.id, token: 2}} />);
    expect(name).toBeDisabled();
    expect(name).toHaveValue("Nueva");
    expect(setStatus).toHaveBeenCalledWith("Espera a que termine el guardado de la categoría antes de cambiar de editor.");
    expect(apiMock.updateCategory).not.toHaveBeenCalled();
    completeCreate();
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Categoría creada."));
  });

  it("presenta error de creación sin perder la categoría escrita", async () => {
    apiMock.createCategory.mockRejectedValueOnce(new Error("Ya existe una categoría con ese nombre."));
    renderCategoryForm();
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, {target: {value: "Comida"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar categoría"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una categoría con ese nombre.");
    expect(name).toHaveValue("Comida");
    expect(screen.getByRole("button", {name: "Guardar categoría"})).toBeEnabled();
  });

  it("separa creación correcta de error de refresco y evita repetir el POST", async () => {
    const load = vi.fn().mockRejectedValue(new Error("Ajustes no refrescados."));
    const setStatus = vi.fn();
    apiMock.createCategory.mockResolvedValue({ok: true, category: {...category, name: "Hogar", display_name: "Hogar"}});
    renderCategoryForm(load, setStatus);
    fireEvent.change(await screen.findByLabelText("Nombre"), {target: {value: "Hogar"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar categoría"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("La categoría se creó, pero no se pudo refrescar la lista.");
    expect(setStatus).toHaveBeenCalledWith("Categoría creada.");
    expect(apiMock.createCategory).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByRole("button", {name: "Guardar categoría"})).toBeDisabled();
  });

  it("carga todos los campos al editar y guarda sin cambiar los valores no editados", async () => {
    const load = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    apiMock.updateCategory.mockResolvedValue({ok: true, category: {...category, name: "Alimentación", display_name: "Alimentación"}});
    render(<CategorySettingsPanels categories={[category]} rules={[]} load={load} setStatus={setStatus} showRules={false} />);
    fireEvent.click(screen.getByRole("button", {name: /^Expandir$/u}));
    const categoryRow = (await screen.findByText("Comida")).closest(".list-card") as HTMLElement | null;
    if (!categoryRow) throw new Error("No se encontró la categoría para editar");
    fireEvent.click(within(categoryRow).getByRole("button", {name: "Editar"}));

    expect(await screen.findByRole("heading", {name: "Editar categoría"})).toBeInTheDocument();
    expect(await screen.findByLabelText("Nombre")).toHaveValue("Comida");
    expect(screen.getByLabelText("Tipo")).toHaveValue("expense");
    expect(screen.getByLabelText("Principal")).toHaveValue("");
    expect(screen.getByLabelText("Color")).toHaveValue("#ff9500");
    fireEvent.change(screen.getByLabelText("Nombre"), {target: {value: "Alimentación"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar categoría"}));

    await waitFor(() => expect(apiMock.updateCategory).toHaveBeenCalledWith(2, expect.objectContaining({
      name: "Alimentación",
      kind: "expense",
      parent: "",
      color: "#ff9500",
      icon: "",
      active: true,
      exclude_from_analytics: false,
    })));
    expect(setStatus).toHaveBeenCalledWith("Categoría actualizada.");
    expect(load).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", {name: "Nueva categoría"})).toBeInTheDocument();
    expect(await screen.findByLabelText("Nombre")).toHaveValue("");
  });
});

describe("AutomationsView", () => {
  it("mantiene la autoaplicación desactivada sin promoción validada", async () => {
    apiMock.automation.mockResolvedValueOnce({ok: true, automation});
    render(<AutomationsView categories={[category]} accounts={[account]} />);
    const autoApply = await screen.findByLabelText("Autoaplicar sugerencias de IA");
    expect(autoApply).toBeDisabled();
    expect(screen.getByText(/NO_PROMOTION: autoaplicación inactiva/)).toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.removeItem("mis-cuentas:settings:category-rule-drafts");
    window.history.replaceState({}, "", "/?tab=settings");
    window.history.replaceState({}, "", "/");
    apiMock.automation.mockResolvedValue({ok: true, automation});
    apiMock.categoryRules.mockResolvedValue({rules: [rule]});
    apiMock.categoryRuleConflicts.mockResolvedValue({conflicts: [{rule_a: rule, rule_b: {...rule, id: 5, description: "Mercado", priority: 2}, reason: "Condiciones solapadas."}]});
    apiMock.categoryRuleApplications.mockResolvedValue({applications: [], next_offset: null});
  });

  it("conserva el historial y el estado de undo al desmontar y volver a entrar", async () => {
    let historyItem: CategoryRuleApplication = {
      id: 17,
      rule_id: 3,
      rule_description: "Regla Mercado demo",
      applied_at: "2026-10-23T12:00:00Z",
      status: "completed",
      reversible: true,
      target_category_id: category.id,
      transactions: 2,
      bank_rows: 1,
      csv_rows: 0,
      total: 3,
    };
    apiMock.categoryRuleApplications.mockImplementation(async () => ({applications: [historyItem], next_offset: null}));
    apiMock.undoCategoryRule.mockImplementation(async () => {
      historyItem = {...historyItem, status: "undone", reversible: false};
      return {ok: true, partial: false};
    });
    const first = render(<AutomationsView categories={[category]} accounts={[account]} />);
    expect(await screen.findByRole("heading", {name: "Historial de aplicaciones"})).toBeInTheDocument();
    expect(await screen.findByText("Regla Mercado demo")).toBeInTheDocument();
    const undo = screen.getByRole("button", {name: "Deshacer aplicación"});
    fireEvent.click(undo);
    await waitFor(() => expect(screen.getByRole("button", {name: "Deshecha"})).toBeInTheDocument());
    expect(apiMock.undoCategoryRule).toHaveBeenCalledWith(3, 17);
    first.unmount();

    render(<AutomationsView categories={[category]} accounts={[account]} />);
    expect(await screen.findByText("Regla Mercado demo")).toBeInTheDocument();
    expect(await screen.findByRole("button", {name: "Deshecha"})).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Deshacer aplicación"})).not.toBeInTheDocument();
  });

  it("presenta reglas y conflictos sin KPI de Control", async () => {
    render(<AutomationsView categories={[category]} accounts={[account]} showCategorySettings={false} showCategoryList={false} />);

    expect(await screen.findByRole("heading", {name: "Automatizaciones"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Sugerencias y aplicación"})).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "Control"})).not.toBeInTheDocument();
    expect(screen.queryByText(/aplicaciones históricas registradas/)).not.toBeInTheDocument();
    expect(screen.getByText("Supermercado ↔ Mercado")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Expandir"}));
    expect(await screen.findByText("Si la descripción contiene “Supermercado” → Comida")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Probar"})).toBeInTheDocument();
  });

  it("abre una regla nueva desde el enlace contextual y muestra sus límites", async () => {
    window.history.replaceState({}, "", "/?tab=automations&focus=new-rule");
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    const description = await screen.findByLabelText("Texto a reconocer");
    expect(description).toHaveFocus();
    expect(screen.getByLabelText("Coincidencia")).not.toBeVisible();
    fireEvent.click(screen.getByText("Condiciones avanzadas"));
    expect(screen.getByLabelText("Coincidencia")).toBeInTheDocument();
    expect(screen.getByLabelText("Cuenta (opcional)")).toHaveDisplayValue("Cualquier cuenta");
    expect(screen.getByLabelText("Importe mínimo")).toBeInTheDocument();
    expect(screen.getByLabelText("Importe máximo")).toBeInTheDocument();
  });

  it("abre la lista de reglas desde su deep-link y conserva el foco", async () => {
    window.history.replaceState({}, "", "/?tab=automations&focus=rules");
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    const disclosure = await screen.findByRole("button", {name: "Comprimir"});
    expect(disclosure).toHaveFocus();
    expect(await screen.findByText("Si la descripción contiene “Supermercado” → Comida")).toBeInTheDocument();
  });

  it("abre la regla identificada por un deep-link para editar sus condiciones guardadas", async () => {
    window.history.replaceState({}, "", "/?tab=automations&rule=3");
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    const description = await screen.findByLabelText("Texto a reconocer");
    expect(description).toHaveValue("Supermercado");
    expect(description).toHaveFocus();
    expect(screen.getByLabelText("Coincidencia")).toBeVisible();
  });

  it("oculta deep-links de regla inexistentes y conserva borradores al cambiar de ID", async () => {
    const otherRule = {...rule, id: 5, description: "Mercado", category: secondCategory};
    apiMock.categoryRules.mockResolvedValue({rules: [rule, otherRule]});
    window.history.replaceState({}, "", "/?tab=settings&settings_section=classification&rule=3");
    const {rerender} = render(<AutomationsView categories={[category, secondCategory]} accounts={[account]} embedded showCategorySettings={false} showCategoryList={false} routeKey={window.location.href} />);
    const renderAtRoute = (routeKey: string) => rerender(<AutomationsView categories={[category, secondCategory]} accounts={[account]} embedded showCategorySettings={false} showCategoryList={false} routeKey={routeKey} />);
    fireEvent.change(await screen.findByLabelText("Texto a reconocer"), {target: {value: "Borrador de Supermercado"}});

    window.history.replaceState({}, "", "/?tab=settings&settings_section=classification&rule=5");
    renderAtRoute(window.location.href);
    await waitFor(() => expect(screen.getByLabelText("Texto a reconocer")).toHaveValue("Mercado"));

    window.history.replaceState({}, "", "/?tab=settings&settings_section=classification&rule=999");
    renderAtRoute(window.location.href);
    expect(await screen.findByText("Regla no disponible")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Texto a reconocer")).not.toBeVisible());
    expect(apiMock.updateCategoryRule).not.toHaveBeenCalled();

    window.history.replaceState({}, "", "/?tab=settings&settings_section=classification&rule=3");
    renderAtRoute(window.location.href);
    await waitFor(() => expect(screen.getByLabelText("Texto a reconocer")).toHaveValue("Borrador de Supermercado"));
  });

  it("integra categorías, reglas y preferencias dentro de la sección de Ajustes", async () => {
    render(<AutomationsView embedded categories={[category]} accounts={[account]} />);

    expect(await screen.findByRole("heading", {name: "Nueva categoría"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Nueva regla"})).toBeInTheDocument();
    expect(screen.getByLabelText("IA para sugerencias")).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "Automatizaciones"})).not.toBeInTheDocument();
  });

  it("mantiene el guardado de una regla enfocado, ocupado y reintentable", async () => {
    let rejectCreate!: (reason: Error) => void;
    const createdRule = {...rule, description: "Regla en espera"};
    apiMock.createCategoryRule.mockImplementationOnce(() => new Promise((_, reject) => {rejectCreate = reject;})).mockResolvedValueOnce({ok: true, rule: createdRule});
    window.history.replaceState({}, "", "/?tab=automations&focus=new-rule");
    render(<AutomationsView categories={[category]} accounts={[account]} />);
    const description = await screen.findByLabelText("Texto a reconocer");
    fireEvent.change(description, {target: {value: createdRule.description}});
    fireEvent.change(screen.getByLabelText("Categoría"), {target: {value: String(category.id)}});
    const save = screen.getByRole("button", {name: "Guardar regla"});
    const form = description.closest("form")!;
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(apiMock.createCategoryRule).toHaveBeenCalledOnce());
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    expect(description).toBeDisabled();
    fireEvent.click(save);
    expect(apiMock.createCategoryRule).toHaveBeenCalledOnce();

    rejectCreate(new Error("No se pudo crear la regla."));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la regla. Puedes volver a intentarlo.");
    expect(description).toHaveValue("Regla en espera");
    expect(save).toHaveFocus();

    fireEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Regla de categoría creada.");
    expect(save).toHaveFocus();
  });

  it("mantiene enfocado y ocupado el disparador mientras prueba una regla", async () => {
    let finishPreview!: (value: {ok: true; result: {transactions: number; bank_rows: number; csv_rows: number; total: number; changes: number; already_categorized: number; examples: Array<{description: string; amount: string}>}}) => void;
    apiMock.previewCategoryRule.mockImplementationOnce(() => new Promise((resolve) => {finishPreview = resolve;}));
    render(<AutomationsView categories={[category]} accounts={[account]} />);
    await screen.findByRole("heading", {name: "Automatizaciones"});
    fireEvent.click(screen.getByRole("button", {name: "Expandir"}));
    const previewButton = await screen.findByRole("button", {name: "Probar"});

    previewButton.focus();
    fireEvent.click(previewButton);
    expect(previewButton).toHaveAttribute("aria-disabled", "true");
    expect(previewButton).toHaveAttribute("aria-busy", "true");
    expect(previewButton).not.toBeDisabled();
    expect(previewButton).toHaveFocus();
    fireEvent.click(previewButton);
    expect(apiMock.previewCategoryRule).toHaveBeenCalledOnce();

    finishPreview({ok: true, result: {transactions: 1, bank_rows: 1, csv_rows: 1, total: 3, changes: 2, already_categorized: 1, examples: [{description: "Supermercado", amount: ""}]}});
    expect(await screen.findByRole("heading", {name: "Vista previa: Supermercado"})).toBeInTheDocument();
    expect(previewButton).toHaveFocus();

    apiMock.previewCategoryRule.mockRejectedValueOnce(new Error("Preview fuera de línea."));
    fireEvent.click(previewButton);
    expect(await screen.findByRole("status")).toHaveTextContent("No se pudo probar la regla. Puedes volver a intentarlo.");
    expect(previewButton).toHaveFocus();
  });

  it("mantiene enfocado y ocupado Deshacer aplicación hasta terminar el undo", async () => {
    let rejectUndo!: (reason: Error) => void;
    apiMock.previewCategoryRule.mockResolvedValueOnce({ok: true, result: {transactions: 1, bank_rows: 1, csv_rows: 1, total: 3, changes: 2, already_categorized: 1, examples: [{description: "Supermercado", amount: ""}]}});
    apiMock.applyCategoryRule.mockResolvedValueOnce({ok: true, result: {application_id: 7, transactions: 1, bank_rows: 1, csv_rows: 1, total: 3}});
    apiMock.undoCategoryRule.mockImplementationOnce(() => new Promise((_, reject) => {rejectUndo = reject;})).mockResolvedValueOnce({ok: true, partial: false});
    render(<AutomationsView categories={[category]} accounts={[account]} />);
    await screen.findByRole("heading", {name: "Automatizaciones"});
    fireEvent.click(screen.getByRole("button", {name: "Expandir"}));
    const previewButton = await screen.findByRole("button", {name: "Probar"});
    fireEvent.click(previewButton);
    fireEvent.click(await screen.findByRole("button", {name: "Aplicar cambios"}));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", {name: "Aplicar cambios"}));
    const undoButton = await screen.findByRole("button", {name: "Deshacer aplicación"});

    undoButton.focus();
    fireEvent.click(undoButton);
    expect(undoButton).toHaveAttribute("aria-disabled", "true");
    expect(undoButton).toHaveAttribute("aria-busy", "true");
    expect(undoButton).not.toBeDisabled();
    expect(undoButton).toHaveFocus();
    fireEvent.click(undoButton);
    expect(apiMock.undoCategoryRule).toHaveBeenCalledOnce();

    await act(async () => {rejectUndo(new Error("Undo fuera de línea.")); await Promise.resolve();});
    expect(await screen.findByText("No se pudo deshacer la aplicación. Puedes volver a intentarlo.")).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Regla aplicada"})).toBeInTheDocument();
    expect(undoButton).toHaveFocus();

    fireEvent.click(undoButton);
    await waitFor(() => expect(apiMock.undoCategoryRule).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Aplicación deshecha."));
    expect(apiMock.undoCategoryRule).toHaveBeenCalledTimes(2);
    expect(previewButton).toHaveFocus();
  });

  it("recupera la carga fallida y muestra el estado vacío de reglas y conflictos", async () => {
    apiMock.automation.mockRejectedValueOnce(new Error("Preferencias fuera de línea"));
    apiMock.categoryRules.mockResolvedValue({rules: []});
    apiMock.categoryRuleConflicts.mockResolvedValue({conflicts: []});
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    expect(await screen.findByText("Preferencias fuera de línea")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Reintentar"}));

    expect(await screen.findByLabelText("IA para sugerencias")).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "Conflictos a revisar"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Expandir"}));
    expect(await screen.findByText("Crea una regla arriba para asignar categorías según la descripción del movimiento.")).toBeInTheDocument();
  });

  it("conserva la automatización y las reglas visibles mientras refresca y si falla", async () => {
    let rejectRefresh!: (reason: Error) => void;
    apiMock.automation.mockResolvedValueOnce({ok: true, automation}).mockReturnValueOnce(new Promise((_, reject) => { rejectRefresh = reject; }));
    apiMock.updateAutomation.mockResolvedValue({ok: true, automation});
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    const enabled = await screen.findByLabelText("IA para sugerencias");
    fireEvent.click(enabled);
    fireEvent.click(screen.getByRole("button", {name: "Guardar automatización"}));
    await waitFor(() => expect(apiMock.automation).toHaveBeenCalledTimes(2));

    const view = document.querySelector(".view-stack");
    expect(view).toHaveAttribute("aria-busy", "true");
    expect(enabled).toBeChecked();
    expect(screen.getByText("Supermercado ↔ Mercado")).toBeInTheDocument();

    rejectRefresh(new Error("No se pudo actualizar la automatización."));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo actualizar la automatización.");
    expect(view).toHaveAttribute("aria-busy", "false");
    expect(enabled).toBeChecked();
    expect(screen.getByText("Supermercado ↔ Mercado")).toBeInTheDocument();
  });

  it("guarda las dos preferencias binarias y el umbral de confianza juntos", async () => {
    const promoted = {...automation, promotion_status: "PROMOTED" as const};
    const updated = {...promoted, llm_enabled: true, auto_apply_enabled: true, auto_apply_effective: true, confidence_threshold: 0.99};
    apiMock.automation.mockResolvedValueOnce({ok: true, automation: promoted}).mockResolvedValueOnce({ok: true, automation: updated});
    apiMock.updateAutomation.mockResolvedValue({ok: true, automation: updated});
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    fireEvent.click(await screen.findByLabelText("IA para sugerencias"));
    fireEvent.click(screen.getByLabelText("Autoaplicar sugerencias de IA"));
    fireEvent.change(screen.getByLabelText("Umbral de confianza"), {target: {value: "0.99"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar automatización"}));

    await waitFor(() => expect(apiMock.updateAutomation).toHaveBeenCalledWith({
      llm_enabled: true,
      auto_apply_enabled: true,
      confidence_threshold: "0.99",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Automatización actualizada.");
    expect(screen.getByLabelText("IA para sugerencias")).toBeChecked();
    expect(screen.getByLabelText("Autoaplicar sugerencias de IA")).toBeChecked();
    expect(screen.getByText(/PROMOTED: la autoaplicación está activa/)).toBeInTheDocument();
  });

  it("crea y edita una regla manteniendo tipo, cuenta y límites del importe", async () => {
    const createdRule = {...rule, description: "Compra local", match_mode: "starts_with" as const, account, amount_min: 12.34, amount_max: 45.67, active: false};
    apiMock.categoryRules.mockResolvedValueOnce({rules: []}).mockResolvedValue({rules: [createdRule]});
    apiMock.createCategoryRule.mockResolvedValue({ok: true, rule: createdRule});
    apiMock.updateCategoryRule.mockResolvedValue({ok: true, rule: {...createdRule, amount_max: 50}});
    window.history.replaceState({}, "", "/?tab=automations&focus=new-rule");
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    fireEvent.change(await screen.findByLabelText("Texto a reconocer"), {target: {value: "Compra local"}});
    fireEvent.click(screen.getByText("Condiciones avanzadas"));
    fireEvent.change(screen.getByLabelText("Coincidencia"), {target: {value: "starts_with"}});
    fireEvent.change(screen.getByLabelText("Categoría"), {target: {value: "2"}});
    fireEvent.change(screen.getByLabelText("Cuenta (opcional)"), {target: {value: "1"}});
    fireEvent.change(screen.getByLabelText("Importe mínimo"), {target: {value: "12.34"}});
    fireEvent.change(screen.getByLabelText("Importe máximo"), {target: {value: "45.67"}});
    fireEvent.click(screen.getByLabelText("Regla activa"));
    fireEvent.click(screen.getByRole("button", {name: "Guardar regla"}));

    await waitFor(() => expect(apiMock.createCategoryRule).toHaveBeenCalledWith(expect.objectContaining({
      description: "Compra local",
      kind: "expense",
      category: "2",
      match_mode: "starts_with",
      account: "1",
      amount_min: "12.34",
      amount_max: "45.67",
      active: false,
    })));
    fireEvent.click(screen.getByRole("button", {name: "Expandir"}));
    const ruleRow = await screen.findByText("Si la descripción empieza por “Compra local” → Comida");
    fireEvent.click(within(ruleRow.closest(".list-card")!).getByRole("button", {name: "Editar"}));
    expect(screen.getByLabelText("Cuenta (opcional)")).toHaveDisplayValue("Cuenta diaria");
    fireEvent.change(screen.getByLabelText("Importe máximo"), {target: {value: "50"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar regla"}));

    await waitFor(() => expect(apiMock.updateCategoryRule).toHaveBeenCalledWith(3, expect.objectContaining({
      account: "1",
      amount_min: "12.34",
      amount_max: "50",
      active: false,
    })));
  });

  it("mantiene el guardado de regla ocupado y reintenta sin perder el borrador", async () => {
    let rejectCreate!: (reason: Error) => void;
    const createdRule = {...rule, description: "Regla retenida"};
    apiMock.createCategoryRule.mockImplementationOnce(() => new Promise((_, reject) => {rejectCreate = reject;})).mockResolvedValueOnce({ok: true, rule: createdRule});
    window.history.replaceState({}, "", "/?tab=automations&focus=new-rule");
    render(<AutomationsView categories={[category]} accounts={[account]} />);
    const description = await screen.findByLabelText("Texto a reconocer");
    fireEvent.change(description, {target: {value: createdRule.description}});
    fireEvent.change(screen.getByLabelText("Categoría"), {target: {value: String(category.id)}});
    const form = description.closest("form")!;
    const save = screen.getByRole("button", {name: "Guardar regla"});
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(apiMock.createCategoryRule).toHaveBeenCalledOnce());
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    expect(description).toBeDisabled();
    fireEvent.click(save);
    expect(apiMock.createCategoryRule).toHaveBeenCalledOnce();

    rejectCreate(new Error("Regla no disponible."));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la regla. Puedes volver a intentarlo.");
    expect(description).toHaveValue("Regla retenida");
    expect(save).toHaveFocus();
    fireEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Regla de categoría creada.");
    expect(save).toHaveFocus();
  });

  it("mantiene la confirmación, preview sin cambios y undo parcial", async () => {
    apiMock.previewCategoryRule.mockResolvedValueOnce({ok: true, result: {transactions: 1, bank_rows: 0, csv_rows: 0, total: 1, changes: 0, already_categorized: 1, examples: [{description: "Ya clasificado", amount: ""}]}});
    apiMock.applyCategoryRule.mockResolvedValueOnce({ok: true, result: {application_id: 7, transactions: 1, bank_rows: 1, csv_rows: 1, total: 3}});
    apiMock.undoCategoryRule.mockResolvedValueOnce({ok: true, partial: true});
    render(<AutomationsView categories={[category]} accounts={[account]} />);

    expect(await screen.findByRole("heading", {name: "Automatizaciones"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Expandir"}));
    fireEvent.click(await screen.findByRole("button", {name: "Probar"}));
    const previewApply = await screen.findByRole("button", {name: "Aplicar cambios"});
    expect(previewApply).toBeDisabled();
    fireEvent.click(screen.getByRole("button", {name: "Eliminar"}));
    expect(await screen.findByRole("dialog")).toBeVisible();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Cancelar"}));
    expect(apiMock.deleteCategoryRule).not.toHaveBeenCalled();

    apiMock.previewCategoryRule.mockResolvedValueOnce({ok: true, result: {transactions: 1, bank_rows: 1, csv_rows: 1, total: 3, changes: 2, already_categorized: 1, examples: [{description: "Supermercado", amount: ""}]}});
    fireEvent.click(await screen.findByRole("button", {name: "Probar"}));
    fireEvent.click(await screen.findByRole("button", {name: "Aplicar cambios"}));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", {name: "Aplicar cambios"}));
    fireEvent.click(await screen.findByRole("button", {name: "Deshacer aplicación"}));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Deshecha parcialmente"));
    fireEvent.click(screen.getByRole("button", {name: "Eliminar"}));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", {name: "Eliminar regla"}));
    await waitFor(() => expect(apiMock.deleteCategoryRule).toHaveBeenCalledWith(3));
    expect(await screen.findByRole("status")).toHaveTextContent("Regla eliminada.");
  });
});
