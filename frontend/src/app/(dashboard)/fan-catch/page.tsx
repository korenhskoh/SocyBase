"use client";

import { useEffect, useState, useCallback } from "react";
import { jobsApi, fanAnalysisApi } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { ScrapingJob, FanEngagementMetrics } from "@/types";

export default function FanCatchPage() {
  // Job selector
  const [jobs, setJobs] = useState<ScrapingJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Fan data
  const [fans, setFans] = useState<FanEngagementMetrics[]>([]);
  const [fansTotal, setFansTotal] = useState(0);
  const [fansPage, setFansPage] = useState(1);
  const [fansSortBy, setFansSortBy] = useState("engagement_score");
  const [showBots, setShowBots] = useState(true);
  const [fansBotCount, setFansBotCount] = useState(0);
  const [fansHighIntent, setFansHighIntent] = useState(0);
  const [loadingFans, setLoadingFans] = useState(false);

  // Actions
  const [analyzingFans, setAnalyzingFans] = useState<Set<string>>(new Set());
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [expandedFan, setExpandedFan] = useState<string | null>(null);

  // Load completed comment scraper jobs
  useEffect(() => {
    (async () => {
      try {
        // Fetch all completed jobs, then filter client-side for comment scrapers
        const res = await jobsApi.list({ page_size: 100, status: "completed" });
        const allJobs: ScrapingJob[] = res.data.items || res.data || [];
        const commentJobs = allJobs.filter(
          (j) => j.job_type !== "post_discovery" && j.result_row_count > 0
        );
        setJobs(commentJobs);
        if (commentJobs.length > 0) {
          setSelectedJobId(commentJobs[0].id);
        }
      } catch {
        /* ignore */
      } finally {
        setLoadingJobs(false);
      }
    })();
  }, []);

  const fetchFans = useCallback(async () => {
    if (!selectedJobId) return;
    setLoadingFans(true);
    try {
      const res = await fanAnalysisApi.getFans(selectedJobId, {
        page: fansPage,
        page_size: 50,
        sort_by: fansSortBy,
        show_bots: showBots,
      });
      setFans(res.data.items || []);
      setFansTotal(res.data.total || 0);
      setFansBotCount(res.data.bot_count || 0);
      setFansHighIntent(res.data.high_intent_count || 0);
    } catch {
      setFans([]);
      setFansTotal(0);
    } finally {
      setLoadingFans(false);
    }
  }, [selectedJobId, fansPage, fansSortBy, showBots]);

  useEffect(() => {
    if (selectedJobId) {
      setFansPage(1);
      setExpandedFan(null);
    }
  }, [selectedJobId]);

  useEffect(() => {
    fetchFans();
  }, [fetchFans]);

  const handleAnalyzeFan = async (uid: string) => {
    setAnalyzingFans((prev) => new Set(prev).add(uid));
    try {
      await fanAnalysisApi.analyzeFan({
        job_id: selectedJobId,
        commenter_user_ids: [uid],
      });
      await fetchFans();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "AI analysis failed";
      alert(msg);
    } finally {
      setAnalyzingFans((prev) => {
        const n = new Set(prev);
        n.delete(uid);
        return n;
      });
    }
  };

  const handleBatchAnalyze = async () => {
    setBatchAnalyzing(true);
    try {
      await fanAnalysisApi.batchAnalyze(selectedJobId, {
        min_comments: 3,
        limit: 50,
      });
      alert("Batch analysis started. Results will appear shortly.");
      setTimeout(() => fetchFans(), 5000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Batch analysis failed";
      alert(msg);
    } finally {
      setBatchAnalyzing(false);
    }
  };

  const handleExportFans = async () => {
    try {
      const res = await fanAnalysisApi.exportFans(selectedJobId, "csv");
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fan_analysis_${selectedJobId}.csv`;
      a.click();
    } catch {
      /* ignore */
    }
  };

  const selectedJob = jobs.find((j) => j.id === selectedJobId);
  const totalPages = Math.ceil(fansTotal / 50);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Fan Catch</h1>
        <p className="text-white/50 mt-1">
          AI-powered fan engagement analysis across your scraping jobs
        </p>
      </div>

      {/* Job Selector */}
      <div className="glass-card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-sm text-white/60 shrink-0">Select Job:</label>
          {loadingJobs ? (
            <div className="flex items-center gap-2 text-sm text-white/30">
              <div className="h-4 w-4 border-2 border-white/20 border-t-transparent rounded-full animate-spin" />
              Loading jobs...
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-white/40">
              No completed comment scraper jobs found. Run a scraping job first to see fan data.
            </p>
          ) : (
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="input-glass text-sm flex-1 max-w-lg"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.input_value} — {j.result_row_count} profiles — {formatDate(j.completed_at || j.started_at || "")}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedJob && (
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-white/40">
            <span>Job ID: <span className="font-mono text-white/50">{selectedJob.id.slice(0, 8)}...</span></span>
            <span>Credits: {selectedJob.credits_used}</span>
            <span>Type: {selectedJob.job_type || "comment_scraper"}</span>
          </div>
        )}
      </div>

      {/* Fan Table */}
      {selectedJobId && (
        <div className="glass-card overflow-x-auto">
          {/* Toolbar */}
          <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-white">
                {loadingFans ? "Loading..." : `Fans (${fansTotal})`}
              </h2>
              {fansBotCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  {fansBotCount} bots
                </span>
              )}
              {fansHighIntent > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {fansHighIntent} high intent
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!showBots}
                  onChange={() => setShowBots(!showBots)}
                  className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500 w-3.5 h-3.5"
                />
                Hide Bots
              </label>
              <select
                value={fansSortBy}
                onChange={(e) => setFansSortBy(e.target.value)}
                className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white/70 focus:outline-none focus:border-primary-500/50"
              >
                <option value="engagement_score">Sort: Engagement</option>
                <option value="total_comments">Sort: Comments</option>
                <option value="buying_intent">Sort: Buying Intent</option>
              </select>
              <button
                onClick={handleBatchAnalyze}
                disabled={batchAnalyzing || !selectedJobId}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition disabled:opacity-50"
              >
                {batchAnalyzing ? "Analyzing..." : "Batch AI Analyze"}
              </button>
              <button
                onClick={handleExportFans}
                disabled={!selectedJobId || fansTotal === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition disabled:opacity-50"
              >
                Export Fans
              </button>
            </div>
          </div>

          {/* Loading state */}
          {loadingFans && fans.length === 0 && (
            <div className="p-12 text-center">
              <div className="h-8 w-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-white/40">Loading fan data...</p>
            </div>
          )}

          {/* Empty state */}
          {!loadingFans && fans.length === 0 && selectedJobId && (
            <div className="p-12 text-center">
              <p className="text-sm text-white/40">No fans found for this job.</p>
              <p className="text-xs text-white/25 mt-1">Fans appear when comments are scraped with identifiable user IDs.</p>
            </div>
          )}

          {/* Table */}
          {fans.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    {["Fan", "Comments", "Posts", "Avg Len", "Engagement", "Buying Intent", "Sentiment", "Actions"].map((h) => (
                      <th key={h} className="text-left text-xs font-medium text-white/40 uppercase px-4 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {fans.map((fan) => (
                    <FanRow
                      key={fan.commenter_user_id}
                      fan={fan}
                      expanded={expandedFan === fan.commenter_user_id}
                      analyzing={analyzingFans.has(fan.commenter_user_id)}
                      onToggle={() =>
                        setExpandedFan(
                          expandedFan === fan.commenter_user_id ? null : fan.commenter_user_id
                        )
                      }
                      onAnalyze={() => handleAnalyzeFan(fan.commenter_user_id)}
                    />
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="p-4 border-t border-white/5 flex items-center justify-between">
                  <p className="text-xs text-white/40">
                    Page {fansPage} of {totalPages}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setFansPage((p) => Math.max(1, p - 1))}
                      disabled={fansPage <= 1}
                      className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 transition"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setFansPage((p) => p + 1)}
                      disabled={fansPage >= totalPages}
                      className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 transition"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fan Row Component                                                    */
/* ------------------------------------------------------------------ */

function FanRow({
  fan,
  expanded,
  analyzing,
  onToggle,
  onAnalyze,
}: {
  fan: FanEngagementMetrics;
  expanded: boolean;
  analyzing: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
}) {
  return (
    <>
      <tr
        className={`hover:bg-white/[0.02] cursor-pointer ${fan.is_bot ? "bg-red-500/[0.02]" : ""}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {fan.profile?.picture_url ? (
              <img
                src={fan.profile.picture_url}
                alt=""
                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] text-white/40">
                  {(fan.commenter_name || "?")[0]}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-white font-medium text-xs truncate">
                {fan.commenter_name || "Unknown"}
              </p>
              {fan.is_bot && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-red-500/15 text-red-400 border border-red-500/25 font-semibold">
                  BOT {(fan.bot_score * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-white/60">{fan.total_comments}</td>
        <td className="px-4 py-3 text-white/60">{fan.unique_posts_commented}</td>
        <td className="px-4 py-3 text-white/60">{fan.avg_comment_length.toFixed(0)}</td>
        <td className="px-4 py-3">
          <span className="text-amber-400 font-semibold">
            {fan.engagement_score.toFixed(0)}
          </span>
        </td>
        <td className="px-4 py-3">
          {fan.ai_analysis ? (
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    fan.ai_analysis.buying_intent_score >= 0.7
                      ? "bg-emerald-500"
                      : fan.ai_analysis.buying_intent_score >= 0.4
                      ? "bg-amber-500"
                      : "bg-white/30"
                  }`}
                  style={{
                    width: `${fan.ai_analysis.buying_intent_score * 100}%`,
                  }}
                />
              </div>
              <span className="text-xs text-white/50">
                {(fan.ai_analysis.buying_intent_score * 100).toFixed(0)}%
              </span>
            </div>
          ) : (
            <span className="text-white/20 text-xs">-</span>
          )}
        </td>
        <td className="px-4 py-3">
          {fan.ai_analysis?.sentiment ? (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                fan.ai_analysis.sentiment === "positive"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : fan.ai_analysis.sentiment === "negative"
                  ? "bg-red-500/15 text-red-400"
                  : "bg-white/10 text-white/50"
              }`}
            >
              {fan.ai_analysis.sentiment}
            </span>
          ) : (
            <span className="text-white/20 text-xs">-</span>
          )}
        </td>
        <td className="px-4 py-3">
          {!fan.ai_analysis ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              disabled={analyzing}
              className="text-xs px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition disabled:opacity-50"
            >
              {analyzing ? "..." : "Analyze"}
            </button>
          ) : (
            <span className="text-xs text-white/30">{fan.ai_analysis.persona_type}</span>
          )}
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr>
          <td colSpan={8} className="px-4 py-3 bg-white/[0.01]">
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-4 text-white/40">
                <span>
                  First seen: {fan.first_seen ? formatDate(fan.first_seen) : "N/A"}
                </span>
                <span>
                  Last seen: {fan.last_seen ? formatDate(fan.last_seen) : "N/A"}
                </span>
                {fan.profile?.phone && <span>Phone: {fan.profile.phone}</span>}
                {fan.profile?.location && (
                  <span>Location: {fan.profile.location}</span>
                )}
              </div>
              {fan.is_bot && fan.bot_indicators && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-red-400/70 font-medium">
                    Bot indicators:
                  </span>
                  {fan.bot_indicators.excessive_same_post && (
                    <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400/80">
                      {fan.bot_details?.max_comments_same_post}x same post
                    </span>
                  )}
                  {fan.bot_indicators.short_comments && (
                    <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400/80">
                      avg {fan.bot_details?.avg_comment_length?.toFixed(0)} chars
                    </span>
                  )}
                  {fan.bot_indicators.duplicate_comments && (
                    <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400/80">
                      {fan.bot_details?.duplicate_percentage?.toFixed(0)}% duplicates
                    </span>
                  )}
                  {fan.bot_indicators.fast_posting && (
                    <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400/80">
                      rapid posting
                    </span>
                  )}
                </div>
              )}
              {fan.ai_analysis && (
                <div className="space-y-1.5 mt-1">
                  <p className="text-white/60">{fan.ai_analysis.summary}</p>
                  {fan.ai_analysis.interests.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fan.ai_analysis.interests.map((interest, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-400 text-[10px]"
                        >
                          {interest}
                        </span>
                      ))}
                    </div>
                  )}
                  {fan.ai_analysis.key_phrases.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fan.ai_analysis.key_phrases.map((phrase, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-white/5 text-white/40 text-[10px] italic"
                        >
                          &quot;{phrase}&quot;
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
