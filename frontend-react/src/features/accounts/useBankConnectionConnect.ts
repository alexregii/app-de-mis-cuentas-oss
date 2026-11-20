import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {accountsApi} from "./api";
import {errorMessage} from "../../shared/lib/errors";
import type {BankDirectory} from "./types";

export function useBankConnectionConnect({bankingConfigured, showBankConnect}: {bankingConfigured: boolean; showBankConnect: boolean}) {
  const [bankDirectory, setBankDirectory] = useState<BankDirectory | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [selectedBankName, setSelectedBankName] = useState("");
  const [authorizationError, setAuthorizationError] = useState("");
  const [connectingBank, setConnectingBank] = useState(false);
  const directoryRequest = useRef(false);
  const authorizationRequest = useRef(false);
  const focusBankSelect = useRef(false);
  const bankSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!showBankConnect || bankDirectory || !bankingConfigured) return;
    let active = true;
    directoryRequest.current = true;
    setDirectoryLoading(true);
    accountsApi.bankConnectOptions()
      .then((payload) => {
        if (!active) return;
        setBankDirectory(payload);
        setSelectedBankName(payload.banks[0]?.name || "");
        setDirectoryError("");
      })
      .catch((reason) => {
        if (active) setDirectoryError(errorMessage(reason, "No se pudo cargar el directorio de bancos."));
      })
      .finally(() => {
        if (!active) return;
        directoryRequest.current = false;
        setDirectoryLoading(false);
      });
    return () => { active = false; };
  }, [bankDirectory, bankingConfigured, directoryAttempt, showBankConnect]);

  useLayoutEffect(() => {
    if (!bankDirectory || !focusBankSelect.current) return;
    bankSelectRef.current?.focus({preventScroll: true});
    focusBankSelect.current = false;
  }, [bankDirectory]);

  const retryBankDirectory = (trigger: HTMLButtonElement) => {
    if (directoryRequest.current) return;
    focusBankSelect.current = true;
    trigger.focus({preventScroll: true});
    setDirectoryAttempt((current) => current + 1);
  };

  const startBankAuthorization = async (returnTo: string) => {
    if (authorizationRequest.current || !selectedBankName) return;
    authorizationRequest.current = true;
    setConnectingBank(true);
    setAuthorizationError("");
    try {
      const payload = await accountsApi.startBankConnect({bank_name: selectedBankName, bank_country: "ES", return_to: returnTo});
      window.location.assign(payload.url);
    } catch (reason) {
      setAuthorizationError(errorMessage(reason, "No se pudo iniciar la conexión con el banco."));
    } finally {
      authorizationRequest.current = false;
      setConnectingBank(false);
    }
  };

  return {
    authorizationError,
    bankDirectory,
    bankSelectRef,
    connectingBank,
    directoryError,
    directoryLoading,
    retryBankDirectory,
    selectedBankName,
    setSelectedBankName,
    startBankAuthorization,
  };
}
