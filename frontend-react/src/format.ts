const euroFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const visibleEuro = (value: number) => euroFormatter.format(value);

const compactEuroFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 0,
  notation: "compact",
  compactDisplay: "short",
});

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
});

const shortDateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
});

export const euro = (value: number) => redactMoney(visibleEuro(value));
/** Shared visible-money formatter for surfaces that receive privacy explicitly. */
export const displayEuro = (value: number, privateAmounts: boolean) => privateAmounts ? "••••••" : visibleEuro(value);
export const parseMoneyInput = (raw: string): number | null => {
  const value = raw.trim().replace(/\s/g, "");
  if (!value) return null;
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
export const compactEuro = (value: number) => redactMoney(`${compactEuroFormatter.format(value)} €`);
export const compactEuroNumber = (value: number) => redactMoney(compactEuroFormatter.format(value), "").trim();
export const currency = (value: number, currencyCode: string, options: Intl.NumberFormatOptions = {}) => redactMoney(
  new Intl.NumberFormat("es-ES", {style: "currency", currency: currencyCode, ...options}).format(value),
  currencyCode === "EUR" ? "€" : currencyCode,
);

export const formatDate = (value: string) => {
  if (!value) return "Nunca";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "Fecha no disponible";
};

export const formatMonth = (value: string) => {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? monthFormatter.format(date) : "Periodo no disponible";
};

export const formatDateTimeShort = (value: Date) => shortDateTimeFormatter.format(value);

export const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const todayInputValue = () => dateInputValue(new Date());
import {redactMoney} from "./shared/lib/privacy";
