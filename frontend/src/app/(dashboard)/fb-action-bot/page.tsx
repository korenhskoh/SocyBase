"use client";

import { useEffect, useState, useCallback } from "react";
import { fbActionApi } from "@/lib/api-client";

// All 13 AKNG fb_action actions
const ACTIONS = [
  {
    name: "get_id",
    label: "Get ID",
    desc: "Get Facebook Group/Page/User ID from URL or username",
    fields: [{ key: "input", label: "URL or Username", required: true, placeholder: "https://facebook.com/page or username" }],
  },
  {
    name: "post_to_my_feed",
    label: "Post to My Feed",
    desc: "Post content, images, or video to your own feed",
    fields: [
      { key: "content", label: "Content", required: true, placeholder: "What's on your mind?", multiline: true },
      { key: "images", label: "Image URLs", required: false, placeholder: "Comma-separated image URLs" },
      { key: "preset_id", label: "Preset ID", required: false, placeholder: "Preset ID (optional)" },
      { key: "video_url", label: "Video URL", required: false, placeholder: "Video URL (overrides images)" },
    ],
  },
  {
    name: "page_post_to_feed",
    label: "Post to Page Feed",
    desc: "Publish a post to your Page's feed",
    fields: [
      { key: "page_id", label: "Page ID", required: true, placeholder: "Facebook page ID" },
      { key: "content", label: "Content", required: true, placeholder: "Post content", multiline: true },
      { key: "images", label: "Image URLs", required: false, placeholder: "Comma-separated image URLs" },
    ],
  },
  {
    name: "post_to_group",
    label: "Post to Group",
    desc: "Post content, images, or video to a group",
    fields: [
      { key: "group_id", label: "Group ID", required: true, placeholder: "Facebook group ID" },
      { key: "content", label: "Content", required: true, placeholder: "Post content", multiline: true },
      { key: "images", label: "Image URLs", required: false, placeholder: "Comma-separated image URLs" },
      { key: "preset_id", label: "Preset ID", required: false, placeholder: "Preset ID (optional)" },
      { key: "video_url", label: "Video URL", required: false, placeholder: "Video URL (overrides images)" },
    ],
  },
  {
    name: "post_reels",
    label: "Post Reels",
    desc: "Upload a video as a Facebook Reel",
    fields: [
      { key: "video_url", label: "Video URL", required: true, placeholder: "Video URL to upload as reel" },
      { key: "content", label: "Caption", required: false, placeholder: "Reel caption" },
    ],
  },
  {
    name: "comment_to_post",
    label: "Comment on Post",
    desc: "Comment on a Facebook post",
    fields: [
      { key: "post_id", label: "Post ID", required: true, placeholder: "Facebook post ID" },
      { key: "content", label: "Comment", required: true, placeholder: "Comment content", multiline: true },
      { key: "image", label: "Image URL", required: false, placeholder: "Image URL or Base64" },
    ],
  },
  {
    name: "page_comment_to_post",
    label: "Comment as Page",
    desc: "Comment on a post as your Page",
    fields: [
      { key: "page_id", label: "Page ID", required: true, placeholder: "Your Facebook page ID" },
      { key: "post_id", label: "Post ID", required: true, placeholder: "Post ID to comment on" },
      { key: "content", label: "Comment", required: true, placeholder: "Comment content", multiline: true },
      { key: "image", label: "Image URL", required: false, placeholder: "Image URL or Base64" },
    ],
  },
  {
    name: "reply_to_comment",
    label: "Reply to Comment",
    desc: "Reply to a comment on a post",
    fields: [
      { key: "parent_post_id", label: "Post ID", required: true, placeholder: "Parent post ID" },
      { key: "comment_id", label: "Comment ID", required: true, placeholder: "Comment ID to reply to" },
      { key: "content", label: "Reply", required: true, placeholder: "Reply content", multiline: true },
      { key: "image", label: "Image URL", required: false, placeholder: "Image URL or Base64" },
    ],
  },
  {
    name: "change_avatar",
    label: "Change Avatar",
    desc: "Change your profile picture",
    fields: [{ key: "image", label: "Image URL", required: true, placeholder: "Image URL or Base64" }],
  },
  {
    name: "change_name",
    label: "Change Name",
    desc: "Change your account name",
    fields: [
      { key: "first", label: "First Name", required: true, placeholder: "First name" },
      { key: "last", label: "Last Name", required: true, placeholder: "Last name" },
      { key: "middle", label: "Middle Name", required: false, placeholder: "Middle name (optional)" },
    ],
  },
  {
    name: "change_bio",
    label: "Change Bio",
    desc: "Change your biography",
    fields: [{ key: "bio", label: "Bio", required: true, placeholder: "New biography content", multiline: true }],
  },
  {
    name: "add_friend",
    label: "Add Friend",
    desc: "Send a friend request",
    fields: [{ key: "uid", label: "User ID", required: true, placeholder: "Facebook user ID" }],
  },
  {
    name: "join_group",
    label: "Join Group",
    desc: "Join a Facebook group",
    fields: [{ key: "group_id", label: "Group ID", required: true, placeholder: "Facebook group ID" }],
  },
] as const;

type ActionName = (typeof ACTIONS)[number]["name"];

interface ActionLog {
  id: string;
  action_name: string;
  action_params: Record<string, unknown>;
  status: string;
  response_data: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string | null;
}

export default function FBActionBotPage() {
  // Config state
  const [hasCookies, setHasCookies] = useState(false);
  const [fbUserId, setFbUserId] = useState<string | null>(null);
  const [userAgent, setUserAgent] = useState("");
  const [proxy, setProxy] = useState({ host: "", port: "", username: "", password: "" });
  const [configLoading, setConfigLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  // Action state
  const [selectedAction, setSelectedAction] = useState<ActionName>("post_to_my_feed");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  // History state
  const [history, setHistory] = useState<ActionLog[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const action = ACTIONS.find((a) => a.name === selectedAction) || ACTIONS[0];

  // Load config
  useEffect(() => {
    fbActionApi.getConfig().then((res) => {
      setHasCookies(res.data.has_cookies);
      setFbUserId(res.data.fb_user_id);
      setUserAgent(res.data.user_agent || "");
      if (res.data.proxy) setProxy(res.data.proxy);
    }).catch(() => {}).finally(() => setConfigLoading(false));
  }, []);

  // Load history
  const loadHistory = useCallback(() => {
    fbActionApi.history({ page: historyPage, page_size: 15 }).then((res) => {
      setHistory(res.data.items || []);
      setHistoryTotal(res.data.total || 0);
    }).catch(() => {});
  }, [historyPage]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Reset form when action changes
  useEffect(() => { setFormValues({}); setResult(null); }, [selectedAction]);

  // Save config
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await fbActionApi.saveConfig({
        user_agent: userAgent || undefined,
        proxy: proxy.host ? proxy : undefined,
      });
      showToast("success", "Config saved");
    } catch {
      showToast("error", "Failed to save config");
    } finally {
      setSavingConfig(false);
    }
  };

  // Execute action
  const handleExecute = async () => {
    // Build params
    const params: Record<string, unknown> = {};
    for (const field of action.fields) {
      const val = formValues[field.key] || "";
      if (field.required && !val.trim()) {
        showToast("error", `${field.label} is required`);
        return;
      }
      if (field.key === "images" && val) {
        params[field.key] = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (val) {
        params[field.key] = val;
      }
    }

    setExecuting(true);
    setResult(null);
    try {
      const res = await fbActionApi.execute({
        action_name: selectedAction,
        params,
        user_agent: userAgent || undefined,
        proxy: proxy.host ? proxy : undefined,
      });
      setResult(res.data);
      if (res.data.success) {
        showToast("success", `Action executed successfully`);
      } else {
        showToast("error", res.data.status_message || "Action failed");
      }
      loadHistory();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Execution failed";
      showToast("error", msg);
    } finally {
      setExecuting(false);
    }
  };

  const timeAgo = (iso: string | null) => {
    if (!iso) return "";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <svg className="h-7 w-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          Facebook Action Bot
        </h1>
        <p className="text-white/40 text-sm mt-1">Automate Facebook actions — post, comment, change profile & more</p>
      </div>

      {/* Config Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Account Config */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
            Account
          </h3>
          {configLoading ? (
            <div className="h-10 rounded bg-white/5 animate-pulse" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${hasCookies ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="text-sm text-white/80">
                  {hasCookies ? `Connected (${fbUserId || "unknown"})` : "No cookies — connect via browser extension"}
                </span>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">User Agent</label>
                <input
                  type="text"
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  placeholder="Optional — browser user agent"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Proxy Config */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
            Proxy (Optional)
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={proxy.host} onChange={(e) => setProxy({ ...proxy, host: e.target.value })} placeholder="Host" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none" />
            <input type="text" value={proxy.port} onChange={(e) => setProxy({ ...proxy, port: e.target.value })} placeholder="Port" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none" />
            <input type="text" value={proxy.username} onChange={(e) => setProxy({ ...proxy, username: e.target.value })} placeholder="Username" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none" />
            <input type="password" value={proxy.password} onChange={(e) => setProxy({ ...proxy, password: e.target.value })} placeholder="Password" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none" />
          </div>
          <button
            onClick={handleSaveConfig}
            disabled={savingConfig}
            className="mt-3 w-full px-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs rounded-lg transition disabled:opacity-50"
          >
            {savingConfig ? "Saving..." : "Save Config"}
          </button>
        </div>
      </div>

      {/* Action Section */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-medium text-white/60 mb-4">Select Action</h3>

        {/* Action Picker */}
        <div className="flex flex-wrap gap-2 mb-5">
          {ACTIONS.map((a) => (
            <button
              key={a.name}
              onClick={() => setSelectedAction(a.name as ActionName)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                selectedAction === a.name
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                  : "border-white/5 bg-white/[0.03] text-white/50 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-white/30 mb-4">{action.desc}</p>

        {/* Dynamic Form Fields */}
        <div className="space-y-3 mb-5">
          {action.fields.map((field) => (
            <div key={field.key}>
              <label className="text-xs text-white/50 block mb-1">
                {field.label} {field.required && <span className="text-amber-400">*</span>}
              </label>
              {"multiline" in field && field.multiline ? (
                <textarea
                  value={formValues[field.key] || ""}
                  onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:border-primary-500 focus:outline-none resize-none"
                />
              ) : (
                <input
                  type="text"
                  value={formValues[field.key] || ""}
                  onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:border-primary-500 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>

        {/* Execute Button */}
        <button
          onClick={handleExecute}
          disabled={executing || !hasCookies}
          className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium text-sm rounded-lg transition hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] disabled:opacity-50 disabled:hover:shadow-none flex items-center gap-2 justify-center"
        >
          {executing ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
              Execute Action
            </>
          )}
        </button>

        {/* Result Panel */}
        {result && (
          <div className={`mt-5 rounded-lg border p-4 ${
            result.success
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              ) : (
                <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              )}
              <span className={`text-sm font-medium ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                {result.success ? "SUCCESS" : (result.status_message as string) || "FAILED"}
              </span>
              {result.status_code != null ? (
                <span className="text-xs text-white/30">Code: {String(result.status_code)}</span>
              ) : null}
            </div>
            {result.data && typeof result.data === "object" ? (
              <div className="space-y-1 text-xs">
                {Object.entries(result.data as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-white/40">{k}:</span>
                    <span className="text-white/80 break-all">{String(v)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Action History */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-medium text-white/60 mb-4 flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Action History
          {historyTotal > 0 && <span className="text-white/30">{historyTotal}</span>}
        </h3>

        {history.length === 0 ? (
          <p className="text-white/30 text-xs text-center py-6">No actions executed yet</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-white/40 text-xs">
                    <th className="text-left py-2 px-3 font-medium">Time</th>
                    <th className="text-left py-2 px-3 font-medium">Action</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((log) => {
                    const actionDef = ACTIONS.find((a) => a.name === log.action_name);
                    const respData = log.response_data as Record<string, unknown> | null;
                    const innerData = respData?.data as Record<string, unknown> | undefined;
                    const resultData = innerData?.data as Record<string, unknown> | undefined;
                    return (
                      <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-3 text-white/40 text-xs whitespace-nowrap">
                          {timeAgo(log.created_at)}
                        </td>
                        <td className="py-2 px-3">
                          <span className="text-xs text-white/70">{actionDef?.label || log.action_name}</span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            log.status === "success"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-red-500/15 text-red-400"
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs text-white/50 max-w-[250px] truncate">
                          {log.status === "success" && resultData
                            ? Object.entries(resultData).map(([k, v]) => `${k}: ${v}`).join(", ")
                            : log.error_message || ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {historyTotal > 15 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                <span className="text-xs text-white/30">
                  Page {historyPage} of {Math.ceil(historyTotal / 15)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={historyPage * 15 >= historyTotal}
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-2xl shadow-black/50 backdrop-blur-md ${
            toast.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10"
              : "border-red-500/20 bg-red-500/10"
          }`}>
            {toast.type === "success" ? (
              <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            ) : (
              <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            )}
            <p className={`text-sm font-medium ${toast.type === "success" ? "text-emerald-300" : "text-red-300"}`}>
              {toast.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
