"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { jobsApi, exportApi, fanAnalysisApi, fbAdsApi } from "@/lib/api-client";
import { formatDate, formatNumber, getStatusColor } from "@/lib/utils";
import type { ScrapingJob, ScrapedProfile, ScrapedPost, PageAuthorProfile, FanEngagementMetrics } from "@/types";

const STAGE_LABELS: Record<string, string> = {
  start: "Starting",
  parse_input: "Parsing Input",
  fetch_author: "Fetching Page Info",
  fetch_comments: "Fetching Comments",
  fetch_posts: "Fetching Posts",
  deduplicate: "Finding Unique Users",
  enrich_profiles: "Enriching Profiles",
  finalize: "Finalizing",
  ai_fan_analysis: "Analyzing Fans (AI)",
};

interface ProgressEvent {
  status: string;
  progress_pct: number;
  processed_items: number;
  total_items: number;
  failed_items: number;
  result_row_count: number;
  current_stage?: string;
  stage_data?: Record<string, unknown>;
}

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [job, setJob] = useState<ScrapingJob | null>(null);
  const [profiles, setProfiles] = useState<ScrapedProfile[]>([]);
  const [profilesTotal, setProfilesTotal] = useState(0);
  const [profilesPage, setProfilesPage] = useState(1);
  const [profilesPageSize, setProfilesPageSize] = useState(30);
  const [posts, setPosts] = useState<ScrapedPost[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [postsPage, setPostsPage] = useState(1);
  const [postsPageSize, setPostsPageSize] = useState(30);
  const [author, setAuthor] = useState<PageAuthorProfile | null>(null);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [showOnlyHighPotential, setShowOnlyHighPotential] = useState(false);
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [continuationJobId, setContinuationJobId] = useState<string | null>(null);
  const [continuationStatus, setContinuationStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [queueInfo, setQueueInfo] = useState<{ position: number; estimated_seconds: number; ahead: number } | null>(null);
  const [liveProgress, setLiveProgress] = useState<ProgressEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastPostsFetchRef = useRef<number>(0);
  const fetchPostsRef = useRef<() => void>(() => {});
  const fetchProfilesRef = useRef<() => void>(() => {});

  // Fan analysis state
  const [fans, setFans] = useState<FanEngagementMetrics[]>([]);
  const [fansTotal, setFansTotal] = useState(0);
  const [fansPage, setFansPage] = useState(1);
  const [fansSortBy, setFansSortBy] = useState("engagement_score");
  const [showBots, setShowBots] = useState(true);
  const [fansBotCount, setFansBotCount] = useState(0);
  const [fansHighIntent, setFansHighIntent] = useState(0);
  const [analyzingFans, setAnalyzingFans] = useState<Set<string>>(new Set());
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [expandedFan, setExpandedFan] = useState<string | null>(null);

  const fetchProfiles = useCallback(async (page?: number, pageSize?: number) => {
    const pg = page ?? profilesPage;
    const ps = pageSize ?? profilesPageSize;
    try {
      const res = await jobsApi.getResults(jobId, { page: pg, page_size: ps });
      const data = res.data;
      if (data.items) {
        setProfiles(data.items);
        setProfilesTotal(data.total);
      } else {
        // Backwards compat: if API returns array directly
        setProfiles(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, [jobId, profilesPage, profilesPageSize]);

  const fetchPosts = useCallback(async (page?: number, pageSize?: number) => {
    const pg = page ?? postsPage;
    const ps = pageSize ?? postsPageSize;
    try {
      const res = await jobsApi.getPosts(jobId, { page: pg, page_size: ps });
      const data = res.data;
      if (data.items) {
        setPosts(data.items);
        setPostsTotal(data.total);
      } else {
        // Backwards compat: if API returns array directly
        setPosts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn("[fetchPosts] Failed:", err);
    }
  }, [jobId, postsPage, postsPageSize]);

  // Keep refs current so SSE handler always uses latest fetch functions
  fetchPostsRef.current = fetchPosts;
  fetchProfilesRef.current = fetchProfiles;

  const fetchFans = useCallback(async () => {
    try {
      const res = await fanAnalysisApi.getFans(jobId, {
        page: fansPage,
        page_size: 50,
        sort_by: fansSortBy,
        show_bots: showBots,
      });
      setFans(res.data.items || []);
      setFansTotal(res.data.total || 0);
      setFansBotCount(res.data.bot_count || 0);
      setFansHighIntent(res.data.high_intent_count || 0);
    } catch { /* ignore */ }
  }, [jobId, fansPage, fansSortBy, showBots]);

  const handleAnalyzeFan = async (uid: string) => {
    setAnalyzingFans(prev => new Set(prev).add(uid));
    try {
      await fanAnalysisApi.analyzeFan({ job_id: jobId, commenter_user_ids: [uid] });
      await fetchFans();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "AI analysis failed");
    } finally {
      setAnalyzingFans(prev => { const n = new Set(prev); n.delete(uid); return n; });
    }
  };

  const handleBatchAnalyze = async () => {
    setBatchAnalyzing(true);
    try {
      await fanAnalysisApi.batchAnalyze(jobId, { min_comments: 3, limit: 50 });
      alert("Batch analysis started. Results will appear shortly.");
      setTimeout(() => fetchFans(), 5000);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Batch analysis failed");
    } finally {
      setBatchAnalyzing(false);
    }
  };

  const handleExportFans = async () => {
    try {
      const res = await fanAnalysisApi.exportFans(jobId, "csv");
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fan_analysis_${jobId}.csv`;
      a.click();
    } catch { /* ignore */ }
  };

  const fetchJob = useCallback(async (opts?: { loadResults?: boolean }) => {
    try {
      const res = await jobsApi.get(jobId);
      setJob(res.data);

      const isActive = res.data.status === "running" || res.data.status === "queued";
      const loadResults = opts?.loadResults ||
        ["completed", "paused", "cancelled"].includes(res.data.status);

      if (res.data.job_type === "post_discovery") {
        if (loadResults || isActive) fetchPosts();
      } else {
        if (loadResults || isActive) fetchProfiles();
      }

      // Fetch queue position for queued jobs
      if (res.data.status === "queued") {
        try {
          const qRes = await jobsApi.getQueuePosition(jobId);
          setQueueInfo(qRes.data);
        } catch {
          setQueueInfo(null);
        }
      } else {
        setQueueInfo(null);
      }

      // Fetch author profile (non-blocking)
      try {
        const authorRes = await jobsApi.getAuthor(jobId);
        setAuthor(authorRes.data);
      } catch {
        // Author may not exist for all jobs
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [jobId, fetchPosts, fetchProfiles]);

  // SSE connection for real-time progress
  const sseInitialized = useRef(false);

  useEffect(() => {
    if (!job) return;

    const isActive = job.status === "running" || job.status === "queued";

    if (!isActive) {
      // Close any existing SSE connection for terminal states
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        sseInitialized.current = false;
      }
      return;
    }

    // Don't create duplicate connections
    if (eventSourceRef.current || sseInitialized.current) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) return;

    sseInitialized.current = true;
    const url = `${jobsApi.getProgressStreamUrl(jobId)}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      try {
        const data: ProgressEvent = JSON.parse(e.data);
        setLiveProgress(data);

        // Update key fields on the job object for consistency
        setJob((prev) => prev ? {
          ...prev,
          progress_pct: data.progress_pct,
          processed_items: data.processed_items,
          total_items: data.total_items,
          failed_items: data.failed_items,
          result_row_count: data.result_row_count,
        } : prev);

        // Refresh posts/profiles table when new data arrives (debounced to 2s)
        const now = Date.now();
        if (now - lastPostsFetchRef.current > 2000 && data.result_row_count > 0) {
          lastPostsFetchRef.current = now;
          fetchPostsRef.current();
          fetchProfilesRef.current();
        }
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener("done", (e) => {
      try {
        const data: ProgressEvent = JSON.parse(e.data);
        setLiveProgress(data);
        // Update the job status to terminal so the UI re-renders correctly
        setJob((prev) => prev ? {
          ...prev,
          status: data.status as ScrapingJob["status"],
          progress_pct: data.progress_pct,
          processed_items: data.processed_items,
          total_items: data.total_items,
          failed_items: data.failed_items,
          result_row_count: data.result_row_count,
        } : prev);
      } catch { /* ignore */ }
      es.close();
      eventSourceRef.current = null;
      sseInitialized.current = false;
      // Re-fetch full job data (includes results, profiles, etc.)
      fetchJob({ loadResults: true });
    });

    es.onerror = () => {
      // SSE failed — fall back to polling
      es.close();
      eventSourceRef.current = null;
      sseInitialized.current = false;
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      sseInitialized.current = false;
    };
  }, [job?.status, jobId, fetchJob]);

  // Initial fetch + fallback poll (only if SSE is not connected)
  useEffect(() => {
    fetchJob();

    const interval = setInterval(() => {
      // Only poll if SSE is not active
      if (!eventSourceRef.current && (job?.status === "running" || job?.status === "queued")) {
        fetchJob();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchJob, job?.status]);

  // Auto-refresh posts table while post_discovery is running (every 2s)
  useEffect(() => {
    if (!job || job.job_type !== "post_discovery") return;
    if (job.status !== "running") return;

    // Fetch immediately once, then every 2s
    fetchPostsRef.current();
    const interval = setInterval(() => fetchPostsRef.current(), 2000);
    return () => clearInterval(interval);
  }, [job?.status, job?.job_type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh profiles table while comment scraper is running (every 3s)
  useEffect(() => {
    if (!job || job.job_type === "post_discovery") return;
    if (job.status !== "running") return;

    const interval = setInterval(() => fetchProfilesRef.current(), 3000);
    return () => clearInterval(interval);
  }, [job?.status, job?.job_type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch posts when pagination changes
  useEffect(() => {
    if (!job || job.job_type !== "post_discovery") return;
    fetchPosts();
  }, [postsPage, postsPageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch profiles when pagination changes
  useEffect(() => {
    if (!job || job.job_type === "post_discovery") return;
    fetchProfiles();
  }, [profilesPage, profilesPageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch fans when job is a completed comment scraper
  useEffect(() => {
    if (!job || job.job_type === "post_discovery") return;
    if (!["completed", "paused", "failed"].includes(job.status)) return;
    fetchFans();
  }, [job?.status, job?.job_type, fansPage, fansSortBy, showBots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll continuation job and refresh posts as it discovers more
  useEffect(() => {
    if (!continuationJobId) return;
    if (continuationStatus !== "running" && continuationStatus !== "queued") return;

    const interval = setInterval(async () => {
      try {
        const res = await jobsApi.get(continuationJobId);
        const contJob = res.data;
        setContinuationStatus(contJob.status);

        // Refresh posts table (backend aggregates across related jobs)
        fetchPosts();

        if (["completed", "failed", "cancelled"].includes(contJob.status)) {
          // Update pipeline state cursor from continuation job for further discovery
          if (contJob.status === "completed" && contJob.error_details?.pipeline_state) {
            const contState = contJob.error_details.pipeline_state;
            setJob(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                error_details: {
                  ...prev.error_details,
                  pipeline_state: {
                    ...prev.error_details?.pipeline_state,
                    current_stage: prev.error_details?.pipeline_state?.current_stage || "finalize",
                    last_after_cursor: contState.last_after_cursor,
                    last_cursor: contState.last_cursor,
                  },
                },
              };
            });
          }
          setContinuationJobId(null);
        }
      } catch { /* ignore */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [continuationJobId, continuationStatus, fetchPosts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExportCsv = async () => {
    const res = await exportApi.downloadCsv(jobId);
    const blob = new Blob([res.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `socybase_export_${jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportFbAds = async () => {
    const res = await exportApi.downloadFbAds(jobId);
    const blob = new Blob([res.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `socybase_fb_ads_${jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXlsx = async () => {
    const res = await exportApi.downloadXlsx(jobId);
    const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `socybase_export_${jobId}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateCustomAudience = async () => {
    setCreatingAudience(true);
    try {
      const res = await fbAdsApi.createCustomAudience(jobId);
      const d = res.data;
      alert(`Custom Audience created!\n\nName: ${d.audience_name}\nProfiles uploaded: ${d.profiles_uploaded}\nAudience ID: ${d.audience_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create Custom Audience";
      alert(msg);
    } finally {
      setCreatingAudience(false);
    }
  };

  const handleResume = async () => {
    if (!job) return;
    setResuming(true);
    try {
      const res = await jobsApi.resume(jobId);
      window.location.href = `/jobs/${res.data.id}`;
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to resume job");
    } finally {
      setResuming(false);
    }
  };

  const handlePause = async () => {
    if (!job) return;
    setPausing(true);
    try {
      await jobsApi.pause(jobId);
      setTimeout(() => fetchJob({ loadResults: true }), 1500);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to pause job");
    } finally {
      setPausing(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    setCancelling(true);
    try {
      await jobsApi.cancel(jobId);
      setTimeout(() => fetchJob({ loadResults: true }), 1500);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to cancel job");
    } finally {
      setCancelling(false);
    }
  };

  const togglePostSelection = (postId: string) => {
    setSelectedPosts(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const toggleAllPosts = () => {
    if (selectedPosts.size === displayedPosts.length) {
      setSelectedPosts(new Set());
    } else {
      setSelectedPosts(new Set(displayedPosts.map(p => p.post_id)));
    }
  };

  // High-potential post detection
  const HIGH_POTENTIAL_TYPES = new Set(["video_inline", "video", "photo", "native_templates", "share", "album"]);
  const isHighPotential = (p: ScrapedPost) =>
    p.comment_count >= 50 && p.reaction_count >= 20 &&
    (HIGH_POTENTIAL_TYPES.has(p.attachment_type || "") || !p.attachment_type || p.attachment_type === "post");

  const highPotentialCount = posts.filter(isHighPotential).length;
  const displayedPosts = showOnlyHighPotential ? posts.filter(isHighPotential) : posts;

  const handleScrapeSelected = async () => {
    if (selectedPosts.size === 0) return;
    setCreatingJobs(true);
    try {
      await jobsApi.createFromPosts({
        post_ids: Array.from(selectedPosts),
        settings: { include_replies: true, profile_retry_count: 2 },
      });
      window.location.href = "/jobs";
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to create jobs");
    } finally {
      setCreatingJobs(false);
    }
  };

  const canResume =
    (job?.status === "failed" || job?.status === "paused") && job?.error_details?.pipeline_state != null;

  const [continuingDiscovery, setContinuingDiscovery] = useState(false);
  const [creatingAudience, setCreatingAudience] = useState(false);

  const handleContinueDiscovery = async (direction: "older" | "newer") => {
    if (!job) return;
    const state = job.error_details?.pipeline_state as Record<string, unknown> | undefined;
    const cursor = direction === "older"
      ? (state?.last_after_cursor || state?.last_cursor) as string | undefined
      : state?.first_before_cursor as string | undefined;
    if (!cursor) return;
    setContinuingDiscovery(true);
    try {
      const res = await jobsApi.create({
        platform: "facebook",
        job_type: "post_discovery",
        input_type: "page_id",
        input_value: job.input_value,
        settings: {
          ...(job.settings || {}),
          start_from_cursor: cursor,
        },
      });
      // Stay on current page — track the continuation job
      setContinuationJobId(res.data.id);
      setContinuationStatus("running");
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to create continuation job");
    } finally {
      setContinuingDiscovery(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!job) {
    return <div className="text-center py-20 text-white/40">Job not found</div>;
  }

  const pipelineState = job.error_details?.pipeline_state;
  const errorInfo = job.error_details?.error;
  const isPostDiscovery = job.job_type === "post_discovery";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-white">Job Details</h1>
          <p className="text-white/40 text-sm mt-1 truncate">{job.input_value}</p>
        </div>
        <span className={`text-sm px-3 py-1.5 rounded-full font-medium shrink-0 self-start sm:self-auto ${getStatusColor(job.status)}`}>
          {job.status}
        </span>
      </div>

      {/* Author Info Card */}
      {author && (
        <div className="glass-card p-5">
          <div className="flex items-start gap-4">
            {author.picture_url ? (
              <img
                src={author.picture_url}
                alt={author.name || ""}
                className="w-14 h-14 rounded-full object-cover flex-shrink-0 ring-2 ring-white/10"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <span className="text-lg text-white/40">{(author.name || "?")[0]}</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white truncate">{author.name || "Unknown Page"}</h3>
                {author.category && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-400 font-medium shrink-0">
                    {author.category}
                  </span>
                )}
              </div>
              {author.about && (
                <p className="text-sm text-white/50 mt-1 line-clamp-2">{author.about}</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-white/40">
                {author.location && <span>{author.location}</span>}
                {author.phone && <span>{author.phone}</span>}
                {author.website && (
                  <a href={author.website} target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300">
                    {author.website}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Queue Position Card */}
      {job.status === "queued" && queueInfo && queueInfo.position > 0 && (
        <div className="glass-card p-6 border border-yellow-500/20">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
              <span className="text-2xl font-bold text-yellow-400">#{queueInfo.position}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">In Queue</p>
              <p className="text-xs text-white/50 mt-0.5">
                {queueInfo.ahead === 0
                  ? "Your job is next — it will start shortly"
                  : `${queueInfo.ahead} job${queueInfo.ahead !== 1 ? "s" : ""} ahead of yours`}
              </p>
              {queueInfo.estimated_seconds > 0 && (
                <p className="text-xs text-yellow-400/80 mt-1">
                  Estimated wait: ~{queueInfo.estimated_seconds < 60
                    ? `${queueInfo.estimated_seconds}s`
                    : queueInfo.estimated_seconds < 3600
                      ? `${Math.ceil(queueInfo.estimated_seconds / 60)} min`
                      : `${Math.floor(queueInfo.estimated_seconds / 3600)}h ${Math.ceil((queueInfo.estimated_seconds % 3600) / 60)}m`}
                </p>
              )}
            </div>
            <div className="shrink-0">
              <svg className="h-6 w-6 text-yellow-400/60 animate-spin" style={{ animationDuration: "3s" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Progress Card */}
      {(job.status === "running" || job.status === "queued") && (
        <div className="glass-card p-6 relative overflow-hidden">
          {/* Animated background shimmer */}
          <div className="absolute inset-0 opacity-[0.03]">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary-400 to-transparent animate-[shimmer_3s_ease-in-out_infinite]" style={{ backgroundSize: "200% 100%" }} />
          </div>
          {(() => {
            const stage = liveProgress?.current_stage || "";
            const stageData: any = liveProgress?.stage_data || {};
            const pct = liveProgress?.progress_pct ?? job.progress_pct;
            const processed = liveProgress?.processed_items ?? job.processed_items;
            const total = liveProgress?.total_items ?? job.total_items;

            // Stage icon + color mapping
            let stageIcon = "";
            let stageColor = "#00AAFF";
            let stageText = "";
            let detailText = "";
            if (isPostDiscovery) {
              stageIcon = "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z";
              stageColor = "#7C5CFF";
              stageText = "Discovering posts";
              const postsFound = stageData.total_posts || liveProgress?.result_row_count || postsTotal || posts.length || 0;
              const pagesDone = stageData.pages_fetched || 0;
              const maxPg = stageData.max_pages || 0;
              detailText = `${formatNumber(postsFound)} posts found`;
              if (pagesDone > 0) detailText += ` (page ${pagesDone}${maxPg ? `/${maxPg}` : ""})`;
            } else if (stage === "parse_input" || stage === "start") {
              stageIcon = "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z";
              stageColor = "#FFAA00";
              stageText = "Starting pipeline";
              detailText = "Parsing input URL...";
            } else if (stage === "fetch_author") {
              stageIcon = "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z";
              stageColor = "#00AAFF";
              stageText = "Fetching page info";
              detailText = stageData.name ? `Page: ${stageData.name}` : "Loading page details...";
            } else if (stage === "fetch_comments") {
              stageIcon = "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z";
              stageColor = "#00AAFF";
              stageText = "Fetching comments";
              const pages = stageData.pages_fetched || 0;
              const topLevel = stageData.top_level_comments || 0;
              const replies = stageData.reply_comments || 0;
              const totalComments = stageData.total_comments || 0;
              detailText = totalComments > 0
                ? `${formatNumber(topLevel as number)} comments + ${formatNumber(replies as number)} replies from ${pages} page${pages !== 1 ? "s" : ""}`
                : `Fetching from page ${pages}...`;
            } else if (stage === "deduplicate") {
              stageIcon = "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z";
              stageColor = "#7C5CFF";
              stageText = "Finding unique users";
              const users = stageData.unique_users || total;
              detailText = users > 0 ? `${formatNumber(users)} unique users found` : "Deduplicating...";
            } else if (stage === "enrich_profiles") {
              stageIcon = "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z";
              stageColor = "#FF3366";
              stageText = "Enriching profiles";
              detailText = `${formatNumber(processed)} / ${formatNumber(total)} profiles`;
            } else if (stage === "finalize") {
              stageIcon = "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
              stageColor = "#10B981";
              stageText = "Finalizing";
              detailText = "Compiling results...";
            } else {
              stageIcon = "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183";
              stageColor = "#00AAFF";
              stageText = "Processing";
              detailText = total > 0 ? `${formatNumber(processed)} / ${formatNumber(total)} profiles` : "Initializing...";
            }

            return (
              <div className="relative">
                {/* Stage header with icon */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${stageColor}15`, border: `1px solid ${stageColor}30` }}
                    >
                      <svg
                        className="h-5 w-5 animate-pulse"
                        style={{ color: stageColor }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={stageIcon} />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{stageText}</p>
                      <p className="text-xs text-white/40">{STAGE_LABELS[stage] || "Processing"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white/80">{detailText}</p>
                    <p className="text-xs text-white/30 mt-0.5">
                      {Number(pct).toFixed(1)}% complete
                      {(liveProgress?.failed_items ?? job.failed_items) > 0 && (
                        <span className="text-red-400"> &middot; {liveProgress?.failed_items ?? job.failed_items} failed</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Progress bar with glow */}
                <div className="w-full h-2.5 bg-white/[0.06] rounded-full overflow-hidden relative">
                  <div
                    className="h-full rounded-full transition-all duration-700 relative"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      background: `linear-gradient(90deg, ${stageColor}, ${stageColor}cc)`,
                      boxShadow: `0 0 12px ${stageColor}40`,
                    }}
                  >
                    {/* Animated shine on progress bar */}
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
                        animation: "shimmer 2s ease-in-out infinite",
                        backgroundSize: "200% 100%",
                      }}
                    />
                  </div>
                </div>

                {/* Stage pipeline dots */}
                <div className="flex items-center justify-between mt-4 px-1">
                  {(isPostDiscovery
                    ? ["parse_input", "fetch_author", "fetch_posts", "finalize"]
                    : ["parse_input", "fetch_author", "fetch_comments", "deduplicate", "enrich_profiles", "finalize"]
                  ).map((s, i, arr) => {
                    const stageOrder = arr.indexOf(stage);
                    const thisOrder = i;
                    const isDone = stageOrder > thisOrder;
                    const isCurrent = s === stage;
                    return (
                      <div key={s} className="flex items-center gap-0 flex-1 last:flex-none">
                        <div className="flex flex-col items-center">
                          <div
                            className={`h-2.5 w-2.5 rounded-full transition-all duration-500 ${
                              isDone
                                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                                : isCurrent
                                  ? "shadow-[0_0_8px] animate-pulse"
                                  : "bg-white/10"
                            }`}
                            style={isCurrent ? { background: stageColor, boxShadow: `0 0 8px ${stageColor}` } : undefined}
                          />
                          <span className={`text-[9px] mt-1 whitespace-nowrap ${
                            isCurrent ? "text-white/60 font-medium" : isDone ? "text-emerald-400/50" : "text-white/15"
                          }`}>
                            {(STAGE_LABELS[s] || s).replace("Fetching ", "").replace("Finding ", "").replace("Enriching ", "")}
                          </span>
                        </div>
                        {i < arr.length - 1 && (
                          <div className={`flex-1 h-px mx-1 mt-[-10px] ${isDone ? "bg-emerald-400/30" : "bg-white/5"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pause / Stop buttons */}
                {job.status === "running" && (
                  <div className="flex gap-2 mt-5">
                    <button
                      onClick={handlePause}
                      disabled={pausing}
                      className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400 font-medium transition-all hover:bg-yellow-500/20 disabled:opacity-50"
                    >
                      {pausing ? "Pausing..." : "Pause"}
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 font-medium transition-all hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {cancelling ? "Stopping..." : "Stop"}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Stats */}
      {(() => {
        const isRunning = job.status === "running" || job.status === "queued";
        const liveTotal = isPostDiscovery
          ? (liveProgress?.result_row_count ?? job.result_row_count) || postsTotal || posts.length
          : (isRunning ? (liveProgress?.processed_items ?? job.processed_items ?? 0) : 0) || job.result_row_count || profilesTotal || profiles.length;
        const liveCredits = isRunning
          ? (liveProgress?.stage_data as any)?.pages_fetched || job.credits_used
          : job.credits_used;

        // Total comments for comment scrape jobs
        const stageData = (liveProgress?.stage_data || {}) as Record<string, unknown>;
        const pipelineComments = (job.error_details?.pipeline_state?.total_comments_fetched ?? 0) as number;
        const liveComments = (stageData.total_comments as number) || pipelineComments;

        const stats = [
          {
            label: isPostDiscovery ? "Total Posts" : "Total Profiles",
            value: formatNumber(liveTotal),
          },
          ...(!isPostDiscovery ? [{
            label: "Total Comments",
            value: formatNumber(liveComments),
          }] : []),
          { label: "Credits Used", value: formatNumber(liveCredits) },
          { label: "Failed", value: formatNumber(liveProgress?.failed_items ?? job.failed_items) },
          { label: "Created", value: formatDate(job.created_at) },
        ];

        return (
          <div className={`grid grid-cols-2 ${stats.length > 4 ? "md:grid-cols-5" : "md:grid-cols-4"} gap-4`}>
            {stats.map((stat) => (
              <div key={stat.label} className="glass-card p-4">
                <p className="text-xs text-white/40">{stat.label}</p>
                <p className="text-lg font-semibold text-white mt-1">{stat.value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Error Details */}
      {job.status === "failed" && (
        <div className="glass-card p-6 space-y-4 border border-red-500/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-red-400">Job Failed</h3>
            {errorInfo?.stage && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 text-red-400/80 font-medium">
                Stage: {STAGE_LABELS[errorInfo.stage] || errorInfo.stage}
              </span>
            )}
          </div>

          {job.error_message && (
            <p className="text-sm text-red-400/80">{job.error_message}</p>
          )}

          {/* Pipeline progress at time of failure */}
          {pipelineState && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {isPostDiscovery ? (
                <>
                  {pipelineState.pages_fetched != null && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40">Pages Fetched</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.pages_fetched}
                      </p>
                    </div>
                  )}
                  {pipelineState.total_posts_fetched != null && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40">Total Posts Fetched</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.total_posts_fetched}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {pipelineState.comment_pages_fetched != null && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40">Pages Fetched</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.comment_pages_fetched}
                      </p>
                    </div>
                  )}
                  {pipelineState.total_comments_fetched != null && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40">Comments + Replies</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.top_level_comments ?? "?"} + {pipelineState.reply_comments ?? "?"} = {pipelineState.total_comments_fetched}
                      </p>
                    </div>
                  )}
                  {pipelineState.unique_user_ids_found != null && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40">Unique Users</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.unique_user_ids_found}
                      </p>
                    </div>
                  )}
                  {pipelineState.profiles_enriched != null && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40">Profiles Done</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.profiles_enriched}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Resume Button */}
          {canResume && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
              <button
                onClick={handleResume}
                disabled={resuming}
                className="relative overflow-hidden rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 text-center"
              >
                {resuming ? "Resuming..." : "Resume Scraping"}
              </button>
              <p className="text-xs text-white/30">
                Creates a new job that continues from the last checkpoint
              </p>
            </div>
          )}
        </div>
      )}

      {/* Resume button for paused jobs (outside the failed block) */}
      {job.status === "paused" && canResume && (
        <div className="glass-card p-6 border border-yellow-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={handleResume}
              disabled={resuming}
              className="relative overflow-hidden rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 text-center"
            >
              {resuming ? "Resuming..." : "Resume Scraping"}
            </button>
            <p className="text-xs text-white/30">
              Creates a new job that continues from the last checkpoint
            </p>
          </div>
        </div>
      )}

      {/* Export Buttons + Report Link */}
      {["completed", "cancelled", "paused"].includes(job.status) && (isPostDiscovery ? (postsTotal > 0 || posts.length > 0 || job.result_row_count > 0) : job.result_row_count > 0) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {isPostDiscovery ? (
            <>
              <button
                onClick={handleExportXlsx}
                className="relative overflow-hidden rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] hover:scale-105 text-center"
              >
                Export XLSX
              </button>
              <button onClick={handleExportCsv} className="btn-glow text-center">
                Export CSV
              </button>
              {continuationJobId && (continuationStatus === "running" || continuationStatus === "queued") ? (
                <div className="flex items-center gap-2 px-6 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="h-4 w-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                  <span className="text-sm text-amber-400 font-medium">Discovering older posts...</span>
                </div>
              ) : (pipelineState as Record<string, unknown> | undefined)?.last_after_cursor && (
                <button
                  onClick={() => handleContinueDiscovery("older")}
                  disabled={continuingDiscovery}
                  className="relative overflow-hidden rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 text-center"
                >
                  {continuingDiscovery ? "Creating..." : "Discover Older Posts"}
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={handleExportCsv} className="btn-glow text-center">
                Export CSV
              </button>
              <button
                onClick={handleExportXlsx}
                className="relative overflow-hidden rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] hover:scale-105 text-center"
              >
                Export XLSX
              </button>
              <button
                onClick={handleExportFbAds}
                className="relative overflow-hidden rounded-lg bg-gradient-to-r from-[#1877F2] to-[#0d5bbd] px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(24,119,242,0.5)] hover:scale-105 text-center"
              >
                Export for FB Ads Manager
              </button>
              <button
                onClick={handleCreateCustomAudience}
                disabled={creatingAudience}
                className="relative overflow-hidden rounded-lg bg-gradient-to-r from-[#1877F2] to-[#42b72a] px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(66,183,42,0.5)] hover:scale-105 text-center disabled:opacity-50 flex items-center gap-2 justify-center"
              >
                {creatingAudience && (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {creatingAudience ? "Creating..." : "Create Custom Audience"}
              </button>
              <Link
                href={`/jobs/${jobId}/report`}
                className="relative overflow-hidden rounded-lg bg-gradient-to-r from-accent-purple to-primary-500 px-6 py-3 text-white font-medium transition-all duration-300 hover:shadow-[0_0_20px_rgba(124,92,255,0.4)] hover:scale-105 text-center"
              >
                View Report
              </Link>
            </>
          )}
        </div>
      )}

      {/* Posts Table — loading placeholder while running with no posts yet */}
      {isPostDiscovery && posts.length === 0 && postsTotal === 0 && (job.status === "running" || job.status === "queued") && (
        <div className="glass-card p-8 relative overflow-hidden">
          <div className="flex flex-col items-center justify-center gap-4">
            {/* Animated scanning icon */}
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 rounded-full border-2 border-primary-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary-400 animate-spin" style={{ animationDuration: "1.5s" }} />
              <div className="absolute inset-2 rounded-full border-2 border-transparent border-b-accent-purple animate-spin" style={{ animationDuration: "2.5s", animationDirection: "reverse" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-6 w-6 text-primary-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white/60">Scanning for posts...</p>
              <p className="text-xs text-white/25 mt-1">Posts will appear here as they&apos;re discovered</p>
            </div>
          </div>
        </div>
      )}

      {/* Loading state for cancelled/paused/failed jobs that have posts but haven't loaded yet */}
      {isPostDiscovery && posts.length === 0 && postsTotal === 0 && ["cancelled", "paused", "failed"].includes(job.status) && job.result_row_count > 0 && (
        <div className="glass-card p-8">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="h-6 w-6 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin" />
            <p className="text-sm text-white/40">Loading {formatNumber(job.result_row_count)} discovered posts...</p>
          </div>
        </div>
      )}

      {/* Empty state for cancelled/paused/failed post discovery jobs with no posts */}
      {isPostDiscovery && posts.length === 0 && postsTotal === 0 && ["cancelled", "paused", "failed"].includes(job.status) && job.result_row_count === 0 && (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-white/40">
            {job.status === "cancelled" && "Job was stopped before any posts were discovered."}
            {job.status === "paused" && "Job was paused before any posts were discovered. You can resume it."}
            {job.status === "failed" && "Job failed before any posts were discovered."}
          </p>
        </div>
      )}

      {/* Posts Table (post_discovery jobs) */}
      {isPostDiscovery && (posts.length > 0 || postsTotal > 0) && (
        <div className="glass-card overflow-x-auto">
          <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-white">
                Discovered Posts ({postsTotal || posts.length})
              </h2>
              {highPotentialCount > 0 && (
                <button
                  onClick={() => setShowOnlyHighPotential(!showOnlyHighPotential)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    showOnlyHighPotential
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
                      : "bg-amber-500/10 text-amber-400/70 border border-amber-500/20 hover:bg-amber-500/15 hover:text-amber-400"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  {highPotentialCount} High Potential
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-white/40">Show:</span>
                {[30, 50, 100, 200].map((size) => (
                  <button
                    key={size}
                    onClick={() => { setPostsPageSize(size); setPostsPage(1); }}
                    className={`text-xs px-2 py-1 rounded transition-all ${
                      postsPageSize === size
                        ? "bg-primary-500/20 text-primary-400 font-semibold"
                        : "text-white/40 hover:text-white/60 hover:bg-white/5"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <button
                onClick={handleScrapeSelected}
                disabled={creatingJobs || selectedPosts.size === 0}
                className="btn-glow text-sm px-4 py-2 disabled:opacity-50 disabled:hover:scale-100"
              >
                {creatingJobs ? "Creating Jobs..." : `Scrape Selected (${selectedPosts.size})`}
              </button>
            </div>
          </div>

          {selectedPosts.size > 0 && (
            <div className="flex items-center justify-between p-4 bg-primary-500/10 border-b border-primary-500/20">
              <span className="text-sm text-white/70">
                {selectedPosts.size} post{selectedPosts.size !== 1 ? "s" : ""} selected
              </span>
              <button
                onClick={handleScrapeSelected}
                disabled={creatingJobs}
                className="btn-glow text-sm px-4 py-2"
              >
                {creatingJobs ? "Creating Jobs..." : `Scrape Comments (${selectedPosts.size})`}
              </button>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase px-4 py-3">
                  <input
                    type="checkbox"
                    checked={displayedPosts.length > 0 && selectedPosts.size === displayedPosts.length}
                    onChange={toggleAllPosts}
                    className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                  />
                </th>
                {["Priority", "Message", "Author", "Created", "Comments", "Reactions", "Shares", "Type", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-white/40 uppercase px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedPosts.map((p) => {
                const hp = isHighPotential(p);
                return (
                  <tr key={p.id} className={`hover:bg-white/[0.02] ${hp ? "bg-amber-500/[0.03]" : ""}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedPosts.has(p.post_id)}
                        onChange={() => togglePostSelection(p.post_id)}
                        className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {hp ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                          HIGH
                        </span>
                      ) : (
                        <span className="text-white/20 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/60 max-w-[250px]">
                      <span className="line-clamp-2">
                        {p.message ? (p.message.length > 100 ? p.message.slice(0, 100) + "..." : p.message) : "N/A"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/60">{p.from_name || "N/A"}</td>
                    <td className="px-4 py-3 text-white/60">{p.created_time ? formatDate(p.created_time) : "N/A"}</td>
                    <td className="px-4 py-3 text-white/60">
                      <span className={p.comment_count >= 50 ? "text-amber-400 font-semibold" : ""}>{formatNumber(p.comment_count)}</span>
                    </td>
                    <td className="px-4 py-3 text-white/60">
                      <span className={p.reaction_count >= 20 ? "text-amber-400 font-semibold" : ""}>{formatNumber(p.reaction_count)}</span>
                    </td>
                    <td className="px-4 py-3 text-white/60">{formatNumber(p.share_count)}</td>
                    <td className="px-4 py-3 text-white/60">{p.attachment_type || "post"}</td>
                    <td className="px-4 py-3">
                      {p.post_url ? (
                        <a
                          href={p.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-400 hover:text-primary-300 text-xs font-medium"
                        >
                          View Post
                        </a>
                      ) : (
                        <span className="text-white/30 text-xs">No link</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {postsTotal > postsPageSize && (
            <div className="p-4 border-t border-white/5 flex items-center justify-between">
              <p className="text-xs text-white/40">
                Showing {(postsPage - 1) * postsPageSize + 1}–{Math.min(postsPage * postsPageSize, postsTotal)} of {postsTotal}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPostsPage((p) => Math.max(1, p - 1))}
                  disabled={postsPage <= 1}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  Prev
                </button>
                {Array.from({ length: Math.min(Math.ceil(postsTotal / postsPageSize), 7) }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setPostsPage(pg)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition ${
                      postsPage === pg ? "bg-primary-500/20 text-primary-400 font-semibold" : "text-white/40 hover:bg-white/5"
                    }`}
                  >
                    {pg}
                  </button>
                ))}
                {Math.ceil(postsTotal / postsPageSize) > 7 && (
                  <span className="text-xs text-white/30 px-1">...</span>
                )}
                <button
                  onClick={() => setPostsPage((p) => Math.min(Math.ceil(postsTotal / postsPageSize), p + 1))}
                  disabled={postsPage >= Math.ceil(postsTotal / postsPageSize)}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profiles loading placeholder while running with no profiles yet */}
      {!isPostDiscovery && profiles.length === 0 && profilesTotal === 0 && (job.status === "running" || job.status === "queued") && (() => {
        const stage = liveProgress?.current_stage || "";
        const sd = (liveProgress?.stage_data || {}) as Record<string, unknown>;
        const topLevel = (sd.top_level_comments as number) || 0;
        const replies = (sd.reply_comments as number) || 0;
        const totalComments = (sd.total_comments as number) || 0;
        const pages = (sd.pages_fetched as number) || 0;
        const uniqueUsers = (sd.unique_users as number) || 0;

        // Stage-specific icon, color, title, subtitle
        let icon = "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z";
        let color = "#00AAFF";
        let title = "Preparing...";
        let subtitle = "Profiles will appear here once enrichment begins";
        let stats: { label: string; value: string }[] = [];

        if (stage === "fetch_comments") {
          icon = "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z";
          color = "#00AAFF";
          title = "Fetching comments...";
          subtitle = "Collecting all comments before extracting profiles";
          if (totalComments > 0) {
            stats = [
              { label: "Comments", value: formatNumber(topLevel) },
              { label: "Replies", value: formatNumber(replies) },
              { label: "Pages", value: formatNumber(pages) },
              { label: "Total", value: formatNumber(totalComments) },
            ];
          }
        } else if (stage === "deduplicate") {
          icon = "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z";
          color = "#7C5CFF";
          title = "Deduplicating user IDs...";
          subtitle = uniqueUsers > 0
            ? `Found ${formatNumber(uniqueUsers)} unique users from ${formatNumber(totalComments || (liveProgress?.stage_data as any)?.total_comments || 0)} comments`
            : "Removing duplicate commenters to find unique users";
          if (uniqueUsers > 0) {
            stats = [{ label: "Unique Users", value: formatNumber(uniqueUsers) }];
            if (totalComments > 0) stats.push({ label: "From Comments", value: formatNumber(totalComments) });
          }
        } else if (stage === "enrich_profiles") {
          color = "#FF3366";
          title = "Enriching profiles...";
          const processed = liveProgress?.processed_items ?? 0;
          const total = liveProgress?.total_items ?? 0;
          subtitle = total > 0 ? `Scraping profile ${formatNumber(processed)} of ${formatNumber(total)}` : "Starting profile enrichment...";
        } else if (stage === "parse_input" || stage === "fetch_author") {
          icon = "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z";
          title = "Initializing...";
          subtitle = "Parsing input and fetching page info";
        }

        return (
          <div className="glass-card p-8 relative overflow-hidden">
            <div className="flex flex-col items-center justify-center gap-4">
              {/* Animated icon */}
              <div className="relative h-16 w-16">
                <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: `${color}20` }} />
                <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: color, animationDuration: "1.5s" }} />
                <div className="absolute inset-2 rounded-full border-2 border-transparent animate-spin" style={{ borderBottomColor: `${color}80`, animationDuration: "2.5s", animationDirection: "reverse" }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="h-6 w-6" style={{ color: `${color}cc` }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white/60">{title}</p>
                <p className="text-xs text-white/30 mt-1">{subtitle}</p>
              </div>

              {/* Live stats mini-cards */}
              {stats.length > 0 && (
                <div className="flex gap-3 mt-1">
                  {stats.map((s) => (
                    <div key={s.label} className="px-4 py-2 rounded-lg bg-white/[0.03] text-center">
                      <p className="text-xs text-white/30">{s.label}</p>
                      <p className="text-sm font-semibold text-white/70 mt-0.5">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Animated skeleton rows preview */}
              <div className="w-full max-w-md space-y-2 mt-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/[0.02]">
                    <div className="h-8 w-8 rounded-full bg-white/5 animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 rounded bg-white/5 animate-pulse" style={{ animationDelay: `${i * 200 + 100}ms` }} />
                      <div className="h-2 w-1/3 rounded bg-white/[0.03] animate-pulse" style={{ animationDelay: `${i * 200 + 200}ms` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Empty state for cancelled/paused/failed comment scrape jobs */}
      {!isPostDiscovery && profiles.length === 0 && profilesTotal === 0 && ["cancelled", "paused", "failed"].includes(job.status) && job.result_row_count === 0 && (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-white/40">
            {job.status === "cancelled" && "Job was stopped before any profiles were scraped."}
            {job.status === "paused" && "Job was paused. You can resume it to continue scraping."}
            {job.status === "failed" && "Job failed before completing profile scraping."}
          </p>
        </div>
      )}

      {/* Profiles Results Table (non-post_discovery jobs) */}
      {!isPostDiscovery && (profiles.length > 0 || profilesTotal > 0) && (
        <div className="glass-card overflow-hidden">
          <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">
              Scraped Profiles ({profilesTotal || profiles.length})
            </h2>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/40">Show:</span>
              {[20, 30, 50, 100, 200].map((size) => (
                <button
                  key={size}
                  onClick={() => { setProfilesPageSize(size); setProfilesPage(1); }}
                  className={`text-xs px-2 py-1 rounded transition-all ${
                    profilesPageSize === size
                      ? "bg-primary-500/20 text-primary-400 font-semibold"
                      : "text-white/40 hover:text-white/60 hover:bg-white/5"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-auto max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-navy-900/95 backdrop-blur-sm z-10">
                <tr className="border-b border-white/5">
                  {["Name", "First Name", "Last Name", "ID", "Gender", "Birthday", "Location", "Hometown", "Education", "Work", "Username", "Username Link"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-white/40 uppercase px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                          {p.picture_url && p.picture_url !== "NA" ? (
                            <img src={p.picture_url} alt="" className="w-8 h-8 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty('display'); }} />
                          ) : null}
                          <span className={`text-xs text-white/40${p.picture_url && p.picture_url !== "NA" ? " hidden" : ""}`}>{(p.name || "?")[0]}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{p.name || "N/A"}</p>
                          {p.username_link && p.username_link !== "NA" ? (
                            <a href={p.username_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-400 hover:text-primary-300 truncate block">
                              {p.username_link.replace("https://facebook.com/", "").replace("https://www.facebook.com/", "")}
                            </a>
                          ) : (
                            <p className="text-xs text-white/40 truncate">{p.platform_user_id}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/60">{p.first_name && p.first_name !== "NA" ? p.first_name : "—"}</td>
                    <td className="px-4 py-3 text-white/60">{p.last_name && p.last_name !== "NA" ? p.last_name : "—"}</td>
                    <td className="px-4 py-3 text-white/40 text-xs font-mono">{p.platform_user_id}</td>
                    <td className="px-4 py-3 text-white/60">{p.gender && p.gender !== "NA" ? p.gender : "—"}</td>
                    <td className="px-4 py-3 text-white/60 whitespace-nowrap">{p.birthday && p.birthday !== "NA" ? p.birthday : "—"}</td>
                    <td className="px-4 py-3 text-white/60">{p.location && p.location !== "NA" ? p.location : "—"}</td>
                    <td className="px-4 py-3 text-white/60">{p.hometown && p.hometown !== "NA" ? p.hometown : "—"}</td>
                    <td className="px-4 py-3 text-white/60 truncate max-w-[180px]">{p.education && p.education !== "NA" ? p.education : "—"}</td>
                    <td className="px-4 py-3 text-white/60 truncate max-w-[180px]">{p.work && p.work !== "NA" ? p.work : "—"}</td>
                    <td className="px-4 py-3 text-white/60">{p.username && p.username !== "NA" ? p.username : "—"}</td>
                    <td className="px-4 py-3 text-white/60 text-xs">
                      {p.username_link && p.username_link !== "NA" ? (
                        <a href={p.username_link} target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300 truncate block max-w-[200px]">
                          {p.username_link.replace("https://facebook.com/", "").replace("https://www.facebook.com/", "")}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {profilesTotal > profilesPageSize && (
            <div className="p-4 border-t border-white/5 flex items-center justify-between">
              <p className="text-xs text-white/40">
                Showing {(profilesPage - 1) * profilesPageSize + 1}–{Math.min(profilesPage * profilesPageSize, profilesTotal)} of {profilesTotal}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setProfilesPage((p) => Math.max(1, p - 1))}
                  disabled={profilesPage <= 1}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  Prev
                </button>
                {Array.from({ length: Math.min(Math.ceil(profilesTotal / profilesPageSize), 7) }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setProfilesPage(pg)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition ${
                      profilesPage === pg ? "bg-primary-500/20 text-primary-400 font-semibold" : "text-white/40 hover:bg-white/5"
                    }`}
                  >
                    {pg}
                  </button>
                ))}
                {Math.ceil(profilesTotal / profilesPageSize) > 7 && (
                  <span className="text-xs text-white/30 px-1">...</span>
                )}
                <button
                  onClick={() => setProfilesPage((p) => Math.min(Math.ceil(profilesTotal / profilesPageSize), p + 1))}
                  disabled={profilesPage >= Math.ceil(profilesTotal / profilesPageSize)}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Fan Catch — for comment scraper jobs */}
      {!isPostDiscovery && fans.length > 0 && (
        <div className="glass-card overflow-x-auto">
          <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-white">
                AI Fan Catch ({fansTotal})
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
                className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white/70 focus:outline-none focus:border-primary-500/50 [&>option]:bg-[#1a1a2e] [&>option]:text-white"
              >
                <option value="engagement_score">Sort: Engagement</option>
                <option value="total_comments">Sort: Comments</option>
                <option value="buying_intent">Sort: Buying Intent</option>
              </select>
              <button
                onClick={handleBatchAnalyze}
                disabled={batchAnalyzing}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition disabled:opacity-50"
              >
                {batchAnalyzing ? "Analyzing..." : "Batch AI Analyze"}
              </button>
              <button
                onClick={handleExportFans}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition"
              >
                Export Fans
              </button>
            </div>
          </div>

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
                <>
                  <tr
                    key={fan.commenter_user_id}
                    className={`hover:bg-white/[0.02] cursor-pointer ${fan.is_bot ? "bg-red-500/[0.02]" : ""}`}
                    onClick={() => setExpandedFan(expandedFan === fan.commenter_user_id ? null : fan.commenter_user_id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {fan.profile?.picture_url ? (
                          <img src={fan.profile.picture_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] text-white/40">{(fan.commenter_name || "?")[0]}</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-white font-medium text-xs truncate">{fan.commenter_name || "Unknown"}</p>
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
                      <span className="text-amber-400 font-semibold">{fan.engagement_score.toFixed(0)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {fan.ai_analysis ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                fan.ai_analysis.buying_intent_score >= 0.7 ? "bg-emerald-500" :
                                fan.ai_analysis.buying_intent_score >= 0.4 ? "bg-amber-500" : "bg-white/30"
                              }`}
                              style={{ width: `${fan.ai_analysis.buying_intent_score * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-white/50">{(fan.ai_analysis.buying_intent_score * 100).toFixed(0)}%</span>
                        </div>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {fan.ai_analysis?.sentiment ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          fan.ai_analysis.sentiment === "positive" ? "bg-emerald-500/15 text-emerald-400" :
                          fan.ai_analysis.sentiment === "negative" ? "bg-red-500/15 text-red-400" :
                          "bg-white/10 text-white/50"
                        }`}>
                          {fan.ai_analysis.sentiment}
                        </span>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!fan.ai_analysis ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAnalyzeFan(fan.commenter_user_id); }}
                          disabled={analyzingFans.has(fan.commenter_user_id)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition disabled:opacity-50"
                        >
                          {analyzingFans.has(fan.commenter_user_id) ? "..." : "Analyze"}
                        </button>
                      ) : (
                        <span className="text-xs text-white/30">{fan.ai_analysis.persona_type}</span>
                      )}
                    </td>
                  </tr>
                  {/* Expanded row */}
                  {expandedFan === fan.commenter_user_id && (
                    <tr key={`${fan.commenter_user_id}-detail`}>
                      <td colSpan={8} className="px-4 py-3 bg-white/[0.01]">
                        <div className="flex flex-col gap-2 text-xs">
                          <div className="flex items-center gap-4 text-white/40">
                            <span>First seen: {fan.first_seen ? formatDate(fan.first_seen) : "N/A"}</span>
                            <span>Last seen: {fan.last_seen ? formatDate(fan.last_seen) : "N/A"}</span>
                            {fan.profile?.phone && <span>Phone: {fan.profile.phone}</span>}
                            {fan.profile?.location && <span>Location: {fan.profile.location}</span>}
                          </div>
                          {fan.is_bot && fan.bot_indicators && (
                            <div className="flex flex-wrap gap-1.5">
                              <span className="text-red-400/70 font-medium">Bot indicators:</span>
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
                                    <span key={i} className="px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-400 text-[10px]">
                                      {interest}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {fan.ai_analysis.key_phrases.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {fan.ai_analysis.key_phrases.map((phrase, i) => (
                                    <span key={i} className="px-2 py-0.5 rounded bg-white/5 text-white/40 text-[10px] italic">
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
              ))}
            </tbody>
          </table>

          {/* Fan Pagination */}
          {fansTotal > 50 && (
            <div className="p-4 border-t border-white/5 flex items-center justify-between">
              <p className="text-xs text-white/40">
                Page {fansPage} of {Math.ceil(fansTotal / 50)}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFansPage(p => Math.max(1, p - 1))}
                  disabled={fansPage <= 1}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 transition"
                >
                  Prev
                </button>
                <button
                  onClick={() => setFansPage(p => p + 1)}
                  disabled={fansPage >= Math.ceil(fansTotal / 50)}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
