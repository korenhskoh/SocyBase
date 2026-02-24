"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { jobsApi } from "@/lib/api-client";

/* ── Types ── */
interface LogEntry {
  ts: string;
  level: string;
  stage: string;
  msg: string;
}

interface JobLogModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
}

/* ── Level badge colors ── */
const levelColors: Record<string, { bg: string; text: string }> = {
  info: { bg: "bg-blue-500/20", text: "text-blue-400" },
  warn: { bg: "bg-yellow-500/20", text: "text-yellow-400" },
  error: { bg: "bg-red-500/20", text: "text-red-400" },
};

/* ── Relative-time helper ── */
function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/* ── Component ── */
export default function JobLogModal({ open, onClose, jobId }: JobLogModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Fetch logs when modal opens or jobId changes */
  useEffect(() => {
    if (!open || !jobId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    jobsApi
      .getLogs(jobId)
      .then((res) => {
        if (cancelled) return;
        setLogs(res.data.logs ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.detail ?? "Failed to load logs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  /* Auto-scroll to bottom after logs load */
  useEffect(() => {
    if (!loading && logs.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [loading, logs]);

  /* Close on Escape key */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Glass card */}
      <div
        className="relative flex w-full max-w-2xl mx-4 flex-col rounded-2xl border
                   border-white/10 bg-navy-900/95 backdrop-blur-xl shadow-2xl
                   max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Job Logs</h2>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors
                       hover:bg-white/10 hover:text-white/80"
            aria-label="Close log viewer"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg
                className="h-8 w-8 animate-spin text-primary-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="text-sm text-white/40">Loading logs...</span>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <svg
                className="h-8 w-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <svg
                className="h-8 w-8 text-white/20"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              <span className="text-sm text-white/40">
                No log entries available
              </span>
            </div>
          )}

          {/* Log entries */}
          {!loading && !error && logs.length > 0 && (
            <ul className="space-y-2">
              {logs.map((entry, idx) => {
                const colors =
                  levelColors[entry.level.toLowerCase()] ?? levelColors.info;

                return (
                  <li
                    key={`${entry.ts}-${idx}`}
                    className="flex items-start gap-3 rounded-xl border border-white/5
                               bg-white/[0.03] px-4 py-3"
                  >
                    {/* Timestamp */}
                    <span
                      className="shrink-0 w-16 text-xs text-white/30 pt-0.5"
                      title={new Date(entry.ts).toLocaleString()}
                    >
                      {relativeTime(entry.ts)}
                    </span>

                    {/* Level badge */}
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase
                                  ${colors.bg} ${colors.text}`}
                    >
                      {entry.level}
                    </span>

                    {/* Stage label */}
                    <span className="shrink-0 text-xs font-medium text-white/50 pt-0.5">
                      {entry.stage}
                    </span>

                    {/* Message */}
                    <span className="flex-1 break-all font-mono text-xs leading-relaxed text-white/80">
                      {entry.msg}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
