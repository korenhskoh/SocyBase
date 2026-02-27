"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatDate, formatCurrency, getStatusColor } from "@/lib/utils";
import type { Payment } from "@/types";

export default function AdminPaymentsPage() {
  const { user } = useAuth(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const fetchPayments = () => {
    setLoading(true);
    const params: Record<string, any> = { page: 1 };
    if (statusFilter) params.status = statusFilter;
    adminApi
      .listPayments(params)
      .then((r) => setPayments(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (user?.role === "super_admin") {
      fetchPayments();
    }
  }, [user, statusFilter]);

  const handleApprove = async (paymentId: string) => {
    const notes = prompt("Admin notes (optional):");
    try {
      await adminApi.approvePayment(paymentId, notes || undefined);
      fetchPayments();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to approve");
    }
  };

  const handleReject = async (paymentId: string) => {
    const notes = prompt("Rejection reason:");
    if (!notes) return;
    try {
      await adminApi.rejectPayment(paymentId, notes);
      fetchPayments();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to reject");
    }
  };

  const handleRefund = async (paymentId: string) => {
    if (!confirm("Are you sure you want to refund this payment? Credits will be deducted from the tenant.")) return;
    const notes = prompt("Refund reason (optional):");
    try {
      await adminApi.refundPayment(paymentId, notes || undefined);
      fetchPayments();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to refund");
    }
  };

  if (user?.role !== "super_admin") {
    return (
      <div className="text-center py-20 text-white/40">
        Access denied. Super admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/admin"
            className="text-white/40 hover:text-white transition"
          >
            &larr;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Payment Management</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7">
          Review, approve, and refund payments
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {["", "pending", "completed", "failed", "refunded"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              statusFilter === s
                ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
                : "bg-white/5 text-white/50 border border-white/10 hover:text-white/80"
            }`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No payments found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[750px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Amount
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Method
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Reference
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Created
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02] transition">
                  <td className="px-6 py-4 text-sm text-white/80 font-medium">
                    {formatCurrency(p.amount_cents, p.currency)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium w-fit ${
                          p.method === "stripe"
                            ? "text-purple-400 bg-purple-400/10"
                            : "text-blue-400 bg-blue-400/10"
                        }`}
                      >
                        {p.method === "stripe" ? "Stripe" : "Bank Transfer"}
                      </span>
                      {p.stripe_subscription_id && (
                        <span className="text-[10px] text-amber-400/70">subscription</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(p.status)}`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {p.bank_transfer_reference && (
                      <span className="text-xs text-white/50">
                        {p.bank_transfer_reference}
                      </span>
                    )}
                    {p.bank_transfer_proof_url && (
                      <a
                        href={p.bank_transfer_proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-primary-400 hover:text-primary-300 mt-0.5"
                      >
                        View Proof
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-white/40">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      {p.status === "pending" && (
                        <>
                          <button
                            onClick={() => handleApprove(p.id)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(p.id)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {p.status === "completed" && (
                        <button
                          onClick={() => handleRefund(p.id)}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 hover:bg-amber-400/20 transition"
                        >
                          Refund
                        </button>
                      )}
                    </div>
                  </td>
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
