import type {HTMLAttributes, ReactNode} from "react";

export function PageHeader({
  title,
  description,
  actions,
  children,
  className = "",
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={`ui-page-header ${className}`.trim()} {...props}>
      <div className="ui-page-header__copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
      {children ? <div className="ui-page-header__supplement">{children}</div> : null}
    </header>
  );
}
