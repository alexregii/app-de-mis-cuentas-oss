import {useEffect, useId, useMemo, useRef, useState} from "react";

export type CategoryComboboxOption = Readonly<{
  id: number | string;
  label: string;
}>;

export function CategoryCombobox({categories, value, onChange, onCancel, ariaLabel, ariaInvalid, ariaDescribedBy, autoFocus = false, placeholder = "Busca una categoría…"}: {
  categories: readonly CategoryComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  onCancel?: (restoreFocus?: boolean) => void;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-options`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const selected = categories.find((category) => String(category.id) === value);
  const selectedLabel = selected?.label || "Sin categoría";
  const options = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = categories.filter((category) => category.label.toLocaleLowerCase().includes(normalizedQuery));
    const categoryOptions = matches.map((category) => ({id: String(category.id), label: category.label}));
    return normalizedQuery ? categoryOptions : [{id: "", label: "Sin categoría"}, ...categoryOptions];
  }, [categories, query]);

  useEffect(() => {
    if (!query.trim()) {
      const selectedIndex = options.findIndex((option) => option.id === value);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : null);
      return;
    }
    setActiveIndex((current) => current === null ? (options.length ? 0 : null) : Math.min(current, Math.max(0, options.length - 1)));
  }, [options, query, value]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(null);
  };
  const choose = (option: {id: string; label: string}) => {
    onChange(option.id);
    close();
  };

  return (
    <div className="ui-category-combobox">
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && activeIndex !== null && options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        autoFocus={autoFocus}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(null); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((current) => options.length ? current === null ? 0 : Math.min(current + 1, options.length - 1) : null); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex((current) => options.length ? current === null ? options.length - 1 : Math.max(current - 1, 0) : null); }
          else if (event.key === "Enter" && open) { event.preventDefault(); if (activeIndex !== null && options[activeIndex]) choose(options[activeIndex]); }
          else if (event.key === "Escape" && open) { event.preventDefault(); close(); onCancel?.(true); }
        }}
        onBlur={() => window.setTimeout(() => { if (document.activeElement !== inputRef.current) { close(); onCancel?.(false); } }, 0)}
      />
      {open ? (
        <div id={listboxId} className="ui-category-combobox-options" role="listbox" aria-label="Categorías disponibles">
          {options.length ? options.map((option, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={option.id || "empty"}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={option.id === value}
              className={index === activeIndex ? "active" : ""}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >{option.label}</button>
          )) : <span className="ui-category-combobox-empty">No hay coincidencias</span>}
        </div>
      ) : null}
    </div>
  );
}
