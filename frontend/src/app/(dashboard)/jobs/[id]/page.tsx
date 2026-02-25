"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { jobsApi, exportApi } from "@/lib/api-client";
import { formatDate, getStatusColor } from "@/lib/utils";
import type { ScrapingJob, ScrapedProfile, ScrapedPost, PageAuthorProfile } from "@/types";

const STAGE_LABELS: Record<string, string> = {
  parse_input: "Parse Input",
  fetch_comments: "Fetch Comments",
  fetch_posts: "Fetch Posts",
  deduplicate: "Deduplicate Users",
  enrich_profiles: "Enrich Profiles",
  finalize: "Finalize",
};

const formatNumber = (n: number) => n.toLocaleString();

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [job, setJob] = useState<ScrapingJob | null>(null);
  const [profiles, setProfiles] = useState<ScrapedProfile[]>([]);
  const [posts, setPosts] = useState<ScrapedPost[]>([]);
  const [author, setAuthor] = useState<PageAuthorProfile | null>(null);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [queueInfo, setQueueInfo] = useState<{ position: number; estimated_seconds: number; ahead: number } | null>(null);

  const fetchJob = useCallback(async () => {
    try {
      const res = await jobsApi.get(jobId);
      setJob(res.data);

      if (res.data.status === "completed" || res.data.status === "paused" || res.data.status === "cancelled") {
        if (res.data.job_type === "post_discovery") {
          const postRes = await jobsApi.getPosts(jobId, { page: 1, page_size: 200 });
          setPosts(postRes.data);
        } else {
          const profRes = await jobsApi.getResults(jobId, { page: 1, page_size: 50 });
          setProfiles(profRes.data);
        }
      }

      // Fetch posts for running/queued post_discovery jobs so users see them in real-time
      if (res.data.job_type === "post_discovery" && (res.data.status === "running" || res.data.status === "queued")) {
        const postRes = await jobsApi.getPosts(jobId, { page: 1, page_size: 200 });
        setPosts(postRes.data);
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
  }, [jobId]);

  useEffect(() => {
    fetchJob();

    // Poll for progress if job is running
    const interval = setInterval(() => {
      if (job?.status === "running" || job?.status === "queued") {
        fetchJob();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchJob, job?.status]);

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

  const togglePostSelection = (postId: string) => {
    setSelectedPosts(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const toggleAllPosts = () => {
    if (selectedPosts.size === posts.length) {
      setSelectedPosts(new Set());
    } else {
      setSelectedPosts(new Set(posts.map(p => p.post_id)));
    }
  };

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
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-white/60">Progress</p>
            {isPostDiscovery ? (
              <p className="text-sm font-medium text-white">
                {posts.length} posts discovered
              </p>
            ) : (
              <p className="text-sm font-medium text-white">
                {job.processed_items} / {job.total_items} profiles
              </p>
            )}
          </div>
          <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 via-accent-purple to-accent-pink rounded-full transition-all duration-500 animate-pulse"
              style={{ width: `${job.progress_pct}%` }}
            />
          </div>
          <p className="text-xs text-white/30 mt-2">
            {Number(job.progress_pct).toFixed(1)}% complete
            {job.failed_items > 0 && ` - ${job.failed_items} failed`}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: isPostDiscovery ? "Total Posts" : "Total Profiles",
            value: isPostDiscovery ? formatNumber(posts.length) : formatNumber(job.result_row_count),
          },
          { label: "Credits Used", value: formatNumber(job.credits_used) },
          { label: "Failed", value: formatNumber(job.failed_items) },
          { label: "Created", value: formatDate(job.created_at) },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-4">
            <p className="text-xs text-white/40">{stat.label}</p>
            <p className="text-lg font-semibold text-white mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

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
                      <p className="text-white/40">Total Posts Fetched</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.total_comments_fetched}
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
                      <p className="text-white/40">Comments</p>
                      <p className="text-white/70 font-semibold text-base mt-0.5">
                        {pipelineState.total_comments_fetched}
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

      {/* Export Buttons + Report Link */}
      {job.status === "completed" && (isPostDiscovery ? posts.length > 0 : job.result_row_count > 0) && (
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

      {/* Posts Table (post_discovery jobs) */}
      {isPostDiscovery && posts.length > 0 && (
        <div className="glass-card overflow-x-auto">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Discovered Posts ({posts.length})</h2>
            <button
              onClick={handleScrapeSelected}
              disabled={creatingJobs || selectedPosts.size === 0}
              className="btn-glow text-sm px-4 py-2 disabled:opacity-50 disabled:hover:scale-100"
            >
              {creatingJobs ? "Creating Jobs..." : `Scrape Selected (${selectedPosts.size})`}
            </button>
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
                    checked={posts.length > 0 && selectedPosts.size === posts.length}
                    onChange={toggleAllPosts}
                    className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                  />
                </th>
                {["Message", "Author", "Created", "Comments", "Reactions", "Shares", "Type", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-white/40 uppercase px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedPosts.has(p.post_id)}
                      onChange={() => togglePostSelection(p.post_id)}
                      className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-white/60 max-w-[250px]">
                    <span className="line-clamp-2">
                      {p.message ? (p.message.length > 100 ? p.message.slice(0, 100) + "..." : p.message) : "N/A"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/60">{p.from_name || "N/A"}</td>
                  <td className="px-4 py-3 text-white/60">{p.created_time ? formatDate(p.created_time) : "N/A"}</td>
                  <td className="px-4 py-3 text-white/60">{formatNumber(p.comment_count)}</td>
                  <td className="px-4 py-3 text-white/60">{formatNumber(p.reaction_count)}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Profiles Results Table (non-post_discovery jobs) */}
      {!isPostDiscovery && profiles.length > 0 && (
        <div className="glass-card overflow-x-auto">
          <div className="p-4 border-b border-white/5">
            <h2 className="text-lg font-semibold text-white">Scraped Profiles ({profiles.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["Name", "Gender", "Phone", "Location", "Education", "Work", "Status"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-white/40 uppercase px-4 py-3">
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
                      {p.picture_url ? (
                        <img src={p.picture_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs text-white/40">{(p.name || "?")[0]}</span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-white font-medium truncate">{p.name || "N/A"}</p>
                        <p className="text-xs text-white/40 truncate">{p.username_link || p.platform_user_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/60">{p.gender || "N/A"}</td>
                  <td className="px-4 py-3 text-white/60">{p.phone && p.phone !== "NA" ? p.phone : "N/A"}</td>
                  <td className="px-4 py-3 text-white/60">{p.location || "N/A"}</td>
                  <td className="px-4 py-3 text-white/60 truncate max-w-[150px]">{p.education || "N/A"}</td>
                  <td className="px-4 py-3 text-white/60 truncate max-w-[150px]">{p.work || "N/A"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(p.scrape_status)}`}>
                      {p.scrape_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
