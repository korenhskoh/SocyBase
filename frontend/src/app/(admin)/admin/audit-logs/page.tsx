"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { AuditLog } from "@/types";

export default function AdminAuditLogsPage() {
  const { user } = useAuth(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === "super_admin") {
      adminApi
        .getAuditLogs({ page: 1 })
        .then((r) => setLogs(r.data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [user]);

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
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Timestamp
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Action
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Resource
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  User ID
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-white/[0.02] transition">
                  <td className="px-6 py-4 text-xs text-white/40">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-white/80">
                    {log.action}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/50">
                    {log.resource_type && (
                      <span>
                        {log.resource_type}
                        {log.resource_id && (
                          <span className="text-white/30 ml-1">
                            {log.resource_id.slice(0, 8)}...
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-white/40 font-mono">
                    {log.user_id ? `${log.user_id.slice(0, 8)}...` : "---"}
                  </td>
                  <td className="px-6 py-4 text-xs text-white/40 font-mono">
                    {log.ip_address || "---"}
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
