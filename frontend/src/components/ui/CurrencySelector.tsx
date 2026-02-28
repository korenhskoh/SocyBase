"use client";

import { useCurrencyStore } from "@/stores/currencyStore";

export function CurrencySelector({ className = "" }: { className?: string }) {
  const { displayCurrency, setDisplayCurrency } = useCurrencyStore();

  return (
    <button
      onClick={() =>
        setDisplayCurrency(displayCurrency === "USD" ? "MYR" : "USD")
      }
      className={`px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition ${className}`}
      title={`Switch to ${displayCurrency === "USD" ? "MYR" : "USD"}`}
    >
      {displayCurrency === "USD" ? "$ USD" : "RM MYR"}
    </button>
  );
}
