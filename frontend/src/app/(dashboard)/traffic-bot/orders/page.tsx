"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { trafficBotApi } from "@/lib/api-client";
import type { TrafficBotOrder, TrafficBotOrderList } from "@/types";

const STATUS_TABS = ["all", "pending", "processing", "in_progress", "completed", "partial", "cancelled"];

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "text-yellow-400 bg-yellow-400/10",
    processing: "text-blue-400 bg-blue-400/10",
    in_progress: "text-blue-400 bg-blue-400/10",
    completed: "text-green-400 bg-green-400/10",
    partial: "text-orange-400 bg-orange-400/10",
    cancelled: "text-red-400 bg-red-400/10",
    refunded: "text-purple-400 bg-purple-400/10",
    failed: "text-red-400 bg-red-400/10",
  };
  return map[status] || "text-white/50 bg-white/5";
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TrafficBotOrdersPage() {
  const [data, setData] = useState<TrafficBotOrderList | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const limit = 20;

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: { status?: string; limit: number; offset: number } = { limit, offset };
      if (statusFilter !== "all") params.status = statusFilter;
      const r = await trafficBotApi.getOrders(params);
      setData(r.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [statusFilter, offset]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handleRefreshStatus(orderId: string) {
    setRefreshingId(orderId);
    try {
      const r = await trafficBotApi.getOrder(orderId, true);
      if (data) {
        setData({
          ...data,
          items: data.items.map((o) => (o.id === orderId ? r.data : o)),
        });
      }
    } catch {
      // ignore
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleCancel(orderId: string) {
    try {
      await trafficBotApi.cancelOrder(orderId);
      fetchOrders();
    } catch {
      // ignore
    }
  }

  async function handleRefill(orderId: string) {
    try {
      await trafficBotApi.refillOrder(orderId);
      alert("Refill request submitted.");
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Order History</h1>
          <p className="text-sm text-white/50 mt-1">
            {data ? `${data.total} total orders` : "Loading..."}
          </p>
        </div>
        <button
          onClick={fetchOrders}
          className="text-xs px-4 py-2 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 transition border border-white/10 font-medium"
        >
          <svg className="h-3.5 w-3.5 mr-1.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setStatusFilter(tab); setOffset(0); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
              statusFilter === tab
                ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
            }`}
          >
            {statusLabel(tab === "all" ? "all" : tab)}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-400"></div>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <svg className="h-12 w-12 mx-auto text-white/20 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-white/40 text-sm">No orders found</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left py-3 px-4 text-white/40 font-medium">Service</th>
                  <th className="text-left py-3 px-4 text-white/40 font-medium hidden md:table-cell">Link</th>
                  <th className="text-right py-3 px-4 text-white/40 font-medium">Qty</th>
                  <th className="text-right py-3 px-4 text-white/40 font-medium">Cost</th>
                  <th className="text-center py-3 px-4 text-white/40 font-medium">Status</th>
                  <th className="text-right py-3 px-4 text-white/40 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-right py-3 px-4 text-white/40 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => (
                  <Fragment key={order.id}>
                    <tr
                      className="border-b border-white/5 hover:bg-white/[0.02] transition cursor-pointer"
                      onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                    >
                      <td className="py-3 px-4">
                        <div className="text-white font-medium text-sm truncate max-w-[200px]">{order.service_name || "—"}</div>
                        <div className="text-white/30 text-xs">#{order.external_order_id || "..."}</div>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <div className="text-white/50 text-xs truncate max-w-[200px]">{order.link}</div>
                      </td>
                      <td className="py-3 px-4 text-right text-white/70">{order.quantity.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-primary-400 font-medium">${order.total_cost.toFixed(2)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColor(order.status)}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current"></span>
                          {statusLabel(order.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-white/40 text-xs hidden sm:table-cell">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <svg className={`h-4 w-4 text-white/30 transition-transform ${expandedId === order.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </td>
                    </tr>
                    {expandedId === order.id && (
                      <tr key={`${order.id}-detail`} className="border-b border-white/5">
                        <td colSpan={7} className="px-4 py-4 bg-white/[0.01]">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-3">
                            <div>
                              <span className="text-white/30">Start Count</span>
                              <p className="text-white/70 mt-0.5">{order.start_count ?? "—"}</p>
                            </div>
                            <div>
                              <span className="text-white/30">Remains</span>
                              <p className="text-white/70 mt-0.5">{order.remains ?? "—"}</p>
                            </div>
                            <div>
                              <span className="text-white/30">Base Cost</span>
                              <p className="text-white/70 mt-0.5">${order.base_cost.toFixed(4)}</p>
                            </div>
                            <div>
                              <span className="text-white/30">Fee</span>
                              <p className="text-white/70 mt-0.5">${order.fee_amount.toFixed(4)}</p>
                            </div>
                          </div>
                          {order.error_message && (
                            <div className="text-xs text-red-400/80 bg-red-500/5 p-2 rounded mb-3">{order.error_message}</div>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRefreshStatus(order.id); }}
                              disabled={refreshingId === order.id}
                              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition border border-white/10"
                            >
                              {refreshingId === order.id ? "Checking..." : "Check Status"}
                            </button>
                            {["pending", "processing", "in_progress"].includes(order.status) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancel(order.id); }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition border border-red-500/20"
                              >
                                Cancel
                              </button>
                            )}
                            {order.status === "completed" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRefill(order.id); }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 transition border border-primary-500/20"
                              >
                                Refill
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
              <p className="text-xs text-white/30">
                Showing {offset + 1}–{Math.min(offset + limit, data.total)} of {data.total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition border border-white/10 disabled:opacity-30"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= data.total}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition border border-white/10 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
