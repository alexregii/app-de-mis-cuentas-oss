import {useEffect, useRef, useState, type FormEvent} from "react";
import {X} from "lucide-react";
import {euro} from "../../format";
import {errorMessage} from "../../shared/lib/errors";
import type {Category} from "../../shared/model/categories";
import type {Transaction} from "../../shared/model/transactions";
import {Button} from "../../ui/controls/Button";
import {FormField, Input, Select} from "../../ui/controls/FormField";

export type AllocationDraft = {category_id: string; amount: string};
export type AllocationPayload = Array<{category_id: number | null; amount: string}>;

export function allocationDraftsFrom(transaction: {
  amount: number | string;
  category: Category | null | string;
  allocations?: Array<{category?: Category | null; category_id?: number | null; amount: number | string}>;
}): AllocationDraft[] {
  if (transaction.allocations?.length) {
    return transaction.allocations.map((item) => {
      const categoryId = "category_id" in item ? item.category_id : item.category?.id ?? null;
      return {category_id: categoryId === null ? "" : String(categoryId), amount: typeof item.amount === "number" ? item.amount.toFixed(2) : item.amount};
    });
  }
  const categoryId = typeof transaction.category === "string" ? transaction.category : transaction.category ? String(transaction.category.id) : "";
  return [{category_id: categoryId, amount: typeof transaction.amount === "number" ? transaction.amount.toFixed(2) : transaction.amount}];
}

export function allocationSumError(total: string, allocations: AllocationDraft[]) {
  const cents = (value: string) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  const totalCents = cents(total);
  const partCents = allocations.map((item) => cents(item.amount));
  if (totalCents === null || totalCents <= 0n) return "Indica primero el importe total del movimiento.";
  if (!allocations.length || partCents.some((part) => part === null || part <= 0n)) return "Cada partida necesita un importe positivo con hasta dos decimales.";
  if (new Set(allocations.map((item) => item.category_id)).size !== allocations.length) return "No repitas categorías; combina sus importes en una partida.";
  if (partCents.reduce<bigint>((sum, part) => sum + (part || 0n), 0n) !== totalCents) return "La suma de las partidas debe coincidir con el importe del movimiento.";
  return "";
}

export function allocationPayload(allocations: AllocationDraft[]): AllocationPayload {
  return allocations.map((item) => ({category_id: item.category_id ? Number(item.category_id) : null, amount: item.amount}));
}

export function TransactionAllocationEditor({kind, total, categories, allocations, linkedRefund = false, disabled = false, feedback = "", onChange}: {
  kind: "income" | "expense";
  total: string;
  categories: Category[];
  allocations: AllocationDraft[];
  linkedRefund?: boolean;
  disabled?: boolean;
  feedback?: string;
  onChange: (allocations: AllocationDraft[]) => void;
}) {
  const categoryOptions = categories.filter((category) => category.kind === kind);
  return <section className="transaction-allocation-editor ui-transaction-editor__full full" aria-labelledby="transaction-allocation-title">
    <div className="transaction-allocation-editor__heading">
      <h4 id="transaction-allocation-title">Distribución por categorías</h4>
      <p>{linkedRefund ? "Lo aplicado reduce primero el gasto original; el exceso sigue esta distribución." : "El movimiento conserva un único importe; reparte ese total entre las partidas."}</p>
    </div>
    <ol className="transaction-allocation-editor__list">
      {allocations.map((part, index) => {
        const selectedCategoryIds = new Set(allocations.filter((_, otherIndex) => otherIndex !== index).map((item) => item.category_id));
        return <li className="transaction-allocation-editor__row" key={index}>
          <FormField label={`Categoría de la partida ${index + 1}`}>
            <Select value={part.category_id} disabled={disabled} onChange={(event) => onChange(allocations.map((item, itemIndex) => itemIndex === index ? {...item, category_id: event.target.value} : item))}>
              <option value="">Sin categoría</option>
              {categoryOptions.filter((category) => !selectedCategoryIds.has(String(category.id))).map((category) => (
                <option key={category.id} value={category.id}>{category.display_name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={`Importe de la partida ${index + 1}`}>
            <Input className="money-input" type="number" inputMode="decimal" min="0.01" step="0.01" value={part.amount} disabled={disabled} onChange={(event) => onChange(allocations.map((item, itemIndex) => itemIndex === index ? {...item, amount: event.target.value} : item))} />
          </FormField>
          {allocations.length > 1 ? <Button variant="secondary" aria-label={`Quitar partida ${index + 1}`} disabled={disabled} onClick={() => onChange(allocations.filter((_, itemIndex) => itemIndex !== index))}><X aria-hidden="true" /></Button> : null}
        </li>;
      })}
    </ol>
    <div className="transaction-allocation-editor__footer">
      <Button variant="secondary" disabled={disabled || allocations.length >= 20} onClick={() => onChange([...allocations, {category_id: "", amount: ""}])}>Añadir partida</Button>
      {total && allocations.length ? <p className="transaction-allocation-editor__total"><span>Distribuido</span> <strong className="money">{euro(allocations.reduce((sum, part) => sum + (Number(part.amount) || 0), 0))}</strong><span>de</span> <strong className="money">{euro(Number(total) || 0)}</strong></p> : null}
    </div>
    {feedback ? <p className="transaction-allocation-editor__feedback" role="alert">{feedback}</p> : null}
  </section>;
}

export function TransactionAllocationForm({movement, categories, linkedRefund = false, onSave, onCancel}: {
  movement: Transaction;
  categories: Category[];
  linkedRefund?: boolean;
  onSave: (allocations: AllocationPayload, expectedRevision: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [allocations, setAllocations] = useState(() => allocationDraftsFrom(movement));
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const problem = allocationSumError(movement.amount.toFixed(2), allocations);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLSelectElement>("select")?.focus({preventScroll: true});
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setSaving(true);
    setFailure("");
    try {
      await onSave(allocationPayload(allocations), movement.allocation_revision ?? 0);
    } catch (error) {
      setFailure(errorMessage(error, "No se pudieron guardar las partidas."));
    } finally {
      setSaving(false);
    }
  };
  return <form ref={formRef} className="entry-form transaction-allocation-form" aria-busy={saving} onSubmit={submit}>
    <p className="transaction-allocation-form__movement">{movement.description} · <strong className="money">{euro(movement.amount)}</strong></p>
    <TransactionAllocationEditor
      kind={movement.kind === "income" ? "income" : "expense"}
      total={movement.amount.toFixed(2)}
      categories={categories}
      allocations={allocations}
      linkedRefund={linkedRefund}
      disabled={saving}
      feedback={failure || (touched ? problem : "")}
      onChange={(next) => {setAllocations(next); setTouched(true); setFailure("");}}
    />
    <div className="transaction-allocation-form__actions">
      <Button variant="primary" type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>{saving ? "Guardando…" : "Guardar partidas"}</Button>
      <Button variant="secondary" disabled={saving} onClick={onCancel}>Cancelar</Button>
    </div>
  </form>;
}
