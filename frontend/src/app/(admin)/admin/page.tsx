"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatCredits } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import type { AdminDashboard } from "@/types";

const DynamicVisitorGlobe = dynamic(
  () => import("@/components/3d/VisitorGlobe").then((mod) => ({ default: mod.VisitorGlobe })),
  { ssr: false },
);

interface Visitor {
  vid: string;
  ip: string;
  path: string;
  method: string;
  ua: string;
  geo: { country: string; country_code: string; city: string; region?: string; lat?: number; lon?: number };
  ts: number;
}

function timeAgo(ts: number): string {
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

function deviceFromUA(ua: string): string {
  if (/mobile|android|iphone/i.test(ua)) return "Mobile";
  if (/tablet|ipad/i.test(ua)) return "Tablet";
  return "Desktop";
}

function browserFromUA(ua: string): string {
  if (/edg/i.test(ua)) return "Edge";
  if (/chrome/i.test(ua)) return "Chrome";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

export default function AdminDashboardPage() {
  const { user } = useAuth(true);
  const { formatPrice } = useCurrency();
  const [stats, setStats] = useState<AdminDashboard | null>(null);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [visitorCount, setVisitorCount] = useState(0);

  useEffect(() => {
    if (user?.role === "super_admin") {
      adminApi.dashboard().then((r) => setStats(r.data)).catch(() => {});
    }
  }, [user]);

  const fetchVisitors = useCallback(() => {
    adminApi
      .liveVisitors()
      .then((r) => {
        setVisitors(r.data.visitors || []);
        setVisitorCount(r.data.count || 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.role !== "super_admin") return;
    fetchVisitors();
    const interval = setInterval(fetchVisitors, 10_000); // refresh every 10s
    return () => clearInterval(interval);
  }, [user, fetchVisitors]);

  if (user?.role !== "super_admin") {
    return (
      <div className="text-center py-20 text-white/40">
        Access denied. Super admin only.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Admin Dashboard</h1>
        <p className="text-white/50 mt-1">System overview and management</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: stats?.total_users ?? "---", color: "from-primary-500 to-blue-600" },
          { label: "Total Tenants", value: stats?.total_tenants ?? "---", color: "from-accent-purple to-purple-700" },
          { label: "Total Jobs", value: stats?.total_jobs ?? "---", color: "from-accent-pink to-rose-600" },
          { label: "Active Jobs", value: stats?.active_jobs ?? "---", color: "from-cyan-500 to-teal-600" },
          { label: "Credits Sold", value: stats ? formatCredits(stats.total_credits_sold) : "---", color: "from-emerald-500 to-green-600" },
          { label: "Total Revenue", value: stats ? formatPrice(stats.total_revenue_cents) : "---", color: "from-yellow-500 to-orange-500" },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-6">
            <div className={`h-1 w-8 rounded-full bg-gradient-to-r ${stat.color} mb-3`} />
            <p className="text-xs text-white/40 uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Visitor Globe */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Visitor Map</h2>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {visitorCount} online
            </span>
          </div>
        </div>
        <div className="h-[400px] md:h-[500px] w-full">
          <DynamicVisitorGlobe
            visitors={visitors}
            className="w-full h-full"
          />
        </div>
      </div>

      {/* Live Visitors */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Live Visitors</h2>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {visitorCount} online
            </span>
          </div>
          <button
            onClick={fetchVisitors}
            className="text-xs text-white/40 hover:text-white/70 transition"
          >
            Refresh
          </button>
        </div>

        {visitors.length === 0 ? (
          <p className="text-sm text-white/30 py-4 text-center">No active visitors right now</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs text-white/30 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Location</th>
                  <th className="pb-2 pr-4">IP</th>
                  <th className="pb-2 pr-4">Page</th>
                  <th className="pb-2 pr-4">Device</th>
                  <th className="pb-2">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visitors.map((v) => (
                  <tr key={v.vid} className="text-white/60">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <span className="text-white/80">
                        {v.geo.city ? `${v.geo.city}, ` : ""}
                        {v.geo.country}
                      </span>
                      {v.geo.country_code && (
                        <span className="ml-1.5 text-xs text-white/30">{v.geo.country_code}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-white/40">{v.ip}</td>
                    <td className="py-2 pr-4 max-w-[200px] truncate text-white/50">{v.path}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-xs">
                      {deviceFromUA(v.ua)} / {browserFromUA(v.ua)}
                    </td>
                    <td className="py-2 text-xs text-white/40">{timeAgo(v.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { name: "Users", href: "/admin/users" },
            { name: "Payments", href: "/admin/payments" },
            { name: "Packages", href: "/admin/packages" },
            { name: "Platforms", href: "/admin/platforms" },
            { name: "AI-Scraping Overview", href: "/admin/scraping" },
            { name: "Job Management", href: "/admin/jobs" },
            { name: "Payment Settings", href: "/admin/settings" },
            { name: "Audit Logs", href: "/admin/audit-logs" },
          ].map((action) => (
            <a
              key={action.name}
              href={action.href}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center text-sm text-white/60 hover:text-white hover:border-primary-500/30 hover:bg-primary-500/5 transition"
            >
              {action.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
