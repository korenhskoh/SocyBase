"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { fbAdsApi } from "@/lib/api-client";
import type { FBInsightScoreItem, FBConnectionStatus } from "@/types";

type GroupType = "creative" | "headline" | "description" | "cta";
type DateRange = "7d" | "14d" | "28d" | "lifetime";
type SortKey = "score" | "spend" | "ctr" | "results" | "roas";
type SortDir = "asc" | "desc";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function scoreColor(score: number): string {
  if (score >= 7) return "text-emerald-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 7) return "bg-emerald-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function scoreBorderColor(score: number): string {
  if (score >= 7) return "border-emerald-500/30";
  if (score >= 4) return "border-amber-500/30";
  return "border-red-500/30";
}

function scoreLabel(score: number): string {
  if (score >= 8) return "Excellent";
  if (score >= 6) return "Good";
  if (score >= 4) return "Average";
  if (score >= 2) return "Below Avg";
  return "Poor";
}

function getDateRange(range: DateRange): [string | undefined, string | undefined] {
  if (range === "lifetime") return [undefined, undefined];
  const to = new Date();
  const from = new Date();
  const days = range === "7d" ? 7 : range === "14d" ? 14 : 28;
  from.setDate(from.getDate() - days);
  return [from.toISOString().split("T")[0], to.toISOString().split("T")[0]];
}

const GROUP_TYPES: { label: string; value: GroupType; icon: string; desc: string }[] = [
  { label: "Creative", value: "creative", desc: "Ad creative titles", icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5" },
  { label: "Headline", value: "headline", desc: "Ad headlines", icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" },
  { label: "Description", value: "description", desc: "Ad descriptions", icon: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" },
  { label: "CTA", value: "cta", desc: "Call-to-action buttons", icon: "M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" },
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
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
      const res = await fbAdsApi.runAIScoring(groupType, df, dt);
      await loadData();
      const count = res.data?.count ?? 0;
      if (count === 0) {
        alert("No ad components found to score. Make sure you have synced your ad data first.");
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "AI scoring failed. Please try again.";
      alert(msg);
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Sorted scores
  const sortedScores = useMemo(() => {
    const arr = [...scores];
    arr.sort((a, b) => {
      let va = 0, vb = 0;
      switch (sortKey) {
        case "score": va = a.score; vb = b.score; break;
        case "spend": va = a.metrics.spend; vb = b.metrics.spend; break;
        case "ctr": va = a.metrics.ctr; vb = b.metrics.ctr; break;
        case "results": va = a.metrics.results; vb = b.metrics.results; break;
        case "roas": va = a.metrics.roas; vb = b.metrics.roas; break;
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return arr;
  }, [scores, sortKey, sortDir]);

  // Summary stats
  const summary = useMemo(() => {
    if (scores.length === 0) return null;
    const avgScore = scores.reduce((s, c) => s + c.score, 0) / scores.length;
    const totalSpend = scores.reduce((s, c) => s + c.metrics.spend, 0);
    const totalResults = scores.reduce((s, c) => s + c.metrics.results, 0);
    const best = scores.reduce((best, c) => c.score > best.score ? c : best, scores[0]);
    const highPerf = scores.filter(s => s.score >= 7).length;
    const midPerf = scores.filter(s => s.score >= 4 && s.score < 7).length;
    const lowPerf = scores.filter(s => s.score < 4).length;
    return { avgScore, totalSpend, totalResults, best, highPerf, midPerf, lowPerf };
  }, [scores]);

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
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center shrink-0">
            <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">AI Insights</h1>
            <p className="text-white/40 text-sm mt-0.5">Performance scoring of your ad components</p>
          </div>
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
          {scoring ? "Analyzing..." : "Run AI Scoring"}
        </button>
      </div>

      {/* Group Type Selector - Card Style */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {GROUP_TYPES.map(g => (
          <button
            key={g.value}
            onClick={() => { setGroupType(g.value); setSelected(new Set()); }}
            className={`p-3 rounded-xl border text-left transition group ${
              groupType === g.value
                ? "bg-purple-500/10 border-purple-500/30"
                : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                groupType === g.value ? "bg-purple-500/20" : "bg-white/5"
              }`}>
                <svg className={`h-4 w-4 ${groupType === g.value ? "text-purple-400" : "text-white/30"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={g.icon} />
                </svg>
              </div>
              <div>
                <p className={`text-sm font-medium ${groupType === g.value ? "text-purple-300" : "text-white/60"}`}>{g.label}</p>
                <p className="text-[10px] text-white/30">{g.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Date Range */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-white/30">Period:</span>
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
        {scores.length > 0 && (
          <span className="text-xs text-white/20 ml-auto">{scores.length} components scored</span>
        )}
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <svg className="h-3.5 w-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
              </div>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Avg Score</span>
            </div>
            <p className={`text-2xl font-bold ${scoreColor(summary.avgScore)}`}>{summary.avgScore.toFixed(1)}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{scoreLabel(summary.avgScore)}</p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497" />
                </svg>
              </div>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Best Performer</span>
            </div>
            <p className="text-sm font-bold text-white truncate">{summary.best.group_value}</p>
            <p className={`text-[10px] mt-0.5 ${scoreColor(summary.best.score)}`}>Score: {summary.best.score.toFixed(1)}</p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Total Spend</span>
            </div>
            <p className="text-2xl font-bold text-white">{formatCents(summary.totalSpend)}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{summary.totalResults.toLocaleString()} total results</p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Distribution</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-white/60">{summary.highPerf}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-xs text-white/60">{summary.midPerf}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-xs text-white/60">{summary.lowPerf}</span>
              </div>
            </div>
            {/* Mini distribution bar */}
            <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-white/5">
              {summary.highPerf > 0 && <div className="bg-emerald-500" style={{ width: `${(summary.highPerf / scores.length) * 100}%` }} />}
              {summary.midPerf > 0 && <div className="bg-amber-500" style={{ width: `${(summary.midPerf / scores.length) * 100}%` }} />}
              {summary.lowPerf > 0 && <div className="bg-red-500" style={{ width: `${(summary.lowPerf / scores.length) * 100}%` }} />}
            </div>
          </div>
        </div>
      )}

      {/* Score Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="w-8 py-3 px-3" />
                <th className="text-left py-3 px-4 text-white/50 font-medium">Component</th>
                <th className="text-center py-3 px-4 text-white/50 font-medium w-32">
                  <button onClick={() => handleSort("score")} className="inline-flex items-center gap-1 hover:text-white/70 transition">
                    Score
                    {sortKey === "score" && <span className="text-[10px]">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>}
                  </button>
                </th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">
                  <button onClick={() => handleSort("spend")} className="inline-flex items-center gap-1 hover:text-white/70 transition">
                    Spend
                    {sortKey === "spend" && <span className="text-[10px]">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>}
                  </button>
                </th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Impressions</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Clicks</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">
                  <button onClick={() => handleSort("ctr")} className="inline-flex items-center gap-1 hover:text-white/70 transition">
                    CTR
                    {sortKey === "ctr" && <span className="text-[10px]">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>}
                  </button>
                </th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">
                  <button onClick={() => handleSort("results")} className="inline-flex items-center gap-1 hover:text-white/70 transition">
                    Results
                    {sortKey === "results" && <span className="text-[10px]">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>}
                  </button>
                </th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">CPR</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">
                  <button onClick={() => handleSort("roas")} className="inline-flex items-center gap-1 hover:text-white/70 transition">
                    ROAS
                    {sortKey === "roas" && <span className="text-[10px]">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedScores.map((s, idx) => (
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
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] text-white/20 w-4 text-right shrink-0">
                        {sortKey === "score" && sortDir === "desc" ? idx + 1 : ""}
                      </span>
                      <div>
                        <p className="text-white font-medium truncate max-w-[250px]">{s.group_value}</p>
                        <p className="text-[10px] text-white/30 mt-0.5">{s.metrics.ad_count} ad{s.metrics.ad_count !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5 justify-center">
                      {/* Circular score indicator */}
                      <div className="relative h-9 w-9 shrink-0">
                        <svg className="h-9 w-9 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15" fill="none" className="stroke-white/5" strokeWidth="3" />
                          <circle
                            cx="18" cy="18" r="15" fill="none"
                            className={`${s.score >= 7 ? "stroke-emerald-500" : s.score >= 4 ? "stroke-amber-500" : "stroke-red-500"}`}
                            strokeWidth="3"
                            strokeDasharray={`${(s.score / 10) * 94.2} 94.2`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${scoreColor(s.score)}`}>
                          {s.score.toFixed(1)}
                        </span>
                      </div>
                      <span className={`text-[10px] ${scoreColor(s.score)}`}>{scoreLabel(s.score)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-white/70">{formatCents(s.metrics.spend)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.impressions.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.clicks.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.ctr.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.results.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-white/70">{s.metrics.results > 0 ? formatCents(s.metrics.cpr) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right font-medium text-white">{s.metrics.roas > 0 ? `${s.metrics.roas.toFixed(2)}x` : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scores.length === 0 && (
            <div className="py-16 text-center space-y-4">
              <div className="h-14 w-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto">
                <svg className="h-7 w-7 text-purple-400/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
              <div>
                <p className="text-white/50 font-medium">No scores yet</p>
                <p className="text-white/30 text-sm mt-1 max-w-sm mx-auto">
                  Click &ldquo;Run AI Scoring&rdquo; to analyze your ad components and get performance scores.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compare Panel */}
      {selectedScores.length >= 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider flex items-center gap-2">
              <svg className="h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              Comparing {selectedScores.length} Components
            </h3>
            <button onClick={() => setSelected(new Set())} className="text-xs text-white/30 hover:text-white/60 transition">
              Clear Selection
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedScores.map(s => (
              <div key={s.id} className={`glass-card p-5 space-y-4 border ${scoreBorderColor(s.score)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{s.group_value}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{s.metrics.ad_count} ad{s.metrics.ad_count !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="relative h-12 w-12 shrink-0 ml-3">
                    <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" className="stroke-white/5" strokeWidth="2.5" />
                      <circle
                        cx="18" cy="18" r="15" fill="none"
                        className={`${s.score >= 7 ? "stroke-emerald-500" : s.score >= 4 ? "stroke-amber-500" : "stroke-red-500"}`}
                        strokeWidth="2.5"
                        strokeDasharray={`${(s.score / 10) * 94.2} 94.2`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${scoreColor(s.score)}`}>
                      {s.score.toFixed(1)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/30">Spend</span>
                    <span className="text-white/70 font-medium">{formatCents(s.metrics.spend)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/30">CTR</span>
                    <span className="text-white/70 font-medium">{s.metrics.ctr.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/30">Results</span>
                    <span className="text-white/70 font-medium">{s.metrics.results.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/30">ROAS</span>
                    <span className="text-white/70 font-medium">{s.metrics.roas > 0 ? `${s.metrics.roas.toFixed(2)}x` : "\u2014"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/30">CPR</span>
                    <span className="text-white/70 font-medium">{s.metrics.results > 0 ? formatCents(s.metrics.cpr) : "\u2014"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/30">Revenue</span>
                    <span className="text-white/70 font-medium">{s.metrics.purchase_value > 0 ? formatCents(s.metrics.purchase_value) : "\u2014"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
