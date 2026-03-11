"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { liveSellApi } from "@/lib/api-client";
import type { LiveSession, LiveComment } from "@/types";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: string, end?: string): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function avatarColor(name: string): string {
  const colors = [
    "from-violet-500 to-purple-600",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-500",
    "from-rose-500 to-pink-500",
    "from-orange-500 to-amber-500",
    "from-indigo-500 to-blue-600",
    "from-fuchsia-500 to-pink-600",
    "from-teal-500 to-cyan-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

type Tab = "all" | "orders";

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const [session, setSession] = useState<LiveSession | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  useEffect(() => {
    loadComments();
  }, [sessionId, tab, page]);

  async function loadSession() {
    try {
      const res = await liveSellApi.getSession(sessionId);
      setSession(res.data);
    } catch {
      // ignore
    }
    setLoading(false);
  }

  async function loadComments() {
    setCommentsLoading(true);
    try {
      const res = await liveSellApi.listComments(sessionId, {
        orders_only: tab === "orders",
        page,
        page_size: pageSize,
      });
      setComments(res.data.comments);
      setTotal(res.data.total);
    } catch {
      // ignore
    }
    setCommentsLoading(false);
  }

  async function exportCSV() {
    try {
      const res = await liveSellApi.exportOrders(sessionId);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `live_orders_${sessionId}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  const totalPages = Math.ceil(total / pageSize);
  const conversionRate =
    session && session.total_comments > 0
      ? ((session.total_orders / session.total_comments) * 100).toFixed(1)
      : "0";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/5 border-t-primary-400" />
        <p className="text-sm text-white/30">Loading session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
          <svg className="h-8 w-8 text-white/[0.07]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-sm text-white/30">Session not found</p>
        <Link
          href="/fb-ads/live-sell"
          className="text-xs text-primary-400 hover:text-primary-300 mt-2 inline-block"
        >
          Back to Live Sell
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/fb-ads/live-sell"
          className="p-1.5 text-white/30 hover:text-white rounded-lg hover:bg-white/5 transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">
              {session.title || `Video ${session.video_id}`}
            </h1>
            <span
              className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-[2px] rounded-sm ${
                session.status === "monitoring"
                  ? "bg-red-500 text-white"
                  : session.status === "completed"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/5 text-white/30"
              }`}
            >
              {session.status}
            </span>
          </div>
          <p className="text-sm text-white/30 mt-0.5">
            {session.started_at ? formatDate(session.started_at) : ""}
          </p>
        </div>
        <button
          onClick={exportCSV}
          className="px-4 py-2 bg-white/[0.03] border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition flex items-center gap-2 font-medium"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export Orders
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-navy-800/40 rounded-xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <svg className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{session.total_comments}</p>
          <p className="text-[10px] text-white/25 mt-0.5">Comments</p>
        </div>

        <div className="bg-gradient-to-br from-amber-500/[0.07] to-transparent rounded-xl border border-amber-500/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-amber-400">{session.total_orders}</p>
          <p className="text-[10px] text-white/25 mt-0.5">Orders</p>
        </div>

        <div className="bg-navy-800/40 rounded-xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{conversionRate}%</p>
          <p className="text-[10px] text-white/25 mt-0.5">Conversion</p>
        </div>

        <div className="bg-navy-800/40 rounded-xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <svg className="h-3.5 w-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-white">
            {session.started_at
              ? formatDuration(session.started_at, session.ended_at ?? undefined)
              : "--"}
          </p>
          <p className="text-[10px] text-white/25 mt-0.5">Duration</p>
        </div>
      </div>

      {/* Comments list */}
      <div className="bg-navy-800/30 rounded-xl border border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <div className="flex gap-1">
            {(["all", "orders"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setPage(1);
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                  tab === t
                    ? t === "orders"
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      : "bg-white/5 text-white/70 border border-white/10"
                    : "text-white/25 hover:text-white/50"
                }`}
              >
                {t === "all"
                  ? `All Comments (${session.total_comments})`
                  : `Orders (${session.total_orders})`}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-white/15">
            {total} {tab === "orders" ? "orders" : "comments"}
          </p>
        </div>

        {commentsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/5 border-t-primary-400" />
          </div>
        ) : comments.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/[0.02] flex items-center justify-center mx-auto mb-3">
              <svg className="h-6 w-6 text-white/[0.06]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-xs text-white/20">
              {tab === "orders" ? "No orders detected" : "No comments recorded"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {comments.map((c) => (
              <div
                key={c.id}
                className={`flex gap-3 px-5 py-3 transition ${
                  c.is_order ? "bg-amber-500/[0.03]" : ""
                }`}
              >
                <div
                  className={`h-8 w-8 rounded-full bg-gradient-to-br ${avatarColor(c.commenter_name)} flex items-center justify-center shrink-0 text-[10px] font-bold text-white shadow-sm`}
                >
                  {c.commenter_name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-white/85">
                      {c.commenter_name}
                    </span>
                    {c.is_order && (
                      <span className="text-[9px] font-black uppercase tracking-widest bg-gradient-to-r from-amber-500 to-orange-500 text-white px-1.5 py-[1px] rounded-sm">
                        ORDER
                      </span>
                    )}
                    {c.matched_keywords?.map((kw) => (
                      <span
                        key={kw}
                        className="text-[9px] bg-white/5 text-white/25 px-1.5 py-[1px] rounded"
                      >
                        {kw}
                      </span>
                    ))}
                    {c.replied && (
                      <span className="text-[10px] text-emerald-400/80 flex items-center gap-0.5">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Replied
                      </span>
                    )}
                    <span className="text-[10px] text-white/15 ml-auto shrink-0">
                      {c.created_at ? timeAgo(c.created_at) : ""}
                    </span>
                  </div>
                  <p className="text-[13px] text-white/50 mt-0.5 leading-relaxed">{c.message}</p>
                  {c.reply_message && (
                    <div className="mt-1.5 flex items-start gap-2 pl-1">
                      <svg className="h-3 w-3 text-primary-400/40 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                      </svg>
                      <p className="text-[11px] text-primary-400/50 italic">{c.reply_message}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
            <p className="text-[11px] text-white/20">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
              {total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs bg-white/[0.03] border border-white/5 rounded-lg text-white/30 hover:bg-white/5 transition disabled:opacity-20"
              >
                Prev
              </button>
              <span className="px-3 py-1.5 text-xs text-white/20">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs bg-white/[0.03] border border-white/5 rounded-lg text-white/30 hover:bg-white/5 transition disabled:opacity-20"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
