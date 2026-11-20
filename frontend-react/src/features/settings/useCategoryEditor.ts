import {useEffect, useLayoutEffect, useRef, useState, type FormEvent} from "react";
import {settingsApi} from "./api";
import type {Category} from "../../shared/model/categories";
import {emptyCategoryForm, type CategoryFormValues} from "./CategoryFormFields";
import type {CategorySettingsPanelsProps} from "./CategorySettingsModel";

export const revealEditorForm = (form: HTMLFormElement | null) => {
  if (!form || typeof form.scrollIntoView !== "function") return;
  form.scrollIntoView({block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
};

type UseCategoryEditorProps = Pick<CategorySettingsPanelsProps, "categories" | "load" | "setStatus" | "categoryIntent" | "onCategoryUpdated">;

export function useCategoryEditor({categories, load, setStatus, categoryIntent, onCategoryUpdated}: UseCategoryEditorProps) {
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [savingCategory, setSavingCategory] = useState(false);
  const savingCategoryRef = useRef(false);
  const categoryDraftsRef = useRef(new Map<number | "new", CategoryFormValues>());
  const [focusCategoryNameAfterSave, setFocusCategoryNameAfterSave] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const categoryFormRef = useRef<HTMLFormElement>(null);
  const categoryPanelOpen = categoryFormOpen || Boolean(editingCategoryId);

  useLayoutEffect(() => {
    if (!focusCategoryNameAfterSave || savingCategory) return;
    const nameInput = categoryFormRef.current?.querySelector<HTMLInputElement>("input[required]");
    if (!nameInput || nameInput.disabled) return;
    nameInput.focus({preventScroll: true});
    setFocusCategoryNameAfterSave(false);
  }, [focusCategoryNameAfterSave, savingCategory]);

  useLayoutEffect(() => {
    if (!categoryIntent || !categoryPanelOpen) return;
    window.requestAnimationFrame(() => {
      const form = categoryFormRef.current;
      if (!form) return;
      revealEditorForm(form);
      form.querySelector<HTMLInputElement>("input[required]")?.focus({preventScroll: true});
    });
  }, [categoryIntent?.token, categoryPanelOpen]);

  useEffect(() => {
    if (editingCategoryId === null) return;
    const active = categories.find((item) => item.id === editingCategoryId)?.active;
    if (active === undefined) return;
    setCategoryForm((current) => {
      if (current.active === active) return current;
      const next = {...current, active};
      categoryDraftsRef.current.set(editingCategoryId, next);
      return next;
    });
  }, [categories, editingCategoryId]);

  useEffect(() => {
    if (!categoryIntent) return;
    if (savingCategoryRef.current) {
      setStatus("Espera a que termine el guardado de la categoría antes de cambiar de editor.");
      return;
    }
    if (categoryPanelOpen) categoryDraftsRef.current.set(editingCategoryId ?? "new", categoryForm);
    const category = categoryIntent.id === null ? null : categories.find((item) => item.id === categoryIntent.id);
    const draftKey = category?.id ?? "new";
    const nextForm = categoryDraftsRef.current.get(draftKey) || (category ? {
      name: category.name,
      kind: category.kind,
      parent: String(category.parent_id || ""),
      color: category.color,
      icon: category.icon,
      active: category.active,
      exclude_from_analytics: category.exclude_from_analytics,
    } : emptyCategoryForm());
    setEditingCategoryId(category?.id ?? null);
    setCategoryForm(nextForm);
    categoryDraftsRef.current.set(draftKey, nextForm);
    setCategoryError("");
    setCategoryFormOpen(true);
  }, [categoryIntent?.token]);

  const toggleCategoryForm = () => {
    if (savingCategoryRef.current) return;
    if (categoryPanelOpen) {
      categoryDraftsRef.current.set(editingCategoryId ?? "new", categoryForm);
      setEditingCategoryId(null);
      setCategoryForm(emptyCategoryForm());
      setCategoryFormOpen(false);
    } else {
      setEditingCategoryId(null);
      setCategoryForm(categoryDraftsRef.current.get("new") || emptyCategoryForm());
      setCategoryFormOpen(true);
    }
    setCategoryError("");
  };

  const editCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryFormOpen(true);
    setCategoryForm({
      name: category.name,
      kind: category.kind,
      parent: String(category.parent_id || ""),
      color: category.color,
      icon: category.icon,
      active: category.active,
      exclude_from_analytics: category.exclude_from_analytics,
    });
  };

  const updateCategoryForm = (patch: Partial<CategoryFormValues>) => {
    setCategoryError("");
    setCategoryForm((current) => {
      const next = {...current, ...patch};
      categoryDraftsRef.current.set(editingCategoryId ?? "new", next);
      return next;
    });
  };

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingCategoryRef.current || !categoryForm.name.trim()) return;
    const wasEditing = Boolean(editingCategoryId);
    const draftKey = editingCategoryId ?? "new";
    savingCategoryRef.current = true;
    setSavingCategory(true);
    setCategoryError("");
    setStatus("");
    try {
      const response = editingCategoryId
        ? await settingsApi.updateCategory(editingCategoryId, categoryForm)
        : await settingsApi.createCategory(categoryForm);
      onCategoryUpdated?.(response.category);
    } catch (reason) {
      savingCategoryRef.current = false;
      setCategoryError(reason instanceof Error ? reason.message : "No se pudo guardar la categoría. Inténtalo de nuevo.");
      setSavingCategory(false);
      setFocusCategoryNameAfterSave(true);
      return;
    }

    categoryDraftsRef.current.delete(draftKey);
    setStatus(wasEditing ? "Categoría actualizada." : "Categoría creada.");
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm());
    try {
      await load();
    } catch {
      setCategoryError(wasEditing
        ? "La categoría se actualizó, pero no se pudo refrescar la lista. Actualiza Ajustes para comprobarlo."
        : "La categoría se creó, pero no se pudo refrescar la lista. Actualiza Ajustes para comprobarlo.");
    } finally {
      savingCategoryRef.current = false;
      setSavingCategory(false);
      setFocusCategoryNameAfterSave(true);
    }
  };

  return {
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
  };
}
