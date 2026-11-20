import type {Dispatch, FormEvent, ReactNode, SetStateAction} from "react";
import {AnimatePresence, motion, useIsPresent, useReducedMotion} from "motion/react";
import {CalendarRange, ListFilter, Loader2, SlidersHorizontal} from "lucide-react";
import {todayInputValue} from "../../../format";
import {Panel, SectionHeader} from "../../../shared/components/ui";
import {motionEase} from "../../../shared/lib/motion";
import {SegmentedControl, SegmentedItem} from "../../../ui/controls/SegmentedControl";
import {Button, TextButton} from "../../../ui/controls/Button";
import {FormField, Input} from "../../../ui/controls/FormField";
import {PageHeader} from "../../../ui/layout/PageHeader";
import type {StatisticsBasis, StatisticsDateRange, StatisticsPeriod, StatisticsScope} from "../types";

function StatisticsFilterDisclosure({children}: {children: ReactNode}) {
  const reduceMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const transition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  return <motion.div
    className="stats-filter-disclosure"
    aria-hidden={!isPresent}
    inert={!isPresent}
    initial={reduceMotion ? false : {height: 0, opacity: 0, y: -3}}
    animate={{height: "auto", opacity: 1, y: 0}}
    exit={reduceMotion ? {height: 0, opacity: 0} : {height: 0, opacity: 0, y: -3}}
    transition={transition}
    style={{overflow: "hidden"}}
  >{children}</motion.div>;
}

export function StatisticsScopeToolbar({
  basis,
  activeFilterCount,
  editOpen,
  reportPending,
  scope,
  onEdit,
}: {
  basis: StatisticsBasis;
  activeFilterCount: number;
  editOpen: boolean;
  reportPending: boolean;
  scope: StatisticsScope | null;
  onEdit: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <PageHeader title="Estadísticas" className="stats-page-header" actions={<div className="stats-scope-toolbar">
      <div className="stats-scope-meta" aria-live="polite">
        <strong>{scope?.label || "Preparando periodo"}</strong>
        <span>{scope?.basis_label || (basis === "analytics" ? "Categorías analíticas" : "Todas las categorías")}</span>
        {!editOpen && activeFilterCount ? <span className="status-chip">{activeFilterCount} {activeFilterCount === 1 ? "filtro activo" : "filtros activos"}</span> : null}
        {scope?.is_partial ? <span className="status-chip">Incluye periodo parcial</span> : null}
      </div>
      {reportPending ? <span className="sr-status" role="status" aria-live="polite" aria-atomic="true">Actualizando el informe…</span> : null}
      <Button
        variant="secondary"
        className="stats-edit-scope"
        aria-expanded={editOpen}
        aria-controls={editOpen ? "statistics-filters" : undefined}
        aria-label="Cambiar informe"
        onClick={(event) => {event.currentTarget.focus({preventScroll: true}); onEdit();}}
      >
        {reportPending ? <Loader2 aria-hidden="true" className={reduceMotion ? "" : "spin"} /> : <SlidersHorizontal aria-hidden="true" />}
        <span className="stats-edit-label-full">Cambiar informe</span>
        <span className="stats-edit-label-compact" aria-hidden="true">Cambiar</span>
      </Button>
    </div>} />
  );
}

export function StatisticsFilters({
  basis,
  customApplyPending,
  customEditorOpen,
  draftRange,
  period,
  rangeError,
  reportPending,
  open,
  onClose,
  applyCustomRange,
  openCustomEditor,
  resetFilters,
  selectPreset,
  setBasis,
  setDraftRange,
}: {
  basis: StatisticsBasis;
  customApplyPending: boolean;
  customEditorOpen: boolean;
  draftRange: StatisticsDateRange;
  period: StatisticsPeriod;
  rangeError: string;
  reportPending: boolean;
  open: boolean;
  onClose: () => void;
  applyCustomRange: () => boolean;
  openCustomEditor: () => void;
  resetFilters: () => void;
  selectPreset: (period: Exclude<StatisticsPeriod, "custom">) => void;
  setBasis: (basis: StatisticsBasis) => void;
  setDraftRange: Dispatch<SetStateAction<StatisticsDateRange>>;
}) {
  const submitRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement) submitter.focus({preventScroll: true});
    if (customApplyPending) return;
    applyCustomRange();
  };

  const activeFilterCount = Number(period !== "12") + Number(basis !== "analytics");

  return (
    <AnimatePresence initial={false}>
    {open ? <StatisticsFilterDisclosure key="statistics-filter-panel"><Panel className="stats-filter-panel" id="statistics-filters" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
      <SectionHeader
        title="Cambiar periodo y base"
        detail={<span className="stats-filter-status">
          <span aria-hidden={Boolean(activeFilterCount)} style={{visibility: activeFilterCount ? "hidden" : "visible"}}>Informe estándar: 12 meses y categorías analíticas.</span>
          <span aria-hidden={!activeFilterCount} style={{visibility: activeFilterCount ? "visible" : "hidden"}}>{activeFilterCount} {activeFilterCount === 1 ? "filtro activo" : "filtros activos"}.</span>
        </span>}
        action={<TextButton className="stats-filter-close" onClick={onClose}>Cerrar</TextButton>}
      />
      <div className="stats-filter-groups">
        <fieldset className="stats-filter-group">
          <legend><CalendarRange aria-hidden="true" />Periodo</legend>
          <SegmentedControl className="stats-period-options" aria-label="Periodo">
            {(["3", "6", "12"] as const).map((value) => (
              <SegmentedItem
                key={value}
                selected={!customEditorOpen && period === value}
                aria-label={`${value} meses`}
                title={`${value} meses`}
                onClick={() => selectPreset(value)}
              >
                <span className="stats-preset-label-full">{value} meses</span>
                <span className="stats-preset-label-short" aria-hidden="true">{value} m</span>
              </SegmentedItem>
            ))}
            <SegmentedItem
              selected={customEditorOpen}
              aria-label="Personalizado"
              title="Personalizado"
              onClick={openCustomEditor}
            >
              <span className="stats-custom-period-label-full">Personalizado</span>
              <span className="stats-custom-period-label-short" aria-hidden="true">A medida</span>
            </SegmentedItem>
          </SegmentedControl>
        </fieldset>
        <fieldset className="stats-filter-group">
          <legend><ListFilter aria-hidden="true" />Base</legend>
          <SegmentedControl className="stats-basis-options" aria-label="Base">
            <SegmentedItem selected={basis === "analytics"} onClick={() => setBasis("analytics")}>Categorías analíticas</SegmentedItem>
            <SegmentedItem selected={basis === "all"} onClick={() => setBasis("all")}>Todas las categorías</SegmentedItem>
          </SegmentedControl>
        </fieldset>
      </div>

      {customEditorOpen ? (
        <form className="stats-custom-range-row" onSubmit={submitRange} noValidate>
          <FormField label="Desde">
            <Input
              type="date"
              name="date_from"
              autoComplete="off"
              value={draftRange.from}
              max={draftRange.to || todayInputValue()}
              aria-invalid={Boolean(rangeError)}
              aria-describedby={rangeError ? "statistics-range-error" : undefined}
              onChange={(event) => setDraftRange((current) => ({...current, from: event.target.value}))}
            />
          </FormField>
          <FormField label="Hasta">
            <Input
              type="date"
              name="date_to"
              autoComplete="off"
              value={draftRange.to}
              min={draftRange.from || undefined}
              max={todayInputValue()}
              aria-invalid={Boolean(rangeError)}
              aria-describedby={rangeError ? "statistics-range-error" : undefined}
              onChange={(event) => setDraftRange((current) => ({...current, to: event.target.value}))}
            />
          </FormField>
          <Button variant="primary" type="submit" aria-disabled={customApplyPending || undefined} aria-busy={customApplyPending || undefined} onClick={(event) => event.currentTarget.focus({preventScroll: true})}>{customApplyPending ? "Aplicando…" : "Aplicar rango"}</Button>
          {rangeError ? <p className="field-error" id="statistics-range-error" role="alert">{rangeError}</p> : null}
        </form>
      ) : null}

      <div className="stats-filter-actions">
        <TextButton className="filter-clear-all" disabled={!activeFilterCount} onClick={resetFilters}>Limpiar filtros</TextButton>
      </div>

    </Panel></StatisticsFilterDisclosure> : null}
    </AnimatePresence>
  );
}
