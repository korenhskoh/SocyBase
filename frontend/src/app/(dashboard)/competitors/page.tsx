"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { competitorsApi, businessProfileApi } from "@/lib/api-client";
import type { CompetitorPage, CompetitorPost, PageSearchResult } from "@/types";

export default function CompetitorsPage() {
  const router = useRouter();

  // Tracked competitors
  const [competitors, setCompetitors] = useState<CompetitorPage[]>([]);
  const [loading, setLoading] = useState(true);

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<"url" | "search" | "location" | "ai">("url");
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  // Search results
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Location search
  const [locQuery, setLocQuery] = useState("");
  const [locCity, setLocCity] = useState("");
  const [locResults, setLocResults] = useState<PageSearchResult[]>([]);
  const [locSearching, setLocSearching] = useState(false);

  // AI suggestions
  const [aiSuggestions, setAiSuggestions] = useState<{ name: string; facebook_url: string | null; reason: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // Quick scan
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<CompetitorPost[]>([]);
  const [scanCompName, setScanCompName] = useState("");

  // Feed
  const [feedTab, setFeedTab] = useState<"all" | "livestream">("all");
  const [feedPosts, setFeedPosts] = useState<CompetitorPost[]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedPage, setFeedPage] = useState(1);
  const [feedSort, setFeedSort] = useState("virality_score");
  const [feedDays, setFeedDays] = useState(90);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);

  // Load competitors
  const loadCompetitors = useCallback(async () => {
    try {
      const res = await competitorsApi.list();
      setCompetitors(res.data.items || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  // Load feed
  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const res = await competitorsApi.feed({
        livestream_only: feedTab === "livestream",
        sort_by: feedSort,
        days: feedDays,
        page: feedPage,
        page_size: 30,
      });
      setFeedPosts(res.data.items || []);
      setFeedTotal(res.data.total || 0);
    } catch {
      /* ignore */
    } finally {
      setFeedLoading(false);
    }
  }, [feedTab, feedSort, feedDays, feedPage]);

  useEffect(() => {
    loadCompetitors();
  }, [loadCompetitors]);

  useEffect(() => {
    if (competitors.length > 0) loadFeed();
  }, [competitors.length, loadFeed]);

  // Add competitor by URL
  const handleAddUrl = async () => {
    if (!addInput.trim()) return;
    setAdding(true);
    try {
      await competitorsApi.add({ input_value: addInput.trim(), source: "manual" });
      setAddInput("");
      setShowAddModal(false);
      loadCompetitors();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to add";
      alert(msg);
    } finally {
      setAdding(false);
    }
  };

  // Add from search result
  const handleAddFromSearch = async (result: PageSearchResult) => {
    setAdding(true);
    try {
      await competitorsApi.add({
        input_value: result.id || "",
        source: "search",
        name: result.name || undefined,
        category: result.category || undefined,
        page_url: result.link || undefined,
      });
      loadCompetitors();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to add";
      alert(msg);
    } finally {
      setAdding(false);
    }
  };

  // Keyword search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await competitorsApi.search(searchQuery.trim());
      setSearchResults(res.data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Location search
  const handleLocSearch = async () => {
    if (!locQuery.trim() || !locCity.trim()) return;
    setLocSearching(true);
    try {
      const res = await competitorsApi.searchByLocation(locQuery.trim(), locCity.trim());
      setLocResults(res.data.results || []);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (detail === "Apify API token not configured") {
        alert("Location search requires APIFY_API_TOKEN to be configured.");
      }
      setLocResults([]);
    } finally {
      setLocSearching(false);
    }
  };

  // AI suggestions
  const handleAiSuggest = async () => {
    setAiLoading(true);
    try {
      const res = await businessProfileApi.getSuggestions();
      const pages = res.data?.suggested_pages || res.data?.ai_suggestions?.suggested_pages || [];
      setAiSuggestions(pages);
    } catch {
      setAiSuggestions([]);
    } finally {
      setAiLoading(false);
    }
  };

  // Quick scan
  const handleQuickScan = async (comp: CompetitorPage) => {
    setScanningId(comp.id);
    setScanCompName(comp.name || comp.page_id);
    setScanResults([]);
    try {
      const res = await competitorsApi.quickScan(comp.id);
      setScanResults(res.data.items || []);
      loadCompetitors(); // refresh stats
    } catch {
      alert("Quick scan failed");
    } finally {
      setScanningId(null);
    }
  };

  // Full scrape
  const handleScrape = async (comp: CompetitorPage) => {
    try {
      const res = await competitorsApi.scrape(comp.id);
      alert(`Scraping job created! Job ID: ${res.data.job_id}`);
      loadCompetitors();
    } catch {
      alert("Failed to start scrape");
    }
  };

  // Remove competitor
  const handleRemove = async (id: string) => {
    if (!confirm("Remove this competitor?")) return;
    try {
      await competitorsApi.remove(id);
      loadCompetitors();
    } catch {
      alert("Failed to remove");
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toString();
  };

  const malaysianCities = [
    "Kuala Lumpur, Malaysia",
    "Petaling Jaya, Malaysia",
    "Johor Bahru, Malaysia",
    "Penang, Malaysia",
    "Kota Kinabalu, Malaysia",
    "Kuching, Malaysia",
    "Ipoh, Malaysia",
    "Melaka, Malaysia",
    "Shah Alam, Malaysia",
    "Subang Jaya, Malaysia",
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <svg className="h-7 w-7 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
            Competitor Intelligence
          </h1>
          <p className="text-white/40 text-sm mt-1">Monitor competitor pages & find high-engagement posts</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition flex items-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Competitor
        </button>
      </div>

      {/* Tracked Competitors Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : competitors.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <svg className="h-12 w-12 text-white/20 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          <p className="text-white/40 text-sm">No competitors tracked yet</p>
          <p className="text-white/20 text-xs mt-1">Click &quot;Add Competitor&quot; to start monitoring</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {competitors.map((comp) => (
            <div key={comp.id} className="glass-card p-4 group relative">
              {/* Remove button */}
              <button
                onClick={() => handleRemove(comp.id)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition p-1"
                title="Remove"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Avatar */}
              <div className="flex items-center gap-3 mb-3">
                {comp.picture_url ? (
                  <img
                    src={comp.picture_url}
                    alt={comp.name || ""}
                    className="h-10 w-10 rounded-full object-cover bg-white/10"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-purple/30 flex items-center justify-center">
                    <span className="text-white/60 text-sm font-medium">
                      {(comp.name || comp.page_id)?.[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{comp.name || comp.page_id}</p>
                  {comp.category && (
                    <p className="text-[11px] text-white/40 truncate">{comp.category}</p>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3 text-[11px] text-white/40 mb-3">
                <span>{comp.total_posts_scanned} posts</span>
                <span>{formatNumber(comp.avg_engagement)} avg eng</span>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleQuickScan(comp)}
                  disabled={scanningId === comp.id}
                  className="flex-1 px-2 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs rounded-lg transition disabled:opacity-50"
                >
                  {scanningId === comp.id ? (
                    <span className="flex items-center justify-center gap-1">
                      <div className="h-3 w-3 border border-white/40 border-t-transparent rounded-full animate-spin" />
                      Scanning
                    </span>
                  ) : (
                    "Quick Scan"
                  )}
                </button>
                <button
                  onClick={() => handleScrape(comp)}
                  className="flex-1 px-2 py-1.5 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 text-xs rounded-lg transition"
                >
                  Full Scrape
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Scan Results */}
      {scanResults.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Quick Scan: {scanCompName}
              <span className="ml-2 text-sm font-normal text-white/40">{scanResults.length} posts</span>
            </h2>
            <button
              onClick={() => setScanResults([])}
              className="text-white/40 hover:text-white transition text-sm"
            >
              Close
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-white/40 text-xs">
                  <th className="text-left py-2 px-3 font-medium">Post</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                  <th className="text-right py-2 px-3 font-medium">Reactions</th>
                  <th className="text-right py-2 px-3 font-medium">Comments</th>
                  <th className="text-right py-2 px-3 font-medium">Shares</th>
                  <th className="text-right py-2 px-3 font-medium">Virality</th>
                  <th className="text-right py-2 px-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {scanResults.slice(0, 25).map((post) => (
                  <tr key={post.post_id} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                    <td className="py-2.5 px-3 max-w-[300px]">
                      <p className="text-white/80 truncate text-xs">
                        {post.message?.slice(0, 80) || "(no text)"}
                      </p>
                      {post.created_time && (
                        <p className="text-[10px] text-white/30 mt-0.5">{new Date(post.created_time).toLocaleDateString()}</p>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {post.is_livestream ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-medium">LIVE</span>
                      ) : (
                        <span className="text-white/40 text-xs">{post.attachment_type || "text"}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-white/60">{formatNumber(post.reaction_count)}</td>
                    <td className="py-2.5 px-3 text-right text-white/60">{formatNumber(post.comment_count)}</td>
                    <td className="py-2.5 px-3 text-right text-white/60">{formatNumber(post.share_count)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="text-primary-400 font-medium">{formatNumber(post.virality_score)}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {post.post_url && (
                        <button
                          onClick={() => router.push(`/jobs/new?input=${encodeURIComponent(post.post_url!)}&type=comment_scraper`)}
                          className="text-[10px] px-2 py-1 bg-accent-pink/20 hover:bg-accent-pink/30 text-accent-pink rounded transition"
                        >
                          Scrape Comments
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Feed Section */}
      {competitors.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-white">Post Feed</h2>
              <div className="flex bg-white/5 rounded-lg p-0.5">
                <button
                  onClick={() => { setFeedTab("all"); setFeedPage(1); }}
                  className={`px-3 py-1.5 text-xs rounded-md transition ${
                    feedTab === "all" ? "bg-primary-500 text-white" : "text-white/40 hover:text-white"
                  }`}
                >
                  All Posts
                </button>
                <button
                  onClick={() => { setFeedTab("livestream"); setFeedPage(1); }}
                  className={`px-3 py-1.5 text-xs rounded-md transition ${
                    feedTab === "livestream" ? "bg-red-500 text-white" : "text-white/40 hover:text-white"
                  }`}
                >
                  Livestreams
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={feedSort}
                onChange={(e) => { setFeedSort(e.target.value); setFeedPage(1); }}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:border-primary-500 focus:outline-none [&>option]:bg-[#1a1a2e] [&>option]:text-white"
              >
                <option value="virality_score">Virality</option>
                <option value="comments">Comments</option>
                <option value="reactions">Reactions</option>
                <option value="shares">Shares</option>
                <option value="engagement">Engagement</option>
                <option value="recency">Recent</option>
              </select>
              <select
                value={feedDays}
                onChange={(e) => { setFeedDays(Number(e.target.value)); setFeedPage(1); }}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:border-primary-500 focus:outline-none [&>option]:bg-[#1a1a2e] [&>option]:text-white"
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>6 months</option>
                <option value={365}>1 year</option>
              </select>
            </div>
          </div>

          {feedLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : feedPosts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white/40 text-sm">No posts found</p>
              <p className="text-white/20 text-xs mt-1">Run &quot;Full Scrape&quot; on your competitors to populate the feed</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-white/40 text-xs">
                      <th className="text-left py-2 px-3 font-medium">Post</th>
                      <th className="text-left py-2 px-3 font-medium">Source</th>
                      <th className="text-left py-2 px-3 font-medium">Type</th>
                      <th className="text-right py-2 px-3 font-medium">Reactions</th>
                      <th className="text-right py-2 px-3 font-medium">Comments</th>
                      <th className="text-right py-2 px-3 font-medium">Shares</th>
                      <th className="text-right py-2 px-3 font-medium">Virality</th>
                      <th className="text-right py-2 px-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedPosts.map((post) => (
                      <tr
                        key={post.post_id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition cursor-pointer"
                        onClick={() => setExpandedPost(expandedPost === post.post_id ? null : post.post_id)}
                      >
                        <td className="py-2.5 px-3 max-w-[300px]">
                          <p className="text-white/80 truncate text-xs">
                            {post.message?.slice(0, expandedPost === post.post_id ? 500 : 80) || "(no text)"}
                          </p>
                          {post.created_time && (
                            <p className="text-[10px] text-white/30 mt-0.5">{new Date(post.created_time).toLocaleDateString()}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-white/50 text-xs truncate max-w-[100px] block">{post.source_page || ""}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          {post.is_livestream ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-medium">LIVE</span>
                          ) : (
                            <span className="text-white/40 text-xs">{post.attachment_type || "text"}</span>
                          )}
                          {post.video_views && (
                            <span className="text-[10px] text-white/30 ml-1">{formatNumber(post.video_views)} views</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-white/60">{formatNumber(post.reaction_count)}</td>
                        <td className="py-2.5 px-3 text-right text-white/60 font-medium">{formatNumber(post.comment_count)}</td>
                        <td className="py-2.5 px-3 text-right text-white/60">{formatNumber(post.share_count)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <span className="text-primary-400 font-medium">{formatNumber(post.virality_score)}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {post.post_url && (
                            <button
                              onClick={() => router.push(`/jobs/new?input=${encodeURIComponent(post.post_url!)}&type=comment_scraper`)}
                              className="text-[10px] px-2 py-1 bg-accent-pink/20 hover:bg-accent-pink/30 text-accent-pink rounded transition whitespace-nowrap"
                            >
                              Scrape Comments
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {feedTotal > 30 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                  <span className="text-xs text-white/40">
                    Showing {(feedPage - 1) * 30 + 1}-{Math.min(feedPage * 30, feedTotal)} of {feedTotal}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFeedPage(Math.max(1, feedPage - 1))}
                      disabled={feedPage === 1}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setFeedPage(feedPage + 1)}
                      disabled={feedPage * 30 >= feedTotal}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30"
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

      {/* Add Competitor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-navy-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-navy-900 border-b border-white/5 p-5 flex items-center justify-between z-10">
              <h3 className="text-lg font-semibold text-white">Add Competitor</h3>
              <button onClick={() => setShowAddModal(false)} className="text-white/40 hover:text-white transition">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/5">
              {(["url", "search", "location", "ai"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAddTab(tab)}
                  className={`flex-1 py-3 text-xs font-medium transition border-b-2 ${
                    addTab === tab
                      ? "border-primary-500 text-primary-400"
                      : "border-transparent text-white/40 hover:text-white/60"
                  }`}
                >
                  {tab === "url" ? "Paste URL" : tab === "search" ? "Search" : tab === "location" ? "Location" : "AI Suggest"}
                </button>
              ))}
            </div>

            <div className="p-5">
              {/* URL Tab */}
              {addTab === "url" && (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={addInput}
                    onChange={(e) => setAddInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
                    placeholder="Paste Facebook page URL or username..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
                  />
                  <button
                    onClick={handleAddUrl}
                    disabled={adding || !addInput.trim()}
                    className="w-full px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                  >
                    {adding ? "Adding..." : "Add Competitor"}
                  </button>
                </div>
              )}

              {/* Search Tab */}
              {addTab === "search" && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder="Search Facebook pages..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
                    />
                    <button
                      onClick={handleSearch}
                      disabled={searching}
                      className="px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition disabled:opacity-50"
                    >
                      {searching ? "..." : "Search"}
                    </button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {searchResults.map((r) => (
                        <SearchResultRow key={r.id} result={r} onAdd={handleAddFromSearch} adding={adding} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Location Tab */}
              {addTab === "location" && (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={locQuery}
                    onChange={(e) => setLocQuery(e.target.value)}
                    placeholder="Keyword (e.g. skincare, restaurant)..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
                  />
                  <div>
                    <input
                      type="text"
                      value={locCity}
                      onChange={(e) => setLocCity(e.target.value)}
                      placeholder="Location (e.g. Kuala Lumpur, Malaysia)..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {malaysianCities.slice(0, 5).map((city) => (
                        <button
                          key={city}
                          onClick={() => setLocCity(city)}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 transition"
                        >
                          {city.split(",")[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleLocSearch}
                    disabled={locSearching || !locQuery.trim() || !locCity.trim()}
                    className="w-full px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition disabled:opacity-50"
                  >
                    {locSearching ? "Searching..." : "Search by Location"}
                  </button>
                  {locResults.length > 0 && (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {locResults.map((r, i) => (
                        <SearchResultRow key={r.id || i} result={r} onAdd={handleAddFromSearch} adding={adding} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* AI Suggest Tab */}
              {addTab === "ai" && (
                <div className="space-y-4">
                  <p className="text-xs text-white/40">
                    Get AI-powered competitor suggestions based on your business profile.
                  </p>
                  <button
                    onClick={handleAiSuggest}
                    disabled={aiLoading}
                    className="w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-accent-purple text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                  >
                    {aiLoading ? "Generating suggestions..." : "Get AI Suggestions"}
                  </button>
                  {aiSuggestions.length > 0 && (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {aiSuggestions.map((s, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white font-medium">{s.name}</p>
                            <p className="text-[11px] text-white/40 mt-0.5">{s.reason}</p>
                          </div>
                          {s.facebook_url ? (
                            <button
                              onClick={() => {
                                setAdding(true);
                                competitorsApi
                                  .add({ input_value: s.facebook_url!, source: "ai", name: s.name })
                                  .then(() => loadCompetitors())
                                  .catch(() => {})
                                  .finally(() => setAdding(false));
                              }}
                              disabled={adding}
                              className="px-3 py-1.5 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 text-xs rounded-lg transition shrink-0 ml-3"
                            >
                              + Add
                            </button>
                          ) : (
                            <a
                              href={`https://www.facebook.com/search/pages/?q=${encodeURIComponent(s.name)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/40 text-xs rounded-lg transition shrink-0 ml-3"
                            >
                              Search FB
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Search result row component
function SearchResultRow({
  result,
  onAdd,
  adding,
}: {
  result: PageSearchResult;
  onAdd: (r: PageSearchResult) => void;
  adding: boolean;
}) {
  const loc = typeof result.location === "string"
    ? result.location
    : result.location && typeof result.location === "object"
    ? [
        (result.location as Record<string, unknown>).city,
        (result.location as Record<string, unknown>).country,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/[0.07] transition">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white font-medium">{result.name || result.id}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {result.category && <span className="text-[10px] text-white/40">{result.category}</span>}
          {loc && <span className="text-[10px] text-white/30">{loc}</span>}
          {result.likes && <span className="text-[10px] text-white/30">{result.likes} likes</span>}
          {result.verification_status === "blue_verified" && (
            <span className="text-[10px] text-blue-400">Verified</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onAdd(result)}
        disabled={adding}
        className="px-3 py-1.5 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 text-xs rounded-lg transition shrink-0 ml-3 disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}
