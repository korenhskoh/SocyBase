"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { platformsApi } from "@/lib/api-client";
import type { Platform } from "@/types";

export default function AdminPlatformsPage() {
  const { user } = useAuth(true);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === "super_admin") {
      platformsApi
        .list()
        .then((r) => setPlatforms(r.data))
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
          <h1 className="text-2xl md:text-3xl font-bold text-white">Platforms</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7">
          Configured scraping platforms and credit costs
        </p>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : platforms.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No platforms configured</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[650px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 md:px-6 py-3">
                  Display Name
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Credits / Profile
                </th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                  Credits / Comment Page
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {platforms.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02] transition">
                  <td className="px-6 py-4 text-sm text-white/80 font-medium">
                    {p.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">
                    {p.display_name}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        p.is_enabled
                          ? "text-emerald-400 bg-emerald-400/10"
                          : "text-gray-400 bg-gray-400/10"
                      }`}
                    >
                      {p.is_enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">
                    {p.credit_cost_per_profile}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/60">
                    {p.credit_cost_per_comment_page}
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
