export type Currency = "NPR" | "USD";
export type FxSource = "actual" | "nrb" | "manual" | "estimated" | "pending";
export type ConversionStatus =
  | "exact"
  | "official_estimate"
  | "manual_estimate"
  | "pending";
export type ExpenseSource = "manual" | "recurring";
export type Cycle = "monthly" | "annual";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  is_core_member: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  monthly_budget: number | null;
}

export interface Vendor {
  id: string;
  name: string;
  category_id: string | null;
  default_currency: Currency;
}

export interface FxRate {
  id: string;
  rate_date: string;
  base_currency: string;
  quote_currency: string;
  buy_rate: number | null;
  sell_rate: number | null;
  source: string;
  fetched_at: string;
}

export interface Expense {
  id: string;
  amount: number;
  currency: Currency;
  fx_rate_to_npr: number;
  amount_npr: number | null;
  actual_npr_charged: number | null;
  fx_source: FxSource;
  fx_rate_date: string | null;
  conversion_status: ConversionStatus;
  expense_date: string;
  billing_month: string | null;
  category_id: string | null;
  vendor_id: string | null;
  paid_by_user_id: string | null;
  client: string | null;
  note: string | null;
  receipt_url: string | null;
  is_reimbursed: boolean;
  source: ExpenseSource;
  recurring_id: string | null;
  created_by: string | null;
  created_at: string;
  expense_shares?: ExpenseShare[];
}

export interface ExpenseShare {
  id: string;
  expense_id: string;
  user_id: string;
  amount: number;
  amount_npr: number | null;
}

export interface Recurring {
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  cycle: Cycle;
  next_renewal_date: string;
  category_id: string | null;
  vendor_id: string | null;
  paid_by_user_id: string | null;
  is_active: boolean;
  recurring_shares?: RecurringShare[];
}

export interface RecurringShare {
  id: string;
  recurring_id: string;
  user_id: string;
  amount: number;
}

export interface Settlement {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount_npr: number;
  settled_on: string;
  note: string | null;
}
