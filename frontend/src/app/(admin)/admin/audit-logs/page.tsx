"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { AuditLog } from "@/types";

const ACTION_BADGES: Record<string, { label: string; color: string }> = {
  "job.created": { label: "Created", color: "bg-blue-500/20 text-blue-400" },
  "job.completed": { label: "Completed", color: "bg-green-500/20 text-green-400" },
  "job.failed": { label: "Failed", color: "bg-red-500/20 text-red-400" },
  "job.resumed": { label: "Resumed", color: "bg-yellow-500/20 text-yellow-400" },
  "job.batch_pause": { label: "Paused", color: "bg-yellow-500/20 text-yellow-400" },
  "job.batch_stop": { label: "Stopped", color: "bg-orange-500/20 text-orange-400" },
  "job.batch_delete": { label: "Deleted", color: "bg-red-500/20 text-red-400" },
  "job.batch_resume": { label: "Resumed", color: "bg-yellow-500/20 text-yellow-400" },
  "job.batch_created": { label: "Batch Created", color: "bg-blue-500/20 text-blue-400" },
  "job.admin_cancelled": { label: "Admin Cancel", color: "bg-red-500/20 text-red-400" },
  "job.admin_paused": { label: "Admin Pause", color: "bg-orange-500/20 text-orange-400" },
  "payment.approved": { label: "Approved", color: "bg-green-500/20 text-green-400" },
  "payment.refunded": { label: "Refunded", color: "bg-orange-500/20 text-orange-400" },
  "payment.rejected": { label: "Rejected", color: "bg-red-500/20 text-red-400" },
  "credits.granted": { label: "Granted", color: "bg-green-500/20 text-green-400" },
  "user.updated": { label: "Updated", color: "bg-purple-500/20 text-purple-400" },
  "tenant.status_updated": { label: "Status", color: "bg-purple-500/20 text-purple-400" },
  "tenant.settings_updated": { label: "Settings", color: "bg-purple-500/20 text-purple-400" },
  "tenant.concurrency_updated": { label: "Concurrency", color: "bg-purple-500/20 text-purple-400" },
  "feature_flag.updated": { label: "Flag", color: "bg-cyan-500/20 text-cyan-400" },
  "payment_settings.updated": { label: "Settings", color: "bg-cyan-500/20 text-cyan-400" },
};

function ActionBadge({ action }: { action: string }) {
  const badge = ACTION_BADGES[action];
  if (!badge) {
    return <span className="text-sm text-white/60">{action}</span>;
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
      {badge.label}
    </span>
  );
}

function actionCategory(action: string): string {
  const prefix = action.split(".")[0];
  const map: Record<string, string> = {
    job: "Job",
    payment: "Payment",
    credits: "Credits",
    user: "User",
    tenant: "Tenant",
    feature_flag: "Feature Flag",
    payment_settings: "Payment Settings",
  };
  return map[prefix] || prefix;
}

export default function AdminAuditLogsPage() {
  const { user } = useAuth(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const fetchLogs = useCallback(
    (p: number) => {
      setLoading(true);
      adminApi
        .getAuditLogs({ page: p })
        .then((r) => {
          setLogs(r.data);
          setHasMore(r.data.length >= PAGE_SIZE);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    if (user?.role === "super_admin") {
      fetchLogs(page);
    }
  }, [user, page, fetchLogs]);

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
          <Link href="/admin" className="text-white/40 hover:text-white transition">
            &larr;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Audit Logs</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7">
          System activity and change history
        </p>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No audit logs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                    Timestamp
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                    Category
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                    Action
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                    Resource
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                    User
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-white/[0.02] transition cursor-pointer"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="px-4 md:px-6 py-3 text-xs text-white/40 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {actionCategory(log.action)}
                    </td>
                    <td className="px-4 py-3">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50 font-mono">
                      {log.resource_type && (
                        <span>
                          {log.resource_type}
                          {log.resource_id && (
                            <span className="text-white/30 ml-1">
                              {log.resource_id.slice(0, 8)}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/40 font-mono">
                      {log.user_id ? `${log.user_id.slice(0, 8)}` : "system"}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/40 max-w-[200px] truncate">
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <span className="text-primary-400 text-xs">
                          {Object.entries(log.details)
                            .filter(([, v]) => v != null)
                            .slice(0, 2)
                            .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 30) : v}`)
                            .join(" | ")}
                        </span>
                      ) : (
                        "---"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Expanded detail row */}
            {expandedId && (() => {
              const log = logs.find((l) => l.id === expandedId);
              if (!log) return null;
              return (
                <div className="border-t border-white/5 bg-white/[0.02] px-6 py-4 space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-white/30">Log ID</span>
                      <p className="text-white/60 font-mono">{log.id}</p>
                    </div>
                    <div>
                      <span className="text-white/30">User ID</span>
                      <p className="text-white/60 font-mono">{log.user_id || "system"}</p>
                    </div>
                    <div>
                      <span className="text-white/30">Tenant ID</span>
                      <p className="text-white/60 font-mono">{log.tenant_id || "---"}</p>
                    </div>
                    <div>
                      <span className="text-white/30">IP Address</span>
                      <p className="text-white/60 font-mono">{log.ip_address || "background task"}</p>
                    </div>
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <div>
                      <span className="text-white/30 text-xs">Details</span>
                      <pre className="mt-1 text-xs text-white/60 bg-black/30 rounded p-3 overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-white/5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs text-white/40 hover:text-white disabled:opacity-30 transition"
            >
              Previous
            </button>
            <span className="text-xs text-white/30">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="text-xs text-white/40 hover:text-white disabled:opacity-30 transition"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
