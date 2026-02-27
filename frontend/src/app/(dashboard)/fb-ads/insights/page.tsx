"use client";

import { useEffect, useState, useCallback } from "react";
import { fbAdsApi } from "@/lib/api-client";
import type { FBInsightScoreItem, FBConnectionStatus } from "@/types";

type GroupType = "creative" | "headline" | "description" | "cta";
type DateRange = "7d" | "14d" | "28d" | "lifetime";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function scoreColor(score: number): string {
  if (score >= 7) return "text-emerald-400";
  if (score >= 5) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 7) return "bg-emerald-500";
  if (score >= 5) return "bg-amber-500";
  return "bg-red-500";
}

function getDateRange(range: DateRange): [string | undefined, string | undefined] {
  if (range === "lifetime") return [undefined, undefined];
  const to = new Date();
  const from = new Date();
  const days = range === "7d" ? 7 : range === "14d" ? 14 : 28;
  from.setDate(from.getDate() - days);
  return [from.toISOString().split("T")[0], to.toISOString().split("T")[0]];
}

const GROUP_TYPES: { label: string; value: GroupType }[] = [
  { label: "Creative", value: "creative" },
  { label: "Headline", value: "headline" },
  { label: "Description", value: "description" },
  { label: "CTA", value: "cta" },
];

const DATE_RANGES: { label: string; value: DateRange }[] = [
  { label: "7 Days", value: "7d" },
  { label: "14 Days", value: "14d" },
  { label: "28 Days", value: "28d" },
  { label: "Lifetime", value: "lifetime" },
];

export default function FBInsightsPage() {
  const [connection, setConnection] = useState<FBConnectionStatus | null>(null);
  const [scores, setScores] = useState<FBInsightScoreItem[]>([]);
  const [groupType, setGroupType] = useState<GroupType>("creative");
  const [dateRange, setDateRange] = useState<DateRange>("28d");
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [df, dt] = getDateRange(dateRange);

  const loadData = useCallback(async () => {
    try {
      const connRes = await fbAdsApi.getConnection();
      setConnection(connRes.data);
      if (!connRes.data.connected) { setLoading(false); return; }

      const res = await fbAdsApi.listInsightScores(groupType, df, dt);
      setScores(res.data);
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, [groupType, df, dt]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleScore = async () => {
    setScoring(true);
    try {
      await fbAdsApi.runAIScoring(groupType, df, dt);
      await loadData();
    } catch {
      alert("AI scoring failed. Check your OpenAI API key.");
    } finally {
      setScoring(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <h1 className="text-2xl font-bold text-white">AI Insights</h1>
        <p className="text-white/40">Connect your Facebook account first.</p>
        <a href="/fb-ads/connect" className="btn-glow inline-block">Go to Connection</a>
      </div>
    );
  }

  const selectedScores = scores.filter(s => selected.has(s.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">AI Insights</h1>
          <p className="text-white/40 text-sm mt-1">AI-powered scoring of your ad components</p>
        </div>
        <button
          onClick={handleScore}
          disabled={scoring}
          className="btn-glow disabled:opacity-50 flex items-center gap-2"
        >
          {scoring ? (
            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          )}
          {scoring ? "Scoring..." : "Run AI Scoring"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex bg-white/[0.03] rounded-lg border border-white/10 p-0.5">
          {GROUP_TYPES.map(g => (
            <button
              key={g.value}
              onClick={() => { setGroupType(g.value); setSelected(new Set()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                groupType === g.value ? "bg-purple-500/20 text-purple-300" : "text-white/40 hover:text-white/60"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex bg-white/[0.03] rounded-lg border border-white/10 p-0.5">
          {DATE_RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setDateRange(r.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                dateRange === r.value ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Score Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="w-8 py-3 px-3" />
                <th className="text-left py-3 px-4 text-white/50 font-medium">Component</th>
                <th className="text-center py-3 px-4 text-white/50 font-medium w-24">Score</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Spend</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Clicks</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">CTR</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Results</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">CPR</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Revenue</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {scores.map(s => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                  <td className="py-3 px-3">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/50"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-white font-medium truncate max-w-[250px]">{s.group_value}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{s.metrics.ad_count} ad{s.metrics.ad_count !== 1 ? "s" : ""}</p>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBg(s.score)}`} style={{ width: `${s.score * 10}%` }} />
                      </div>
                      <span className={`text-sm font-bold ${scoreColor(s.score)}`}>{s.score.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-white/70">{formatCents(s.metrics.spend)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.clicks.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.ctr.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.results.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.results > 0 ? formatCents(s.metrics.cpr) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.purchase_value > 0 ? formatCents(s.metrics.purchase_value) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right font-medium text-white">{s.metrics.roas > 0 ? `${s.metrics.roas.toFixed(2)}x` : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scores.length === 0 && (
            <div className="py-12 text-center text-white/30 text-sm">
              No scores yet. Click &ldquo;Run AI Scoring&rdquo; to analyze your ad components.
            </div>
          )}
        </div>
      </div>

      {/* Compare Panel */}
      {selectedScores.length >= 2 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Compare Selected</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedScores.map(s => (
              <div key={s.id} className="glass-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-white font-medium text-sm truncate">{s.group_value}</p>
                  <span className={`text-lg font-bold ${scoreColor(s.score)}`}>{s.score.toFixed(1)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-white/30">Spend</span><p className="text-white/70">{formatCents(s.metrics.spend)}</p></div>
                  <div><span className="text-white/30">CTR</span><p className="text-white/70">{s.metrics.ctr.toFixed(2)}%</p></div>
                  <div><span className="text-white/30">Results</span><p className="text-white/70">{s.metrics.results}</p></div>
                  <div><span className="text-white/30">ROAS</span><p className="text-white/70">{s.metrics.roas > 0 ? `${s.metrics.roas.toFixed(2)}x` : "\u2014"}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
