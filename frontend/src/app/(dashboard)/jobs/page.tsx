"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { jobsApi, exportApi } from "@/lib/api-client";
import { formatDate, getStatusColor } from "@/lib/utils";
import type { ScrapingJob } from "@/types";
import ConfirmModal from "@/components/ui/ConfirmModal";
import JobLogModal from "@/components/ui/JobLogModal";

/* ── Status icon SVGs ── */
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
        </span>
      );
    case "completed":
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      );
    case "failed":
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
    case "cancelled":
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case "paused":
      return (
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      );
    case "queued":
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "scheduled":
      return (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      );
    default:
      return null;
  }
}

/* ── Helpers ── */
const ACTIVE_STATUSES = ["running", "queued"];
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "paused"];
const RESUMABLE_STATUSES = ["failed", "paused"];

type ConfirmAction = {
  type: "pause" | "stop" | "delete";
  jobIds: string[];
} | null;

const JOB_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  full_pipeline: { label: "Comment Scraper", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  post_discovery: { label: "Post Discovery", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
};

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScrapingJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  // Selection
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  // Modals
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [logJobId, setLogJobId] = useState<string | null>(null);

  // Export dropdown
  const [exportDropdownId, setExportDropdownId] = useState<string | null>(null);

  // Action feedback
  const [actionError, setActionError] = useState("");

  const fetchJobs = useCallback(() => {
    const params: Record<string, any> = { page, page_size: pageSize };
    if (statusFilter) params.status = statusFilter;

    setLoading(true);
    jobsApi
      .list(params)
      .then((r) => {
        const data = r.data;
        if (data.items) {
          setJobs(data.items);
          setJobsTotal(data.total || 0);
        } else if (Array.isArray(data)) {
          setJobs(data);
          setJobsTotal(data.length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, page, pageSize]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Clear selection and reset page on filter change
  useEffect(() => {
    setSelectedJobs(new Set());
    setPage(1);
  }, [statusFilter, typeFilter]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportDropdownId) return;
    const handler = () => setExportDropdownId(null);
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [exportDropdownId]);

  // Filter jobs by type (client-side since API doesn't support type filter yet)
  const filteredJobs = typeFilter ? jobs.filter((j) => j.job_type === typeFilter) : jobs;

  /* ── Selection handlers ── */
  const toggleJob = (id: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedJobs.size === filteredJobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(filteredJobs.map((j) => j.id)));
    }
  };

  /* ── Confirm action labels ── */
  const getConfirmConfig = () => {
    if (!confirmAction) return { title: "", message: "", label: "", color: "red" as const };
    const count = confirmAction.jobIds.length;
    const plural = count > 1 ? `${count} jobs` : "this job";

    switch (confirmAction.type) {
      case "pause":
        return {
          title: "Pause Job" + (count > 1 ? "s" : ""),
          message: `Are you sure you want to pause ${plural}? The scraping pipeline will save its current progress and can be resumed later.`,
          label: "Pause",
          color: "yellow" as const,
        };
      case "stop":
        return {
          title: "Stop Job" + (count > 1 ? "s" : ""),
          message: `Are you sure you want to stop ${plural}? This will cancel the scraping process. You can still resume from the last checkpoint.`,
          label: "Stop",
          color: "red" as const,
        };
      case "delete":
        return {
          title: "Delete Job" + (count > 1 ? "s" : ""),
          message: `Are you sure you want to permanently delete ${plural}? All associated profiles and data will be removed. This cannot be undone.`,
          label: "Delete",
          color: "red" as const,
        };
    }
  };

  /* ── Execute confirmed action ── */
  const executeAction = async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    setActionError("");

    try {
      const { type, jobIds } = confirmAction;

      if (jobIds.length === 1) {
        // Single action
        const id = jobIds[0];
        if (type === "pause") await jobsApi.pause(id);
        else if (type === "stop") await jobsApi.cancel(id);
        else if (type === "delete") await jobsApi.hardDelete(id);
      } else {
        // Batch action
        await jobsApi.batchAction({ action: type, job_ids: jobIds });
      }

      setConfirmAction(null);
      setSelectedJobs(new Set());
      fetchJobs();
    } catch (err: any) {
      setActionError(err.response?.data?.detail || "Action failed");
    } finally {
      setConfirmLoading(false);
    }
  };

  /* ── Resume handler ── */
  const handleResume = async (jobId: string) => {
    try {
      const retryCount = Number(localStorage.getItem("socybase_scraping_retry_count") || "2");
      const res = await jobsApi.resume(jobId, { profile_retry_count: retryCount });
      router.push(`/jobs/${res.data.id}`);
    } catch (err: any) {
      setActionError(err.response?.data?.detail || "Failed to resume job");
    }
  };

  /* ── Single-job export ── */
  const handleExport = async (jobId: string, format: "csv" | "xlsx" | "facebook-ads") => {
    setExportDropdownId(null);
    try {
      let res;
      if (format === "csv") res = await exportApi.downloadCsv(jobId);
      else if (format === "xlsx") res = await exportApi.downloadXlsx(jobId);
      else res = await exportApi.downloadFbAds(jobId);

      const ext = format === "xlsx" ? "xlsx" : "csv";
      const mime = format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv";
      const blob = new Blob([res.data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `socybase_${format === "facebook-ads" ? "fb_ads_" : "export_"}${jobId.slice(0, 8)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError("Export failed");
    }
  };

  /* ── Batch export ── */
  const handleBatchExport = async () => {
    const completedIds = selectedArr.filter((id) => {
      const j = jobs.find((job) => job.id === id);
      return j && j.status === "completed" && j.result_row_count > 0;
    });
    if (completedIds.length === 0) return;
    try {
      const res = await exportApi.batchExport({ job_ids: completedIds, format: "csv" });
      const blob = new Blob([res.data], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "socybase_batch_export.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError("Batch export failed");
    }
  };

  /* ── Batch resume ── */
  const handleBatchResume = async () => {
    const resumableIds = selectedArr.filter((id) => {
      const j = jobs.find((job) => job.id === id);
      return j && RESUMABLE_STATUSES.includes(j.status);
    });
    if (resumableIds.length === 0) return;
    try {
      await jobsApi.batchAction({ action: "resume", job_ids: resumableIds });
      setSelectedJobs(new Set());
      fetchJobs();
    } catch (err: any) {
      setActionError(err.response?.data?.detail || "Batch resume failed");
    }
  };

  /* ── Batch action helpers ── */
  const selectedArr = Array.from(selectedJobs);
  const canBatchPause = selectedArr.some((id) => {
    const j = jobs.find((job) => job.id === id);
    return j && ACTIVE_STATUSES.includes(j.status);
  });
  const canBatchStop = canBatchPause; // same criteria
  const canBatchDelete = selectedArr.some((id) => {
    const j = jobs.find((job) => job.id === id);
    return j && TERMINAL_STATUSES.includes(j.status);
  });
  const canBatchResume = selectedArr.some((id) => {
    const j = jobs.find((job) => job.id === id);
    return j && RESUMABLE_STATUSES.includes(j.status);
  });
  const canBatchExport = selectedArr.some((id) => {
    const j = jobs.find((job) => job.id === id);
    return j && j.status === "completed" && j.result_row_count > 0;
  });

  const confirmConfig = getConfirmConfig();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">My Jobs</h1>
          <p className="text-white/50 mt-1">All your scraping jobs</p>
        </div>
        <Link href="/jobs/new" className="btn-glow shrink-0 text-center">
          + New Job
        </Link>
      </div>

      {/* Error banner */}
      {actionError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError("")} className="text-red-400/60 hover:text-red-400 ml-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {["", "running", "queued", "paused", "completed", "failed", "cancelled", "scheduled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                statusFilter === s
                  ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
                  : "bg-white/5 text-white/50 border border-white/10 hover:text-white/80"
              }`}
            >
              {s || "All"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "", label: "All Types" },
            { value: "full_pipeline", label: "Comment Scraper" },
            { value: "post_discovery", label: "Post Discovery" },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                typeFilter === t.value
                  ? "bg-accent-purple/20 text-purple-400 border border-accent-purple/30"
                  : "bg-white/5 text-white/50 border border-white/10 hover:text-white/80"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Batch action toolbar */}
      {selectedJobs.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary-500/30 bg-primary-500/5 px-4 py-3">
          <span className="text-sm font-medium text-primary-400">
            {selectedJobs.size} selected
          </span>
          <div className="h-4 w-px bg-white/10" />

          {canBatchPause && (
            <button
              onClick={() =>
                setConfirmAction({
                  type: "pause",
                  jobIds: selectedArr.filter((id) => {
                    const j = jobs.find((job) => job.id === id);
                    return j && ACTIVE_STATUSES.includes(j.status);
                  }),
                })
              }
              className="flex items-center gap-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/20 transition"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </button>
          )}

          {canBatchStop && (
            <button
              onClick={() =>
                setConfirmAction({
                  type: "stop",
                  jobIds: selectedArr.filter((id) => {
                    const j = jobs.find((job) => job.id === id);
                    return j && ACTIVE_STATUSES.includes(j.status);
                  }),
                })
              }
              className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          )}

          {canBatchDelete && (
            <button
              onClick={() =>
                setConfirmAction({
                  type: "delete",
                  jobIds: selectedArr.filter((id) => {
                    const j = jobs.find((job) => job.id === id);
                    return j && TERMINAL_STATUSES.includes(j.status);
                  }),
                })
              }
              className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete
            </button>
          )}

          {canBatchResume && (
            <button
              onClick={handleBatchResume}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
              Resume
            </button>
          )}

          {canBatchExport && (
            <button
              onClick={handleBatchExport}
              className="flex items-center gap-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 text-xs font-medium text-teal-400 hover:bg-teal-500/20 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export ZIP
            </button>
          )}

          <div className="flex-1" />
          <button
            onClick={() => setSelectedJobs(new Set())}
            className="text-white/40 hover:text-white/70 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No jobs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-white/5">
                  {/* Checkbox header */}
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedJobs.size === filteredJobs.length && filteredJobs.length > 0}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    />
                  </th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Input</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Type</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Progress</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Results</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Credits</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Created</th>
                  <th className="text-right text-xs font-medium text-white/40 uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredJobs.map((job) => {
                  const isActive = ACTIVE_STATUSES.includes(job.status);
                  const isTerminal = TERMINAL_STATUSES.includes(job.status);
                  const isResumable = RESUMABLE_STATUSES.includes(job.status);

                  return (
                    <tr
                      key={job.id}
                      className={`hover:bg-white/[0.02] transition ${
                        selectedJobs.has(job.id) ? "bg-primary-500/[0.04]" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedJobs.has(job.id)}
                          onChange={() => toggleJob(job.id)}
                          className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                        />
                      </td>

                      {/* Input */}
                      <td className="px-4 py-4">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="text-sm text-primary-400 hover:text-primary-300 truncate max-w-[200px] block"
                        >
                          {job.input_value.slice(0, 50)}
                          {job.input_value.length > 50 ? "..." : ""}
                        </Link>
                      </td>

                      {/* Type badge */}
                      <td className="px-4 py-4">
                        {(() => {
                          const badge = JOB_TYPE_BADGE[job.job_type] || { label: job.job_type, color: "bg-white/5 text-white/50 border-white/10" };
                          return (
                            <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${badge.color}`}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>

                      {/* Status badge with icon */}
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(
                            job.status
                          )}`}
                        >
                          <StatusIcon status={job.status} />
                          {job.status}
                        </span>
                      </td>

                      {/* Progress */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary-500 to-accent-purple rounded-full transition-all"
                              style={{ width: `${job.progress_pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-white/40">
                            {Number(job.progress_pct).toFixed(0)}%
                          </span>
                        </div>
                      </td>

                      {/* Results */}
                      <td className="px-4 py-4 text-sm text-white/60">
                        {job.result_row_count} {job.job_type === "post_discovery" ? "posts" : "profiles"}
                      </td>

                      {/* Credits */}
                      <td className="px-4 py-4 text-sm text-white/60">
                        {job.credits_used}
                      </td>

                      {/* Created */}
                      <td className="px-4 py-4 text-xs text-white/40">
                        {formatDate(job.created_at)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {/* Pause - running/queued only */}
                          {isActive && (
                            <button
                              onClick={() => setConfirmAction({ type: "pause", jobIds: [job.id] })}
                              title="Pause"
                              className="rounded-lg p-1.5 text-yellow-400/60 hover:text-yellow-400 hover:bg-yellow-500/10 transition"
                            >
                              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                <rect x="6" y="4" width="4" height="16" rx="1" />
                                <rect x="14" y="4" width="4" height="16" rx="1" />
                              </svg>
                            </button>
                          )}

                          {/* Stop - running/queued only */}
                          {isActive && (
                            <button
                              onClick={() => setConfirmAction({ type: "stop", jobIds: [job.id] })}
                              title="Stop"
                              className="rounded-lg p-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition"
                            >
                              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                <rect x="6" y="6" width="12" height="12" rx="1" />
                              </svg>
                            </button>
                          )}

                          {/* Resume - failed/paused only */}
                          {isResumable && (
                            <button
                              onClick={() => handleResume(job.id)}
                              title="Resume"
                              className="rounded-lg p-1.5 text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10 transition"
                            >
                              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5.14v14l11-7-11-7z" />
                              </svg>
                            </button>
                          )}

                          {/* Export dropdown - completed jobs with results */}
                          {job.status === "completed" && job.result_row_count > 0 && (
                            <div className="relative">
                              <button
                                onClick={() => setExportDropdownId(exportDropdownId === job.id ? null : job.id)}
                                title="Export"
                                className="rounded-lg p-1.5 text-teal-400/60 hover:text-teal-400 hover:bg-teal-500/10 transition"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                </svg>
                              </button>
                              {exportDropdownId === job.id && (
                                <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-white/10 bg-[#1a1a2e] shadow-xl py-1">
                                  <button
                                    onClick={() => handleExport(job.id, "csv")}
                                    className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white transition"
                                  >
                                    Export CSV
                                  </button>
                                  <button
                                    onClick={() => handleExport(job.id, "xlsx")}
                                    className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white transition"
                                  >
                                    Export XLSX
                                  </button>
                                  {job.job_type !== "post_discovery" && (
                                    <button
                                      onClick={() => handleExport(job.id, "facebook-ads")}
                                      className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white transition"
                                    >
                                      Export FB Ads
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Logs - any job */}
                          <button
                            onClick={() => setLogJobId(job.id)}
                            title="View Logs"
                            className="rounded-lg p-1.5 text-white/30 hover:text-white/70 hover:bg-white/5 transition"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                          </button>

                          {/* Delete - terminal states only */}
                          {isTerminal && (
                            <button
                              onClick={() => setConfirmAction({ type: "delete", jobIds: [job.id] })}
                              title="Delete"
                              className="rounded-lg p-1.5 text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {jobsTotal > pageSize && (() => {
          const totalPages = Math.ceil(jobsTotal / pageSize);
          const getPageNumbers = () => {
            const pages: (number | "...")[] = [];
            if (totalPages <= 7) {
              for (let i = 1; i <= totalPages; i++) pages.push(i);
            } else {
              pages.push(1);
              if (page > 3) pages.push("...");
              const start = Math.max(2, page - 1);
              const end = Math.min(totalPages - 1, page + 1);
              for (let i = start; i <= end; i++) pages.push(i);
              if (page < totalPages - 2) pages.push("...");
              pages.push(totalPages);
            }
            return pages;
          };
          return (
            <div className="p-4 border-t border-white/5 flex items-center justify-between">
              <p className="text-xs text-white/40">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, jobsTotal)} of {jobsTotal}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                  title="First page"
                  className="px-2 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  &laquo;
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  Prev
                </button>
                {getPageNumbers().map((pg, i) =>
                  pg === "..." ? (
                    <span key={`dots-${i}`} className="text-xs text-white/30 px-1">...</span>
                  ) : (
                    <button
                      key={pg}
                      onClick={() => setPage(pg as number)}
                      className={`px-3 py-1.5 text-xs rounded-lg transition ${
                        page === pg ? "bg-primary-500/20 text-primary-400 font-semibold" : "text-white/40 hover:bg-white/5"
                      }`}
                    >
                      {pg}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  title="Last page"
                  className="px-2 py-1.5 text-xs rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  &raquo;
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Confirmation Modal */}
      <ConfirmModal
        open={confirmAction !== null}
        onConfirm={executeAction}
        onCancel={() => {
          setConfirmAction(null);
          setConfirmLoading(false);
        }}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.label}
        confirmColor={confirmConfig.color}
        loading={confirmLoading}
      />

      {/* Log Viewer Modal */}
      <JobLogModal
        open={logJobId !== null}
        onClose={() => setLogJobId(null)}
        jobId={logJobId || ""}
      />
    </div>
  );
}
