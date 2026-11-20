import type {HTMLAttributes, ReactNode} from "react";
import type {LucideIcon} from "lucide-react";
import {Loader2} from "lucide-react";

export function Panel({children, className = "", ...props}: HTMLAttributes<HTMLElement>) {
  return (
    <section className={`panel ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="section-heading">
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
  Icon?: LucideIcon;
}) {
  return (
    <article className={`metric-card ${tone || ""}`.trim()}>
      <span>{Icon ? <Icon aria-hidden="true" /> : null}{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function ErrorBanner({message}: {message: string}) {
  return (
    <div className="message error" role="alert">
      {message}
    </div>
  );
}

export function StatusBanner({message}: {message: string}) {
  return (
    <div className="message success" role="status">
      {message}
    </div>
  );
}

export function LoadingPanel({label = "Cargando…"}: {label?: string}) {
  return (
    <Panel className="loading-panel skeleton-panel" aria-busy="true">
      <div className="skeleton-copy">
        <span className="skeleton-line short" />
        <span className="skeleton-line" />
        <span className="skeleton-line medium" />
      </div>
      <span className="loading-label"><Loader2 aria-hidden="true" className="spin" /> {label}</span>
    </Panel>
  );
}
