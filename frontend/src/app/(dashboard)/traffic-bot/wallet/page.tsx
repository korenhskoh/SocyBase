"use client";

import { useEffect, useState } from "react";
import { trafficBotApi, creditsApi, uploadsApi } from "@/lib/api-client";
import type { TrafficBotWallet, TrafficBotTransaction, TrafficBotWalletDeposit } from "@/types";

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

function depositStatusColor(status: string) {
  if (status === "approved") return "text-green-400 bg-green-400/10";
  if (status === "rejected") return "text-red-400 bg-red-400/10";
  return "text-amber-400 bg-amber-400/10";
}

export default function TrafficBotWalletPage() {
  const [wallet, setWallet] = useState<TrafficBotWallet | null>(null);
  const [transactions, setTransactions] = useState<TrafficBotTransaction[]>([]);
  const [deposits, setDeposits] = useState<TrafficBotWalletDeposit[]>([]);
  const [loading, setLoading] = useState(true);

  // Deposit modal state
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Bank details from admin settings
  const [paymentInfo, setPaymentInfo] = useState<{
    bank_name: string;
    bank_account_name: string;
    bank_account_number: string;
    bank_duitnow_id: string;
  } | null>(null);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      trafficBotApi.getWallet().then((r) => setWallet(r.data)),
      trafficBotApi.getTransactions({ limit: 50 }).then((r) => setTransactions(r.data)),
      trafficBotApi.getMyDeposits().then((r) => setDeposits(r.data)),
      creditsApi.getPaymentInfo().then((r) => setPaymentInfo(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDepositSubmit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    if (!bankReference.trim()) {
      alert("Please enter the transaction reference number");
      return;
    }

    setSubmitting(true);
    try {
      let proofUrl: string | undefined;
      if (proofFile) {
        const uploadRes = await uploadsApi.uploadProof(proofFile);
        proofUrl = uploadRes.data.proof_url;
      }

      await trafficBotApi.submitDepositRequest({
        amount,
        bank_reference: bankReference.trim(),
        proof_url: proofUrl,
      });

      setShowDepositModal(false);
      setDepositAmount("");
      setBankReference("");
      setProofFile(null);
      alert("Deposit request submitted! Awaiting admin approval.");
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    );
  }

  const pendingDeposits = deposits.filter((d) => d.status === "pending");

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Wallet</h1>

      {/* Balance Card */}
      <div className="glass-card p-6 bg-gradient-to-br from-primary-500/10 to-accent-purple/10 border-primary-500/20">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-primary-500/20 flex items-center justify-center">
              <svg className="h-6 w-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-white/40 font-medium">Available Balance</p>
              <p className="text-3xl font-bold text-white">RM{wallet?.balance?.toFixed(2) || "0.00"}</p>
            </div>
          </div>
          <button
            onClick={() => setShowDepositModal(true)}
            className="btn-glow px-5 py-2.5 text-sm font-medium flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Deposit
          </button>
        </div>
      </div>

      {/* Pending Deposits */}
      {pendingDeposits.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Pending Deposits</h2>
          <div className="space-y-2">
            {pendingDeposits.map((d) => (
              <div key={d.id} className="glass-card p-4 border-amber-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                      <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">RM{d.amount.toFixed(2)}</p>
                      <p className="text-xs text-white/30">Ref: {d.bank_reference}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium text-amber-400 bg-amber-400/10">
                      Pending Approval
                    </span>
                    <p className="text-xs text-white/20 mt-1">
                      {new Date(d.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Deposits (approved/rejected) */}
      {deposits.filter((d) => d.status !== "pending").length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Deposit History</h2>
          <div className="glass-card overflow-hidden">
            <div className="divide-y divide-white/5">
              {deposits
                .filter((d) => d.status !== "pending")
                .map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition">
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                        d.status === "approved" ? "bg-green-500/10" : "bg-red-500/10"
                      }`}>
                        <svg className={`h-4 w-4 ${d.status === "approved" ? "text-green-400" : "text-red-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={
                            d.status === "approved" ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"
                          } />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">RM{d.amount.toFixed(2)}</p>
                        <p className="text-xs text-white/30">Ref: {d.bank_reference}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${depositStatusColor(d.status)}`}>
                        {d.status}
                      </span>
                      <p className="text-xs text-white/20 mt-1">
                        {new Date(d.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

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
                      {txn.amount > 0 ? "+" : ""}RM{Math.abs(txn.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-white/20">{new Date(txn.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card max-w-md w-full mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Deposit via Bank Transfer</h3>
              <button
                onClick={() => setShowDepositModal(false)}
                className="text-white/40 hover:text-white text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            {/* Bank Details */}
            <div className="rounded-lg bg-white/5 border border-white/10 p-4 space-y-2">
              <p className="text-sm text-white/40">Transfer to:</p>
              <p className="text-white font-medium">{paymentInfo?.bank_account_name || "---"}</p>
              {paymentInfo?.bank_name && (
                <p className="text-white/60 text-sm">Bank: {paymentInfo.bank_name}</p>
              )}
              {paymentInfo?.bank_account_number && (
                <p className="text-white/60 text-sm">Account: {paymentInfo.bank_account_number}</p>
              )}
              {paymentInfo?.bank_duitnow_id && (
                <p className="text-white/60 text-sm">DuitNow ID: {paymentInfo.bank_duitnow_id}</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                Deposit Amount (RM)
              </label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g., 50.00"
                min="1"
                step="0.01"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
              />
            </div>

            {/* Reference Number */}
            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                Transaction Reference Number
              </label>
              <input
                type="text"
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                placeholder="e.g., FT2402221234567"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
              />
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                Upload Payment Proof (optional)
              </label>
              <label className="flex items-center justify-center rounded-lg border-2 border-dashed border-white/10 hover:border-primary-500/30 p-6 cursor-pointer transition">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <div className="text-center">
                  {proofFile ? (
                    <p className="text-sm text-primary-400">{proofFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm text-white/40">Click to upload screenshot</p>
                      <p className="text-xs text-white/20 mt-1">JPG, PNG, PDF (max 10MB)</p>
                    </>
                  )}
                </div>
              </label>
            </div>

            {/* Submit */}
            <button
              onClick={handleDepositSubmit}
              disabled={submitting || !depositAmount || !bankReference.trim()}
              className="btn-glow w-full py-3 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Deposit Request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
