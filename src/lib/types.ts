export type Currency = "NPR" | "USD";
export type FxSource = "actual" | "nrb" | "manual" | "estimated" | "pending";
export type ConversionStatus =
  | "exact"
  | "official_estimate"
  | "manual_estimate"
  | "pending";
export type ExpenseSource = "manual" | "recurring";
export type Cycle = "monthly" | "annual";
export type IncomeAgreementStatus =
  | "active"
  | "pending"
  | "paused"
  | "completed"
  | "cancelled";
/** Legacy mirror of the has_website / has_ads / has_automation flags. */
export type IncomeServiceType =
  | "ai_automation"
  | "marketing"
  | "full_track"
  | "website"
  | "custom";
export type ServiceKey = "website" | "ads" | "automation";
export type WebsiteStatus =
  | "not_started"
  | "in_progress"
  | "review"
  | "completed"
  | "on_hold"
  | "cancelled";
export type AdsStatus =
  | "not_started"
  | "preparation"
  | "ready"
  | "live"
  | "paused"
  | "stopped";
export type AutomationStatus =
  | "not_started"
  | "development"
  | "testing"
  | "ready"
  | "live"
  | "paused"
  | "stopped";
export type RecurringBillingMode = "combined" | "separate";
/** Which recurring fee a payment settles. Combined = ads + automation as one. */
export type BillingStream = "combined" | "ads" | "automation";
export type SetupPaymentTerms = "full_upfront" | "half_advance" | "custom";
export type IncomePaymentFor = "setup" | "recurring" | "website";
export type IncomePaymentMethod =
  | "bank_transfer"
  | "cash"
  | "cheque"
  | "wallet"
  | "card"
  | "other";
/** Derived from agreed amount vs payments; never stored. */
export type BillingStatus = "unpaid" | "partial" | "paid" | "overdue";
export type IncomeAccountType = "company" | "personal";
/** Money in that is not revenue: it moves a balance, never sales or profit. */
export type CapitalInflowType =
  | "founder_investment"
  | "owner_contribution"
  | "loan_received"
  | "other_non_revenue";
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

/**
 * One client agreement. Services are a free combination of website, ads and
 * automation, so every service block below is meaningful only when its own
 * has_* flag is set.
 *
 * Dates are deliberately distinct and none of them stands in for another:
 *   agreement_date                signed / contract start
 *   setup_due_date                when the setup balance is due
 *   website_*                     the website project's own timeline
 *   ads_live_date                 the day ads actually went live (nullable)
 *   automation_live_date          the day automation actually went live (nullable)
 *   recurring_billing_start_date  the anchor every monthly cycle counts from
 *
 * Balances, payment status, current cycle and overdue state are never stored.
 * They are computed from the amounts here plus income_payments — see
 * summarizeIncomeAgreement in lib/income.ts.
 */
export interface IncomeAgreement {
  id: string;
  client_name: string;
  agreement_name: string | null;
  /** Legacy mirror of the has_* flags. Written by the app, never read back. */
  service_type: IncomeServiceType;
  has_website: boolean;
  has_ads: boolean;
  has_automation: boolean;
  contact_name: string | null;
  agreement_date: string;
  contract_end_date: string | null;
  /** VAT vs non-VAT classification: which account this client normally pays into. */
  default_money_account_id: string | null;
  currency: Currency;

  setup_amount: number;
  setup_payment_terms: SetupPaymentTerms;
  setup_advance_percent: number;
  setup_due_date: string;
  /** Admin override for the derived date the setup balance reached zero. */
  setup_paid_in_full_date: string | null;
  setup_notes: string | null;

  website_amount: number;
  website_status: WebsiteStatus;
  website_start_date: string | null;
  website_expected_date: string | null;
  website_completed_date: string | null;
  website_due_date: string | null;
  website_paid_in_full_date: string | null;
  website_notes: string | null;

  ads_status: AdsStatus;
  ads_prep_start_date: string | null;
  ads_live_date: string | null;
  ads_monthly_amount: number | null;
  ads_billing_start_date: string | null;
  ads_notes: string | null;

  automation_status: AutomationStatus;
  automation_live_date: string | null;
  automation_monthly_amount: number | null;
  automation_billing_start_date: string | null;
  automation_notes: string | null;

  recurring_billing_mode: RecurringBillingMode;
  /** Combined-mode monthly fee. */
  recurring_amount: number;
  recurring_billing_start_date: string | null;
  setup_covers_first_cycle: boolean;
  recurring_due_days_before: number;

  status: IncomeAgreementStatus;
  service_end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One receipt from a client. Payments are never overwritten by a running
 * total: totalPaid and remaining are summed from these rows, so a client can
 * pay in as many instalments as they like without anything being recreated.
 */
export interface IncomePayment {
  id: string;
  agreement_id: string;
  payment_for: IncomePaymentFor;
  /** Recurring payments only: the cycle they settle. */
  billing_period_start: string | null;
  billing_stream: BillingStream | null;
  amount: number;
  paid_on: string;
  received_in: IncomeAccountType;
  money_account_id: string | null;
  account_name: string | null;
  method: IncomePaymentMethod | null;
  reference: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Money into an account that is not revenue — founder capital, owner
 * contributions, loans. It raises the account balance and must never reach
 * revenue, client income, VAT sales or profit, which is why it has no client.
 */
export interface CapitalInflow {
  id: string;
  money_account_id: string;
  inflow_type: CapitalInflowType;
  amount: number;
  received_on: string;
  source_name: string | null;
  reference: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
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
