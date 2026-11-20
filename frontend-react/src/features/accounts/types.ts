export interface BankDirectory {
  ok: boolean;
  configured: boolean;
  country: string;
  banks: Array<{
    name: string;
    country: string;
  }>;
}
