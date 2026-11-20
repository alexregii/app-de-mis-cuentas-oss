export type CommandSearchItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
};

export type CommandSearchGroup = {
  id: "transactions" | "accounts" | "categories" | "rules";
  label: string;
  items: CommandSearchItem[];
};

export type CommandSearchPayload = {
  query: string;
  groups: CommandSearchGroup[];
};
