import type {InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes} from "react";
import {forwardRef} from "react";
import {joinClasses} from "./joinClasses";

export function FormField({
  label,
  hint,
  error,
  fullWidth = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={joinClasses("ui-field", fullWidth && "ui-field--full", className)}>
      <span className="ui-field__label">{label}{hint ? <span className="ui-field__hint">{hint}</span> : null}</span>
      {children}
      {error ? <span className="ui-field__error">{error}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({className, ...props}, ref) {
  return <input {...props} ref={ref} className={joinClasses("ui-input", className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({className, ...props}, ref) {
  return <select {...props} ref={ref} className={joinClasses("ui-select", className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({className, ...props}, ref) {
  return <textarea {...props} ref={ref} className={joinClasses("ui-textarea", className)} />;
});
