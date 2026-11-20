import {displayEuro} from "../../format";

export type MoneyTone = "income" | "expense" | "neutral";

export function TransactionAmount({value, privateAmounts = false, tone = "neutral", label = "Importe"}: {
  value: number;
  privateAmounts?: boolean;
  tone?: MoneyTone;
  label?: string;
}) {
  const displayValue = displayEuro(value, privateAmounts);
  return <span className={`ui-money-amount ui-money-amount--${tone}`} aria-label={privateAmounts ? "Importe oculto" : `${label}: ${displayValue}`}>{displayValue}</span>;
}
