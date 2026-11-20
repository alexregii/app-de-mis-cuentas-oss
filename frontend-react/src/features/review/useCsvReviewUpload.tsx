import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {LoadingPanel} from "../../shared/components/ui";
import {importsApi} from "../../shared/api/imports";
import type {ImportPayload} from "../../shared/model/imports";
import {Button} from "../../ui/controls/Button";
import {FormField, Select} from "../../ui/controls/FormField";

export function useCsvReviewUpload({imports, routeKey, selectionMode, csvBulkBusy, navigateToSettings, setCsvExpanded, onShowAllFilter, onExitSelectionMode, openCsvBatch, focusBatchDetails}: {
  imports: ImportPayload | null;
  routeKey: string;
  selectionMode: boolean;
  csvBulkBusy: boolean;
  navigateToSettings: (search: URLSearchParams) => void;
  setCsvExpanded: (expanded: boolean) => void;
  onShowAllFilter: () => void;
  onExitSelectionMode: () => void;
  openCsvBatch: (batchId: number) => Promise<void>;
  focusBatchDetails: () => void;
}): {trigger: ReactNode; form: ReactNode} {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState("");
  const [profile, setProfile] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadedBatch, setUploadedBatch] = useState<number | null>(null);
  const [batchReadError, setBatchReadError] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const focusInputRef = useRef(false);
  const focusAfterUploadRef = useRef(false);

  useEffect(() => {
    if (new URL(routeKey || window.location.href).searchParams.get("focus") !== "csv-import") return;
    setCsvExpanded(true);
    focusInputRef.current = true;
    setOpen(true);
  }, [routeKey, setCsvExpanded]);

  useLayoutEffect(() => {
    if (!open || !imports || !focusInputRef.current) return;
    focusInputRef.current = false;
    const input = inputRef.current;
    input?.focus({preventScroll: true});
    if (!input) return;
    const {top, bottom} = input.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) input.scrollIntoView({block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  }, [open, imports]);

  useLayoutEffect(() => {
    if (uploading || !focusAfterUploadRef.current) return;
    focusAfterUploadRef.current = false;
    inputRef.current?.focus({preventScroll: true});
  }, [uploading]);

  useEffect(() => {
    if (!imports) return;
    if (!imports.accounts.some((item) => String(item.id) === account)) setAccount(String(imports.accounts[0]?.id || ""));
  }, [imports, account]);

  useEffect(() => {
    if (!imports || imports.profiles.some((item) => String(item.id) === profile)) return;
    const preferred = imports.profiles.find((item) => item.id === imports.default_profile_id) || imports.profiles[0];
    setProfile(String(preferred?.id || ""));
  }, [imports, profile]);

  const reviewUploadedBatch = async () => {
    if (uploadedBatch === null) return;
    setBatchReadError(false);
    onShowAllFilter();
    onExitSelectionMode();
    try {
      await openCsvBatch(uploadedBatch);
      focusBatchDetails();
    } catch {
      setBatchReadError(true);
    }
  };

  const trigger = <Button variant="secondary" type="button" aria-expanded={open} aria-controls="review-csv-upload" disabled={uploading || csvBulkBusy || selectionMode} onClick={(event) => {
    event.currentTarget.focus({preventScroll: true});
    if (!open) focusInputRef.current = true;
    setOpen((value) => !value);
  }}>{open ? "Cerrar carga CSV" : "Importar CSV"}</Button>;

  const form = imports ? <form id="review-csv-upload" className="review-csv-upload" hidden={!open} aria-hidden={!open || undefined} inert={!open} aria-busy={uploading} onSubmit={async (event) => {
    event.preventDefault();
    if (!file || !account || !profile || pendingRef.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement) submitter.focus({preventScroll: true});
    pendingRef.current = true;
    const formData = new FormData();
    formData.set("account", account);
    formData.set("profile", profile);
    formData.set("file", file);
    setUploading(true);
    setUploadError("");
    setBatchReadError(false);
    setMessage("");
    try {
      const response = await importsApi.uploadImport(formData);
      setUploadedBatch(response.batch.id);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      focusAfterUploadRef.current = true;
      setMessage("CSV cargado a revisión. El lote está pendiente y todavía no se ha importado.");
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "No se pudo subir el CSV. Inténtalo de nuevo.");
    } finally {
      pendingRef.current = false;
      setUploading(false);
    }
  }}>
    {imports.accounts.length ? <FormField label="Cuenta"><Select required value={account} disabled={uploading} onChange={(event) => setAccount(event.target.value)}>{imports.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></FormField> : <p className="review-csv-profile-help">No hay cuentas activas para importar movimientos.</p>}
    <FormField label="Perfil"><Select required value={profile} disabled={uploading || !imports.profiles.length} onChange={(event) => setProfile(event.target.value)}>{imports.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></FormField>
    <label className="review-csv-file">Archivo CSV<input ref={inputRef} type="file" required disabled={uploading} accept=".csv,text/csv" onChange={(event) => {setUploadError(""); setFile(event.target.files?.[0] || null); setUploadedBatch(null); setMessage("");}} /></label>
    <Button variant="primary" type="submit" disabled={!file || !account || !profile} aria-disabled={uploading || !file || !account || !profile || undefined} aria-busy={uploading || undefined}>{uploading ? "Subiendo CSV…" : "Subir CSV"}</Button>
    {!imports.profiles.length ? <div className="review-csv-profile-help">Para subir un archivo necesitas un perfil CSV. <Button variant="secondary" type="button" onClick={() => navigateToSettings(new URLSearchParams("settings_section=imports"))}>Ir a Ajustes › Importación</Button></div> : null}
    {uploadError ? <p className="review-csv-upload-error" role="alert">{uploadError}</p> : null}
    {message ? <div className="review-csv-upload-success" role="status"><span>{message}</span>{uploadedBatch !== null ? <Button variant="secondary" type="button" onClick={() => void reviewUploadedBatch()}>Revisar lote</Button> : null}{batchReadError ? <><span role="alert">El CSV se guardó, pero no se pudieron cargar sus filas.</span><Button variant="secondary" type="button" onClick={() => void reviewUploadedBatch()}>Reintentar lectura</Button></> : null}</div> : null}
  </form> : open ? <LoadingPanel label="Cargando cuentas y perfiles CSV…" /> : null;

  return {trigger, form};
}
