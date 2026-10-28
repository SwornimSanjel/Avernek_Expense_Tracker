"use client";

import { createContext, useContext } from "react";
import type { AppUser, Category, MoneyAccount, Vendor } from "@/lib/types";

export type ExpenseFormData = {
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  moneyAccounts: MoneyAccount[];
  clients: string[];
};

const FormDataContext = createContext<ExpenseFormData | null>(null);

/**
 * The pick-lists every expense form needs (categories, vendors, people,
 * accounts, clients), given once at the top of the Expenses page so the Add
 * button and each row's Edit form read them here instead of every row
 * carrying its own copy in props.
 */
export function ExpenseFormDataProvider({ value, children }: { value: ExpenseFormData; children: React.ReactNode }) {
  return <FormDataContext.Provider value={value}>{children}</FormDataContext.Provider>;
}

export function useExpenseFormData(): ExpenseFormData {
  const value = useContext(FormDataContext);
  if (!value) throw new Error("useExpenseFormData needs an ExpenseFormDataProvider above it.");
  return value;
}
