import {useEffect, useId, useMemo, useRef, useState} from "react";

export type ReviewInlineChoiceOption = Readonly<{id: string; label: string}>;

export function ReviewInlineChoice({ariaLabel, value, options, placeholder, emptyLabel, onChange, onCancel, ariaInvalid, ariaDescribedBy}: {
  ariaLabel: string;
  value: string;
  options: readonly ReviewInlineChoiceOption[];
  placeholder: string;
  emptyLabel?: string;
  onChange: (value: string) => void;
  onCancel: (restoreFocus?: boolean) => void;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-options`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const matches = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query]);

  useEffect(() => { inputRef.current?.focus({preventScroll: true}); }, []);
  useEffect(() => {
    if (!query.trim()) {
      const selectedIndex = matches.findIndex((option) => option.id === value);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : null);
      return;
    }
    setActiveIndex((current) => current === null ? (matches.length ? 0 : null) : Math.min(current, Math.max(0, matches.length - 1)));
  }, [matches, query, value]);

  return <div className="ui-review-choice-combobox">
    <input
      ref={inputRef}
      id={inputId}
      role="combobox"
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      aria-expanded="true"
      aria-controls={listboxId}
      aria-autocomplete="list"
      aria-activedescendant={activeIndex !== null && matches[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
      value={query}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(event) => { setQuery(event.target.value); setActiveIndex(null); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => matches.length ? current === null ? 0 : Math.min(current + 1, matches.length - 1) : null); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => matches.length ? current === null ? matches.length - 1 : Math.max(current - 1, 0) : null); }
        else if (event.key === "Enter" && activeIndex !== null && matches[activeIndex]) { event.preventDefault(); onChange(matches[activeIndex].id); }
        else if (event.key === "Escape") { event.preventDefault(); onCancel(true); }
      }}
      onBlur={() => window.setTimeout(() => { if (document.activeElement !== inputRef.current) onCancel(false); }, 0)}
    />
    <div id={listboxId} className="ui-review-choice-combobox__options" role="listbox" aria-label={`${ariaLabel} disponibles`}>
      {matches.length ? matches.map((option, index) => <button
        id={`${listboxId}-${index}`}
        key={option.id || "empty"}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={option.id === value}
        className={index === activeIndex ? "active" : ""}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onChange(option.id)}
      >{option.label}</button>) : <span className="ui-review-choice-combobox__empty">No hay coincidencias</span>}
    </div>
  </div>;
}
