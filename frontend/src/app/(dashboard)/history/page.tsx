"use client";

import { useEffect, useState } from "react";
import { creditsApi } from "@/lib/api-client";
import { formatCredits, formatDate } from "@/lib/utils";
import type { CreditTransaction } from "@/types";

export default function HistoryPage() {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    creditsApi
      .getHistory({ page: 1, page_size: 50 })
      .then((r) => setTransactions(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      purchase: "text-emerald-400",
      usage: "text-red-400",
      refund: "text-blue-400",
      admin_grant: "text-purple-400",
    };
    return colors[type] || "text-white/60";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Transaction History</h1>
        <p className="text-white/50 mt-1">Your credit usage and purchase history</p>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center text-white/30">No transactions yet</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase px-4 md:px-6 py-3">Type</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase px-4 md:px-6 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase px-4 md:px-6 py-3">Balance After</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase px-4 md:px-6 py-3">Description</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase px-4 md:px-6 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 md:px-6 py-4">
                    <span className={`text-sm font-medium capitalize ${getTypeColor(tx.type)}`}>
                      {tx.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <span className={`text-sm font-mono ${tx.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {tx.amount >= 0 ? "+" : ""}{formatCredits(tx.amount)}
                    </span>
                  </td>
                  <td className="px-4 md:px-6 py-4 text-sm text-white/60">{formatCredits(tx.balance_after)}</td>
                  <td className="px-4 md:px-6 py-4 text-sm text-white/40 truncate max-w-[200px]">{tx.description || "-"}</td>
                  <td className="px-4 md:px-6 py-4 text-xs text-white/40 whitespace-nowrap">{formatDate(tx.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
