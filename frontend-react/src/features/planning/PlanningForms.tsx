import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {Loader2, Repeat2, Save} from "lucide-react";
import {todayInputValue} from "../../format";
import {ApiError} from "../../shared/api/client";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {FieldError} from "../../shared/components/FieldError";
import {ErrorBanner, StatusBanner} from "../../shared/components/ui";
import type {Budget, PlanningPayload, RecurringRule} from "../../shared/model/planning";
import {planningApi as api} from "./api";
import {FormField, Input, Select, Textarea} from "../../ui/controls/FormField";
import {Button} from "../../ui/controls/Button";

type ComposerKind = "budget" | "recurring";
type FocusRequest = {kind: ComposerKind; token: number} | null;
type PreparedBudget = {
  key: string;
  month: string;
  categoryId: number;
  categoryName: string;
  existingBudget: Budget | null;
};

const emptyBudget = (month: string) => ({month, category: "", limit: ""});
const emptyRule = () => ({
  name: "",
  kind: "expense",
  amount: "",
  account: "",
  category: "",
  frequency: "monthly",
  day_of_month: String(new Date().getDate()),
  start_date: todayInputValue(),
  end_date: "",
  notes: "",
  active: true,
});

const focusFirstControl = (form: HTMLFormElement | null, errors?: Record<string, string[]>) => {
  const firstError = errors && Object.keys(errors)[0];
  const target = firstError
    ? form?.elements.namedItem(firstError)
    : form?.querySelector<HTMLElement>("input, select, textarea");
  if (target instanceof HTMLElement) target.focus();
};

export function PlanningForms({
  planning,
  selectedMonth,
  preparedBudget = null,
  editingBudget,
  editingRule,
  focusRequest,
  onCancelEdit,
  onSaved,
}: {
  planning: PlanningPayload;
  selectedMonth: string;
  preparedBudget?: PreparedBudget | null;
  editingBudget: Budget | null;
  editingRule: RecurringRule | null;
  focusRequest: FocusRequest;
  onCancelEdit: (kind: ComposerKind) => void;
  onSaved: (kind: ComposerKind, id: number, message: string) => Promise<void>;
}) {
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState(emptyBudget(selectedMonth));
  const [budgetDraftDirty, setBudgetDraftDirty] = useState(false);
  const [preparedEditingBudget, setPreparedEditingBudget] = useState<Budget | null>(null);
  const [preparedBudgetNotice, setPreparedBudgetNotice] = useState("");
  const [preparedBudgetFocusToken, setPreparedBudgetFocusToken] = useState(0);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [budgetErrors, setBudgetErrors] = useState<Record<string, string[]>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string[]>>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState<ComposerKind | "">("");
  const budgetRef = useRef<HTMLFormElement>(null);
  const ruleRef = useRef<HTMLFormElement>(null);
  const submitAnchorsRef = useRef<Partial<Record<ComposerKind, {panel: HTMLElement; trigger: HTMLButtonElement; top: number}>>>({});
  const processedPreparedBudgetKey = useRef("");
  const activeEditingBudget = editingBudget ?? preparedEditingBudget;

  useEffect(() => {
    if (!editingBudget) return;
    setPreparedEditingBudget(null);
    setBudgetDraftDirty(true);
    setBudgetOpen(true);
    setBudgetForm({month: editingBudget.month, category: String(editingBudget.category.id), limit: String(editingBudget.limit)});
  }, [editingBudget]);

  useEffect(() => {
    if (!budgetOpen && !activeEditingBudget && !budgetDraftDirty) setBudgetForm((current) => ({...current, month: selectedMonth}));
  }, [activeEditingBudget, budgetDraftDirty, budgetOpen, selectedMonth]);

  useEffect(() => {
    if (!preparedBudget) {
      processedPreparedBudgetKey.current = "";
      setPreparedBudgetNotice("");
      return;
    }
    if (processedPreparedBudgetKey.current === preparedBudget.key) return;
    processedPreparedBudgetKey.current = preparedBudget.key;
    setBudgetOpen(true);
    setPreparedBudgetFocusToken((current) => current + 1);
    if (budgetDraftDirty || activeEditingBudget || budgetForm.category || budgetForm.limit) {
      setPreparedBudgetNotice("Se conservó el borrador que ya estabas preparando; el pico no ha cambiado su categoría, mes ni límite.");
      return;
    }
    setPreparedEditingBudget(preparedBudget.existingBudget);
    setBudgetForm({
      month: preparedBudget.month,
      category: String(preparedBudget.categoryId),
      limit: preparedBudget.existingBudget ? String(preparedBudget.existingBudget.limit) : "",
    });
    setBudgetDraftDirty(true);
    setPreparedBudgetNotice(preparedBudget.existingBudget
      ? `Ya existe un presupuesto para ${preparedBudget.categoryName}; revisa el límite antes de guardarlo.`
      : `Presupuesto preparado para ${preparedBudget.categoryName}. No se ha guardado.`);
  }, [activeEditingBudget, budgetDraftDirty, budgetForm.category, budgetForm.limit, preparedBudget]);

  useEffect(() => {
    if (!editingRule) return;
    setRecurringOpen(true);
    setRuleForm({
      name: editingRule.name,
      kind: editingRule.kind,
      amount: String(editingRule.amount),
      account: String(editingRule.account.id),
      category: String(editingRule.category.id),
      frequency: editingRule.frequency,
      day_of_month: String(editingRule.day_of_month),
      start_date: editingRule.start_date,
      end_date: editingRule.end_date,
      notes: editingRule.notes,
      active: editingRule.active,
    });
  }, [editingRule]);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === "budget") setBudgetOpen(true);
    else setRecurringOpen(true);
  }, [focusRequest]);

  useLayoutEffect(() => {
    if (!focusRequest) return;
    const form = focusRequest.kind === "budget" ? budgetRef.current : ruleRef.current;
    if (form) focusFirstControl(form);
  }, [focusRequest, budgetOpen, recurringOpen]);

  useLayoutEffect(() => {
    if (!preparedBudgetFocusToken || !budgetOpen) return;
    const limit = budgetRef.current?.elements.namedItem("limit");
    if (limit instanceof HTMLElement) limit.focus({preventScroll: true});
    setPreparedBudgetFocusToken(0);
  }, [activeEditingBudget, budgetOpen, preparedBudgetFocusToken]);

  useLayoutEffect(() => {
    for (const kind of ["budget", "recurring"] as const) {
      const anchor = submitAnchorsRef.current[kind];
      if (!anchor) continue;
      if (!anchor.trigger.isConnected || !anchor.panel.isConnected) {
        delete submitAnchorsRef.current[kind];
        continue;
      }
      const delta = anchor.panel.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) window.scrollTo({top: Math.max(0, window.scrollY + delta), behavior: "instant"});
      if (kind === "budget" ? !budgetOpen : !recurringOpen) {
        delete submitAnchorsRef.current[kind];
        anchor.trigger.focus({preventScroll: true});
      }
    }
  }, [budgetOpen, recurringOpen, planning, saving, submitError]);

  const expenseCategories = planning.categories.filter((item) => item.kind === "expense" && item.active);
  const activeAccounts = planning.accounts.filter((item) => item.active);

  const cancelBudgetEdit = () => {
    setBudgetForm(emptyBudget(selectedMonth));
    setBudgetDraftDirty(false);
    setPreparedEditingBudget(null);
    setPreparedBudgetNotice("");
    processedPreparedBudgetKey.current = "";
    setBudgetErrors({});
    setSubmitError("");
    setBudgetOpen(false);
    onCancelEdit("budget");
  };

  const cancelRuleEdit = () => {
    setRuleForm(emptyRule());
    setRuleErrors({});
    setSubmitError("");
    setRecurringOpen(false);
    onCancelEdit("recurring");
  };

  const rememberSubmitAnchor = (kind: ComposerKind) => {
    if (submitAnchorsRef.current[kind]) return;
    const form = kind === "budget" ? budgetRef.current : ruleRef.current;
    const panel = form?.closest<HTMLElement>(".collapsible-panel");
    const trigger = panel?.querySelector<HTMLButtonElement>(".disclosure-button");
    if (panel && trigger) submitAnchorsRef.current[kind] = {panel, trigger, top: panel.getBoundingClientRect().top};
  };

  const captureError = (error: unknown, kind: ComposerKind) => {
    const fieldErrors = error instanceof ApiError ? error.errors || {} : {};
    if (kind === "budget") setBudgetErrors(fieldErrors);
    else setRuleErrors(fieldErrors);
    setSubmitError(error instanceof Error ? error.message : "No se pudo guardar. Revisa los datos e inténtalo otra vez.");
    if (Object.keys(fieldErrors).length) {
      window.setTimeout(() => focusFirstControl(kind === "budget" ? budgetRef.current : ruleRef.current, fieldErrors), 0);
    }
  };

  return (
    <section className="planning-composers" aria-label="Añadir elementos al seguimiento">
      {submitError ? <ErrorBanner message={submitError} /> : null}
      {preparedBudgetNotice ? <StatusBanner message={preparedBudgetNotice} /> : null}
      <div className="dual-grid">
        <CollapsiblePanel
          title={activeEditingBudget ? "Editar presupuesto" : "Nuevo presupuesto"}
          detail="Límite de gasto de una categoría para un mes."
          open={budgetOpen || Boolean(activeEditingBudget)}
          onToggle={() => {
            if (activeEditingBudget) cancelBudgetEdit();
            else setBudgetOpen((value) => !value);
          }}
          summary={<span>{planning.budgets.length} en {planning.period.month}</span>}
        >
          <form
            ref={budgetRef}
            className="entry-form"
            aria-busy={saving === "budget"}
            noValidate={false}
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              rememberSubmitAnchor("budget");
              setSaving("budget");
              setSubmitError("");
              setBudgetErrors({});
              try {
                const response = activeEditingBudget
                  ? await api.updateBudget(activeEditingBudget.id, budgetForm)
                  : await api.createBudget(budgetForm);
                await onSaved("budget", response.budget.id, activeEditingBudget ? "Presupuesto actualizado." : "Presupuesto guardado.");
                setBudgetForm(emptyBudget(selectedMonth));
                setBudgetOpen(false);
                setBudgetDraftDirty(false);
                setPreparedEditingBudget(null);
                setPreparedBudgetNotice("");
                processedPreparedBudgetKey.current = "";
                onCancelEdit("budget");
              } catch (error) {
                captureError(error, "budget");
              } finally {
                setSaving("");
              }
            }}
          >
            <FormField label="Mes" error={<FieldError errors={budgetErrors} name="month" id="budget-month-error" />}>
              <Input name="month" type="month" required value={budgetForm.month} onChange={(event) => {setBudgetDraftDirty(true); setBudgetForm((current) => ({...current, month: event.target.value}));}} aria-invalid={Boolean(budgetErrors.month)} aria-describedby={budgetErrors.month ? "budget-month-error" : undefined} />
            </FormField>
            <FormField label="Límite" error={<FieldError errors={budgetErrors} name="limit" id="budget-limit-error" />}>
              <Input className="money-input" name="limit" type="number" inputMode="decimal" min="0.01" step="0.01" required value={budgetForm.limit} onChange={(event) => {setBudgetDraftDirty(true); setBudgetForm((current) => ({...current, limit: event.target.value}));}} aria-invalid={Boolean(budgetErrors.limit)} aria-describedby={budgetErrors.limit ? "budget-limit-error" : undefined} />
            </FormField>
            <FormField label="Categoría" fullWidth error={<FieldError errors={budgetErrors} name="category" id="budget-category-error" />}>
              <Select name="category" required value={budgetForm.category} onChange={(event) => {setBudgetDraftDirty(true); setBudgetForm((current) => ({...current, category: event.target.value}));}} aria-invalid={Boolean(budgetErrors.category)} aria-describedby={budgetErrors.category ? "budget-category-error" : undefined}>
                <option value="">Selecciona categoría</option>
                {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.display_name}</option>)}
              </Select>
            </FormField>
            {activeEditingBudget ? <Button variant="secondary" fullWidth disabled={Boolean(saving)} onClick={cancelBudgetEdit}>Cancelar edición</Button> : null}
            <Button variant="primary" fullWidth type="submit" aria-disabled={Boolean(saving) || undefined} aria-busy={saving === "budget" || undefined}>
              {saving === "budget" ? <Loader2 className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {saving === "budget" ? "Guardando…" : "Guardar presupuesto"}
            </Button>
          </form>
        </CollapsiblePanel>

        <CollapsiblePanel
          title={editingRule ? "Editar recurrente" : "Nuevo recurrente"}
          detail="Ingreso o pago que se repite."
          open={recurringOpen || Boolean(editingRule)}
          onToggle={() => {
            if (editingRule) cancelRuleEdit();
            else setRecurringOpen((value) => !value);
          }}
          summary={<span>{planning.rules.filter((rule) => rule.lifecycle === "active").length} activos</span>}
        >
          <form
            ref={ruleRef}
            className="entry-form"
            aria-busy={saving === "recurring"}
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              const domainErrors: Record<string, string[]> = {};
              if (ruleForm.end_date && ruleForm.end_date < ruleForm.start_date) domainErrors.end_date = ["La fecha de fin no puede ser anterior al inicio."];
              if (Object.keys(domainErrors).length) {
                setRuleErrors(domainErrors);
                window.setTimeout(() => focusFirstControl(ruleRef.current, domainErrors), 0);
                return;
              }
              rememberSubmitAnchor("recurring");
              setSaving("recurring");
              setSubmitError("");
              setRuleErrors({});
              try {
                const response = editingRule
                  ? await api.updateRecurringRule(editingRule.id, ruleForm)
                  : await api.createRecurringRule(ruleForm);
                await onSaved("recurring", response.rule.id, editingRule ? "Recurrente actualizado." : "Recurrente guardado.");
                setRuleForm(emptyRule());
                setRecurringOpen(false);
                onCancelEdit("recurring");
              } catch (error) {
                captureError(error, "recurring");
              } finally {
                setSaving("");
              }
            }}
          >
            <FormField label="Nombre" fullWidth error={<FieldError errors={ruleErrors} name="name" id="rule-name-error" />}><Input name="name" type="text" required maxLength={120} value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({...current, name: event.target.value}))} aria-invalid={Boolean(ruleErrors.name)} aria-describedby={ruleErrors.name ? "rule-name-error" : undefined} /></FormField>
            <FormField label="Tipo"><Select name="kind" required value={ruleForm.kind} onChange={(event) => setRuleForm((current) => ({...current, kind: event.target.value, category: ""}))}><option value="expense">Gasto</option><option value="income">Ingreso</option></Select></FormField>
            <FormField label="Importe" error={<FieldError errors={ruleErrors} name="amount" id="rule-amount-error" />}><Input className="money-input" name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={ruleForm.amount} onChange={(event) => setRuleForm((current) => ({...current, amount: event.target.value}))} aria-invalid={Boolean(ruleErrors.amount)} aria-describedby={ruleErrors.amount ? "rule-amount-error" : undefined} /></FormField>
            <FormField label="Cuenta" error={<FieldError errors={ruleErrors} name="account" id="rule-account-error" />}><Select name="account" required value={ruleForm.account} onChange={(event) => setRuleForm((current) => ({...current, account: event.target.value}))} aria-invalid={Boolean(ruleErrors.account)} aria-describedby={ruleErrors.account ? "rule-account-error" : undefined}><option value="">Selecciona cuenta</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></FormField>
            <FormField label="Categoría" error={<FieldError errors={ruleErrors} name="category" id="rule-category-error" />}><Select name="category" required value={ruleForm.category} onChange={(event) => setRuleForm((current) => ({...current, category: event.target.value}))} aria-invalid={Boolean(ruleErrors.category)} aria-describedby={ruleErrors.category ? "rule-category-error" : undefined}><option value="">Selecciona categoría</option>{planning.categories.filter((item) => item.active && item.kind === ruleForm.kind).map((category) => <option key={category.id} value={category.id}>{category.display_name}</option>)}</Select></FormField>
            <FormField label="Frecuencia"><Select name="frequency" required value={ruleForm.frequency} onChange={(event) => setRuleForm((current) => ({...current, frequency: event.target.value}))}><option value="monthly">Mensual</option><option value="yearly">Anual</option></Select></FormField>
            <FormField label="Día" error={<FieldError errors={ruleErrors} name="day_of_month" id="rule-day-error" />}><Input name="day_of_month" type="number" inputMode="numeric" min="1" max="31" required value={ruleForm.day_of_month} onChange={(event) => setRuleForm((current) => ({...current, day_of_month: event.target.value}))} aria-invalid={Boolean(ruleErrors.day_of_month)} aria-describedby={ruleErrors.day_of_month ? "rule-day-error" : undefined} /></FormField>
            <FormField label="Inicio" error={<FieldError errors={ruleErrors} name="start_date" id="rule-start-error" />}><Input name="start_date" type="date" required value={ruleForm.start_date} onChange={(event) => setRuleForm((current) => ({...current, start_date: event.target.value}))} aria-invalid={Boolean(ruleErrors.start_date)} aria-describedby={ruleErrors.start_date ? "rule-start-error" : undefined} /></FormField>
            <FormField label="Fin" hint="(opcional)" error={<FieldError errors={ruleErrors} name="end_date" id="rule-end-error" />}><Input name="end_date" type="date" min={ruleForm.start_date} value={ruleForm.end_date} onChange={(event) => setRuleForm((current) => ({...current, end_date: event.target.value}))} aria-invalid={Boolean(ruleErrors.end_date)} aria-describedby={ruleErrors.end_date ? "rule-end-error" : undefined} /></FormField>
            <FormField label="Notas" hint="(opcional)" fullWidth><Textarea name="notes" rows={2} value={ruleForm.notes} onChange={(event) => setRuleForm((current) => ({...current, notes: event.target.value}))} /></FormField>
            {editingRule ? <Button variant="secondary" fullWidth disabled={Boolean(saving)} onClick={cancelRuleEdit}>Cancelar edición</Button> : null}
            <Button variant="primary" fullWidth type="submit" aria-disabled={Boolean(saving) || undefined} aria-busy={saving === "recurring" || undefined}>
              {saving === "recurring" ? <Loader2 className="spin" aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}
              {saving === "recurring" ? "Guardando…" : "Guardar recurrente"}
            </Button>
          </form>
        </CollapsiblePanel>
      </div>
    </section>
  );
}
