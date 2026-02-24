"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { User } from "@/types";

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth(true);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Concurrency limits keyed by tenant_id
  const [concurrencyLimits, setConcurrencyLimits] = useState<Record<string, number>>({});
  const [editingTenant, setEditingTenant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingConcurrency, setSavingConcurrency] = useState(false);

  useEffect(() => {
    if (currentUser?.role === "super_admin") {
      adminApi
        .listUsers({ page: 1 })
        .then((r) => {
          setUsers(r.data);
          // Fetch concurrency limits for unique tenants
          const tenantIds = Array.from(new Set(r.data.map((u: User) => u.tenant_id))) as string[];
          tenantIds.forEach((tid) => {
            adminApi.getTenantConcurrency(tid).then((res) => {
              setConcurrencyLimits((prev) => ({ ...prev, [tid]: res.data.max_concurrent_jobs }));
            }).catch(() => {
              setConcurrencyLimits((prev) => ({ ...prev, [tid]: 3 }));
            });
          });
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [currentUser]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await adminApi.updateUser(userId, { role: newRole });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, role: newRole as User["role"] } : u
        )
      );
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update role");
    }
  };

  const handleToggleActive = async (userId: string, currentActive: boolean) => {
    try {
      await adminApi.updateUser(userId, { is_active: !currentActive });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, is_active: !currentActive } : u
        )
      );
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update status");
    }
  };

  const startEditConcurrency = (tenantId: string) => {
    setEditingTenant(tenantId);
    setEditValue(String(concurrencyLimits[tenantId] ?? 3));
  };

  const saveConcurrency = async (tenantId: string) => {
    const val = parseInt(editValue, 10);
    if (isNaN(val) || val < 1 || val > 50) return;

    setSavingConcurrency(true);
    try {
      await adminApi.setTenantConcurrency(tenantId, val);
      setConcurrencyLimits((prev) => ({ ...prev, [tenantId]: val }));
      setEditingTenant(null);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update concurrency limit");
    } finally {
      setSavingConcurrency(false);
    }
  };

  if (currentUser?.role !== "super_admin") {
    return (
      <div className="text-center py-20 text-white/40">
        Access denied. Super admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/admin"
              className="text-white/40 hover:text-white transition"
            >
              &larr;
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold text-white">User Management</h1>
          </div>
          <p className="text-white/50 mt-1 ml-7">
            Manage users, roles, access, and concurrency limits
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Email
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Role
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Active
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Max Jobs
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-white/[0.02] transition">
                  <td className="px-4 md:px-6 py-4 text-sm text-white/80">{u.email}</td>
                  <td className="px-4 md:px-6 py-4 text-sm text-white/60">
                    {u.full_name || "---"}
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:border-primary-500 focus:outline-none"
                    >
                      <option value="member">member</option>
                      <option value="tenant_admin">tenant_admin</option>
                      <option value="super_admin">super_admin</option>
                    </select>
                  </td>
                  <td className="px-4 md:px-6 py-4">
                    <button
                      onClick={() => handleToggleActive(u.id, u.is_active)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${
                        u.is_active
                          ? "text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20"
                          : "text-red-400 bg-red-400/10 hover:bg-red-400/20"
                      }`}
                    >
                      {u.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  {/* Concurrent jobs limit */}
                  <td className="px-4 md:px-6 py-4">
                    {editingTenant === u.tenant_id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveConcurrency(u.tenant_id);
                            if (e.key === "Escape") setEditingTenant(null);
                          }}
                          className="w-16 bg-white/5 border border-primary-500/50 rounded-lg px-2 py-1 text-sm text-white focus:outline-none"
                          autoFocus
                          disabled={savingConcurrency}
                        />
                        <button
                          onClick={() => saveConcurrency(u.tenant_id)}
                          disabled={savingConcurrency}
                          className="text-emerald-400 hover:text-emerald-300 transition"
                          title="Save"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setEditingTenant(null)}
                          className="text-white/30 hover:text-white/60 transition"
                          title="Cancel"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditConcurrency(u.tenant_id)}
                        className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white/90 transition group"
                        title="Click to edit concurrent job limit"
                      >
                        <span className="font-mono">{concurrencyLimits[u.tenant_id] ?? "..."}</span>
                        <svg className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                      </button>
                    )}
                  </td>
                  <td className="px-4 md:px-6 py-4 text-xs text-white/40">
                    {formatDate(u.created_at)}
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
