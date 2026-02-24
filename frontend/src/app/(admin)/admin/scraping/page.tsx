"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatDate, formatCredits, getStatusColor } from "@/lib/utils";

interface UserStat {
  user_id: string;
  email: string;
  full_name: string | null;
  total_jobs: number;
  total_profiles: number;
  total_credits_used: number;
}

interface PlatformStat {
  platform: string;
  job_count: number;
  profiles: number;
}

interface RecentJob {
  id: string;
  user_email: string;
  input_value: string;
  status: string;
  result_row_count: number;
  credits_used: number;
  progress_pct: number;
  created_at: string;
  completed_at: string | null;
}

interface ScrapingOverview {
  user_stats: UserStat[];
  platform_stats: PlatformStat[];
  status_breakdown: Record<string, number>;
  recent_jobs: RecentJob[];
}

export default function AdminScrapingPage() {
  const { user } = useAuth(true);
  const [data, setData] = useState<ScrapingOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === "super_admin") {
      adminApi
        .scrapingOverview()
        .then((r) => setData(r.data))
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-20 text-white/40">Failed to load data.</div>;
  }

  const totalJobs = Object.values(data.status_breakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin" className="text-white/40 hover:text-white transition">
            &larr;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Scraping Overview</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7">All scraping activity across every user</p>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {Object.entries(data.status_breakdown)
          .sort(([, a], [, b]) => b - a)
          .map(([status, count]) => (
            <div key={status} className="glass-card p-4 text-center">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(status)}`}>
                {status}
              </span>
              <p className="text-xl font-bold text-white mt-2">{count}</p>
            </div>
          ))}
      </div>

      {/* Platform Stats */}
      {data.platform_stats.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">
            By Platform
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {data.platform_stats.map((p) => (
              <div key={p.platform} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02]">
                <span className="text-sm text-white/80 font-medium">{p.platform}</span>
                <div className="text-right">
                  <p className="text-sm text-white font-medium">{p.job_count} jobs</p>
                  <p className="text-xs text-white/40">{formatCredits(p.profiles)} profiles</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-User Stats */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white">User Activity</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  User
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Total Jobs
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Profiles
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Credits Used
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.user_stats.map((u) => (
                <tr key={u.user_id} className="hover:bg-white/[0.02] transition">
                  <td className="px-6 py-4">
                    <p className="text-sm text-white/80 font-medium">{u.email}</p>
                    {u.full_name && <p className="text-xs text-white/40">{u.full_name}</p>}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">{u.total_jobs}</td>
                  <td className="px-6 py-4 text-sm text-white/60">{formatCredits(u.total_profiles)}</td>
                  <td className="px-6 py-4 text-sm text-white/60">{formatCredits(u.total_credits_used)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Jobs (All Users) */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white">Recent Jobs (All Users)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  User
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Input
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Progress
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
              {data.recent_jobs.map((j) => (
                <tr key={j.id} className="hover:bg-white/[0.02] transition">
                  <td className="px-6 py-4 text-sm text-white/60">{j.user_email}</td>
                  <td className="px-6 py-4 text-sm text-white/80 truncate max-w-[200px]">
                    {j.input_value}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(j.status)}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary-500"
                          style={{ width: `${j.progress_pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-white/40">{j.progress_pct}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">{j.result_row_count}</td>
                  <td className="px-6 py-4 text-sm text-white/60">{j.credits_used}</td>
                  <td className="px-6 py-4 text-xs text-white/40">{formatDate(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
