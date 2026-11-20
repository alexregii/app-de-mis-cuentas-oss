export function FieldError({errors, name, id}: {errors?: Record<string, string[]>; name: string; id?: string}) {
  if (!errors?.[name]?.length) return null;
  return <small className="field-error" id={id} role="alert">{errors[name].join(" ")}</small>;
}
