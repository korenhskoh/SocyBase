"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatCredits, formatCurrency } from "@/lib/utils";
import type { AdminDashboard } from "@/types";

export default function AdminDashboardPage() {
  const { user } = useAuth(true);
  const [stats, setStats] = useState<AdminDashboard | null>(null);

  useEffect(() => {
    if (user?.role === "super_admin") {
      adminApi.dashboard().then((r) => setStats(r.data)).catch(() => {});
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
          { label: "Total Revenue", value: stats ? formatCurrency(stats.total_revenue_cents) : "---", color: "from-yellow-500 to-orange-500" },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-6">
            <div className={`h-1 w-8 rounded-full bg-gradient-to-r ${stat.color} mb-3`} />
            <p className="text-xs text-white/40 uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
          </div>
        ))}
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
            { name: "Scraping Overview", href: "/admin/scraping" },
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
