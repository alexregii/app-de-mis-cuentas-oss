import {BarChart3, CreditCard, Home, PiggyBank, Settings, ShieldCheck, WalletCards, type LucideIcon} from "lucide-react";
import type {NavigationGroup, Tab} from "./contracts";

export interface NavigationCatalogItem {
  id: Tab;
  label: string;
  shortLabel?: string;
  Icon: LucideIcon;
  navigationGroup: NavigationGroup;
}

export const navigationCatalog: readonly NavigationCatalogItem[] = [
  {id: "dashboard", label: "Resumen", Icon: Home, navigationGroup: "primary"},
  {id: "transactions", label: "Movimientos", Icon: WalletCards, navigationGroup: "primary"},
  {id: "review", label: "Revisión", Icon: ShieldCheck, navigationGroup: "primary"},
  {id: "planning", label: "Plan", Icon: PiggyBank, navigationGroup: "secondary"},
  {id: "accounts", label: "Cuentas", Icon: CreditCard, navigationGroup: "secondary"},
  {id: "statistics", label: "Estadísticas", shortLabel: "Estad.", Icon: BarChart3, navigationGroup: "primary"},
  {id: "settings", label: "Ajustes", Icon: Settings, navigationGroup: "secondary"},
];

export const navigationById = Object.fromEntries(navigationCatalog.map((item) => [item.id, item])) as Record<Tab, NavigationCatalogItem>;
