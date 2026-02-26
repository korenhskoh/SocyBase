"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { trendsApi, tenantSettingsApi } from "@/lib/api-client";
import type {
  ViralPost,
  ContentInsights,
  GoogleTrendsData,
  SourcePage,
} from "@/types";

export default function TrendsPage() {
  // Google Trends state
  const [trendsData, setTrendsData] = useState<GoogleTrendsData | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [keywordChips, setKeywordChips] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("socybase_trends_keywords");
        if (saved) return JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return [];
  });
  const [keywordInput, setKeywordInput] = useState("");
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const chipInputRef = useRef<HTMLInputElement>(null);

  // Content Insights state
  const [insights, setInsights] = useState<ContentInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  // Viral Posts state
  const [viralPosts, setViralPosts] = useState<ViralPost[]>([]);
  const [viralTotal, setViralTotal] = useState(0);
  const [viralLoading, setViralLoading] = useState(true);
  const [viralPage, setViralPage] = useState(1);
  const [viralSort, setViralSort] = useState("virality_score");
  const [viralContentType, setViralContentType] = useState("");
  const [viralDays, setViralDays] = useState(90);
  const [viralPageId, setViralPageId] = useState("");

  // Source pages for filter
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);

  // Expanded post
  const [expandedPost, setExpandedPost] = useState<string | null>(null);

  // Load source pages + business profile suggestions
  useEffect(() => {
    trendsApi
      .getSourcePages()
      .then((r) => setSourcePages(r.data.pages || []))
      .catch(() => {});

    // Load business profile for keyword suggestions
    tenantSettingsApi.get()
      .then((r) => {
        const biz = r.data?.business;
        if (biz) {
          const suggestions: string[] = [];
          if (biz.industry) suggestions.push(biz.industry);
          if (biz.business_name) suggestions.push(biz.business_name);
          if (biz.business_type && biz.business_type !== biz.industry) suggestions.push(biz.business_type);
          setSuggestedKeywords(suggestions.filter(Boolean).slice(0, 4));
        }
      })
      .catch(() => {});
  }, []);

  // Chip management helpers
  const addChip = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || keywordChips.length >= 5 || keywordChips.includes(trimmed)) return;
    const updated = [...keywordChips, trimmed];
    setKeywordChips(updated);
    setKeywordInput("");
    localStorage.setItem("socybase_trends_keywords", JSON.stringify(updated));
  };

  const removeChip = (index: number) => {
    const updated = keywordChips.filter((_, i) => i !== index);
    setKeywordChips(updated);
    localStorage.setItem("socybase_trends_keywords", JSON.stringify(updated));
  };

  const handleChipKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && keywordInput.trim()) {
      e.preventDefault();
      addChip(keywordInput);
    } else if (e.key === "Backspace" && !keywordInput && keywordChips.length > 0) {
      removeChip(keywordChips.length - 1);
    }
  };

  const searchWithChips = () => {
    const keywords = keywordChips.join(",");
    loadTrends(keywords || undefined);
  };

  // Load Google Trends
  const loadTrends = useCallback(
    (keywords?: string) => {
      setTrendsLoading(true);
      const params: { keywords?: string; days?: number } = { days: viralDays };
      if (keywords) params.keywords = keywords;
      trendsApi
        .getGoogleTrends(params)
        .then((r) => setTrendsData(r.data))
        .catch(() => {})
        .finally(() => setTrendsLoading(false));
    },
    [viralDays]
  );

  useEffect(() => {
    const savedKeywords = keywordChips.length > 0 ? keywordChips.join(",") : undefined;
    loadTrends(savedKeywords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTrends]);

  // Load Content Insights
  useEffect(() => {
    setInsightsLoading(true);
    const params: { page_id?: string; days?: number } = { days: viralDays };
    if (viralPageId) params.page_id = viralPageId;
    trendsApi
      .getContentInsights(params)
      .then((r) => setInsights(r.data))
      .catch(() => {})
      .finally(() => setInsightsLoading(false));
  }, [viralDays, viralPageId]);

  // Load Viral Posts
  useEffect(() => {
    setViralLoading(true);
    const params: {
      page_id?: string;
      content_type?: string;
      days?: number;
      page?: number;
      page_size?: number;
      sort_by?: string;
    } = {
      days: viralDays,
      page: viralPage,
      page_size: 20,
      sort_by: viralSort,
    };
    if (viralPageId) params.page_id = viralPageId;
    if (viralContentType) params.content_type = viralContentType;
    trendsApi
      .getViralPosts(params)
      .then((r) => {
        setViralPosts(r.data.items || []);
        setViralTotal(r.data.total || 0);
      })
      .catch(() => {})
      .finally(() => setViralLoading(false));
  }, [viralDays, viralPage, viralSort, viralContentType, viralPageId]);

  const totalPages = Math.ceil(viralTotal / 20);

  // Find best content type, best day, best hour from insights
  const bestType =
    insights?.by_content_type?.length
      ? [...insights.by_content_type].sort(
          (a, b) =>
            b.avg_reactions + b.avg_comments + b.avg_shares -
            (a.avg_reactions + a.avg_comments + a.avg_shares)
        )[0]
      : null;

  const bestDay =
    insights?.by_day_of_week?.length
      ? [...insights.by_day_of_week].sort(
          (a, b) => b.avg_engagement - a.avg_engagement
        )[0]
      : null;

  const bestHour =
    insights?.by_hour?.length
      ? [...insights.by_hour].sort(
          (a, b) => b.avg_engagement - a.avg_engagement
        )[0]
      : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">
          Trends & Viral Posts
        </h1>
        <p className="text-white/50 mt-1">
          Discover winning content, trending topics, and content strategy
          insights
        </p>
      </div>

      {/* Global Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={viralDays}
          onChange={(e) => {
            setViralDays(Number(e.target.value));
            setViralPage(1);
          }}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none [&>option]:bg-[#1a1a2e] [&>option]:text-white"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 6 months</option>
          <option value={365}>Last year</option>
        </select>

        {sourcePages.length > 0 && (
          <select
            value={viralPageId}
            onChange={(e) => {
              setViralPageId(e.target.value);
              setViralPage(1);
            }}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none [&>option]:bg-[#1a1a2e] [&>option]:text-white"
          >
            <option value="">All Pages</option>
            {sourcePages.map((sp) => (
              <option key={sp.input_value} value={sp.input_value}>
                {sp.input_value} ({sp.total_posts} posts)
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ───── Google Trends Section ───── */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg
              className="h-5 w-5 text-primary-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
              />
            </svg>
            Google Trends
          </h2>
        </div>

        {/* Keyword chips input */}
        <div className="space-y-2 mb-4">
          <div className="flex gap-2">
            <div
              className="flex-1 flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus-within:border-primary-500 transition cursor-text min-h-[40px]"
              onClick={() => chipInputRef.current?.focus()}
            >
              {keywordChips.map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-500/20 text-primary-400 text-xs font-medium"
                >
                  {chip}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChip(i);
                    }}
                    className="hover:text-white transition"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              {keywordChips.length < 5 && (
                <input
                  ref={chipInputRef}
                  type="text"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={handleChipKeyDown}
                  placeholder={keywordChips.length === 0 ? "Type keyword + Enter (max 5)..." : "Add more..."}
                  className="flex-1 min-w-[120px] bg-transparent text-sm text-white placeholder-white/30 focus:outline-none"
                />
              )}
            </div>
            <button
              onClick={searchWithChips}
              disabled={trendsLoading}
              className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition disabled:opacity-50 shrink-0"
            >
              {trendsLoading ? "Loading..." : "Search"}
            </button>
          </div>

          {/* Suggested keywords from business profile */}
          {suggestedKeywords.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-white/30">Suggestions:</span>
              {suggestedKeywords
                .filter((s) => !keywordChips.includes(s.toLowerCase()))
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => addChip(s)}
                    disabled={keywordChips.length >= 5}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-[11px] transition disabled:opacity-30"
                  >
                    + {s}
                  </button>
                ))}
            </div>
          )}
        </div>

        {trendsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : trendsData?.error ? (
          <div className="text-center py-8">
            <p className="text-white/40 text-sm">{trendsData.error}</p>
            <p className="text-white/20 text-xs mt-1">
              Try setting your industry in AI Business Profile, or enter keywords
              above
            </p>
          </div>
        ) : trendsData?.interest_over_time?.length ? (
          <div className="space-y-4">
            {/* Keywords + Country badges */}
            <div className="flex flex-wrap gap-2 items-center">
              {trendsData.keywords.map((kw) => (
                <span
                  key={kw}
                  className="px-2.5 py-1 rounded-full bg-primary-500/20 text-primary-400 text-xs font-medium"
                >
                  {kw}
                </span>
              ))}
              {trendsData.country && (
                <span className="px-2.5 py-1 rounded-full bg-white/10 text-white/60 text-xs">
                  {trendsData.country} {trendsData.geo ? `(${trendsData.geo})` : ""}
                </span>
              )}
            </div>

            {/* Interest over time bar chart */}
            <div className="space-y-2">
              <p className="text-xs text-white/40 uppercase tracking-wider">
                Interest Over Time (last {trendsData.interest_over_time.length}{" "}
                data points)
              </p>
              <div className="overflow-x-auto">
                <div className="flex items-end gap-[2px] h-32 min-w-[400px]">
                  {trendsData.interest_over_time.map((point, i) => {
                    const maxVal = Math.max(
                      ...trendsData.interest_over_time.map((p) =>
                        Math.max(
                          ...trendsData.keywords.map((kw) =>
                            Number(p[kw] || 0)
                          )
                        )
                      )
                    );
                    const primaryVal = Number(
                      point[trendsData.keywords[0]] || 0
                    );
                    const height =
                      maxVal > 0 ? (primaryVal / maxVal) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[3px] bg-primary-500/60 hover:bg-primary-400 transition-colors rounded-t cursor-pointer group relative"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${point.date}: ${primaryVal}`}
                      >
                        <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap bg-navy-800 text-white text-[10px] px-2 py-1 rounded shadow-lg z-10">
                          {String(point.date)}: {primaryVal}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Related Queries */}
            {trendsData.related_queries &&
              Object.keys(trendsData.related_queries).length > 0 && (
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-wider mb-2">
                    Rising Related Queries
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(trendsData.related_queries).map(
                      ([kw, queries]) =>
                        queries.length > 0 && (
                          <div
                            key={kw}
                            className="bg-white/5 rounded-lg p-3"
                          >
                            <p className="text-xs font-medium text-primary-400 mb-2">
                              {kw}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {queries.slice(0, 8).map((q) => (
                                <span
                                  key={q}
                                  className="px-2 py-0.5 rounded bg-white/5 text-white/60 text-[11px]"
                                >
                                  {q}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                    )}
                  </div>
                </div>
              )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-white/40 text-sm">
              No trend data available yet
            </p>
            <p className="text-white/20 text-xs mt-1">
              Enter keywords above or set your industry in AI Business Profile
            </p>
          </div>
        )}
      </div>

      {/* ───── Content Insights Section ───── */}
      {insightsLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : insights && insights.total_posts > 0 ? (
        <>
          {/* Quick stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InsightCard
              label="Total Posts Analyzed"
              value={insights.total_posts.toLocaleString()}
              color="primary"
            />
            <InsightCard
              label="Avg Engagement"
              value={insights.avg_engagement.toLocaleString()}
              color="purple"
            />
            <InsightCard
              label="Posts/Week"
              value={insights.posting_frequency.toString()}
              color="pink"
            />
            <InsightCard
              label={bestType ? `Best: ${bestType.type}` : "Best Type"}
              value={
                bestType
                  ? `${Math.round(
                      bestType.avg_reactions +
                        bestType.avg_comments +
                        bestType.avg_shares
                    )} avg`
                  : "—"
              }
              color="cyan"
            />
          </div>

          {/* Detailed insights row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Content Type Breakdown */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-3">
                By Content Type
              </h3>
              {insights.by_content_type.length === 0 ? (
                <p className="text-white/30 text-sm">No data</p>
              ) : (
                <div className="space-y-3">
                  {insights.by_content_type.map((ct) => {
                    const total =
                      ct.avg_reactions + ct.avg_comments + ct.avg_shares;
                    const maxTotal = Math.max(
                      ...insights.by_content_type.map(
                        (c) => c.avg_reactions + c.avg_comments + c.avg_shares
                      )
                    );
                    const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                    return (
                      <div key={ct.type}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-white/80 capitalize">
                            {ct.type}
                          </span>
                          <span className="text-white/50">
                            {ct.count} posts · {Math.round(total)} avg
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-purple transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Best Posting Times */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-3">
                Best Posting Day
              </h3>
              {insights.by_day_of_week.length === 0 ? (
                <p className="text-white/30 text-sm">No data</p>
              ) : (
                <div className="space-y-2">
                  {insights.by_day_of_week.map((d) => {
                    const maxEng = Math.max(
                      ...insights.by_day_of_week.map((x) => x.avg_engagement)
                    );
                    const pct =
                      maxEng > 0 ? (d.avg_engagement / maxEng) * 100 : 0;
                    const isBest = d.day === bestDay?.day;
                    return (
                      <div key={d.day} className="flex items-center gap-2">
                        <span
                          className={`text-xs w-12 ${
                            isBest ? "text-primary-400 font-bold" : "text-white/50"
                          }`}
                        >
                          {d.day.slice(0, 3)}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isBest
                                ? "bg-primary-400"
                                : "bg-white/20"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-white/40 w-8 text-right">
                          {Math.round(d.avg_engagement)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Best Hour + Keywords */}
            <div className="glass-card p-5 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-2">
                  Peak Hour
                </h3>
                {bestHour ? (
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold text-primary-400">
                      {bestHour.hour.toString().padStart(2, "0")}:00
                    </span>
                    <span className="text-sm text-white/40">
                      avg {Math.round(bestHour.avg_engagement)} engagement
                    </span>
                  </div>
                ) : (
                  <p className="text-white/30 text-sm">No data</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-2">
                  Top Keywords
                </h3>
                {insights.top_keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {insights.top_keywords.slice(0, 12).map((kw) => (
                      <span
                        key={kw}
                        className="px-2 py-0.5 rounded bg-accent-purple/20 text-accent-purple text-xs"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-white/30 text-sm">No keywords found</p>
                )}
              </div>
            </div>
          </div>
        </>
      ) : !insightsLoading && (
        <div className="glass-card p-8 text-center">
          <p className="text-white/40">
            No post data yet. Run post discovery jobs to see content insights.
          </p>
        </div>
      )}

      {/* ───── Viral Posts Table ───── */}
      <div className="glass-card overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 border-b border-white/5 gap-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg
              className="h-5 w-5 text-accent-pink"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z"
              />
            </svg>
            Viral Posts
            {viralTotal > 0 && (
              <span className="text-sm font-normal text-white/40">
                ({viralTotal.toLocaleString()})
              </span>
            )}
          </h2>
          <div className="flex flex-wrap gap-2">
            <select
              value={viralContentType}
              onChange={(e) => {
                setViralContentType(e.target.value);
                setViralPage(1);
              }}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:border-primary-500 focus:outline-none [&>option]:bg-[#1a1a2e] [&>option]:text-white"
            >
              <option value="">All Types</option>
              <option value="photo">Photo</option>
              <option value="video">Video</option>
              <option value="link">Link</option>
              <option value="status">Status</option>
            </select>
            <select
              value={viralSort}
              onChange={(e) => {
                setViralSort(e.target.value);
                setViralPage(1);
              }}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:border-primary-500 focus:outline-none [&>option]:bg-[#1a1a2e] [&>option]:text-white"
            >
              <option value="virality_score">Virality Score</option>
              <option value="engagement">Engagement</option>
              <option value="reactions">Reactions</option>
              <option value="comments">Comments</option>
              <option value="shares">Shares</option>
              <option value="recency">Most Recent</option>
            </select>
          </div>
        </div>

        {viralLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : viralPosts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">
              No viral posts found. Run post discovery jobs first.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">
                      Post
                    </th>
                    <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      Type
                    </th>
                    <th className="text-right text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      Reactions
                    </th>
                    <th className="text-right text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      Comments
                    </th>
                    <th className="text-right text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      Shares
                    </th>
                    <th className="text-right text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      Virality
                    </th>
                    <th className="text-right text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      vs Avg
                    </th>
                    <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {viralPosts.map((post) => (
                    <tr
                      key={post.id}
                      className="hover:bg-white/[0.02] transition cursor-pointer"
                      onClick={() =>
                        setExpandedPost(
                          expandedPost === post.id ? null : post.id
                        )
                      }
                    >
                      <td className="px-6 py-4 max-w-[300px]">
                        <p className="text-sm text-white/80 truncate">
                          {post.message || (
                            <span className="text-white/30 italic">
                              No text
                            </span>
                          )}
                        </p>
                        {expandedPost === post.id && post.message && (
                          <div className="mt-2 p-3 bg-white/5 rounded-lg">
                            <p className="text-sm text-white/70 whitespace-pre-wrap break-words">
                              {post.message}
                            </p>
                            <div className="mt-2 flex gap-2">
                              <span className="text-[11px] text-white/30">
                                Source: {post.source_page}
                              </span>
                              {post.post_url && (
                                <a
                                  href={post.post_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-primary-400 hover:text-primary-300"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View on Facebook
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-white/50 capitalize">
                          {post.attachment_type || "text"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-white/60">
                        {post.reaction_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-white/60">
                        {post.comment_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-white/60">
                        {post.share_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span
                          className={`text-sm font-bold ${
                            post.virality_score >= 1000
                              ? "text-accent-pink"
                              : post.virality_score >= 100
                              ? "text-amber-400"
                              : "text-white/60"
                          }`}
                        >
                          {post.virality_score >= 1000
                            ? `${(post.virality_score / 1000).toFixed(1)}k`
                            : post.virality_score.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        {post.above_average > 0 ? (
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              post.above_average >= 5
                                ? "bg-accent-pink/20 text-accent-pink"
                                : post.above_average >= 2
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-white/10 text-white/50"
                            }`}
                          >
                            {post.above_average}x
                          </span>
                        ) : (
                          <span className="text-xs text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-white/40 whitespace-nowrap">
                        {post.created_time
                          ? new Date(post.created_time).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
                <p className="text-sm text-white/40">
                  Page {viralPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViralPage(Math.max(1, viralPage - 1))}
                    disabled={viralPage === 1}
                    className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/60 rounded-lg transition disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() =>
                      setViralPage(Math.min(totalPages, viralPage + 1))
                    }
                    disabled={viralPage === totalPages}
                    className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/60 rounded-lg transition disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InsightCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    primary: "from-primary-500/20 to-primary-500/5 text-primary-400",
    purple: "from-accent-purple/20 to-accent-purple/5 text-accent-purple",
    pink: "from-accent-pink/20 to-accent-pink/5 text-accent-pink",
    cyan: "from-cyan-500/20 to-cyan-500/5 text-cyan-400",
  };

  return (
    <div className="glass-card p-5 bg-gradient-to-br relative overflow-hidden">
      <div
        className={`absolute inset-0 bg-gradient-to-br ${
          colorMap[color]?.split(" ")[0]
        } ${colorMap[color]?.split(" ")[1]} opacity-30`}
      />
      <div className="relative">
        <p className="text-xs text-white/40 uppercase tracking-wider">
          {label}
        </p>
        <p
          className={`text-2xl font-bold mt-1 ${
            colorMap[color]?.split(" ")[2]
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
