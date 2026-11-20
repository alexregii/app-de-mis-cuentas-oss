export type BasicKind = "income" | "expense";
export type Kind = BasicKind | "transfer_in" | "transfer_out";
export type Pace = "low" | "normal" | "high";

export interface Choice {
  value: string;
  label: string;
}
