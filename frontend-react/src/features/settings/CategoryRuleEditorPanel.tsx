import {useState, type FormEventHandler, type Ref, type SyntheticEvent} from "react";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {ErrorBanner} from "../../shared/components/ui";
import type {Account} from "../../shared/model/accounts";
import type {Category} from "../../shared/model/categories";
import type {CategoryRule} from "./types";
import type {CategoryRuleFormValues} from "./CategorySettingsModel";
import {Button} from "../../ui/controls/Button";
import {FormField, Input, Select} from "../../ui/controls/FormField";
import {Save} from "lucide-react";

export function CategoryRuleEditorPanel({categories, accounts, count, editing, open, saving, error, form, formRef, summary, onToggle, onSubmit, onChange}: {
  categories: Category[];
  accounts: Account[];
  count: number;
  editing: boolean;
  open: boolean;
  saving: boolean;
  error: string;
  form: CategoryRuleFormValues;
  formRef: Ref<HTMLFormElement>;
  summary: string;
  onToggle: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onChange: (patch: Partial<CategoryRuleFormValues>) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(editing);

  return <CollapsiblePanel title={editing ? "Editar regla" : "Nueva regla"} detail="Define cuándo clasificar un movimiento; prueba antes de aplicar al histórico." open={open} onToggle={onToggle} summary={<span>{summary} guardada{count === 1 ? "" : "s"} para clasificar movimientos</span>}>
    <form ref={formRef} className="entry-form" aria-busy={saving} onSubmit={onSubmit}>
      <FormField label="Texto a reconocer" fullWidth><Input type="text" required disabled={saving} value={form.description} onChange={(event) => onChange({description: event.target.value})} placeholder="Ej.: SUPERMERCADO BARRIO" /></FormField>
      <FormField label="Tipo"><Select disabled={saving} value={form.kind} onChange={(event) => onChange({kind: event.target.value as CategoryRule["kind"], category: ""})}><option value="expense">Gasto</option><option value="income">Ingreso</option></Select></FormField>
      <FormField label="Categoría" fullWidth><Select required disabled={saving} value={form.category} onChange={(event) => onChange({category: event.target.value})}><option value="">Selecciona categoría</option>{categories.filter((item) => item.kind === form.kind).map((category) => <option key={category.id} value={category.id}>{category.display_name}</option>)}</Select></FormField>
      <details className="category-rule-advanced" open={advancedOpen} onToggle={(event: SyntheticEvent<HTMLDetailsElement>) => setAdvancedOpen(event.currentTarget.open)}>
        <summary>Condiciones avanzadas</summary>
        <div className="entry-form">
          <FormField label="Coincidencia"><Select disabled={saving} value={form.match_mode} onChange={(event) => onChange({match_mode: event.target.value as CategoryRule["match_mode"]})}><option value="exact">Es exactamente</option><option value="contains">Contiene</option><option value="starts_with">Empieza por</option><option value="ends_with">Termina en</option></Select></FormField>
          <FormField label="Cuenta (opcional)"><Select disabled={saving} value={form.account} onChange={(event) => onChange({account: event.target.value})}><option value="">Cualquier cuenta</option>{accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></FormField>
          <FormField label="Importe mínimo"><Input disabled={saving} type="number" min="0" step="0.01" inputMode="decimal" value={form.amount_min} onChange={(event) => onChange({amount_min: event.target.value})} placeholder="Sin mínimo" /></FormField>
          <FormField label="Importe máximo"><Input disabled={saving} type="number" min="0" step="0.01" inputMode="decimal" value={form.amount_max} onChange={(event) => onChange({amount_max: event.target.value})} placeholder="Sin máximo" /></FormField>
          <FormField label="Prioridad"><Input disabled={saving} type="number" min="1" step="1" value={form.priority} onChange={(event) => onChange({priority: event.target.value})} /></FormField>
          <label className="check-row"><input type="checkbox" disabled={saving} checked={form.active} onChange={(event) => onChange({active: event.target.checked})} />Regla activa</label>
        </div>
      </details>
      <Button variant="primary" fullWidth type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={(event) => event.currentTarget.focus({preventScroll: true})}><Save aria-hidden="true" /> {saving ? "Guardando regla…" : "Guardar regla"}</Button>
    </form>
    {error ? <ErrorBanner message={error} /> : null}
  </CollapsiblePanel>;
}
