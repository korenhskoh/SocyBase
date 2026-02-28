"use client";

import { useEffect, useState } from "react";
import { trafficBotApi } from "@/lib/api-client";
import type { TrafficBotWallet, TrafficBotTransaction } from "@/types";

function txnTypeColor(type: string) {
  const map: Record<string, string> = {
    deposit: "text-green-400",
    order_payment: "text-red-400",
    refund: "text-blue-400",
  };
  return map[type] || "text-white/50";
}

function txnTypeLabel(type: string) {
  const map: Record<string, string> = {
    deposit: "Deposit",
    order_payment: "Order Payment",
    refund: "Refund",
  };
  return map[type] || type;
}

function txnIcon(type: string) {
  if (type === "deposit") return "M12 4v16m8-8H4";
  if (type === "refund") return "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6";
  return "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z";
}

export default function TrafficBotWalletPage() {
  const [wallet, setWallet] = useState<TrafficBotWallet | null>(null);
  const [transactions, setTransactions] = useState<TrafficBotTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      trafficBotApi.getWallet().then((r) => setWallet(r.data)),
      trafficBotApi.getTransactions({ limit: 50 }).then((r) => setTransactions(r.data)),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Wallet</h1>

      {/* Balance Card */}
      <div className="glass-card p-6 bg-gradient-to-br from-primary-500/10 to-accent-purple/10 border-primary-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-primary-500/20 flex items-center justify-center">
            <svg className="h-6 w-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-white/40 font-medium">Available Balance</p>
            <p className="text-3xl font-bold text-white">${wallet?.balance?.toFixed(2) || "0.00"}</p>
          </div>
        </div>
        <p className="text-xs text-white/30">
          Contact your administrator to add funds to your wallet.
        </p>
      </div>

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Transaction History</h2>
        {transactions.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <svg className="h-10 w-10 mx-auto text-white/20 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-white/40 text-sm">No transactions yet</p>
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <div className="divide-y divide-white/5">
              {transactions.map((txn) => (
                <div key={txn.id} className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition">
                  <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                    txn.type === "deposit" ? "bg-green-500/10" : txn.type === "refund" ? "bg-blue-500/10" : "bg-red-500/10"
                  }`}>
                    <svg className={`h-4 w-4 ${txnTypeColor(txn.type)}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={txnIcon(txn.type)} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{txnTypeLabel(txn.type)}</span>
                    </div>
                    <p className="text-xs text-white/30 truncate">{txn.description || "—"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${txn.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                      {txn.amount > 0 ? "+" : ""}${Math.abs(txn.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-white/20">{new Date(txn.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
