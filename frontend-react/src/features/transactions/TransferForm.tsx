import {useEffect, useRef, useState} from "react";
import {ArrowLeftRight, Loader2} from "lucide-react";
import {ErrorBanner} from "../../shared/components/ui";
import {errorMessage} from "../../shared/lib/errors";
import type {Account} from "../../shared/model/accounts";
import type {TransferInput} from "./types";
import {emptyTransfer} from "./transactionModel";
import {Button} from "../../ui/controls/Button";
import {FormField, Input, Select, Textarea} from "../../ui/controls/FormField";

export function TransferForm({
  accounts,
  onSubmit,
  errors,
}: {
  accounts: Account[];
  errors?: Record<string, string[]>;
  onSubmit: (input: TransferInput) => Promise<void>;
}) {
  const [input, setInput] = useState<TransferInput>(emptyTransfer);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    if (!input.source_account && accounts[0]) {
      setInput((current) => ({
        ...current,
        source_account: String(accounts[0].id),
        target_account: String(accounts[1]?.id || ""),
      }));
    }
  }, [accounts, input.source_account]);

  return (
    <form
      className="entry-form"
      autoComplete="off"
      aria-busy={saving}
      onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true;
        event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus({preventScroll: true});
        setSaving(true);
        setSubmitError("");
        try {
          await onSubmit(input);
          setInput((current) => ({...emptyTransfer, source_account: current.source_account, target_account: current.target_account}));
        } catch (error) {
          setSubmitError(errorMessage(error, "No se pudo registrar el traspaso."));
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      }}
    >
      <div className="form-block full">
        <h3>Traspaso entre cuentas</h3>
      </div>
      {submitError ? <div className="full"><ErrorBanner message={submitError} /></div> : null}
      <FormField label="Origen" error={errors?.source_account?.join(" ")}>
        <Select name="source_account" required value={input.source_account} onChange={(event) => setInput((current) => ({...current, source_account: event.target.value}))}>
          {accounts.filter((item) => item.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </Select>
      </FormField>
      <FormField label="Destino" error={errors?.target_account?.join(" ")}>
        <Select name="target_account" required value={input.target_account} onChange={(event) => setInput((current) => ({...current, target_account: event.target.value}))}>
          <option value="">Selecciona cuenta</option>
          {accounts.filter((item) => item.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </Select>
      </FormField>
      <FormField label="Importe" error={errors?.amount?.join(" ")}>
        <Input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required value={input.amount} onChange={(event) => setInput((current) => ({...current, amount: event.target.value}))} />
      </FormField>
      <FormField label="Fecha">
        <Input name="date" type="date" required value={input.date} onChange={(event) => setInput((current) => ({...current, date: event.target.value}))} />
      </FormField>
      <FormField label="Concepto" fullWidth>
        <Input name="description" type="text" required value={input.description} onChange={(event) => setInput((current) => ({...current, description: event.target.value}))} />
      </FormField>
      <FormField label="Notas" fullWidth>
        <Textarea name="notes" rows={2} value={input.notes} onChange={(event) => setInput((current) => ({...current, notes: event.target.value}))} />
      </FormField>
      <Button className="full" variant="secondary" fullWidth type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>
        {saving ? <Loader2 aria-hidden="true" className="spin" /> : <ArrowLeftRight aria-hidden="true" />}
        {saving ? "Registrando…" : "Registrar traspaso"}
      </Button>
    </form>
  );
}
