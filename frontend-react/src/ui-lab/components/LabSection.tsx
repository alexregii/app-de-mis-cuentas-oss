import {useId, type ReactNode} from "react";

export function LabSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="ui-lab-foundation" aria-labelledby={titleId}>
      <div className="ui-lab-section-heading">
        <h2 id={titleId}>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {children}
    </section>
  );
}
