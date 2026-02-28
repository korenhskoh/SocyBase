"use client";

import { useCurrencyStore, convertCents } from "@/stores/currencyStore";
import { formatCurrency } from "@/lib/utils";

export function useCurrency() {
  const { displayCurrency, setDisplayCurrency } = useCurrencyStore();

  function formatPrice(cents: number, sourceCurrency = "USD"): string {
    const converted = convertCents(cents, sourceCurrency, displayCurrency);
    return formatCurrency(converted, displayCurrency);
  }

  return { displayCurrency, setDisplayCurrency, formatPrice };
}
