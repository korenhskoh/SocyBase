"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { jobsApi } from "@/lib/api-client";
import type { CursorHistoryItem } from "@/types";

// ── Platform & scrape type definitions ────────────────────────────────

interface PlatformDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  enabled: boolean;
  scrapeTypes: ScrapeTypeDef[];
}

interface ScrapeTypeDef {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  steps: { title: string; desc: string }[];
}

const COMMENT_ICON = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
  </svg>
);

const DISCOVER_ICON = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);

const PLATFORMS: PlatformDef[] = [
  {
    id: "facebook",
    name: "Facebook",
    icon: "F",
    color: "from-[#1877F2] to-[#0d5bbd]",
    enabled: true,
    scrapeTypes: [
      {
        id: "comment_scraper",
        label: "Comment Profile Scraper",
        desc: "Extract commenter profiles from any post",
        icon: COMMENT_ICON,
        steps: [
          { title: "Paste URL", desc: "Enter a Facebook post URL or ID" },
          { title: "Extract Comments", desc: "We fetch all commenters from the post" },
          { title: "Get Profiles", desc: "Each commenter's profile is enriched" },
        ],
      },
      {
        id: "post_discovery",
        label: "Page Post Discovery",
        desc: "Discover all posts from a page, group, or profile",
        icon: DISCOVER_ICON,
        steps: [
          { title: "Enter Page", desc: "Provide a Page ID, username, or URL" },
          { title: "Discover Posts", desc: "We fetch all posts with engagement data" },
          { title: "Select & Scrape", desc: "Pick posts to extract commenter profiles" },
        ],
      },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "T",
    color: "from-[#00F2EA] to-[#FF0050]",
    enabled: false,
    scrapeTypes: [],
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "I",
    color: "from-[#F58529] to-[#DD2A7B]",
    enabled: false,
    scrapeTypes: [],
  },
];

export default function NewJobPage() {
  const router = useRouter();

  // ── Step state ──────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1=platform, 2=scrapeType, 3=configure
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformDef | null>(null);
  const [selectedScrapeType, setSelectedScrapeType] = useState<ScrapeTypeDef | null>(null);

  // ── Shared state ────────────────────────────────────────────────
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Concurrent job limit warning
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [concurrencyLimit] = useState<number | null>(null);

  useEffect(() => {
    jobsApi.list({ page: 1, page_size: 50, status: "running" }).then((r) => {
      const running = Array.isArray(r.data) ? r.data.length : 0;
      jobsApi.list({ page: 1, page_size: 50, status: "queued" }).then((r2) => {
        const queued = Array.isArray(r2.data) ? r2.data.length : 0;
        setActiveJobCount(running + queued);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  // ── Comment Scraper state ───────────────────────────────────────
  const [inputValue, setInputValue] = useState("");
  const [ignoreDuplicates, setIgnoreDuplicates] = useState(false);
  const [useCustomCursor, setUseCustomCursor] = useState(false);
  const [selectedCursor, setSelectedCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<CursorHistoryItem[]>([]);
  const [loadingCursors, setLoadingCursors] = useState(false);

  // ── Post Discovery state ────────────────────────────────────────
  const [pageInput, setPageInput] = useState("");
  const [tokenType, setTokenType] = useState("EAAAAU");
  const [maxPages, setMaxPages] = useState(50);
  const [useDiscoveryCursor, setUseDiscoveryCursor] = useState(false);
  const [selectedDiscoveryCursor, setSelectedDiscoveryCursor] = useState("");
  const [discoveryCursorHistory, setDiscoveryCursorHistory] = useState<
    { job_id: string; status: string; created_at: string; last_after_cursor: string | null; pages_fetched: number; total_posts_fetched: number }[]
  >([]);
  const [loadingDiscoveryCursors, setLoadingDiscoveryCursors] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────
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
    if (checked) loadCursorHistory();
  };

  const loadDiscoveryCursorHistory = async () => {
    if (!pageInput.trim()) return;
    setLoadingDiscoveryCursors(true);
    try {
      const res = await jobsApi.getPostDiscoveryCursors(pageInput.trim());
      setDiscoveryCursorHistory(res.data);
    } catch {
      setDiscoveryCursorHistory([]);
    } finally {
      setLoadingDiscoveryCursors(false);
    }
  };

  const handleDiscoveryCursorToggle = (checked: boolean) => {
    setUseDiscoveryCursor(checked);
    setSelectedDiscoveryCursor("");
    if (checked) loadDiscoveryCursorHistory();
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const selectPlatform = (p: PlatformDef) => {
    if (!p.enabled) return;
    setSelectedPlatform(p);
    setSelectedScrapeType(null);
    setError("");
    // If only one scrape type, auto-select it
    if (p.scrapeTypes.length === 1) {
      setSelectedScrapeType(p.scrapeTypes[0]);
      setStep(3);
    } else {
      setStep(2);
    }
  };

  const selectScrapeType = (st: ScrapeTypeDef) => {
    setSelectedScrapeType(st);
    setError("");
    setStep(3);
  };

  const goBack = () => {
    setError("");
    if (step === 3) {
      if (selectedPlatform && selectedPlatform.scrapeTypes.length === 1) {
        setSelectedPlatform(null);
        setSelectedScrapeType(null);
        setStep(1);
      } else {
        setSelectedScrapeType(null);
        setStep(2);
      }
    } else if (step === 2) {
      setSelectedPlatform(null);
      setStep(1);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlatform || !selectedScrapeType) return;
    setError("");
    setLoading(true);

    try {
      if (selectedScrapeType.id === "comment_scraper") {
        const retryCount = Number(localStorage.getItem("socybase_scraping_retry_count") || "2");
        const res = await jobsApi.create({
          platform: selectedPlatform.id,
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
      } else if (selectedScrapeType.id === "post_discovery") {
        const res = await jobsApi.create({
          platform: selectedPlatform.id,
          job_type: "post_discovery",
          input_type: "page_id",
          input_value: pageInput,
          scheduled_at: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          settings: {
            token_type: tokenType,
            max_pages: maxPages,
            ...(useDiscoveryCursor && selectedDiscoveryCursor && { start_from_cursor: selectedDiscoveryCursor }),
          },
        });
        router.push(`/jobs/${res.data.id}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create job");
    } finally {
      setLoading(false);
    }
  };

  // ── Stepper indicator ───────────────────────────────────────────
  const stepLabels = ["Platform", "Scrape Type", "Configure"];

  const Stepper = () => (
    <div className="flex items-center gap-2 mb-8">
      {stepLabels.map((label, i) => {
        const stepNum = i + 1;
        const isActive = step === stepNum;
        const isDone = step > stepNum;
        return (
          <div key={label} className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => {
                if (isDone) {
                  if (stepNum === 1) { setSelectedPlatform(null); setSelectedScrapeType(null); setStep(1); }
                  else if (stepNum === 2) { setSelectedScrapeType(null); setStep(2); }
                }
              }}
              className={`flex items-center gap-2 transition-all ${isDone ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all ${
                isActive
                  ? "bg-gradient-to-br from-primary-500 to-accent-purple text-white shadow-lg shadow-primary-500/25"
                  : isDone
                    ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
                    : "bg-white/5 text-white/30 border border-white/10"
              }`}>
                {isDone ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : stepNum}
              </div>
              <span className={`text-sm font-medium hidden sm:inline ${
                isActive ? "text-white" : isDone ? "text-primary-400" : "text-white/30"
              }`}>{label}</span>
            </button>
            {i < stepLabels.length - 1 && (
              <div className={`flex-1 h-px ${isDone ? "bg-primary-500/30" : "bg-white/10"}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">New Scraping Job</h1>
        <p className="text-white/50 mt-1">
          {step === 1 && "Select a social media platform to scrape"}
          {step === 2 && `Choose a scrape type for ${selectedPlatform?.name}`}
          {step === 3 && "Configure your job and start scraping"}
        </p>
      </div>

      {/* Concurrent job warning */}
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

      {/* Stepper */}
      <Stepper />

      {/* ── STEP 1: Choose Platform ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.enabled}
                onClick={() => selectPlatform(p)}
                className={`group relative rounded-2xl border-2 p-6 text-center transition-all ${
                  p.enabled
                    ? "border-white/10 bg-white/[0.02] hover:border-primary-500/50 hover:bg-primary-500/5 cursor-pointer"
                    : "border-white/5 bg-white/[0.01] opacity-50 cursor-not-allowed"
                }`}
              >
                <div className={`mx-auto h-14 w-14 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center mb-3 transition-transform group-hover:scale-110`}>
                  <span className="text-white font-bold text-2xl">{p.icon}</span>
                </div>
                <p className="text-sm font-semibold text-white">{p.name}</p>
                {p.enabled ? (
                  <p className="text-xs text-white/40 mt-1">{p.scrapeTypes.length} scrape type{p.scrapeTypes.length !== 1 ? "s" : ""}</p>
                ) : (
                  <p className="text-xs text-white/30 mt-1">Coming soon</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 2: Choose Scrape Type ──────────────────────────── */}
      {step === 2 && selectedPlatform && (
        <div className="space-y-4">
          {/* Back button */}
          <button type="button" onClick={goBack} className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to platforms
          </button>

          <div className="space-y-3">
            {selectedPlatform.scrapeTypes.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => selectScrapeType(st)}
                className="w-full group rounded-2xl border-2 border-white/10 bg-white/[0.02] hover:border-primary-500/50 hover:bg-primary-500/5 p-6 text-left transition-all cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-purple/20 border border-primary-500/20 flex items-center justify-center text-primary-400 shrink-0 transition-colors group-hover:border-primary-500/40">
                    {st.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-white">{st.label}</p>
                    <p className="text-sm text-white/40 mt-0.5">{st.desc}</p>
                    {/* Mini steps */}
                    <div className="flex items-center gap-3 mt-3">
                      {st.steps.map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className="h-5 w-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white/40">{i + 1}</span>
                          </div>
                          <span className="text-xs text-white/30">{s.title}</span>
                          {i < st.steps.length - 1 && (
                            <svg className="h-3 w-3 text-white/15 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <svg className="h-5 w-5 text-white/20 group-hover:text-primary-400 transition-colors shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 3: Configure ───────────────────────────────────── */}
      {step === 3 && selectedPlatform && selectedScrapeType && (
        <div className="space-y-6">
          {/* Back button */}
          <button type="button" onClick={goBack} className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>

          {/* Selection summary */}
          <div className="glass-card p-4 flex items-center gap-4">
            <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${selectedPlatform.color} flex items-center justify-center shrink-0`}>
              <span className="text-white font-bold text-lg">{selectedPlatform.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">{selectedPlatform.name}</p>
              <p className="text-xs text-white/40">{selectedScrapeType.label}</p>
            </div>
          </div>

          {/* How it works */}
          <div className="glass-card p-6 space-y-2">
            <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">How it works</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
              {selectedScrapeType.steps.map((s, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center shrink-0">
                    <span className="text-white text-sm font-bold">{i + 1}</span>
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
            {/* ── Comment Scraper form fields ── */}
            {selectedScrapeType.id === "comment_scraper" && (
              <>
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
              </>
            )}

            {/* ── Post Discovery form fields ── */}
            {selectedScrapeType.id === "post_discovery" && (
              <>
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

                {/* Max Pages (scrape limit) */}
                <div className="glass-card p-6 space-y-4">
                  <label className="block text-sm font-medium text-white/80">Max Pages to Fetch</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={5}
                      max={200}
                      step={5}
                      value={maxPages}
                      onChange={(e) => setMaxPages(Number(e.target.value))}
                      className="flex-1 accent-primary-500"
                    />
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={maxPages}
                      onChange={(e) => setMaxPages(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                      className="w-20 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-primary-500"
                    />
                  </div>
                  <p className="text-xs text-white/30">
                    ~{maxPages * 10} posts estimated ({maxPages} pages x ~10 posts/page). Uses {maxPages} credits.
                  </p>
                </div>

                {/* Continue from previous cursor */}
                <div className="glass-card p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="discoveryCursor"
                      checked={useDiscoveryCursor}
                      onChange={(e) => handleDiscoveryCursorToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    />
                    <label htmlFor="discoveryCursor" className="text-sm font-medium text-white/80">
                      Continue from previous scrape
                    </label>
                  </div>
                  {useDiscoveryCursor && (
                    <div className="space-y-3">
                      {loadingDiscoveryCursors ? (
                        <p className="text-xs text-white/40">Loading previous scrapes...</p>
                      ) : discoveryCursorHistory.length === 0 ? (
                        <p className="text-xs text-white/40">No previous scrapes found for this page. Run a discovery first.</p>
                      ) : (
                        <div className="space-y-2">
                          {discoveryCursorHistory.map((h) => (
                            <button
                              key={h.job_id}
                              type="button"
                              onClick={() => setSelectedDiscoveryCursor(h.last_after_cursor || "")}
                              className={`w-full text-left rounded-lg border p-3 transition-all ${
                                selectedDiscoveryCursor === h.last_after_cursor
                                  ? "border-primary-500 bg-primary-500/10"
                                  : "border-white/10 hover:border-white/20"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-white/70">
                                  {h.total_posts_fetched} posts from {h.pages_fetched} pages
                                </span>
                                <span className="text-xs text-white/40">{formatTimeAgo(h.created_at)}</span>
                              </div>
                              <span className={`text-xs mt-1 inline-block px-1.5 py-0.5 rounded ${
                                h.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-yellow-500/10 text-yellow-400"
                              }`}>
                                {h.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Schedule */}
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

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || (selectedScrapeType.id === "comment_scraper" ? !inputValue.trim() : !pageInput.trim())}
              className="btn-glow w-full text-lg py-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? "Creating Job..."
                : schedule
                  ? selectedScrapeType.id === "post_discovery" ? "Schedule Discovery" : "Schedule Job"
                  : selectedScrapeType.id === "post_discovery" ? "Discover Posts" : "Start Scraping"
              }
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
