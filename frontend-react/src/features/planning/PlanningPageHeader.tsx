import {CalendarRange} from "lucide-react";
import {formatMonth} from "../../format";
import {PageHeader} from "../../ui/layout/PageHeader";

export function PlanningPageHeader({
  selectedMonth,
  periodLabel,
  periodDetails,
  disabled,
  onMonthChange,
}: {
  selectedMonth: string;
  periodLabel: string;
  periodDetails: string;
  disabled?: boolean;
  onMonthChange: (month: string) => void;
}) {
  return <>
    <PageHeader
      title="Plan"
      actions={<label className="planning-month-control">
        <span><CalendarRange aria-hidden="true" /> Mes del plan</span>
        <span className="planning-month-field"><strong aria-hidden="true">{formatMonth(`${selectedMonth}-01`)}</strong><input aria-label="Mes del plan" type="month" value={selectedMonth} disabled={disabled} onChange={(event) => onMonthChange(event.target.value)} /></span>
      </label>}
    />
    <p className="planning-period-note">
      <strong>{periodLabel}</strong>
      {periodDetails ? <span>{periodDetails}</span> : null}
    </p>
  </>;
}
