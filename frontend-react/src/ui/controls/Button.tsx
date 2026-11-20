import type {AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode} from "react";
import {joinClasses} from "./joinClasses";

export type ButtonVariant = "default" | "primary" | "secondary" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  loading?: boolean;
  loadingLabel?: ReactNode;
};

function buttonClasses(variant: ButtonVariant, fullWidth: boolean, className?: string) {
  return joinClasses(
    "ui-button",
    variant !== "default" && `ui-button--${variant}`,
    fullWidth && "ui-button--full",
    className,
  );
}

export function Button({
  variant = "default",
  fullWidth = false,
  loading = false,
  loadingLabel,
  className,
  disabled,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClasses(variant, fullWidth, className)}
      disabled={disabled || loading}
      aria-busy={loading ? true : props["aria-busy"]}
    >
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </button>
  );
}

export function ButtonLink({
  variant = "default",
  fullWidth = false,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}) {
  return <a {...props} className={buttonClasses(variant, fullWidth, className)} />;
}

export type IconButtonVariant = "default" | "primary" | "subtle";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  "aria-label": string;
  variant?: IconButtonVariant;
};

export function IconButton({
  variant = "default",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={joinClasses(
        "ui-icon-button",
        variant !== "default" && `ui-icon-button--${variant}`,
        className,
      )}
    />
  );
}

export function TextButton({className, type = "button", ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={joinClasses("ui-text-button", className)} />;
}

export function TextLink({className, ...props}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} className={joinClasses("ui-text-button", className)} />;
}
