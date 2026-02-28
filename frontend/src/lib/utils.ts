import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatCredits(credits: number): string {
  return credits.toLocaleString();
}

export function formatCurrency(cents: number, currency = "USD"): string {
  const locale = currency === "MYR" ? "en-MY" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: "text-yellow-400 bg-yellow-400/10",
    queued: "text-blue-400 bg-blue-400/10",
    scheduled: "text-purple-400 bg-purple-400/10",
    running: "text-cyan-400 bg-cyan-400/10",
    completed: "text-emerald-400 bg-emerald-400/10",
    failed: "text-red-400 bg-red-400/10",
    cancelled: "text-gray-400 bg-gray-400/10",
    paused: "bg-yellow-500/10 text-yellow-400",
  };
  return colors[status] || "text-gray-400 bg-gray-400/10";
}
