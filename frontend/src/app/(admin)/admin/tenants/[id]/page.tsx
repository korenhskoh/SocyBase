"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  settings: {
    max_concurrent_jobs: number;
    daily_job_limit: number;
    monthly_credit_limit: number;
  };
  credit_balance: number;
  lifetime_purchased: number;
  lifetime_used: number;
  jobs_today: number;
  credits_this_month: number;
  active_jobs: number;
}

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
};

export default function AdminTenantDetailPage() {
  const { user } = useAuth(true);
  const params = useParams();
  const tenantId = params.id as string;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsPage, setJobsPage] = useState(1);

  // Settings form
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [dailyJobLimit, setDailyJobLimit] = useState(0);
  const [monthlyCredLimit, setMonthlyCredLimit] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // Credit grant
  const [grantAmount, setGrantAmount] = useState("");
  const [grantDesc, setGrantDesc] = useState("Bonus credits");
  const [granting, setGranting] = useState(false);
  const [grantMsg, setGrantMsg] = useState("");

  const fetchData = async () => {
    try {
      const [tenantRes, jobsRes] = await Promise.all([
        adminApi.getTenantSettings(tenantId),
        adminApi.listAllJobs({ tenant_id: tenantId, page: jobsPage, page_size: 10 }),
      ]);
      const t = tenantRes.data;
      setTenant(t);
      setMaxConcurrent(t.settings.max_concurrent_jobs);
      setDailyJobLimit(t.settings.daily_job_limit);
      setMonthlyCredLimit(t.settings.monthly_credit_limit);
      setJobs(jobsRes.data.items);
      setJobsTotal(jobsRes.data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "super_admin" && tenantId) {
      fetchData();
    }
  }, [user, tenantId, jobsPage]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg("");
    try {
      await adminApi.updateTenantSettings(tenantId, {
        max_concurrent_jobs: maxConcurrent,
        daily_job_limit: dailyJobLimit,
        monthly_credit_limit: monthlyCredLimit,
      });
      setSettingsMsg("Settings saved!");
      // Refresh stats
      const res = await adminApi.getTenantSettings(tenantId);
      setTenant(res.data);
    } catch {
      setSettingsMsg("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleGrant = async () => {
    const amount = parseInt(grantAmount);
    if (!amount || amount <= 0) return;
    setGranting(true);
    setGrantMsg("");
    try {
      await adminApi.grantCredits({ tenant_id: tenantId, amount, description: grantDesc });
      setGrantMsg(`Granted ${amount} credits`);
      setGrantAmount("");
      // Refresh
      const res = await adminApi.getTenantSettings(tenantId);
      setTenant(res.data);
    } catch {
      setGrantMsg("Failed to grant credits");
    } finally {
      setGranting(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    if (!confirm("Cancel this job?")) return;
    try {
      await adminApi.adminCancelJob(jobId);
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "cancelled" } : j));
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to cancel");
    }
  };

  const handlePauseJob = async (jobId: string) => {
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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin/users" className="text-white/40 hover:text-white transition">&larr;</Link>
          <h1 className="text-2xl font-bold text-white">
            {loading ? "Loading..." : tenant?.name || "Tenant"}
          </h1>
          {tenant && (
            <span className="text-sm text-white/30 font-mono">({tenant.slug})</span>
          )}
        </div>
        <p className="text-white/50 text-sm ml-7">Manage scraping limits, credits, and jobs</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tenant ? (
        <>
          {/* Info Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: "Status",
                value: tenant.is_active ? "Active" : "Inactive",
                color: tenant.is_active ? "text-emerald-400" : "text-red-400",
              },
              { label: "Active Jobs", value: tenant.active_jobs, color: "text-amber-400" },
              { label: "Jobs Today", value: tenant.jobs_today, color: "text-blue-400" },
              { label: "Credits This Month", value: tenant.credits_this_month, color: "text-purple-400" },
            ].map((card) => (
              <div key={card.label} className="glass-card p-4">
                <p className="text-xs text-white/40">{card.label}</p>
                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Scraping Settings */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-blue-500/10 border border-blue-500/20">
                <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Scraping Limits</h2>
                <p className="text-sm text-white/40">Control job creation and credit usage</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs text-white/60 mb-1">Max Concurrent Jobs</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(parseInt(e.target.value) || 1)}
                  className="input-glass text-sm"
                />
                <p className="text-xs text-white/30 mt-1">1-50 jobs at once</p>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Daily Job Limit</label>
                <input
                  type="number"
                  min={0}
                  value={dailyJobLimit}
                  onChange={(e) => setDailyJobLimit(parseInt(e.target.value) || 0)}
                  className="input-glass text-sm"
                />
                <p className="text-xs text-white/30 mt-1">0 = unlimited</p>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Monthly Credit Limit</label>
                <input
                  type="number"
                  min={0}
                  value={monthlyCredLimit}
                  onChange={(e) => setMonthlyCredLimit(parseInt(e.target.value) || 0)}
                  className="input-glass text-sm"
                />
                <p className="text-xs text-white/30 mt-1">0 = unlimited</p>
              </div>
            </div>

            {settingsMsg && (
              <p className={`text-xs ${settingsMsg.includes("saved") ? "text-emerald-400" : "text-red-400"}`}>
                {settingsMsg}
              </p>
            )}

            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="btn-glow px-6 py-2 text-sm disabled:opacity-50"
            >
              {savingSettings ? "Saving..." : "Save Settings"}
            </button>
          </div>

          {/* Credits */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20">
                <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Credits</h2>
                <p className="text-sm text-white/40">Balance and usage tracking</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-2">
              <div>
                <p className="text-xs text-white/40">Current Balance</p>
                <p className="text-2xl font-bold text-emerald-400">{tenant.credit_balance.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Lifetime Purchased</p>
                <p className="text-lg font-semibold text-white/70">{tenant.lifetime_purchased.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Lifetime Used</p>
                <p className="text-lg font-semibold text-white/70">{tenant.lifetime_used.toLocaleString()}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-white/5">
              <p className="text-xs text-white/60 font-medium mb-2">Grant Credits</p>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-white/40 mb-1">Amount</label>
                  <input
                    type="number"
                    min={1}
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    placeholder="100"
                    className="input-glass text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input
                    type="text"
                    value={grantDesc}
                    onChange={(e) => setGrantDesc(e.target.value)}
                    className="input-glass text-sm"
                  />
                </div>
                <button
                  onClick={handleGrant}
                  disabled={granting || !grantAmount}
                  className="px-4 py-2 text-sm rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition disabled:opacity-50"
                >
                  {granting ? "..." : "Grant"}
                </button>
              </div>
              {grantMsg && (
                <p className={`text-xs mt-2 ${grantMsg.includes("Granted") ? "text-emerald-400" : "text-red-400"}`}>
                  {grantMsg}
                </p>
              )}
            </div>
          </div>

          {/* Jobs Table */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
                  <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Jobs</h2>
                  <p className="text-sm text-white/40">{jobsTotal} total jobs</p>
                </div>
              </div>
              <Link
                href={`/admin/jobs?tenant_id=${tenantId}`}
                className="text-xs text-primary-400 hover:text-primary-300 transition"
              >
                View all &rarr;
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 pr-4">Input</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Progress</th>
                    <th className="text-right py-2 pr-4">Profiles</th>
                    <th className="text-right py-2 pr-4">Credits</th>
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 pr-4 max-w-[180px] truncate text-white/70" title={job.input_value}>
                        {job.input_value}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status] || "text-white/40 bg-white/5"}`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="w-20 bg-white/5 rounded-full h-1.5">
                          <div
                            className="bg-primary-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${Math.min(job.progress_pct, 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right text-white/50">{job.result_row_count}</td>
                      <td className="py-2 pr-4 text-right text-white/50">{job.credits_used}</td>
                      <td className="py-2 pr-4 text-white/40 text-xs">
                        {new Date(job.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-right">
                        {["running", "queued"].includes(job.status) && (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handlePauseJob(job.id)}
                              className="text-xs px-2 py-0.5 rounded text-purple-400 bg-purple-400/10 hover:bg-purple-400/20 transition"
                            >
                              Pause
                            </button>
                            <button
                              onClick={() => handleCancelJob(job.id)}
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
                      <td colSpan={7} className="py-8 text-center text-white/30">No jobs found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {jobsTotal > 10 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-white/30">
                  Showing {(jobsPage - 1) * 10 + 1}-{Math.min(jobsPage * 10, jobsTotal)} of {jobsTotal}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                    disabled={jobsPage === 1}
                    className="text-xs px-3 py-1 rounded-lg text-white/50 bg-white/5 hover:bg-white/10 disabled:opacity-30 transition"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setJobsPage((p) => p + 1)}
                    disabled={jobsPage * 10 >= jobsTotal}
                    className="text-xs px-3 py-1 rounded-lg text-white/50 bg-white/5 hover:bg-white/10 disabled:opacity-30 transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-white/40">Tenant not found</div>
      )}
    </div>
  );
}
