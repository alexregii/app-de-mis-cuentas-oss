import {useLayoutEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction} from "react";
import type {Account} from "../../shared/model/accounts";
import {accountsApi as api} from "./api";

export type AccountFormValues = {
  name: string;
  kind: string;
  opening_balance: string;
  color: string;
  active: boolean;
};

export function revealAccountForm(getForm: () => HTMLFormElement | null, focusFirstField: boolean, reduceMotion: boolean | null) {
  window.requestAnimationFrame(() => {
    const focusOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const form = getForm();
    if (!form) return;
    const target = focusFirstField ? form.querySelector<HTMLElement>("input:not([type=checkbox])") : form;
    if (!target) return;
    const panel = form.closest<HTMLElement>(".collapsible-content");
    let frames = 0;
    const reveal = () => {
      if (!form.isConnected) return;
      const panelHeight = panel?.getBoundingClientRect().height ?? 0;
      const fullHeight = panel?.scrollHeight ?? panelHeight;
      if (reduceMotion === false && panel && panelHeight < fullHeight - 1 && frames++ < 60) {
        window.requestAnimationFrame(reveal);
        return;
      }
      const focusStillBelongs = !focusOrigin || document.activeElement === focusOrigin || document.activeElement === document.body;
      if (focusFirstField && !focusStillBelongs) return;
      target.scrollIntoView?.({block: "nearest", behavior: reduceMotion === false ? "smooth" : "auto"});
      if (focusFirstField) target.focus({preventScroll: true});
    };
    reveal();
  });
}

export function useAccountFormSubmission({
  accounts,
  editingAccountId,
  form,
  refresh,
  setEditingAccountId,
  setForm,
  setStatus,
  status,
}: {
  accounts: Account[];
  editingAccountId: number | null;
  form: AccountFormValues;
  refresh: () => Promise<void>;
  setEditingAccountId: Dispatch<SetStateAction<number | null>>;
  setForm: Dispatch<SetStateAction<AccountFormValues>>;
  setStatus: Dispatch<SetStateAction<string>>;
  status: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdAccountId, setCreatedAccountId] = useState<number | null>(null);
  const savingRef = useRef(false);
  const anchorRef = useRef<{element: HTMLElement; top: number} | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor?.element.isConnected) {
      const offset = anchor.element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(offset) > 0.5) window.scrollBy(0, offset);
    }
    if (!saving) {
      savingRef.current = false;
      anchorRef.current = null;
    }
  }, [accounts, error, saving, status]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    const initiator = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : event.currentTarget.querySelector<HTMLElement>("button[type='submit']");
    if (initiator) {
      initiator.scrollIntoView?.({block: "nearest", behavior: "auto"});
      initiator.focus({preventScroll: true});
      anchorRef.current = {element: initiator, top: initiator.getBoundingClientRect().top};
    }
    setError("");
    setStatus("");
    setSaving(true);
    const editingId = editingAccountId;
    let mutationCompleted = false;
    try {
      if (editingId) {
        await api.updateAccount(editingId, form);
        mutationCompleted = true;
        setStatus("Cuenta actualizada.");
      } else {
        const result = await api.createAccount(form);
        mutationCompleted = true;
        setCreatedAccountId(result.account.id);
        setStatus("Cuenta creada.");
      }
      setEditingAccountId(null);
      setForm({name: "", kind: "checking", opening_balance: "0", color: "#3478f6", active: true});
      try {
        await refresh();
      } catch (reason) {
        setError(`La cuenta se guardó, pero no se pudo actualizar la lista: ${reason instanceof Error ? reason.message : "inténtalo otra vez."}`);
      }
    } catch (reason) {
      setError(mutationCompleted
        ? `La cuenta se guardó, pero no se pudo actualizar la lista: ${reason instanceof Error ? reason.message : "inténtalo otra vez."}`
        : reason instanceof Error ? reason.message : "No se pudo guardar la cuenta.");
    } finally {
      setSaving(false);
    }
  };

  return {
    createdAccountId,
    error,
    saving,
    setError,
    submit,
    accountEntryComplete: (accountId: number) => {
      if (accountId === createdAccountId) setCreatedAccountId(null);
    },
  };
}
