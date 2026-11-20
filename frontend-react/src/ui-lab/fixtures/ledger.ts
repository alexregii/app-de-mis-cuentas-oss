import type {LedgerItem, LedgerItemCapabilities} from "../../ui/finance/LedgerItem";

const accounts = {
  main: {name: "Cuenta principal", color: "var(--entity-1)"},
  savings: {name: "Cuenta ahorro", color: "var(--entity-4)"},
  card: {name: "Tarjeta diaria", color: "var(--entity-6)"},
} as const;

type LedgerSeed = Omit<LedgerItem, "id" | "date">;

const seeds: LedgerSeed[] = [
  {kind: "income", description: "Nómina septiembre 2026", account: accounts.main, category: {name: "Nómina", color: "var(--entity-2)"}, signedAmount: 1955, isRefund: false, attachmentCount: 0},
  {kind: "expense", description: "Alquiler vivienda", account: accounts.main, category: {name: "Vivienda", color: "var(--entity-3)"}, signedAmount: -725, isRefund: false, attachmentCount: 0},
  {kind: "expense", description: "Compra semanal", account: accounts.card, category: {name: "Alimentación", color: "var(--entity-6)"}, sourceLabel: "Enable Banking", signedAmount: -63.42, isRefund: false, attachmentCount: 1},
  {kind: "transfer", description: "Aporte a cuenta de ahorro", account: accounts.main, category: null, signedAmount: -300, isRefund: false, attachmentCount: 0},
  {kind: "expense", description: "Factura electricidad", account: accounts.main, category: {name: "Suministros", color: "var(--entity-7)"}, sourceLabel: "CSV", signedAmount: -48.15, isRefund: false, attachmentCount: 0},
  {kind: "income", description: "Reembolso transporte", account: accounts.main, category: {name: "Transporte", color: "var(--entity-1)"}, signedAmount: 18.4, isRefund: true, attachmentCount: 0},
  {kind: "expense", description: "Farmacia", account: accounts.card, category: {name: "Salud", color: "var(--entity-5)"}, signedAmount: -12.8, isRefund: false, attachmentCount: 0},
  {kind: "expense", description: "Cargo pendiente de clasificar", account: accounts.card, category: null, signedAmount: -7.99, isRefund: false, attachmentCount: 0},
];

export const ledgerFixtures: LedgerItem[] = Array.from({length: 32}, (_, index) => {
  const seed = seeds[index % seeds.length];
  return {
    ...seed,
    id: `ledger-${index + 1}`,
    date: new Date(Date.UTC(2026, 8, 30 - index)).toISOString().slice(0, 10),
    description: index < seeds.length ? seed.description : `${seed.description} · ${Math.floor(index / seeds.length) + 1}`,
    signedAmount: seed.signedAmount + (index >= seeds.length && seed.kind !== "transfer" ? (index % 3) * 0.11 : 0),
  };
});

// Explicit interaction fixtures, separate from visual item metadata and domain.
const capabilities: readonly LedgerItemCapabilities[] = [
  {edit: true, archive: true, reopen: false},
  {edit: true, archive: true, reopen: false},
  {edit: false, archive: true, reopen: true},
  {edit: false, archive: true, reopen: false},
  {edit: false, archive: true, reopen: true},
  {edit: true, archive: true, reopen: false},
  {edit: true, archive: true, reopen: false},
  {edit: false, archive: false, reopen: false},
];
export const ledgerFixtureCapabilities: Readonly<Record<string, LedgerItemCapabilities>> = Object.fromEntries(
  ledgerFixtures.map((item, index) => [item.id, capabilities[index % capabilities.length]]),
);
