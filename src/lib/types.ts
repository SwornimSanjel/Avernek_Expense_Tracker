export type Currency = "NPR" | "USD";
export type FxSource = "actual" | "nrb" | "manual" | "estimated" | "pending";
export type ConversionStatus =
  | "exact"
  | "official_estimate"
  | "manual_estimate"
  | "pending";
export type ExpenseSource = "manual" | "recurring";
export type Cycle = "monthly" | "annual";
export type IncomeAgreementStatus = "active" | "paused" | "completed";
export type IncomeServiceType = "ai_automation" | "marketing" | "full_track";
export type SetupPaymentTerms = "full_upfront" | "half_advance" | "custom";
export type IncomePaymentFor = "setup" | "recurring";
export type IncomeAccountType = "company" | "personal";
export type ExpenseFundingSource = "personal" | "company_funds";
export type MoneyAccountKind =
  | "company_bank"
  | "personal_custody"
  | "digital_wallet"
  | "cash";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  is_core_member: boolean;
  is_admin: boolean;
}

/**
 * The team list on /settings. `can_sign_in` is computed in SQL as
 * `password_hash is not null` — never select password_hash itself. These rows
 * reach client components, so anything in this shape is shipped to the browser.
 */
export interface TeamMember extends AppUser {
  can_sign_in: boolean;
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
  funding_source: ExpenseFundingSource;
  money_account_id: string | null;
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

export interface IncomeAgreement {
  id: string;
  client_name: string;
  agreement_name: string | null;
  service_type: IncomeServiceType;
  contact_name: string | null;
  agreement_date: string;
  ads_live_date: string;
  setup_amount: number;
  recurring_amount: number;
  currency: Currency;
  setup_payment_terms: SetupPaymentTerms;
  setup_advance_percent: number;
  setup_due_date: string;
  recurring_due_days_before: number;
  status: IncomeAgreementStatus;
  service_end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncomePayment {
  id: string;
  agreement_id: string;
  payment_for: IncomePaymentFor;
  billing_period_start: string | null;
  amount: number;
  paid_on: string;
  received_in: IncomeAccountType;
  money_account_id: string | null;
  account_name: string | null;
  reference: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface MoneyAccount {
  id: string;
  name: string;
  kind: MoneyAccountKind;
  currency: Currency;
  holder_name: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MoneyTransfer {
  id: string;
  from_account_id: string;
  to_account_id: string;
  from_amount: number;
  to_amount: number;
  transfer_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}
