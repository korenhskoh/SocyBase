"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { jobsApi } from "@/lib/api-client";
import type { CursorHistoryItem } from "@/types";
import * as Tabs from "@radix-ui/react-tabs";

export default function NewJobPage() {
  const router = useRouter();

  // ── Shared state ──────────────────────────────────────────────
  const [platform, setPlatform] = useState("facebook");
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Concurrent job limit warning
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [concurrencyLimit, setConcurrencyLimit] = useState<number | null>(null);

  useEffect(() => {
    jobsApi.list({ page: 1, page_size: 50, status: "running" }).then((r) => {
      const running = Array.isArray(r.data) ? r.data.length : 0;
      jobsApi.list({ page: 1, page_size: 50, status: "queued" }).then((r2) => {
        const queued = Array.isArray(r2.data) ? r2.data.length : 0;
        setActiveJobCount(running + queued);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  // ── Comment Scraper state ─────────────────────────────────────
  const [inputValue, setInputValue] = useState("");
  const [ignoreDuplicates, setIgnoreDuplicates] = useState(false);
  const [useCustomCursor, setUseCustomCursor] = useState(false);
  const [selectedCursor, setSelectedCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<CursorHistoryItem[]>([]);
  const [loadingCursors, setLoadingCursors] = useState(false);

  // ── Post Discovery state ──────────────────────────────────────
  const [pageInput, setPageInput] = useState("");
  const [tokenType, setTokenType] = useState("EAAAAU");

  // ── Comment Scraper helpers ───────────────────────────────────
  const loadCursorHistory = async () => {
    if (!inputValue.trim()) return;
    setLoadingCursors(true);
    try {
      const res = await jobsApi.getCursorHistory(inputValue.trim());
      setCursorHistory(res.data);
    } catch {
      setCursorHistory([]);
    } finally {
      setLoadingCursors(false);
    }
  };

  const handleCursorToggle = (checked: boolean) => {
    setUseCustomCursor(checked);
    setSelectedCursor("");
    if (checked) {
      loadCursorHistory();
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // ── Submit: Comment Scraper ───────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const retryCount = Number(localStorage.getItem("socybase_scraping_retry_count") || "2");
      const res = await jobsApi.create({
        platform,
        input_type: "post_url",
        input_value: inputValue,
        scheduled_at: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        settings: {
          include_replies: true,
          profile_retry_count: retryCount,
          ...(ignoreDuplicates && { ignore_duplicate_users: true }),
          ...(useCustomCursor && selectedCursor && { start_from_cursor: selectedCursor }),
        },
      });
      router.push(`/jobs/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create job");
    } finally {
      setLoading(false);
    }
  };

  // ── Submit: Post Discovery ────────────────────────────────────
  const handlePostDiscoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await jobsApi.create({
        platform,
        job_type: "post_discovery",
        input_type: "page_id",
        input_value: pageInput,
        scheduled_at: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        settings: {
          token_type: tokenType,
        },
      });
      router.push(`/jobs/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create job");
    } finally {
      setLoading(false);
    }
  };

  // ── Shared UI fragments ───────────────────────────────────────
  const platformSelector = (
    <div className="glass-card p-6 space-y-4">
      <label className="block text-sm font-medium text-white/80">Platform</label>
      <div className="flex gap-3">
        {[
          { id: "facebook", name: "Facebook", color: "from-[#1877F2] to-[#0d5bbd]", enabled: true },
          { id: "tiktok", name: "TikTok", color: "from-[#00F2EA] to-[#FF0050]", enabled: false },
        ].map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!p.enabled}
            onClick={() => setPlatform(p.id)}
            className={`flex-1 rounded-xl border-2 p-4 text-center transition-all ${
              platform === p.id
                ? "border-primary-500 bg-primary-500/10"
                : "border-white/10 bg-white/[0.02] hover:border-white/20"
            } ${!p.enabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className={`mx-auto h-10 w-10 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center mb-2`}>
              <span className="text-white font-bold text-lg">{p.name[0]}</span>
            </div>
            <p className="text-sm font-medium text-white">{p.name}</p>
            {!p.enabled && <p className="text-xs text-white/30 mt-1">Coming soon</p>}
          </button>
        ))}
      </div>
    </div>
  );

  const scheduleSection = (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="schedule"
          checked={schedule}
          onChange={(e) => setSchedule(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
        />
        <label htmlFor="schedule" className="text-sm font-medium text-white/80">
          Schedule for later
        </label>
      </div>
      {schedule && (
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="input-glass"
          required={schedule}
        />
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">New Scraping Job</h1>
        <p className="text-white/50 mt-1">Choose a scraping type and configure your job</p>
      </div>

      {/* Concurrent job limit warning */}
      {activeJobCount > 0 && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${
          concurrencyLimit && activeJobCount >= concurrencyLimit
            ? "bg-red-500/10 border-red-500/30 text-red-400"
            : activeJobCount >= 2
              ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              : "bg-blue-500/10 border-blue-500/30 text-blue-400"
        }`}>
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          You have {activeJobCount} active job{activeJobCount !== 1 ? "s" : ""} running
          {concurrencyLimit ? ` (limit: ${concurrencyLimit})` : ""}.
          {concurrencyLimit && activeJobCount >= concurrencyLimit
            ? " New jobs will be rejected until active jobs complete."
            : " New jobs may be queued."}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tab picker */}
      <Tabs.Root defaultValue="comment_scraper">
        {/* Tab triggers */}
        <div className="glass-card p-2 mb-6">
          <Tabs.List className="flex gap-2">
            <Tabs.Trigger
              value="comment_scraper"
              className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all
                data-[state=inactive]:bg-white/5 data-[state=inactive]:text-white/50 data-[state=inactive]:hover:bg-white/10 data-[state=inactive]:hover:text-white/70
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary-500 data-[state=active]:to-accent-purple data-[state=active]:text-white data-[state=active]:shadow-lg"
            >
              {/* Chat bubble icon */}
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              Comment Scraper
            </Tabs.Trigger>
            <Tabs.Trigger
              value="post_discovery"
              className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all
                data-[state=inactive]:bg-white/5 data-[state=inactive]:text-white/50 data-[state=inactive]:hover:bg-white/10 data-[state=inactive]:hover:text-white/70
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary-500 data-[state=active]:to-accent-purple data-[state=active]:text-white data-[state=active]:shadow-lg"
            >
              {/* Grid / search icon */}
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Post Discovery
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* ────────────────────────────────────────────────────── */}
        {/* Tab 1: Comment Profile Scraper                        */}
        {/* ────────────────────────────────────────────────────── */}
        <Tabs.Content value="comment_scraper" className="space-y-6 outline-none">
          {/* Steps */}
          <div className="glass-card p-6 space-y-2">
            <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">How it works</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
              {[
                { step: "1", title: "Paste URL", desc: "Enter a Facebook post URL or ID" },
                { step: "2", title: "Extract Comments", desc: "We fetch all commenters from the post" },
                { step: "3", title: "Get Profiles", desc: "Each commenter's profile is enriched" },
              ].map((s) => (
                <div key={s.step} className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center shrink-0">
                    <span className="text-white text-sm font-bold">{s.step}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{s.title}</p>
                    <p className="text-xs text-white/40">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Platform */}
            {platformSelector}

            {/* Post URL/ID */}
            <div className="glass-card p-6 space-y-4">
              <label className="block text-sm font-medium text-white/80">Post URL or ID</label>
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="input-glass min-h-[100px] resize-none"
                placeholder={"https://www.facebook.com/page/posts/123456789\nor paste a post ID like pfbid0zzVHSdSfx5a4..."}
                required
              />
              <p className="text-xs text-white/30">
                Supported: Page posts, group posts, video posts, photo posts, reels
              </p>
            </div>

            {/* Advanced Options */}
            <div className="glass-card p-6 space-y-5">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Advanced Options</h3>

              {/* Ignore duplicate users */}
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="ignoreDuplicates"
                    checked={ignoreDuplicates}
                    onChange={(e) => setIgnoreDuplicates(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                  />
                  <label htmlFor="ignoreDuplicates" className="text-sm font-medium text-white/80">
                    Ignore duplicate comment users
                  </label>
                </div>
                <p className="text-xs text-white/30 ml-7">
                  Skip users already scraped in previous jobs for the same post. Saves credits.
                </p>
              </div>

              {/* Start from previous cursor */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="useCustomCursor"
                      checked={useCustomCursor}
                      onChange={(e) => handleCursorToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    />
                    <label htmlFor="useCustomCursor" className="text-sm font-medium text-white/80">
                      Start from previous cursor
                    </label>
                  </div>
                  <p className="text-xs text-white/30 ml-7">
                    Resume comment fetching from where a previous job stopped
                  </p>
                </div>

                {/* Expandable cursor history */}
                {useCustomCursor && (
                  <div className="ml-7 rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
                    {loadingCursors ? (
                      <div className="flex items-center gap-2 text-white/40 text-sm">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading cursor history...
                      </div>
                    ) : !inputValue.trim() ? (
                      <p className="text-xs text-white/30">Enter a post URL first to see available cursors</p>
                    ) : cursorHistory.length === 0 ? (
                      <p className="text-xs text-white/30">No cursor history available for this post</p>
                    ) : (
                      <>
                        <p className="text-xs text-white/40 font-medium">Select a checkpoint to resume from:</p>
                        <div className="space-y-2">
                          {cursorHistory.map((item) => (
                            <label
                              key={item.job_id}
                              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                                selectedCursor === item.last_cursor
                                  ? "border-primary-500/50 bg-primary-500/10"
                                  : "border-white/5 bg-white/[0.01] hover:border-white/15"
                              }`}
                            >
                              <input
                                type="radio"
                                name="cursorSelect"
                                value={item.last_cursor}
                                checked={selectedCursor === item.last_cursor}
                                onChange={() => setSelectedCursor(item.last_cursor)}
                                className="mt-0.5 h-4 w-4 border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-white/80 font-medium">
                                    {formatTimeAgo(item.created_at)}
                                  </span>
                                  <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                                    item.status === "cancelled"
                                      ? "bg-yellow-500/10 text-yellow-400"
                                      : "bg-red-500/10 text-red-400"
                                  }`}>
                                    {item.status}
                                  </span>
                                </div>
                                <p className="text-xs text-white/40 mt-0.5">
                                  {item.comment_pages_fetched} pages fetched &middot; {item.total_comments_fetched} comments collected
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Schedule */}
            {scheduleSection}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="btn-glow w-full text-lg py-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating Job..." : schedule ? "Schedule Job" : "Start Scraping"}
            </button>
          </form>
        </Tabs.Content>

        {/* ────────────────────────────────────────────────────── */}
        {/* Tab 2: Page Post Discovery                            */}
        {/* ────────────────────────────────────────────────────── */}
        <Tabs.Content value="post_discovery" className="space-y-6 outline-none">
          {/* Steps */}
          <div className="glass-card p-6 space-y-2">
            <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">How it works</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
              {[
                { step: "1", title: "Enter Page", desc: "Provide a Page ID, username, or Facebook URL" },
                { step: "2", title: "Discover Posts", desc: "We fetch all posts with engagement data" },
                { step: "3", title: "Select & Scrape", desc: "Pick posts to extract commenter profiles" },
              ].map((s) => (
                <div key={s.step} className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center shrink-0">
                    <span className="text-white text-sm font-bold">{s.step}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{s.title}</p>
                    <p className="text-xs text-white/40">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handlePostDiscoverySubmit} className="space-y-6">
            {/* Platform */}
            {platformSelector}

            {/* Page Input */}
            <div className="glass-card p-6 space-y-4">
              <label className="block text-sm font-medium text-white/80">Page / Group / Profile</label>
              <textarea
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                className="input-glass min-h-[100px] resize-none"
                placeholder={"Enter a Page ID, username, or URL\ne.g., mtpfan, 123456789, https://facebook.com/pagename"}
                required
              />
              <p className="text-xs text-white/30">
                Supported: Page IDs, usernames, @handles, group URLs, profile URLs
              </p>
            </div>

            {/* Token Type */}
            <div className="glass-card p-6 space-y-4">
              <label className="block text-sm font-medium text-white/80">Token Type</label>
              <div className="flex gap-3">
                {[
                  { id: "EAAAAU", name: "EAAAAU", subtitle: "Pages & Profiles" },
                  { id: "EAAGNO", name: "EAAGNO", subtitle: "Groups" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTokenType(t.id)}
                    className={`flex-1 rounded-xl border-2 p-4 text-center transition-all cursor-pointer ${
                      tokenType === t.id
                        ? "border-primary-500 bg-primary-500/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <p className="text-sm font-bold text-white">{t.name}</p>
                    <p className="text-xs text-white/40 mt-1">{t.subtitle}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule */}
            {scheduleSection}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !pageInput.trim()}
              className="btn-glow w-full text-lg py-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating Job..." : schedule ? "Schedule Discovery" : "Discover Posts"}
            </button>
          </form>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
