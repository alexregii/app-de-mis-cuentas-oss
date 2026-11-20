import {CategoryCombobox} from "./CategoryCombobox";
import type {TransactionEditorCategory} from "./TransactionEditor";

export function TransactionCategoryEditor({categories, value, onChange, onCancel, ariaLabel = "Categoría", ariaInvalid, ariaDescribedBy, autoFocus = false, placeholder = "Busca una categoría…"}: {
  categories: readonly TransactionEditorCategory[];
  value: string;
  onChange: (value: string) => void;
  onCancel?: (restoreFocus?: boolean) => void;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const options = categories.map((category) => ({id: category.id, label: category.display_name}));
  return <CategoryCombobox ariaLabel={ariaLabel} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} autoFocus={autoFocus} placeholder={placeholder} categories={options} value={value} onChange={onChange} onCancel={onCancel} />;
}
