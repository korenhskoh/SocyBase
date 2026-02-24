"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { tenantDashboardApi } from "@/lib/api-client";
import { formatCredits, getStatusColor, formatDate } from "@/lib/utils";

interface TenantStats {
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  active_jobs: number;
  total_profiles_scraped: number;
  success_profiles: number;
  credit_balance: number;
  lifetime_purchased: number;
  lifetime_used: number;
  credits_used_this_month: number;
  jobs_this_week: number;
  recent_jobs: {
    id: string;
    input_value: string;
    status: string;
    result_row_count: number;
    credits_used: number;
    created_at: string;
    completed_at: string | null;
  }[];
}

export default function TenantDashboardPage() {
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tenantDashboardApi
      .getStats()
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-20 text-white/40">Failed to load dashboard data.</div>
    );
  }

  const successRate =
    stats.total_profiles_scraped > 0
      ? Math.round((stats.success_profiles / stats.total_profiles_scraped) * 100)
      : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Tenant Dashboard</h1>
        <p className="text-white/50 mt-1">Overview of your organization&apos;s activity</p>
      </div>

      {/* Top Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Credit Balance" value={formatCredits(stats.credit_balance)} color="primary" />
        <StatCard label="Total Jobs" value={stats.total_jobs.toString()} color="purple" />
        <StatCard label="Profiles Scraped" value={formatCredits(stats.success_profiles)} color="pink" />
        <StatCard label="Active Jobs" value={stats.active_jobs.toString()} color="cyan" />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <p className="text-xs text-white/40 uppercase tracking-wider">Completed Jobs</p>
          <p className="text-xl font-bold text-emerald-400 mt-1">{stats.completed_jobs}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-white/40 uppercase tracking-wider">Failed Jobs</p>
          <p className="text-xl font-bold text-red-400 mt-1">{stats.failed_jobs}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-white/40 uppercase tracking-wider">Credits This Month</p>
          <p className="text-xl font-bold text-amber-400 mt-1">{formatCredits(stats.credits_used_this_month)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-white/40 uppercase tracking-wider">Jobs This Week</p>
          <p className="text-xl font-bold text-blue-400 mt-1">{stats.jobs_this_week}</p>
        </div>
      </div>

      {/* Progress Bars */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-sm font-medium text-white/60 uppercase tracking-wider">Performance</h2>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-white/60">Profile Success Rate</span>
            <span className="text-white font-medium">{successRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${successRate}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-white/60">Credits Used / Purchased</span>
            <span className="text-white font-medium">
              {formatCredits(stats.lifetime_used)} / {formatCredits(stats.lifetime_purchased)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-purple transition-all duration-500"
              style={{
                width: `${stats.lifetime_purchased > 0 ? Math.min(100, (stats.lifetime_used / stats.lifetime_purchased) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Recent Jobs Table */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white">Recent Jobs</h2>
          <Link href="/jobs" className="text-sm text-primary-400 hover:text-primary-300 transition">
            View all
          </Link>
        </div>
        {stats.recent_jobs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No jobs yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                    Input
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                    Profiles
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                    Credits
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.recent_jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-white/[0.02] transition">
                    <td className="px-6 py-4">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-sm text-primary-400 hover:text-primary-300 truncate block max-w-[250px]"
                      >
                        {job.input_value}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-white/60">{job.result_row_count}</td>
                    <td className="px-6 py-4 text-sm text-white/60">{job.credits_used}</td>
                    <td className="px-6 py-4 text-xs text-white/40">{formatDate(job.created_at)}</td>
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

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    primary: "from-primary-500/20 to-primary-500/5 text-primary-400",
    purple: "from-accent-purple/20 to-accent-purple/5 text-accent-purple",
    pink: "from-accent-pink/20 to-accent-pink/5 text-accent-pink",
    cyan: "from-cyan-500/20 to-cyan-500/5 text-cyan-400",
  };

  return (
    <div className="glass-card p-5 bg-gradient-to-br relative overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${colorMap[color]?.split(" ")[0]} ${colorMap[color]?.split(" ")[1]} opacity-30`} />
      <div className="relative">
        <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${colorMap[color]?.split(" ")[2]}`}>{value}</p>
      </div>
    </div>
  );
}
