"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { jobsApi } from "@/lib/api-client";
import { formatDate, formatCredits } from "@/lib/utils";

interface JobReport {
  job_id: string;
  status: string;
  input_value: string;
  input_type: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  credits_used: number;
  total_profiles: number;
  success_profiles: number;
  failed_profiles: number;
  success_rate: number;
  gender_stats: Record<string, number>;
  location_stats: Record<string, number>;
  field_completeness: Record<string, number>;
  total_comments_fetched: number;
  comment_pages_fetched: number;
  unique_user_ids_found: number;
  error_message: string | null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function JobReportPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [report, setReport] = useState<JobReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    jobsApi
      .getReport(jobId)
      .then((r) => setReport(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-20 text-white/40">
        Failed to load report.{" "}
        <Link href={`/jobs/${jobId}`} className="text-primary-400 hover:underline">
          Back to job
        </Link>
      </div>
    );
  }

  const totalGender = Object.values(report.gender_stats).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link href={`/jobs/${jobId}`} className="text-white/40 hover:text-white transition">
            &larr;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Job Report</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7 truncate">{report.input_value}</p>
      </div>

      {/* Status Banner */}
      <div
        className={`glass-card p-4 border-l-4 ${
          report.status === "completed"
            ? "border-l-emerald-500"
            : report.status === "failed"
            ? "border-l-red-500"
            : "border-l-yellow-500"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3">
            {report.status === "completed" ? (
              <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
            <span className="text-white font-medium capitalize">{report.status}</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-white/50">
            {report.started_at && <span>Started: {formatDate(report.started_at)}</span>}
            {report.duration_seconds !== null && (
              <span>Duration: {formatDuration(report.duration_seconds)}</span>
            )}
          </div>
        </div>
        {report.error_message && (
          <p className="text-sm text-red-400/80 mt-2">{report.error_message}</p>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Profiles" value={report.total_profiles} />
        <MetricCard label="Successful" value={report.success_profiles} color="emerald" />
        <MetricCard label="Failed" value={report.failed_profiles} color="red" />
        <MetricCard label="Success Rate" value={`${report.success_rate}%`} color="blue" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Credits Used" value={report.credits_used} />
        <MetricCard label="Comments Found" value={report.total_comments_fetched} />
        <MetricCard label="Comment Pages" value={report.comment_pages_fetched} />
        <MetricCard label="Unique Users" value={report.unique_user_ids_found} />
      </div>

      {/* Gender Distribution */}
      {totalGender > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">
            Gender Distribution
          </h3>
          <div className="space-y-3">
            {Object.entries(report.gender_stats)
              .sort(([, a], [, b]) => b - a)
              .map(([gender, count]) => (
                <div key={gender}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white/70 capitalize">{gender}</span>
                    <span className="text-white/50">
                      {count} ({Math.round((count / totalGender) * 100)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-purple transition-all duration-500"
                      style={{ width: `${(count / totalGender) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Location Distribution */}
      {Object.keys(report.location_stats).length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">
            Top Locations
          </h3>
          <div className="space-y-2">
            {Object.entries(report.location_stats)
              .sort(([, a], [, b]) => b - a)
              .map(([location, count]) => (
                <div key={location} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-white/70 truncate mr-4">{location}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-24 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent-pink"
                        style={{
                          width: `${(count / Math.max(...Object.values(report.location_stats))) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-white/40 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Field Completeness */}
      {report.success_profiles > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">
            Field Completeness
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(report.field_completeness).map(([field, count]) => {
              const pct = Math.round((count / report.success_profiles) * 100);
              return (
                <div key={field} className="text-center">
                  <div className="relative h-16 w-16 mx-auto mb-2">
                    <svg className="h-16 w-16 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth="3"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="url(#gradient)"
                        strokeWidth="3"
                        strokeDasharray={`${pct}, 100`}
                        strokeLinecap="round"
                      />
                      <defs>
                        <linearGradient id="gradient">
                          <stop offset="0%" stopColor="#00AAFF" />
                          <stop offset="100%" stopColor="#7C5CFF" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                      {pct}%
                    </span>
                  </div>
                  <p className="text-xs text-white/50 capitalize">{field}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/jobs/${jobId}`}
          className="text-sm px-4 py-2 rounded-lg font-medium text-primary-400 bg-primary-400/10 border border-primary-400/20 hover:bg-primary-400/20 transition"
        >
          View Job Details
        </Link>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  const colorClass =
    color === "emerald"
      ? "text-emerald-400"
      : color === "red"
      ? "text-red-400"
      : color === "blue"
      ? "text-blue-400"
      : "text-white";

  return (
    <div className="glass-card p-4">
      <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${colorClass}`}>
        {typeof value === "number" ? formatCredits(value) : value}
      </p>
    </div>
  );
}
