"use client";

import { useEffect, useState, useCallback } from "react";
import { fbAdsApi } from "@/lib/api-client";
import type { FBCampaignItem, FBAdSetItem, FBAdItem, FBInsightSummary, FBConnectionStatus, PaginatedCampaigns } from "@/types";

type Tab = "campaigns" | "adsets" | "ads";
type DateRange = "7d" | "14d" | "28d" | "90d";
type SortBy = "spend" | "clicks" | "results" | "roas" | "ctr" | "name";
type StatusFilter = "ALL" | "ACTIVE" | "PAUSED";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case "ACTIVE": return "bg-emerald-500";
    case "PAUSED": return "bg-amber-500";
    case "DELETED":
    case "ARCHIVED": return "bg-red-500";
    default: return "bg-gray-500";
  }
}

function getDateRange(range: DateRange): [string, string] {
  const to = new Date();
  const from = new Date();
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "28d" ? 28 : 90;
  from.setDate(from.getDate() - days);
  return [from.toISOString().split("T")[0], to.toISOString().split("T")[0]];
}

export default function FBPerformancePage() {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [dateRange, setDateRange] = useState<DateRange>("90d");
  const [connection, setConnection] = useState<FBConnectionStatus | null>(null);
  const [summary, setSummary] = useState<FBInsightSummary | null>(null);
  const [campaigns, setCampaigns] = useState<FBCampaignItem[]>([]);
  const [adsets, setAdsets] = useState<FBAdSetItem[]>([]);
  const [ads, setAds] = useState<FBAdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<FBCampaignItem | null>(null);
  const [selectedAdSet, setSelectedAdSet] = useState<FBAdSetItem | null>(null);

  // Pagination & sort state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [totalCampaigns, setTotalCampaigns] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("spend");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const [df, dt] = getDateRange(dateRange);

  const loadData = useCallback(async () => {
    try {
      const connRes = await fbAdsApi.getConnection();
      setConnection(connRes.data);
      if (!connRes.data.connected) { setLoading(false); return; }

      const [summRes, campRes] = await Promise.all([
        fbAdsApi.getInsightsSummary(df, dt),
        fbAdsApi.listCampaigns({
          date_from: df, date_to: dt,
          page, per_page: perPage,
          sort_by: sortBy, sort_order: sortOrder,
          status_filter: statusFilter,
        }),
      ]);
      setSummary(summRes.data);
      const data = campRes.data as PaginatedCampaigns;
      setCampaigns(data.items);
      setTotalCampaigns(data.total);
      setTotalPages(data.total_pages);
    } catch {
      // not connected or error
    } finally {
      setLoading(false);
    }
  }, [df, dt, page, perPage, sortBy, sortOrder, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [dateRange, sortBy, sortOrder, statusFilter, perPage]);

  const loadAdSets = async (campaign: FBCampaignItem) => {
    setSelectedCampaign(campaign);
    setSelectedAdSet(null);
    setAds([]);
    setTab("adsets");
    try {
      const res = await fbAdsApi.listCampaignAdSets(campaign.id, df, dt);
      setAdsets(res.data);
    } catch {
      setAdsets([]);
    }
  };

  const loadAds = async (adset: FBAdSetItem) => {
    setSelectedAdSet(adset);
    setTab("ads");
    try {
      const res = await fbAdsApi.listAdSetAds(adset.id, df, dt);
      setAds(res.data);
    } catch {
      setAds([]);
    }
  };

  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState<{campaigns: number; adsets: number; ads: number; insights: number} | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncStats(null);
    try {
      const res = await fbAdsApi.triggerSync();
      const data = res.data as { detail?: string; stats?: typeof syncStats };
      const stats = data?.stats;
      if (stats) {
        setSyncStats(stats);
        if (stats.campaigns === 0) {
          setSyncError("No campaigns found in this ad account. Make sure you have campaigns in Meta Ads Manager.");
        }
      }
      if (data?.detail && data.detail !== "Sync complete.") {
        setSyncError(data.detail);
      }
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Sync failed. Please try again.";
      setSyncError(msg);
    } finally {
      setSyncing(false);
    }
  };

  const toggleStatus = async (
    type: "campaign" | "adset" | "ad",
    id: string,
    currentStatus: string,
  ) => {
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    if (!confirm(`${newStatus === "PAUSED" ? "Pause" : "Activate"} this ${type}?`)) return;
    try {
      if (type === "campaign") {
        await fbAdsApi.updateCampaignStatus(id, newStatus);
        setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
      } else if (type === "adset") {
        await fbAdsApi.updateAdSetStatus(id, newStatus);
        setAdsets(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
      } else {
        await fbAdsApi.updateAdStatus(id, newStatus);
        setAds(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
      }
    } catch {
      alert(`Failed to update ${type} status.`);
    }
  };

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortOrder(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
  };

  const sortIcon = (col: SortBy) => {
    if (sortBy !== col) return null;
    return sortOrder === "desc" ? " \u25BE" : " \u25B4";
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
        <h1 className="text-2xl font-bold text-white">Performance Dashboard</h1>
        <p className="text-white/40">Connect your Facebook account first to view performance data.</p>
        <a href="/fb-ads/connect" className="btn-glow inline-block">Go to Connection</a>
      </div>
    );
  }

  const dateRanges: { label: string; value: DateRange }[] = [
    { label: "7 Days", value: "7d" },
    { label: "14 Days", value: "14d" },
    { label: "28 Days", value: "28d" },
    { label: "90 Days", value: "90d" },
  ];

  const statusFilters: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "ALL" },
    { label: "Active", value: "ACTIVE" },
    { label: "Paused", value: "PAUSED" },
  ];

  const perPageOptions = [10, 25, 50, 100];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Performance Dashboard</h1>
          <p className="text-white/40 text-sm mt-1">
            {connection.last_synced_at
              ? `Last synced ${new Date(connection.last_synced_at).toLocaleString()}`
              : "Not synced yet"}
            {totalCampaigns > 0 && ` \u00B7 ${totalCampaigns} campaigns`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Range */}
          <div className="flex bg-white/[0.03] rounded-lg border border-white/10 p-0.5">
            {dateRanges.map(r => (
              <button
                key={r.value}
                onClick={() => setDateRange(r.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  dateRange === r.value
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-sm px-4 py-2 rounded-lg font-medium bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition disabled:opacity-50 flex items-center gap-2"
          >
            {syncing ? (
              <div className="h-3.5 w-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            )}
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      {/* Sync feedback */}
      {syncError && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300 flex items-start gap-2">
          <svg className="h-4 w-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {syncError}
        </div>
      )}
      {syncStats && !syncError && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300 flex items-start gap-2">
          <svg className="h-4 w-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Synced {syncStats.campaigns} campaigns, {syncStats.adsets} ad sets, {syncStats.ads} ads, {syncStats.insights} insight rows.
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Spend", value: formatCents(summary.total_spend), color: "text-white" },
            { label: "Total Clicks", value: formatNumber(summary.total_clicks), sub: `${summary.avg_ctr.toFixed(2)}% CTR`, color: "text-blue-400" },
            { label: "Results", value: formatNumber(summary.total_results), sub: summary.avg_cost_per_result > 0 ? `${formatCents(summary.avg_cost_per_result)} CPR` : undefined, color: "text-emerald-400" },
            { label: "ROAS", value: summary.avg_roas > 0 ? `${summary.avg_roas.toFixed(2)}x` : "\u2014", sub: summary.total_purchase_value > 0 ? formatCents(summary.total_purchase_value) + " revenue" : undefined, color: "text-purple-400" },
          ].map((card, i) => (
            <div key={i} className="glass-card p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider">{card.label}</p>
              <p className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</p>
              {card.sub && <p className="text-xs text-white/30 mt-0.5">{card.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Tabs + Breadcrumb + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => { setTab("campaigns"); setSelectedCampaign(null); setSelectedAdSet(null); }}
            className={`px-3 py-1.5 rounded-lg transition ${
              tab === "campaigns" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
            }`}
          >
            Campaigns
          </button>
          {selectedCampaign && (
            <>
              <svg className="h-4 w-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              <button
                onClick={() => { setTab("adsets"); setSelectedAdSet(null); }}
                className={`px-3 py-1.5 rounded-lg transition truncate max-w-[200px] ${
                  tab === "adsets" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
                }`}
                title={selectedCampaign.name}
              >
                {selectedCampaign.name}
              </button>
            </>
          )}
          {selectedAdSet && (
            <>
              <svg className="h-4 w-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              <span className="px-3 py-1.5 bg-white/10 text-white rounded-lg truncate max-w-[200px]" title={selectedAdSet.name}>
                {selectedAdSet.name}
              </span>
            </>
          )}
        </div>

        {/* Status filter (only on campaigns tab) */}
        {tab === "campaigns" && (
          <div className="flex items-center gap-2">
            <div className="flex bg-white/[0.03] rounded-lg border border-white/10 p-0.5">
              {statusFilters.map(f => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                    statusFilter === f.value
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Data Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th
                  className="text-left py-3 px-4 text-white/50 font-medium cursor-pointer hover:text-white/70 transition select-none"
                  onClick={() => tab === "campaigns" && handleSort("name")}
                >
                  Name{tab === "campaigns" && sortIcon("name")}
                </th>
                <th className="text-center py-3 px-2 text-white/50 font-medium w-20">Status</th>
                <th
                  className="text-right py-3 px-4 text-white/50 font-medium cursor-pointer hover:text-white/70 transition select-none"
                  onClick={() => tab === "campaigns" && handleSort("spend")}
                >
                  Spend{tab === "campaigns" && sortIcon("spend")}
                </th>
                <th
                  className="text-right py-3 px-4 text-white/50 font-medium cursor-pointer hover:text-white/70 transition select-none"
                  onClick={() => tab === "campaigns" && handleSort("clicks")}
                >
                  Clicks{tab === "campaigns" && sortIcon("clicks")}
                </th>
                <th
                  className="text-right py-3 px-4 text-white/50 font-medium cursor-pointer hover:text-white/70 transition select-none"
                  onClick={() => tab === "campaigns" && handleSort("ctr")}
                >
                  CTR{tab === "campaigns" && sortIcon("ctr")}
                </th>
                <th
                  className="text-right py-3 px-4 text-white/50 font-medium cursor-pointer hover:text-white/70 transition select-none"
                  onClick={() => tab === "campaigns" && handleSort("results")}
                >
                  Results{tab === "campaigns" && sortIcon("results")}
                </th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">CPR</th>
                <th className="text-right py-3 px-4 text-white/50 font-medium">Revenue</th>
                <th
                  className="text-right py-3 px-4 text-white/50 font-medium cursor-pointer hover:text-white/70 transition select-none"
                  onClick={() => tab === "campaigns" && handleSort("roas")}
                >
                  ROAS{tab === "campaigns" && sortIcon("roas")}
                </th>
              </tr>
            </thead>
            <tbody>
              {tab === "campaigns" && campaigns.map(c => (
                <tr
                  key={c.id}
                  className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition"
                  onClick={() => loadAdSets(c)}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium truncate max-w-[300px]">{c.name}</p>
                      {c.objective && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 uppercase shrink-0">
                          {c.objective}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStatus("campaign", c.id, c.status); }}
                      className="inline-flex items-center gap-1.5 text-xs"
                    >
                      <div className={`h-2 w-2 rounded-full ${statusColor(c.status)}`} />
                      <span className="text-white/50">{c.status}</span>
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right text-white/70">{formatCents(c.spend)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{formatNumber(c.clicks)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{c.ctr.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-white/70">{formatNumber(c.results)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{c.results > 0 ? formatCents(c.cost_per_result) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right text-white/70">{c.purchase_value > 0 ? formatCents(c.purchase_value) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right font-medium text-white">{c.roas > 0 ? `${c.roas.toFixed(2)}x` : "\u2014"}</td>
                </tr>
              ))}
              {tab === "adsets" && adsets.map(a => (
                <tr
                  key={a.id}
                  className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition"
                  onClick={() => loadAds(a)}
                >
                  <td className="py-3 px-4">
                    <p className="text-white font-medium truncate max-w-[300px]">{a.name}</p>
                    {a.optimization_goal && (
                      <p className="text-[10px] text-white/30 mt-0.5">{a.optimization_goal}</p>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStatus("adset", a.id, a.status); }}
                      className="inline-flex items-center gap-1.5 text-xs"
                    >
                      <div className={`h-2 w-2 rounded-full ${statusColor(a.status)}`} />
                      <span className="text-white/50">{a.status}</span>
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right text-white/70">{formatCents(a.spend)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{formatNumber(a.clicks)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{a.ctr.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-white/70">{formatNumber(a.results)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{a.results > 0 ? formatCents(a.cost_per_result) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right text-white/70">{a.purchase_value > 0 ? formatCents(a.purchase_value) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right font-medium text-white">{a.roas > 0 ? `${a.roas.toFixed(2)}x` : "\u2014"}</td>
                </tr>
              ))}
              {tab === "ads" && ads.map(a => (
                <tr key={a.id} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                  <td className="py-3 px-4">
                    <p className="text-white font-medium truncate max-w-[300px]">{a.name}</p>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <button
                      onClick={() => toggleStatus("ad", a.id, a.status)}
                      className="inline-flex items-center gap-1.5 text-xs"
                    >
                      <div className={`h-2 w-2 rounded-full ${statusColor(a.status)}`} />
                      <span className="text-white/50">{a.status}</span>
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right text-white/70">{formatCents(a.spend)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{formatNumber(a.clicks)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{a.ctr.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-white/70">{formatNumber(a.results)}</td>
                  <td className="py-3 px-4 text-right text-white/70">{a.results > 0 ? formatCents(a.cost_per_result) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right text-white/70">{a.purchase_value > 0 ? formatCents(a.purchase_value) : "\u2014"}</td>
                  <td className="py-3 px-4 text-right font-medium text-white">{a.roas > 0 ? `${a.roas.toFixed(2)}x` : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Empty states */}
          {tab === "campaigns" && campaigns.length === 0 && (
            <div className="py-12 text-center text-white/30 text-sm">
              No campaigns found. Click &ldquo;Sync Now&rdquo; to fetch data from Facebook.
            </div>
          )}
          {tab === "adsets" && adsets.length === 0 && (
            <div className="py-12 text-center text-white/30 text-sm">
              No ad sets found for this campaign.
            </div>
          )}
          {tab === "ads" && ads.length === 0 && (
            <div className="py-12 text-center text-white/30 text-sm">
              No ads found for this ad set.
            </div>
          )}
        </div>

        {/* Pagination (only for campaigns tab) */}
        {tab === "campaigns" && totalPages > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
            <div className="flex items-center gap-3 text-xs text-white/40">
              <span>
                Showing {Math.min((page - 1) * perPage + 1, totalCampaigns)}-{Math.min(page * perPage, totalCampaigns)} of {totalCampaigns}
              </span>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/60 outline-none"
              >
                {perPageOptions.map(n => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                First
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Prev
              </button>
              {/* Page number buttons */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-7 h-7 rounded text-xs transition ${
                      page === pageNum
                        ? "bg-white/10 text-white font-medium"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
