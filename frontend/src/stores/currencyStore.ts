import { create } from "zustand";

export type DisplayCurrency = "USD" | "MYR";

const MYR_PER_USD = 4.70;

interface CurrencyState {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
}

function getInitialCurrency(): DisplayCurrency {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("socybase_display_currency");
    if (stored === "MYR" || stored === "USD") return stored;
  }
  return "USD";
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  displayCurrency: getInitialCurrency(),
  setDisplayCurrency: (currency) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("socybase_display_currency", currency);
    }
    set({ displayCurrency: currency });
  },
}));

export function convertCents(
  cents: number,
  fromCurrency: string,
  toCurrency: DisplayCurrency
): number {
  if (fromCurrency === toCurrency) return cents;
  if (fromCurrency === "MYR" && toCurrency === "USD")
    return Math.round(cents / MYR_PER_USD);
  if (fromCurrency === "USD" && toCurrency === "MYR")
    return Math.round(cents * MYR_PER_USD);
  return cents;
}
