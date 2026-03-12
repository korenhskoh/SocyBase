"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { liveSellApi } from "@/lib/api-client";
import { useLiveComments, playNotificationSound } from "@/hooks/useLiveComments";
import type { LiveSession, LiveComment } from "@/types";

type View = "idle" | "pick_video" | "monitoring";

interface VideoItem {
  id: string;
  title?: string;
  live_status?: string;
  created_time?: string;
}

// ── Toast notifications ────────────────────────────
interface Toast {
  id: string;
  name: string;
  message: string;
}

function OrderToast({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="animate-slide-in-right flex items-center gap-3 bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/30 backdrop-blur-xl rounded-xl px-4 py-3 shadow-lg shadow-amber-500/10 min-w-[280px]">
      <div className="h-8 w-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
        <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-300 truncate">New Order!</p>
        <p className="text-[11px] text-white/50 truncate">
          <span className="text-white/70">{toast.name}</span> — {toast.message}
        </p>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatDuration(start: string, end?: string): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatTimer(start: string): string {
  const ms = Date.now() - new Date(start).getTime();
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Stable avatar color from name
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


export default function LiveSellPage() {
  const [view, setView] = useState<View>("idle");
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [activeSession, setActiveSession] = useState<LiveSession | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [pageName, setPageName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [ordersSearch, setOrdersSearch] = useState("");
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [timer, setTimer] = useState("0:00");
  const [ordersTab, setOrdersTab] = useState<"orders" | "all">("orders");
  const feedRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Order notification handler
  const handleNewOrder = useCallback(
    (comment: LiveComment) => {
      if (soundEnabled) playNotificationSound("order");
      setToasts((prev) => [
        ...prev,
        { id: comment.id, name: comment.commenter_name, message: comment.message },
      ]);
    },
    [soundEnabled],
  );

  // SSE hook
  const {
    comments: liveComments,
    connected,
    sessionEnded,
    orderCount,
    cpm,
  } = useLiveComments(
    activeSession?.id || "",
    view === "monitoring",
    handleNewOrder,
  );

  // Live timer
  useEffect(() => {
    if (view !== "monitoring" || !activeSession?.started_at) return;
    const interval = setInterval(() => setTimer(formatTimer(activeSession.started_at!)), 1000);
    return () => clearInterval(interval);
  }, [view, activeSession?.started_at]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [liveComments]);

  const handleFeedScroll = useCallback(() => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 80;
  }, []);

  // Session end via SSE
  useEffect(() => {
    if (sessionEnded && activeSession) {
      setActiveSession((s) => (s ? { ...s, status: "stopped" } : s));
    }
  }, [sessionEnded, activeSession]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await liveSellApi.listSessions({ page: 1, page_size: 20 });
      const list: LiveSession[] = res.data.sessions;
      setSessions(list);
      const active = list.find((s: LiveSession) => s.status === "monitoring");
      if (active) {
        setActiveSession(active);
        setView("monitoring");
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }

  async function loadVideos() {
    setLoadingVideos(true);
    setError("");
    try {
      const res = await liveSellApi.listVideos();
      setVideos(res.data.videos || []);
      setPageName(res.data.page_name || "");
      setView("pick_video");
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Failed to load videos";
      setError(msg);
    }
    setLoadingVideos(false);
  }

  async function startSession(video: VideoItem) {
    setStarting(true);
    setError("");
    try {
      const res = await liveSellApi.startSession({
        video_id: video.id,
        title: video.title,
      });
      const session: LiveSession = res.data;
      setActiveSession(session);
      setView("monitoring");
      autoScrollRef.current = true;
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Failed to start session";
      setError(msg);
    }
    setStarting(false);
  }

  async function stopSession() {
    if (!activeSession) return;
    setStopping(true);
    try {
      await liveSellApi.stopSession(activeSession.id);
      setActiveSession((s) => (s ? { ...s, status: "stopped" } : s));
      setView("idle");
      loadSessions();
    } catch {
      // ignore
    }
    setStopping(false);
  }

  async function sendReply(comment: LiveComment) {
    if (!activeSession || !replyText.trim()) return;
    setSendingReply(true);
    try {
      await liveSellApi.replyToComment(
        activeSession.id,
        comment.id,
        replyText.trim(),
      );
      setReplyingTo(null);
      setReplyText("");
    } catch {
      // ignore
    }
    setSendingReply(false);
  }

  async function exportCSV() {
    if (!activeSession) return;
    try {
      const res = await liveSellApi.exportOrders(activeSession.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `live_orders_${activeSession.id}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  const orderComments = liveComments.filter((c) => c.is_order);
  const rightPanelComments = ordersTab === "orders" ? orderComments : liveComments;
  const filteredRightPanel = ordersSearch
    ? rightPanelComments.filter((c) =>
        c.commenter_name.toLowerCase().includes(ordersSearch.toLowerCase()),
      )
    : rightPanelComments;

  // ────────────────────────────────────────────
  // Loading
  // ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="relative">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/5 border-t-primary-400" />
        </div>
        <p className="text-sm text-white/30">Loading sessions...</p>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // MONITORING VIEW
  // ════════════════════════════════════════════
  if (view === "monitoring" && activeSession) {
    const isLive = activeSession.status === "monitoring";

    return (
      <div className="flex flex-col h-[calc(100vh-2rem)]">
        {/* ── Toast notifications ── */}
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((t) => (
            <OrderToast
              key={t.id}
              toast={t}
              onDone={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            />
          ))}
        </div>

        {/* ── Stats header bar ── */}
        <div className="grid grid-cols-6 gap-3 mb-4 shrink-0">
          {/* Live badge + title */}
          <div className="col-span-2 flex items-center gap-3 bg-navy-800/60 rounded-xl border border-white/5 px-4 py-3">
            <div className="relative">
              {isLive && (
                <span className="absolute -inset-1 rounded-full bg-red-500/20 animate-ping" />
              )}
              <span
                className={`relative flex h-3 w-3 rounded-full ${isLive ? "bg-red-500" : "bg-gray-500"}`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-red-400">
                  {isLive ? "LIVE" : "ENDED"}
                </span>
                {connected && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Connected" />
                )}
              </div>
              <p className="text-sm font-medium text-white truncate mt-0.5">
                {activeSession.title || `Video ${activeSession.video_id}`}
              </p>
            </div>
          </div>

          {/* Timer */}
          <div className="bg-navy-800/60 rounded-xl border border-white/5 px-4 py-3 flex flex-col items-center justify-center">
            <p className="text-lg font-mono font-bold text-white tracking-wider">{timer}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Duration</p>
          </div>

          {/* Comments */}
          <div className="bg-navy-800/60 rounded-xl border border-white/5 px-4 py-3 flex flex-col items-center justify-center">
            <p className="text-lg font-bold text-white">{liveComments.length}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Comments</p>
          </div>

          {/* Orders */}
          <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl border border-amber-500/20 px-4 py-3 flex flex-col items-center justify-center">
            <p className="text-lg font-bold text-amber-400">{orderCount}</p>
            <p className="text-[10px] text-amber-400/50 uppercase tracking-wider">Orders</p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 bg-navy-800/60 rounded-xl border border-white/5 px-4 py-3">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition ${soundEnabled ? "bg-white/5 text-white/60" : "bg-white/5 text-white/20"}`}
              title={soundEnabled ? "Mute notifications" : "Enable notifications"}
            >
              {soundEnabled ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
              )}
            </button>
            {isLive ? (
              <button
                onClick={stopSession}
                disabled={stopping}
                className="px-4 py-2 bg-red-500/15 text-red-400 rounded-lg text-xs font-semibold hover:bg-red-500/25 transition disabled:opacity-50 border border-red-500/20"
              >
                {stopping ? (
                  <span className="flex items-center gap-1.5">
                    <div className="animate-spin h-3 w-3 border border-red-400/30 border-t-red-400 rounded-full" />
                    Stopping
                  </span>
                ) : (
                  "Stop Session"
                )}
              </button>
            ) : (
              <button
                onClick={() => {
                  setView("idle");
                  setActiveSession(null);
                  loadSessions();
                }}
                className="px-4 py-2 bg-white/5 text-white/50 rounded-lg text-xs font-medium hover:bg-white/10 transition border border-white/10"
              >
                Back
              </button>
            )}
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* ── Left: Comment Feed ── */}
          <div className="flex-1 flex flex-col bg-navy-800/30 rounded-xl border border-white/5 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white/80">Live Feed</h3>
                {cpm > 0 && (
                  <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
                    {cpm}/min
                  </span>
                )}
              </div>
              {!connected && isLive && (
                <span className="text-[10px] text-amber-400/70 flex items-center gap-1">
                  <div className="animate-spin h-2.5 w-2.5 border border-amber-400/30 border-t-amber-400 rounded-full" />
                  Reconnecting...
                </span>
              )}
            </div>

            <div
              ref={feedRef}
              onScroll={handleFeedScroll}
              className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
            >
              {liveComments.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-white/20">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-3">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium">Waiting for comments...</p>
                  <p className="text-xs text-white/10 mt-1">Comments will appear here in real-time</p>
                </div>
              )}

              {liveComments.map((c, i) => (
                <div
                  key={c.id}
                  className={`group flex gap-2.5 px-3 py-2 rounded-lg transition-all ${
                    c.is_order
                      ? "bg-amber-500/[0.08] border border-amber-500/15"
                      : "hover:bg-white/[0.02]"
                  }`}
                  style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                >
                  <div
                    className={`h-7 w-7 rounded-full bg-gradient-to-br ${avatarColor(c.commenter_name)} flex items-center justify-center shrink-0 text-[10px] font-bold text-white shadow-sm`}
                  >
                    {c.commenter_name?.[0]?.toUpperCase() || "?"}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-semibold text-white/90">
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
                          className="text-[9px] bg-white/5 text-white/30 px-1.5 py-[1px] rounded"
                        >
                          {kw}
                        </span>
                      ))}
                      {c.replied && (
                        <svg className="h-3 w-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className="text-[10px] text-white/15 ml-auto shrink-0">
                        {c.created_at ? timeAgo(c.created_at) : ""}
                      </span>
                    </div>
                    <p className="text-[13px] text-white/55 mt-0.5 break-words leading-relaxed">
                      {c.message}
                    </p>

                    {/* Reply */}
                    {replyingTo === c.id ? (
                      <div className="flex gap-2 mt-2">
                        <input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write a reply..."
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/40 focus:ring-1 focus:ring-primary-500/20"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              sendReply(c);
                            }
                            if (e.key === "Escape") {
                              setReplyingTo(null);
                              setReplyText("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          onClick={() => sendReply(c)}
                          disabled={sendingReply || !replyText.trim()}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition disabled:opacity-40"
                        >
                          {sendingReply ? "..." : "Send"}
                        </button>
                        <button
                          onClick={() => {
                            setReplyingTo(null);
                            setReplyText("");
                          }}
                          className="px-2 text-white/20 hover:text-white/50 text-xs"
                        >
                          Esc
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setReplyingTo(c.id);
                          setReplyText("");
                        }}
                        className="text-[11px] text-white/15 hover:text-primary-400 mt-1 transition opacity-0 group-hover:opacity-100"
                      >
                        Reply
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Scroll to latest */}
            {!autoScrollRef.current && liveComments.length > 5 && (
              <button
                onClick={() => {
                  autoScrollRef.current = true;
                  feedRef.current?.scrollTo({
                    top: feedRef.current.scrollHeight,
                    behavior: "smooth",
                  });
                }}
                className="mx-3 mb-2 py-2 bg-primary-500/10 text-primary-400 rounded-lg text-xs text-center hover:bg-primary-500/20 transition border border-primary-500/10 flex items-center justify-center gap-1.5"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                </svg>
                New comments below
              </button>
            )}
          </div>

          {/* ── Right: Orders / All Panel ── */}
          <div className="w-80 flex flex-col bg-navy-800/30 rounded-xl border border-white/5 shrink-0 overflow-hidden">
            {/* Tabs */}
            <div className="px-3 pt-3 pb-2 border-b border-white/5 shrink-0 space-y-2">
              <div className="flex gap-1">
                <button
                  onClick={() => setOrdersTab("orders")}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                    ordersTab === "orders"
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  Orders
                  <span className="ml-1 text-[10px] opacity-60">{orderCount}</span>
                </button>
                <button
                  onClick={() => setOrdersTab("all")}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                    ordersTab === "all"
                      ? "bg-white/5 text-white/70 border border-white/10"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  All
                  <span className="ml-1 text-[10px] opacity-60">{liveComments.length}</span>
                </button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  <input
                    value={ordersSearch}
                    onChange={(e) => setOrdersSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full bg-white/[0.03] border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-white placeholder:text-white/15 focus:outline-none focus:border-white/10"
                  />
                </div>
                <button
                  onClick={exportCSV}
                  className="px-2.5 py-1.5 bg-white/[0.03] border border-white/5 rounded-lg text-white/25 hover:text-white/50 hover:bg-white/5 transition"
                  title="Export CSV"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {filteredRightPanel.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-white/15">
                  <svg className="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                  <p className="text-xs">
                    {ordersTab === "orders" ? "No orders yet" : "No comments yet"}
                  </p>
                </div>
              )}
              {filteredRightPanel.map((c) => (
                <div
                  key={c.id}
                  className={`p-2.5 rounded-lg border transition ${
                    c.is_order
                      ? "bg-amber-500/[0.05] border-amber-500/10"
                      : "bg-white/[0.01] border-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-5 w-5 rounded-full bg-gradient-to-br ${avatarColor(c.commenter_name)} flex items-center justify-center text-[8px] font-bold text-white`}
                    >
                      {c.commenter_name?.[0]?.toUpperCase() || "?"}
                    </div>
                    <span className="text-xs font-medium text-white/80 truncate flex-1">
                      {c.commenter_name}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.replied && (
                        <svg className="h-3 w-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className="text-[9px] text-white/15">
                        {c.created_at ? timeAgo(c.created_at) : ""}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-white/35 mt-1 line-clamp-2">{c.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // VIDEO PICKER
  // ════════════════════════════════════════════
  if (view === "pick_video") {
    const liveVideos = videos.filter((v) => v.live_status === "LIVE");
    const otherVideos = videos.filter((v) => v.live_status !== "LIVE");

    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView("idle")}
              className="p-1.5 text-white/30 hover:text-white rounded-lg hover:bg-white/5 transition"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Select a Video</h1>
              <p className="text-sm text-white/30 mt-0.5">
                {pageName ? `Page: ${pageName}` : "Choose a video to monitor"}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {error}
          </div>
        )}

        {videos.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-sm text-white/30">No videos found on this page</p>
            <p className="text-xs text-white/15 mt-1">Go live on Facebook first, then come back</p>
          </div>
        )}

        {/* Live videos first */}
        {liveVideos.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-semibold text-red-400/60 uppercase tracking-wider mb-2 px-1">
              Currently Live
            </p>
            <div className="space-y-2">
              {liveVideos.map((v) => (
                <button
                  key={v.id}
                  onClick={() => startSession(v)}
                  disabled={starting}
                  className="w-full flex items-center gap-4 p-4 bg-red-500/[0.04] border border-red-500/10 rounded-xl hover:bg-red-500/[0.08] hover:border-red-500/20 transition text-left disabled:opacity-50 group"
                >
                  <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                    <span className="relative flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500" />
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {v.title || `Video ${v.id}`}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest bg-red-500 text-white px-1.5 py-[2px] rounded-sm">
                        LIVE
                      </span>
                    </div>
                    <p className="text-xs text-white/30 mt-0.5">
                      {v.created_time ? `Started ${timeAgo(v.created_time)}` : ""}
                    </p>
                  </div>
                  <div className="text-xs text-white/20 group-hover:text-primary-400 transition flex items-center gap-1">
                    Monitor
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Other videos */}
        {otherVideos.length > 0 && (
          <div>
            {liveVideos.length > 0 && (
              <p className="text-xs font-semibold text-white/20 uppercase tracking-wider mb-2 px-1">
                Recent Videos
              </p>
            )}
            <div className="space-y-1.5">
              {otherVideos.map((v) => (
                <button
                  key={v.id}
                  onClick={() => startSession(v)}
                  disabled={starting}
                  className="w-full flex items-center gap-4 p-3.5 bg-navy-800/30 border border-white/5 rounded-xl hover:bg-white/[0.03] hover:border-white/10 transition text-left disabled:opacity-50 group"
                >
                  <div className="h-10 w-10 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0">
                    <svg className="h-5 w-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-white/80 truncate block">
                      {v.title || `Video ${v.id}`}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {v.live_status === "LIVE_STOPPED" && (
                        <span className="text-[9px] bg-white/5 text-white/25 px-1.5 py-[1px] rounded">
                          Ended
                        </span>
                      )}
                      <span className="text-[11px] text-white/20">
                        {v.created_time ? timeAgo(v.created_time) : ""}
                      </span>
                    </div>
                  </div>
                  <svg className="h-4 w-4 text-white/10 group-hover:text-white/30 shrink-0 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════
  // IDLE / DASHBOARD
  // ════════════════════════════════════════════
  const totalComments = sessions.reduce((a, s) => a + s.total_comments, 0);
  const totalOrders = sessions.reduce((a, s) => a + s.total_orders, 0);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Sell Helper</h1>
          <p className="text-sm text-white/30 mt-1">
            Monitor live comments, detect orders, and auto-reply in real-time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/fb-ads/live-sell/settings"
            className="p-2.5 bg-white/[0.03] border border-white/5 rounded-xl text-white/30 hover:text-white/60 hover:bg-white/5 transition"
            title="Settings"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
          <button
            onClick={loadVideos}
            disabled={loadingVideos}
            className="px-5 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-semibold hover:from-primary-600 hover:to-primary-700 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50 flex items-center gap-2"
          >
            {loadingVideos ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
            )}
            Start Session
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-3">
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="flex-1">
            <p>{error}</p>
            {(error.toLowerCase().includes("no facebook page") || error.toLowerCase().includes("connect a page") || error.toLowerCase().includes("reconnect")) && (
              <Link
                href="/fb-ads/connect"
                className="text-xs text-primary-400 hover:text-primary-300 mt-1 inline-flex items-center gap-1 transition"
              >
                Go to FB Connection
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Quick stats */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-navy-800/40 rounded-xl border border-white/5 p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary-500/10 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-white">{sessions.length}</p>
              <p className="text-[11px] text-white/30">Sessions</p>
            </div>
          </div>
          <div className="bg-navy-800/40 rounded-xl border border-white/5 p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-white">{totalComments.toLocaleString()}</p>
              <p className="text-[11px] text-white/30">Total Comments</p>
            </div>
          </div>
          <div className="bg-gradient-to-br from-amber-500/[0.07] to-transparent rounded-xl border border-amber-500/10 p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-400">{totalOrders.toLocaleString()}</p>
              <p className="text-[11px] text-white/30">Orders Detected</p>
            </div>
          </div>
        </div>
      )}

      {/* Session list */}
      <div className="bg-navy-800/30 rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70">Recent Sessions</h2>
          {sessions.length > 0 && (
            <span className="text-xs text-white/20">{sessions.length} sessions</span>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/[0.02] to-white/[0.01] flex items-center justify-center mx-auto mb-4 border border-white/[0.03]">
              <svg className="h-10 w-10 text-white/[0.07]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white/25">No sessions yet</p>
            <p className="text-xs text-white/15 mt-1 max-w-xs mx-auto">
              Start your first session to monitor live video comments and detect orders automatically
            </p>
            <button
              onClick={loadVideos}
              disabled={loadingVideos}
              className="mt-4 px-4 py-2 bg-primary-500/10 text-primary-400 rounded-lg text-xs font-medium hover:bg-primary-500/20 transition border border-primary-500/10"
            >
              Get Started
            </button>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={
                  s.status === "monitoring"
                    ? "/fb-ads/live-sell"
                    : `/fb-ads/live-sell/${s.id}`
                }
                onClick={
                  s.status === "monitoring"
                    ? (e) => {
                        e.preventDefault();
                        setActiveSession(s);
                        setView("monitoring");
                      }
                    : undefined
                }
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.015] transition group"
              >
                {/* Status icon */}
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    s.status === "monitoring"
                      ? "bg-red-500/10"
                      : "bg-white/[0.03]"
                  }`}
                >
                  {s.status === "monitoring" ? (
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                    </span>
                  ) : (
                    <svg className="h-4.5 w-4.5 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/80 truncate">
                      {s.title || `Video ${s.video_id}`}
                    </span>
                    {s.status === "monitoring" && (
                      <span className="text-[9px] font-black uppercase tracking-widest bg-red-500 text-white px-1.5 py-[2px] rounded-sm animate-pulse">
                        LIVE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/25">
                    <span>{s.started_at ? timeAgo(s.started_at) : ""}</span>
                    {s.started_at && s.ended_at && (
                      <>
                        <span className="text-white/10">&middot;</span>
                        <span>{formatDuration(s.started_at, s.ended_at)}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-5 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-medium text-white/60">{s.total_comments}</p>
                    <p className="text-[10px] text-white/20">comments</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-amber-400/80">{s.total_orders}</p>
                    <p className="text-[10px] text-white/20">orders</p>
                  </div>
                </div>

                <svg className="h-4 w-4 text-white/[0.06] group-hover:text-white/20 shrink-0 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
