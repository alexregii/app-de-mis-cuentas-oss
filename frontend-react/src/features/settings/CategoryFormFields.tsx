import {FormField, Input, Select} from "../../ui/controls/FormField";
import type {Category} from "../../shared/model/categories";

export type CategoryFormValues = {
  name: string;
  kind: Category["kind"];
  parent: string;
  color: string;
  icon: string;
  active: boolean;
  exclude_from_analytics: boolean;
};

export const emptyCategoryForm = (): CategoryFormValues => ({name: "", kind: "expense", parent: "", color: "#8e8e93", icon: "", active: true, exclude_from_analytics: false});

export function CategoryFormFields({categories, value, disabled, onChange}: {categories: Category[]; value: CategoryFormValues; disabled: boolean; onChange: (patch: Partial<CategoryFormValues>) => void}) {
  return <>
    <FormField label="Nombre" fullWidth><Input type="text" required disabled={disabled} value={value.name} onChange={(event) => onChange({name: event.target.value})} /></FormField>
    <FormField label="Tipo"><Select disabled={disabled} value={value.kind} onChange={(event) => onChange({kind: event.target.value as Category["kind"], parent: ""})}><option value="expense">Gasto</option><option value="income">Ingreso</option></Select></FormField>
    <FormField label="Principal"><Select disabled={disabled} value={value.parent} onChange={(event) => onChange({parent: event.target.value})}><option value="">Sin principal</option>{categories.filter((item) => item.kind === value.kind && !item.parent_id).map((category) => <option key={category.id} value={category.id}>{category.display_name}</option>)}</Select></FormField>
    <label>Color<input type="color" disabled={disabled} value={value.color} onChange={(event) => onChange({color: event.target.value})} /></label>
    <FormField label="Icono"><Input type="text" name="category_icon" autoComplete="off" disabled={disabled} value={value.icon} onChange={(event) => onChange({icon: event.target.value})} placeholder="wallet, bus…" /></FormField>
    <label className="check-row"><input type="checkbox" disabled={disabled} checked={value.exclude_from_analytics} onChange={(event) => onChange({exclude_from_analytics: event.target.checked})} />Excluir de estadísticas</label>
  </>;
}
