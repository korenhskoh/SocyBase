"use client";

import { useEffect, useState } from "react";
import { fbAdsApi } from "@/lib/api-client";
import type { FBWinningAdItem, FBConnectionStatus } from "@/types";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FBWinningAdsPage() {
  const [connection, setConnection] = useState<FBConnectionStatus | null>(null);
  const [winners, setWinners] = useState<FBWinningAdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);

  const loadData = async () => {
    try {
      const connRes = await fbAdsApi.getConnection();
      setConnection(connRes.data);
      if (!connRes.data.connected) { setLoading(false); return; }

      const res = await fbAdsApi.listWinningAds();
      setWinners(res.data);
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const res = await fbAdsApi.detectWinningAds();
      await loadData();
      const count = res.data?.count ?? 0;
      if (count === 0) {
        alert("No winning ads found. Ads need at least $50 in spend to qualify. Make sure you have synced your ad data first.");
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to detect winning ads. Please try again.";
      alert(msg);
    } finally {
      setDetecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!connection?.connected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 space-y-4">
        <h1 className="text-2xl font-bold text-white">Winning Ads</h1>
        <p className="text-white/40">Connect your Facebook account first.</p>
        <a href="/fb-ads/connect" className="btn-glow inline-block">Go to Connection</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-bold text-white">Winning Ads</h1>
          {winners.length > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
              {winners.length} winners
            </span>
          )}
        </div>
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="text-sm px-4 py-2 rounded-lg font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-50 flex items-center gap-2"
        >
          {detecting ? (
            <div className="h-3.5 w-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497" />
            </svg>
          )}
          {detecting ? "Detecting..." : "Detect Winners"}
        </button>
      </div>

      {winners.length === 0 ? (
        <div className="glass-card p-12 text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
            <svg className="h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.896m5.25-6.624v-1.516" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white">No Winners Detected Yet</h2>
          <p className="text-white/40 max-w-md mx-auto">
            Sync your ad data and click &ldquo;Detect Winners&rdquo; to find your top-performing ads. Ads need at least $50 in spend to qualify.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {winners.map(w => {
            const targeting = w.targeting || {};
            const creative = w.creative_data || {};
            const oss = (creative.object_story_spec as Record<string, unknown>) || {};
            const linkData = (oss.link_data as Record<string, unknown>) || {};
            const headline = (linkData.name as string) || (creative.title as string) || "";
            const primaryText = (linkData.message as string) || (creative.body as string) || "";

            return (
              <div key={w.id} className="glass-card p-5 space-y-4">
                {/* Top row: rank + metrics */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                      <span className="text-amber-400 font-bold text-lg">#{w.rank}</span>
                    </div>
                    <div>
                      <p className="text-white font-semibold">{w.ad_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                          Score: {w.score.toFixed(1)}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          w.ad_status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/30"
                        }`}>
                          {w.ad_status}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Performance Metrics */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {[
                    { label: "ROAS", value: w.roas > 0 ? `${w.roas.toFixed(2)}x` : "\u2014", color: "text-emerald-400" },
                    { label: "Results", value: w.total_results.toLocaleString(), color: "text-blue-400" },
                    { label: "Revenue", value: w.roas > 0 ? formatCents(Math.round(w.total_spend * w.roas)) : "\u2014", color: "text-purple-400" },
                    { label: "CPR", value: w.cost_per_result > 0 ? formatCents(w.cost_per_result) : "\u2014", color: "text-orange-400" },
                    { label: "Total Spend", value: formatCents(w.total_spend), color: "text-white/70" },
                    { label: "CTR", value: `${w.ctr.toFixed(2)}%`, color: "text-cyan-400" },
                  ].map((m, i) => (
                    <div key={i} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/5">
                      <p className="text-[10px] text-white/30 uppercase">{m.label}</p>
                      <p className={`text-sm font-bold mt-0.5 ${m.color}`}>{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* Targeting + Creative */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {Object.keys(targeting).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-white/40 uppercase tracking-wider font-semibold">Targeting</p>
                      <div className="space-y-1 text-white/50">
                        {targeting.age_min != null && (
                          <p>Age: {String(targeting.age_min)}-{String(targeting.age_max ?? 65)}+</p>
                        )}
                        {targeting.genders != null && (
                          <p>Gender: {Array.isArray(targeting.genders) ? (targeting.genders as number[]).map((g: number) => g === 1 ? "Male" : "Female").join(", ") : String(targeting.genders)}</p>
                        )}
                        {targeting.geo_locations != null && (
                          <p>Locations: {JSON.stringify(targeting.geo_locations)}</p>
                        )}
                        {Array.isArray(targeting.flexible_spec) && targeting.flexible_spec.length > 0 && (
                          <p>Interests: {JSON.stringify(targeting.flexible_spec)}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {(headline || primaryText) && (
                    <div className="space-y-1.5">
                      <p className="text-white/40 uppercase tracking-wider font-semibold">Ad Creative</p>
                      {headline && <p className="text-white/70 font-medium">{headline}</p>}
                      {primaryText && <p className="text-white/50 line-clamp-3">{primaryText}</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
