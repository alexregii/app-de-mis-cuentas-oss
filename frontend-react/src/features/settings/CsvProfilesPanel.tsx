import {useEffect, useRef, useState, type Dispatch, type SetStateAction} from "react";
import {motion, useReducedMotion} from "motion/react";
import {Import} from "lucide-react";
import {importsApi as api} from "../../shared/api/imports";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {ErrorBanner} from "../../shared/components/ui";
import type {ImportPayload} from "../../shared/model/imports";
import {Button} from "../../ui/controls/Button";
import {FormField, Input} from "../../ui/controls/FormField";
import {motionEase} from "../../shared/lib/motion";

type CsvProfilesPanelProps = {
  imports: ImportPayload;
  load: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
};

const emptyProfileForm = () => ({
  name: "",
  delimiter: ",",
  date_format: "%Y-%m-%d",
  date_column: "date",
  description_column: "description",
  amount_column: "amount",
  category_column: "category",
  subcategory_column: "subcategory",
});

export function CsvProfilesPanel({imports, load, setStatus}: CsvProfilesPanelProps) {
  const [csvProfilesOpen, setCsvProfilesOpen] = useState(false);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [savingProfile, setSavingProfile] = useState(false);
  const savingProfileRef = useRef(false);
  const profileFormRef = useRef<HTMLFormElement>(null);
  const [createdProfileId, setCreatedProfileId] = useState<number | null>(null);
  const [profileEntryReady, setProfileEntryReady] = useState(false);
  const profileEntryRef = useRef<HTMLDivElement | null>(null);
  const focusedCreatedProfileId = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
  const [profileError, setProfileError] = useState("");
  const updateProfileField = (field: keyof ReturnType<typeof emptyProfileForm>, value: string) => {
    setProfileError("");
    setProfileForm((current) => ({...current, [field]: value}));
  };
  const profileFormValid = Boolean(
    profileForm.name.trim()
    && profileForm.delimiter
    && profileForm.date_format.trim()
    && profileForm.date_column.trim()
    && profileForm.description_column.trim()
    && profileForm.amount_column.trim(),
  );
  useEffect(() => {
    if (savingProfile || createdProfileId === null || !profileEntryReady) return;
    const target = profileEntryRef.current || profileFormRef.current?.querySelector<HTMLInputElement>("input[required]");
    if (!target) return;
    focusedCreatedProfileId.current = createdProfileId;
    target.focus({preventScroll: true});
    const {top, bottom} = target.getBoundingClientRect();
    const safeBottom = window.innerHeight - 80;
    const delta = top < 16 ? top - 16 : bottom > safeBottom ? bottom - safeBottom + 16 : 0;
    if (delta) window.scrollTo({top: Math.max(0, window.scrollY + delta), behavior: reduceMotion ? "auto" : "smooth"});
    setProfileEntryReady(false);
  }, [savingProfile, createdProfileId, profileEntryReady, reduceMotion]);

  return (
    <CollapsiblePanel
      title="Perfiles CSV"
      detail="Define cómo interpretar las columnas de tus archivos CSV."
      className="settings-import-profiles"
      open={csvProfilesOpen}
      onToggle={() => setCsvProfilesOpen((value) => !value)}
      summary={<span>{imports.profiles.length} {imports.profiles.length === 1 ? "perfil guardado" : "perfiles guardados"}</span>}
    >
      {profileError ? <ErrorBanner message={profileError} /> : null}
      <form ref={profileFormRef} className="entry-form csv-profile-form" aria-busy={savingProfile} onSubmit={async (event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement) submitter.focus({preventScroll: true});
        if (savingProfileRef.current || !profileFormValid) return;
        savingProfileRef.current = true;
        setSavingProfile(true);
        setCreatedProfileId(null);
        setProfileEntryReady(false);
        profileEntryRef.current = null;
        focusedCreatedProfileId.current = null;
        setProfileError("");
        setStatus("");
        let createdId: number | null = null;
        try {
          const response = await api.createImportProfile(profileForm);
          createdId = response.profile.id;
          setCreatedProfileId(createdId);
          setStatus("Perfil CSV creado.");
          setProfileForm(emptyProfileForm());
          try {
            await load();
          } catch {
            setProfileError("El perfil se creó, pero no se pudo actualizar la lista. Actualiza Ajustes para comprobarlo.");
          }
        } catch (reason) {
          setProfileError(reason instanceof Error ? reason.message : "No se pudo guardar el perfil CSV. Inténtalo de nuevo.");
        } finally {
          savingProfileRef.current = false;
          setSavingProfile(false);
          if (createdId !== null && (reduceMotion || !profileEntryRef.current)) setProfileEntryReady(true);
        }
      }}>
        <FormField label="Nombre" fullWidth><Input type="text" required disabled={savingProfile} value={profileForm.name} onChange={(event) => updateProfileField("name", event.currentTarget.value)} /></FormField>
        <FormField label="Separador"><Input type="text" required disabled={savingProfile} value={profileForm.delimiter} onChange={(event) => updateProfileField("delimiter", event.currentTarget.value)} maxLength={1} /></FormField>
        <FormField label="Formato fecha"><Input type="text" required disabled={savingProfile} value={profileForm.date_format} onChange={(event) => updateProfileField("date_format", event.currentTarget.value)} /></FormField>
        <FormField label="Columna fecha"><Input type="text" required disabled={savingProfile} value={profileForm.date_column} onChange={(event) => updateProfileField("date_column", event.currentTarget.value)} /></FormField>
        <FormField label="Columna concepto" fullWidth><Input type="text" required disabled={savingProfile} value={profileForm.description_column} onChange={(event) => updateProfileField("description_column", event.currentTarget.value)} /></FormField>
        <FormField label="Columna importe"><Input type="text" required disabled={savingProfile} value={profileForm.amount_column} onChange={(event) => updateProfileField("amount_column", event.currentTarget.value)} /></FormField>
        <FormField label="Columna categoría"><Input type="text" disabled={savingProfile} value={profileForm.category_column} onChange={(event) => updateProfileField("category_column", event.currentTarget.value)} /></FormField>
        <FormField label="Columna subcategoría"><Input type="text" disabled={savingProfile} value={profileForm.subcategory_column} onChange={(event) => updateProfileField("subcategory_column", event.currentTarget.value)} /></FormField>
        <Button variant="primary" fullWidth type="submit" disabled={!profileFormValid} aria-disabled={savingProfile || !profileFormValid || undefined} aria-busy={savingProfile || undefined} onClick={(event) => event.currentTarget.focus({preventScroll: true})}><Import aria-hidden="true" /> {savingProfile ? "Guardando perfil…" : "Guardar perfil"}</Button>
      </form>
      <div className="stack-list compact-stack top-gap">
        {imports.profiles.map((profile) => (
          <motion.div ref={profile.id === createdProfileId ? profileEntryRef : undefined} onAnimationComplete={() => {if (profile.id === createdProfileId && focusedCreatedProfileId.current !== profile.id) setProfileEntryReady(true);}} role={profile.id === createdProfileId ? "group" : undefined} aria-label={profile.id === createdProfileId ? `Perfil ${profile.name}` : undefined} tabIndex={profile.id === createdProfileId ? -1 : undefined} layout={!reduceMotion} initial={profile.id === createdProfileId && !reduceMotion ? {height: 0, opacity: 0} : false} animate={{height: "auto", opacity: 1}} transition={reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase}} className={`list-card ${profile.id === createdProfileId ? "csv-profile-entry-motion" : ""}`} key={`profile-${profile.id}`}>
            <strong>{profile.name}</strong>
            <span>{profile.delimiter === "\t" ? "Separado por tabulador" : `Separador ${profile.delimiter}`}</span>
            <small>{profile.date_column} · {profile.description_column} · {profile.amount_column}</small>
          </motion.div>
        ))}
      </div>
    </CollapsiblePanel>
  );
}
