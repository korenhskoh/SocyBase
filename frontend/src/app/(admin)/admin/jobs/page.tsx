"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";

interface AdminJob {
  id: string;
  tenant_id: string;
  user_email: string;
  input_value: string;
  job_type: string;
  status: string;
  progress_pct: number;
  result_row_count: number;
  credits_used: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "text-blue-400 bg-blue-400/10",
  running: "text-amber-400 bg-amber-400/10",
  completed: "text-emerald-400 bg-emerald-400/10",
  failed: "text-red-400 bg-red-400/10",
  cancelled: "text-white/40 bg-white/5",
  paused: "text-purple-400 bg-purple-400/10",
  scheduled: "text-cyan-400 bg-cyan-400/10",
  pending: "text-white/50 bg-white/5",
};

const STATUSES = ["", "queued", "running", "completed", "failed", "cancelled", "paused", "scheduled"];

export default function AdminJobsPage() {
  const { user } = useAuth(true);
  const searchParams = useSearchParams();

  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [tenantFilter] = useState(searchParams.get("tenant_id") || "");
  const [loading, setLoading] = useState(true);

  const pageSize = 20;

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      if (tenantFilter) params.tenant_id = tenantFilter;
      const { data } = await adminApi.listAllJobs(params);
      setJobs(data.items);
      setTotal(data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, tenantFilter]);

  useEffect(() => {
    if (user?.role === "super_admin") {
      fetchJobs();
    }
  }, [user, fetchJobs]);

  const handleCancel = async (jobId: string) => {
    if (!confirm("Cancel this job? It will be stopped immediately.")) return;
    try {
      await adminApi.adminCancelJob(jobId);
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "cancelled" } : j));
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to cancel");
    }
  };

  const handlePause = async (jobId: string) => {
    try {
      await adminApi.adminPauseJob(jobId);
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "paused" } : j));
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to pause");
    }
  };

  if (user?.role !== "super_admin") {
    return <div className="text-center py-20 text-white/40">Access denied.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin" className="text-white/40 hover:text-white transition">&larr;</Link>
          <h1 className="text-2xl font-bold text-white">Job Management</h1>
        </div>
        <p className="text-white/50 text-sm ml-7">
          View, cancel, and pause scraping jobs across all tenants
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-white/40 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-glass text-sm py-1.5 px-3 min-w-[140px]"
          >
            <option value="">All Statuses</option>
            {STATUSES.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-white/40 mb-1">Search (email or URL)</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchJobs(); } }}
            placeholder="Search by email or input URL..."
            className="input-glass text-sm"
          />
        </div>
        <button
          onClick={() => { setPage(1); fetchJobs(); }}
          className="px-4 py-2 text-sm rounded-lg font-medium text-primary-400 bg-primary-400/10 border border-primary-400/20 hover:bg-primary-400/20 transition"
        >
          Search
        </button>
        {(statusFilter || search) && (
          <button
            onClick={() => { setStatusFilter(""); setSearch(""); setPage(1); }}
            className="px-3 py-2 text-sm rounded-lg text-white/40 hover:text-white/60 transition"
          >
            Clear
          </button>
        )}
      </div>

      {/* Jobs Table */}
      <div className="glass-card p-4 overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs border-b border-white/5">
                <th className="text-left py-2 pr-3">User</th>
                <th className="text-left py-2 pr-3">Input</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Progress</th>
                <th className="text-right py-2 pr-3">Profiles</th>
                <th className="text-right py-2 pr-3">Credits</th>
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/admin/tenants/${job.tenant_id}`}
                      className="text-primary-400/80 hover:text-primary-400 transition text-xs"
                    >
                      {job.user_email}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-3 max-w-[200px] truncate text-white/60" title={job.input_value}>
                    {job.input_value}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status] || "text-white/40 bg-white/5"}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-white/5 rounded-full h-1.5">
                        <div
                          className="bg-primary-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.min(job.progress_pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-white/30">{job.progress_pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-white/50">{job.result_row_count}</td>
                  <td className="py-2.5 pr-3 text-right text-white/50">{job.credits_used}</td>
                  <td className="py-2.5 pr-3 text-white/40 text-xs whitespace-nowrap">
                    {new Date(job.created_at).toLocaleDateString()}{" "}
                    {new Date(job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2.5 text-right">
                    {["running", "queued"].includes(job.status) && (
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handlePause(job.id)}
                          className="text-xs px-2 py-0.5 rounded text-purple-400 bg-purple-400/10 hover:bg-purple-400/20 transition"
                        >
                          Pause
                        </button>
                        <button
                          onClick={() => handleCancel(job.id)}
                          className="text-xs px-2 py-0.5 rounded text-red-400 bg-red-400/10 hover:bg-red-400/20 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-white/30">
                    {statusFilter || search ? "No jobs match your filters" : "No jobs found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/30">
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs px-3 py-1.5 rounded-lg text-white/50 bg-white/5 hover:bg-white/10 disabled:opacity-30 transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * pageSize >= total}
              className="text-xs px-3 py-1.5 rounded-lg text-white/50 bg-white/5 hover:bg-white/10 disabled:opacity-30 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
