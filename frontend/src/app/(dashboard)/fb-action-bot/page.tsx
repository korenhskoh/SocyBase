"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fbActionApi, competitorsApi } from "@/lib/api-client";

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

interface BatchInfo {
  id: string;
  status: string;
  total_rows: number;
  completed_rows: number;
  success_count: number;
  failed_count: number;
  execution_mode: string;
  delay_seconds: number;
  max_parallel: number;
  error_message?: string;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export default function FBActionBotPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"single" | "batch" | "login" | "ai-planner" | "livestream">("single");

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

  // Batch state
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchMode, setBatchMode] = useState<"sequential" | "concurrent">("sequential");
  const [batchDelay, setBatchDelay] = useState(5);
  const [batchParallel, setBatchParallel] = useState(3);
  const [batchProxy, setBatchProxy] = useState({ host: "", port: "", username: "", password: "" });
  const [batchUploading, setBatchUploading] = useState(false);
  const [activeBatch, setActiveBatch] = useState<BatchInfo | null>(null);
  const [batchHistory, setBatchHistory] = useState<BatchInfo[]>([]);
  const [batchHistoryTotal, setBatchHistoryTotal] = useState(0);
  const [batchHistoryPage, setBatchHistoryPage] = useState(1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Login batch state
  const [loginFile, setLoginFile] = useState<File | null>(null);
  const [loginMode, setLoginMode] = useState<"sequential" | "concurrent">("sequential");
  const [loginDelay, setLoginDelay] = useState(10);
  const [loginParallel, setLoginParallel] = useState(2);
  const [loginProxyPool, setLoginProxyPool] = useState("");
  const [loginUploading, setLoginUploading] = useState(false);
  const [activeLoginBatch, setActiveLoginBatch] = useState<BatchInfo | null>(null);
  const [loginHistory, setLoginHistory] = useState<BatchInfo[]>([]);
  const [loginHistoryTotal, setLoginHistoryTotal] = useState(0);
  const [loginHistoryPage, setLoginHistoryPage] = useState(1);
  const loginPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loginFileInputRef = useRef<HTMLInputElement>(null);
  const [autoGoToBatch, setAutoGoToBatch] = useState(true);

  // AI Planner state
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [plannerStep, setPlannerStep] = useState<1 | 2 | 3 | 4>(1);
  const [plannerSource, setPlannerSource] = useState<"feed" | "quickscan" | "aisearch">("feed");
  const [plannerPosts, setPlannerPosts] = useState<any[]>([]);
  const [plannerPostsLoading, setPlannerPostsLoading] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [plannerActionTypes, setPlannerActionTypes] = useState<Set<string>>(new Set(["comment_to_post"]));
  const [plannerContext, setPlannerContext] = useState("");
  const [plannerActionsPerPost, setPlannerActionsPerPost] = useState(3);
  const [plannerPageId, setPlannerPageId] = useState("");
  const [plannerGroupId, setPlannerGroupId] = useState("");
  const [generatedActions, setGeneratedActions] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [loginBatchOptions, setLoginBatchOptions] = useState<any[]>([]);
  const [selectedLoginBatchId, setSelectedLoginBatchId] = useState("");
  const [plannerFeedDays, setPlannerFeedDays] = useState(90);
  const [plannerFeedSort, setPlannerFeedSort] = useState("virality_score");
  const [plannerScanUrl, setPlannerScanUrl] = useState("");
  const [plannerActionFilter, setPlannerActionFilter] = useState("all");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [plannerRefContent, setPlannerRefContent] = useState("");
  const [plannerImageUrl, setPlannerImageUrl] = useState("");
  // AI Search state
  const [aiSearchPrompt, setAiSearchPrompt] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiSearchKeywords, setAiSearchKeywords] = useState<string[]>([]);
  const [aiSearchPages, setAiSearchPages] = useState<any[]>([]);
  const [aiSelectedPageIds, setAiSelectedPageIds] = useState<Set<string>>(new Set());
  const [aiBulkScanning, setAiBulkScanning] = useState(false);
  const [aiBulkScanProgress, setAiBulkScanProgress] = useState("");
  const [aiExtraKeyword, setAiExtraKeyword] = useState("");
  const [aiLoadingMore, setAiLoadingMore] = useState(false);

  // Livestream Engagement state
  const [liveEngagePhase, setLiveEngagePhase] = useState<"setup" | "running">("setup");
  const [liveEngageSession, setLiveEngageSession] = useState<any>(null);
  const [liveEngageLogs, setLiveEngageLogs] = useState<any[]>([]);
  const [lePostUrl, setLePostUrl] = useState("");
  const [lePostId, setLePostId] = useState("");
  const [leTitle, setLeTitle] = useState("");
  const [leLoginBatchId, setLeLoginBatchId] = useState("");
  const [leRoles, setLeRoles] = useState<Record<string, number>>({
    ask_question: 10, place_order: 10, repeat_question: 20,
    good_vibe: 30, react_comment: 15, share_experience: 15,
  });
  const [leContext, setLeContext] = useState("");
  const [leTrainingComments, setLeTrainingComments] = useState("");
  const [leInstructions, setLeInstructions] = useState("");
  const [leMinDelay, setLeMinDelay] = useState(15);
  const [leMaxDelay, setLeMaxDelay] = useState(60);
  const [leStarting, setLeStarting] = useState(false);
  const lePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */

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

  // Load batch history
  const loadBatchHistory = useCallback(() => {
    fbActionApi.getBatchHistory({ page: batchHistoryPage, page_size: 10 }).then((res) => {
      setBatchHistory(res.data.items || []);
      setBatchHistoryTotal(res.data.total || 0);
    }).catch(() => {});
  }, [batchHistoryPage]);

  useEffect(() => { if (activeTab === "batch") loadBatchHistory(); }, [activeTab, loadBatchHistory]);

  // Poll active batch
  useEffect(() => {
    if (activeBatch && (activeBatch.status === "pending" || activeBatch.status === "running")) {
      pollRef.current = setInterval(() => {
        fbActionApi.getBatchStatus(activeBatch.id).then((res) => {
          setActiveBatch(res.data);
          if (res.data.status !== "pending" && res.data.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
            loadBatchHistory();
          }
        }).catch(() => {});
      }, 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [activeBatch?.id, activeBatch?.status, loadBatchHistory]);

  // Load login batch history
  const loadLoginHistory = useCallback(() => {
    fbActionApi.getLoginBatchHistory({ page: loginHistoryPage, page_size: 10 }).then((res) => {
      setLoginHistory(res.data.items || []);
      setLoginHistoryTotal(res.data.total || 0);
    }).catch(() => {});
  }, [loginHistoryPage]);

  useEffect(() => { if (activeTab === "login") loadLoginHistory(); }, [activeTab, loadLoginHistory]);

  // Poll active login batch
  useEffect(() => {
    if (activeLoginBatch && (activeLoginBatch.status === "pending" || activeLoginBatch.status === "running")) {
      loginPollRef.current = setInterval(() => {
        fbActionApi.getLoginBatchStatus(activeLoginBatch.id).then(async (res) => {
          setActiveLoginBatch(res.data);
          if (res.data.status !== "pending" && res.data.status !== "running") {
            if (loginPollRef.current) clearInterval(loginPollRef.current);
            loadLoginHistory();

            // Auto-download CSV and navigate to Batch Mode
            if (autoGoToBatch && res.data.success_count > 0) {
              try {
                const csvRes = await fbActionApi.exportLoginResults(res.data.id);
                const url = window.URL.createObjectURL(new Blob([csvRes.data]));
                const a = document.createElement("a");
                a.href = url;
                a.download = `login_${res.data.id.slice(0, 8)}_action_ready.csv`;
                a.click();
                window.URL.revokeObjectURL(url);
                setActiveTab("batch");
                showToast("success", `${res.data.success_count} accounts exported — fill in action_name & params, then upload here`);
              } catch {
                showToast("success", `Login done — ${res.data.success_count} successful. Export manually to continue.`);
              }
            }
          }
        }).catch(() => {});
      }, 3000);
      return () => { if (loginPollRef.current) clearInterval(loginPollRef.current); };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLoginBatch?.id, activeLoginBatch?.status, loadLoginHistory, autoGoToBatch]);

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
        showToast("success", "Action executed successfully");
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

  // Batch: download template
  const handleDownloadTemplate = async () => {
    try {
      const res = await fbActionApi.downloadTemplate();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "fb_action_batch_template.csv";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast("error", "Failed to download template");
    }
  };

  // Batch: upload & start
  const handleStartBatch = async () => {
    if (!batchFile) return;
    setBatchUploading(true);
    try {
      const res = await fbActionApi.uploadBatch(batchFile, {
        execution_mode: batchMode,
        delay_seconds: batchDelay,
        max_parallel: batchParallel,
        proxy: batchProxy.host ? batchProxy : undefined,
      });
      setActiveBatch({
        id: res.data.batch_id,
        status: "pending",
        total_rows: res.data.total_actions,
        completed_rows: 0,
        success_count: 0,
        failed_count: 0,
        execution_mode: batchMode,
        delay_seconds: batchDelay,
        max_parallel: batchParallel,
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
      });
      setBatchFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const errs = res.data.errors as string[];
      if (errs && errs.length > 0) {
        showToast("error", `Batch started with ${errs.length} skipped rows`);
      } else {
        showToast("success", `Batch started: ${res.data.total_actions} actions`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Upload failed";
      showToast("error", msg);
    } finally {
      setBatchUploading(false);
    }
  };

  // Batch: cancel
  const handleCancelBatch = async () => {
    if (!activeBatch) return;
    try {
      await fbActionApi.cancelBatch(activeBatch.id);
      setActiveBatch({ ...activeBatch, status: "cancelled" });
      showToast("success", "Batch cancelled");
      loadBatchHistory();
    } catch {
      showToast("error", "Failed to cancel");
    }
  };

  // Batch: export results
  const handleExportBatchResults = async (batchId: string) => {
    try {
      const res = await fbActionApi.exportBatchResults(batchId);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `batch_${batchId.slice(0, 8)}_results.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast("error", "Failed to export results");
    }
  };

  // Login: parse proxy pool textarea
  const parseProxyPool = (text: string) => {
    return text.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split(":");
      return { host: parts[0] || "", port: parts[1] || "", username: parts[2] || "", password: parts[3] || "" };
    });
  };

  // Login: download template
  const handleDownloadLoginTemplate = async () => {
    try {
      const res = await fbActionApi.downloadLoginTemplate();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "fb_login_accounts_template.csv";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast("error", "Failed to download template");
    }
  };

  // Login: start batch
  const handleStartLoginBatch = async () => {
    if (!loginFile) return;
    setLoginUploading(true);
    try {
      const proxyPool = parseProxyPool(loginProxyPool);
      const res = await fbActionApi.uploadLoginBatch(loginFile, {
        execution_mode: loginMode,
        delay_seconds: loginDelay,
        max_parallel: loginParallel,
        proxy_pool: proxyPool.length > 0 ? proxyPool : undefined,
      });
      setActiveLoginBatch({
        id: res.data.batch_id,
        status: "pending",
        total_rows: res.data.total_rows,
        completed_rows: 0,
        success_count: 0,
        failed_count: 0,
        execution_mode: loginMode,
        delay_seconds: loginDelay,
        max_parallel: loginParallel,
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
      });
      setLoginFile(null);
      if (loginFileInputRef.current) loginFileInputRef.current.value = "";
      const errs = res.data.errors as string[];
      if (errs && errs.length > 0) {
        showToast("error", `Login started with ${errs.length} skipped rows`);
      } else {
        showToast("success", `Login batch started: ${res.data.total_rows} accounts`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Upload failed";
      showToast("error", msg);
    } finally {
      setLoginUploading(false);
    }
  };

  // Login: cancel
  const handleCancelLoginBatch = async () => {
    if (!activeLoginBatch) return;
    try {
      await fbActionApi.cancelLoginBatch(activeLoginBatch.id);
      setActiveLoginBatch({ ...activeLoginBatch, status: "cancelled" });
      showToast("success", "Login batch cancelled");
      loadLoginHistory();
    } catch {
      showToast("error", "Failed to cancel");
    }
  };

  // Login: export action-ready CSV
  const handleExportLoginResults = async (batchId: string) => {
    try {
      const res = await fbActionApi.exportLoginResults(batchId);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `login_${batchId.slice(0, 8)}_action_ready.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast("error", "Failed to export");
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

  const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none";

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

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("single")}
          className={`px-5 py-2 text-sm rounded-lg transition font-medium ${
            activeTab === "single"
              ? "bg-white/10 text-white shadow-sm"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          Single Action
        </button>
        <button
          onClick={() => setActiveTab("batch")}
          className={`px-5 py-2 text-sm rounded-lg transition font-medium ${
            activeTab === "batch"
              ? "bg-white/10 text-white shadow-sm"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          Batch Mode
        </button>
        <button
          onClick={() => setActiveTab("login")}
          className={`px-5 py-2 text-sm rounded-lg transition font-medium ${
            activeTab === "login"
              ? "bg-white/10 text-white shadow-sm"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          Bulk Login
        </button>
        <button
          onClick={() => setActiveTab("ai-planner")}
          className={`px-5 py-2 text-sm rounded-lg transition font-medium ${
            activeTab === "ai-planner"
              ? "bg-white/10 text-white shadow-sm"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          AI Planner
        </button>
        <button
          onClick={() => setActiveTab("livestream")}
          className={`px-5 py-2 text-sm rounded-lg transition font-medium ${
            activeTab === "livestream"
              ? "bg-red-500/20 text-red-300 shadow-sm"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          Livestream
        </button>
      </div>

      {/* ═══════════════════ SINGLE ACTION TAB ═══════════════════ */}
      {activeTab === "single" && (
        <>
          {/* Config Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                    <input type="text" value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="Optional — browser user agent" className={inputClass} />
                  </div>
                </div>
              )}
            </div>
            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                Proxy (Optional)
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={proxy.host} onChange={(e) => setProxy({ ...proxy, host: e.target.value })} placeholder="Host" className={inputClass} />
                <input type="text" value={proxy.port} onChange={(e) => setProxy({ ...proxy, port: e.target.value })} placeholder="Port" className={inputClass} />
                <input type="text" value={proxy.username} onChange={(e) => setProxy({ ...proxy, username: e.target.value })} placeholder="Username" className={inputClass} />
                <input type="password" value={proxy.password} onChange={(e) => setProxy({ ...proxy, password: e.target.value })} placeholder="Password" className={inputClass} />
              </div>
              <button onClick={handleSaveConfig} disabled={savingConfig} className="mt-3 w-full px-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs rounded-lg transition disabled:opacity-50">
                {savingConfig ? "Saving..." : "Save Config"}
              </button>
            </div>
          </div>

          {/* Action Section */}
          <div className="glass-card p-6">
            <h3 className="text-sm font-medium text-white/60 mb-4">Select Action</h3>
            <div className="flex flex-wrap gap-2 mb-5">
              {ACTIONS.map((a) => (
                <button key={a.name} onClick={() => setSelectedAction(a.name as ActionName)} className={`px-3 py-1.5 text-xs rounded-lg border transition ${selectedAction === a.name ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-white/5 bg-white/[0.03] text-white/50 hover:text-white/70 hover:bg-white/5"}`}>
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/30 mb-4">{action.desc}</p>
            <div className="space-y-3 mb-5">
              {action.fields.map((field) => (
                <div key={field.key}>
                  <label className="text-xs text-white/50 block mb-1">
                    {field.label} {field.required && <span className="text-amber-400">*</span>}
                  </label>
                  {"multiline" in field && field.multiline ? (
                    <textarea value={formValues[field.key] || ""} onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })} placeholder={field.placeholder} rows={3} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:border-primary-500 focus:outline-none resize-none" />
                  ) : (
                    <input type="text" value={formValues[field.key] || ""} onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })} placeholder={field.placeholder} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:border-primary-500 focus:outline-none" />
                  )}
                </div>
              ))}
            </div>
            <button onClick={handleExecute} disabled={executing || !hasCookies} className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium text-sm rounded-lg transition hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] disabled:opacity-50 disabled:hover:shadow-none flex items-center gap-2 justify-center">
              {executing ? (<><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Executing...</>) : (<><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>Execute Action</>)}
            </button>
            {result && (
              <div className={`mt-5 rounded-lg border p-4 ${result.success ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {result.success ? (
                    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  ) : (
                    <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                  )}
                  <span className={`text-sm font-medium ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                    {result.success ? "SUCCESS" : (result.status_message as string) || "FAILED"}
                  </span>
                  {result.status_code != null ? (<span className="text-xs text-white/30">Code: {String(result.status_code)}</span>) : null}
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
                            <td className="py-2 px-3 text-white/40 text-xs whitespace-nowrap">{timeAgo(log.created_at)}</td>
                            <td className="py-2 px-3"><span className="text-xs text-white/70">{actionDef?.label || log.action_name}</span></td>
                            <td className="py-2 px-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${log.status === "success" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>{log.status}</span>
                            </td>
                            <td className="py-2 px-3 text-xs text-white/50 max-w-[250px] truncate">
                              {log.status === "success" && resultData ? Object.entries(resultData).map(([k, v]) => `${k}: ${v}`).join(", ") : log.error_message || ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {historyTotal > 15 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                    <span className="text-xs text-white/30">Page {historyPage} of {Math.ceil(historyTotal / 15)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage <= 1} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Previous</button>
                      <button onClick={() => setHistoryPage((p) => p + 1)} disabled={historyPage * 15 >= historyTotal} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════ BATCH MODE TAB ═══════════════════ */}
      {activeTab === "batch" && (
        <>
          {/* CSV Upload */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                Upload CSV
              </h3>
              <button onClick={handleDownloadTemplate} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs rounded-lg transition flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                Download Template
              </button>
            </div>

            {/* Drop Zone */}
            <label
              className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                batchFile ? "border-amber-500/40 bg-amber-500/5" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith(".csv")) setBatchFile(f); }}
            >
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setBatchFile(e.target.files[0]); }} />
              {batchFile ? (
                <div className="space-y-1">
                  <p className="text-sm text-amber-300 font-medium">{batchFile.name}</p>
                  <p className="text-xs text-white/40">{(batchFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <svg className="h-8 w-8 text-white/20 mx-auto" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                  <p className="text-xs text-white/40">Drop CSV file here or click to browse</p>
                  <p className="text-xs text-white/20">Each row: cookie, user_agent, action_name, params, repeat_count</p>
                </div>
              )}
            </label>
          </div>

          {/* Execution Settings */}
          <div className="glass-card p-6">
            <h3 className="text-sm font-medium text-white/60 mb-4 flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Execution Settings
            </h3>

            <div className="space-y-4">
              {/* Mode Selector */}
              <div>
                <label className="text-xs text-white/40 block mb-2">Execution Mode</label>
                <div className="flex gap-2">
                  <button onClick={() => setBatchMode("sequential")} className={`flex-1 px-4 py-2.5 text-xs rounded-lg border transition ${batchMode === "sequential" ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-white/5 bg-white/[0.03] text-white/50 hover:bg-white/5"}`}>
                    Sequential (One by One)
                  </button>
                  <button onClick={() => setBatchMode("concurrent")} className={`flex-1 px-4 py-2.5 text-xs rounded-lg border transition ${batchMode === "concurrent" ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-white/5 bg-white/[0.03] text-white/50 hover:bg-white/5"}`}>
                    Concurrent (Parallel)
                  </button>
                </div>
              </div>

              {/* Mode-specific slider */}
              {batchMode === "sequential" ? (
                <div>
                  <label className="text-xs text-white/40 block mb-2">Delay Between Actions: <span className="text-white/70">{batchDelay}s</span></label>
                  <input type="range" min={1} max={30} value={batchDelay} onChange={(e) => setBatchDelay(Number(e.target.value))} className="w-full accent-amber-500" />
                  <div className="flex justify-between text-xs text-white/20 mt-1"><span>1s</span><span>30s</span></div>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-white/40 block mb-2">Max Parallel Workers: <span className="text-white/70">{batchParallel}</span></label>
                  <input type="range" min={1} max={10} value={batchParallel} onChange={(e) => setBatchParallel(Number(e.target.value))} className="w-full accent-amber-500" />
                  <div className="flex justify-between text-xs text-white/20 mt-1"><span>1</span><span>10</span></div>
                </div>
              )}

              {/* Shared Proxy */}
              <div>
                <label className="text-xs text-white/40 block mb-2">Shared Proxy (optional — overridden by per-row proxy columns)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={batchProxy.host} onChange={(e) => setBatchProxy({ ...batchProxy, host: e.target.value })} placeholder="Host" className={inputClass} />
                  <input type="text" value={batchProxy.port} onChange={(e) => setBatchProxy({ ...batchProxy, port: e.target.value })} placeholder="Port" className={inputClass} />
                  <input type="text" value={batchProxy.username} onChange={(e) => setBatchProxy({ ...batchProxy, username: e.target.value })} placeholder="Username" className={inputClass} />
                  <input type="password" value={batchProxy.password} onChange={(e) => setBatchProxy({ ...batchProxy, password: e.target.value })} placeholder="Password" className={inputClass} />
                </div>
              </div>
            </div>

            {/* Start Button */}
            <button
              onClick={handleStartBatch}
              disabled={!batchFile || batchUploading}
              className="mt-5 w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium text-sm rounded-lg transition hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] disabled:opacity-50 disabled:hover:shadow-none flex items-center gap-2 justify-center"
            >
              {batchUploading ? (
                <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Uploading...</>
              ) : (
                <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>Start Batch Execution</>
              )}
            </button>
          </div>

          {/* Active Batch Progress */}
          {activeBatch && (
            <div className="glass-card p-6">
              <h3 className="text-sm font-medium text-white/60 mb-4 flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
                Batch Progress
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  activeBatch.status === "completed" ? "bg-emerald-500/15 text-emerald-400"
                  : activeBatch.status === "failed" ? "bg-red-500/15 text-red-400"
                  : activeBatch.status === "cancelled" ? "bg-yellow-500/15 text-yellow-400"
                  : "bg-blue-500/15 text-blue-400"
                }`}>{activeBatch.status}</span>
              </h3>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="w-full bg-white/5 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                    style={{ width: `${activeBatch.total_rows > 0 ? (activeBatch.completed_rows / activeBatch.total_rows) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs text-white/50">
                  <span>{activeBatch.completed_rows} / {activeBatch.total_rows} actions</span>
                  <span className="flex gap-3">
                    <span className="text-emerald-400">{activeBatch.success_count} success</span>
                    <span className="text-red-400">{activeBatch.failed_count} failed</span>
                  </span>
                </div>
              </div>

              {activeBatch.error_message && (
                <p className="text-xs text-red-400 mb-3">{activeBatch.error_message}</p>
              )}

              <div className="flex gap-2">
                {(activeBatch.status === "pending" || activeBatch.status === "running") && (
                  <button onClick={handleCancelBatch} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg border border-red-500/20 transition">
                    Cancel Batch
                  </button>
                )}
                {(activeBatch.status === "completed" || activeBatch.status === "failed" || activeBatch.status === "cancelled") && (
                  <button onClick={() => handleExportBatchResults(activeBatch.id)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition">
                    Export Results CSV
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Batch History */}
          <div className="glass-card p-6">
            <h3 className="text-sm font-medium text-white/60 mb-4 flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Batch History
              {batchHistoryTotal > 0 && <span className="text-white/30">{batchHistoryTotal}</span>}
            </h3>

            {batchHistory.length === 0 ? (
              <p className="text-white/30 text-xs text-center py-6">No batches executed yet</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-white/40 text-xs">
                        <th className="text-left py-2 px-3 font-medium">Time</th>
                        <th className="text-left py-2 px-3 font-medium">Actions</th>
                        <th className="text-left py-2 px-3 font-medium">Success</th>
                        <th className="text-left py-2 px-3 font-medium">Failed</th>
                        <th className="text-left py-2 px-3 font-medium">Mode</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchHistory.map((b) => (
                        <tr key={b.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="py-2 px-3 text-white/40 text-xs whitespace-nowrap">{timeAgo(b.created_at)}</td>
                          <td className="py-2 px-3 text-xs text-white/70">{b.total_rows}</td>
                          <td className="py-2 px-3 text-xs text-emerald-400">{b.success_count}</td>
                          <td className="py-2 px-3 text-xs text-red-400">{b.failed_count}</td>
                          <td className="py-2 px-3 text-xs text-white/50">{b.execution_mode === "sequential" ? "seq" : "par"}</td>
                          <td className="py-2 px-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              b.status === "completed" ? "bg-emerald-500/15 text-emerald-400"
                              : b.status === "failed" ? "bg-red-500/15 text-red-400"
                              : b.status === "cancelled" ? "bg-yellow-500/15 text-yellow-400"
                              : b.status === "running" ? "bg-blue-500/15 text-blue-400"
                              : "bg-white/10 text-white/40"
                            }`}>{b.status}</span>
                          </td>
                          <td className="py-2 px-3">
                            <button onClick={() => handleExportBatchResults(b.id)} className="text-xs text-white/30 hover:text-white/60 transition" title="Export CSV">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batchHistoryTotal > 10 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                    <span className="text-xs text-white/30">Page {batchHistoryPage} of {Math.ceil(batchHistoryTotal / 10)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setBatchHistoryPage((p) => Math.max(1, p - 1))} disabled={batchHistoryPage <= 1} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Previous</button>
                      <button onClick={() => setBatchHistoryPage((p) => p + 1)} disabled={batchHistoryPage * 10 >= batchHistoryTotal} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════ BULK LOGIN TAB ═══════════════════ */}
      {activeTab === "login" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Upload Card */}
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
                  Upload Accounts CSV
                </h3>
                <button onClick={handleDownloadLoginTemplate} className="text-xs text-primary-400 hover:text-primary-300 transition flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Template
                </button>
              </div>
              <div
                className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-white/20 transition cursor-pointer"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) setLoginFile(f); }}
                onClick={() => loginFileInputRef.current?.click()}
              >
                <input
                  ref={loginFileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setLoginFile(f); }}
                />
                {loginFile ? (
                  <div className="text-sm text-white/70">
                    <span className="text-primary-400 font-medium">{loginFile.name}</span>
                    <span className="text-white/30 ml-2">({(loginFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <div className="text-white/30 text-sm">
                    Drop accounts CSV here or click to browse
                    <div className="text-xs mt-1 text-white/20">Columns: email, password, 2fa_secret, proxy_*</div>
                  </div>
                )}
              </div>
            </div>

            {/* Proxy Pool */}
            <div className="glass-card p-5 space-y-3">
              <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                Shared Proxy Pool (optional)
              </h3>
              <textarea
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-primary-500 focus:outline-none h-28 resize-none font-mono"
                placeholder={"host:port:username:password\nproxy1.com:8080:user1:pass1\nproxy2.com:8080:user2:pass2"}
                value={loginProxyPool}
                onChange={(e) => setLoginProxyPool(e.target.value)}
              />
              <p className="text-xs text-white/20">One proxy per line. Per-row proxies in CSV take priority.</p>
            </div>
          </div>

          {/* Execution Settings */}
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Settings
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-2">Mode</label>
                <div className="flex gap-2">
                  <button onClick={() => setLoginMode("sequential")} className={`flex-1 py-2 text-xs rounded-lg transition ${loginMode === "sequential" ? "bg-primary-500/20 text-primary-300 border border-primary-500/30" : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/10"}`}>Sequential</button>
                  <button onClick={() => setLoginMode("concurrent")} className={`flex-1 py-2 text-xs rounded-lg transition ${loginMode === "concurrent" ? "bg-primary-500/20 text-primary-300 border border-primary-500/30" : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/10"}`}>Concurrent</button>
                </div>
              </div>
              {loginMode === "sequential" ? (
                <div>
                  <label className="text-xs text-white/40 block mb-2">Delay: {loginDelay}s</label>
                  <input type="range" min={3} max={60} value={loginDelay} onChange={(e) => setLoginDelay(Number(e.target.value))} className="w-full accent-primary-500" />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-white/40 block mb-2">Workers: {loginParallel}</label>
                  <input type="range" min={1} max={5} value={loginParallel} onChange={(e) => setLoginParallel(Number(e.target.value))} className="w-full accent-primary-500" />
                </div>
              )}
              <div className="flex flex-col items-end gap-3">
                <label className="flex items-center gap-2 cursor-pointer self-start">
                  <input
                    type="checkbox"
                    checked={autoGoToBatch}
                    onChange={(e) => setAutoGoToBatch(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-amber-500"
                  />
                  <span className="text-xs text-white/40">Auto-load results into Batch Mode when done</span>
                </label>
                <button
                  onClick={handleStartLoginBatch}
                  disabled={!loginFile || loginUploading}
                  className="w-full py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm font-medium rounded-xl border border-amber-500/20 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginUploading ? (
                    <div className="h-4 w-4 border-2 border-amber-300/30 border-t-amber-300 rounded-full animate-spin" />
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                  )}
                  {loginUploading ? "Starting..." : "Start Bulk Login"}
                </button>
              </div>
            </div>
          </div>

          {/* Active Login Progress */}
          {activeLoginBatch && (activeLoginBatch.status === "pending" || activeLoginBatch.status === "running") && (
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/60">Login Progress</h3>
                <button onClick={handleCancelLoginBatch} className="text-xs text-red-400 hover:text-red-300 transition px-3 py-1 rounded-lg border border-red-500/20 hover:border-red-500/30">
                  Cancel
                </button>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/40">
                    {activeLoginBatch.completed_rows} / {activeLoginBatch.total_rows}
                    <span className="ml-3 text-emerald-400">{activeLoginBatch.success_count} ok</span>
                    <span className="ml-2 text-red-400">{activeLoginBatch.failed_count} fail</span>
                  </span>
                  <span className="text-xs text-white/30">
                    {activeLoginBatch.total_rows > 0 ? Math.round((activeLoginBatch.completed_rows / activeLoginBatch.total_rows) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                    style={{ width: `${activeLoginBatch.total_rows > 0 ? (activeLoginBatch.completed_rows / activeLoginBatch.total_rows) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Completed Login Batch Result */}
          {activeLoginBatch && activeLoginBatch.status !== "pending" && activeLoginBatch.status !== "running" && (
            <div className="glass-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/60">Login Complete</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  activeLoginBatch.status === "completed" ? "bg-emerald-500/15 text-emerald-400"
                  : activeLoginBatch.status === "failed" ? "bg-red-500/15 text-red-400"
                  : "bg-yellow-500/15 text-yellow-400"
                }`}>{activeLoginBatch.status}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-emerald-400">{activeLoginBatch.success_count} successful</span>
                <span className="text-red-400">{activeLoginBatch.failed_count} failed</span>
                <span className="text-white/30">of {activeLoginBatch.total_rows} accounts</span>
              </div>
              {activeLoginBatch.success_count > 0 && (
                <button
                  onClick={() => handleExportLoginResults(activeLoginBatch.id)}
                  className="px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs rounded-lg transition border border-emerald-500/20 flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Export Action-Ready CSV
                </button>
              )}
            </div>
          )}

          {/* Login History */}
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Login History
            </h3>

            {loginHistory.length === 0 ? (
              <p className="text-white/30 text-xs text-center py-6">No login batches yet</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-white/40 text-xs">
                        <th className="text-left py-2 px-3 font-medium">Time</th>
                        <th className="text-left py-2 px-3 font-medium">Accounts</th>
                        <th className="text-left py-2 px-3 font-medium">Success</th>
                        <th className="text-left py-2 px-3 font-medium">Failed</th>
                        <th className="text-left py-2 px-3 font-medium">Mode</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginHistory.map((b) => (
                        <tr key={b.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="py-2 px-3 text-white/40 text-xs whitespace-nowrap">{timeAgo(b.created_at)}</td>
                          <td className="py-2 px-3 text-xs text-white/70">{b.total_rows}</td>
                          <td className="py-2 px-3 text-xs text-emerald-400">{b.success_count}</td>
                          <td className="py-2 px-3 text-xs text-red-400">{b.failed_count}</td>
                          <td className="py-2 px-3 text-xs text-white/50">{b.execution_mode === "sequential" ? "seq" : "par"}</td>
                          <td className="py-2 px-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              b.status === "completed" ? "bg-emerald-500/15 text-emerald-400"
                              : b.status === "failed" ? "bg-red-500/15 text-red-400"
                              : b.status === "cancelled" ? "bg-yellow-500/15 text-yellow-400"
                              : b.status === "running" ? "bg-blue-500/15 text-blue-400"
                              : "bg-white/10 text-white/40"
                            }`}>{b.status}</span>
                          </td>
                          <td className="py-2 px-3">
                            {b.success_count > 0 ? (
                              <button onClick={() => handleExportLoginResults(b.id)} className="text-xs text-amber-400/60 hover:text-amber-400 transition flex items-center gap-1" title="Export Action CSV">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                              </button>
                            ) : (
                              <span className="text-xs text-white/10">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {loginHistoryTotal > 10 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                    <span className="text-xs text-white/30">Page {loginHistoryPage} of {Math.ceil(loginHistoryTotal / 10)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setLoginHistoryPage((p) => Math.max(1, p - 1))} disabled={loginHistoryPage <= 1} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Previous</button>
                      <button onClick={() => setLoginHistoryPage((p) => p + 1)} disabled={loginHistoryPage * 10 >= loginHistoryTotal} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════ AI PLANNER TAB ═══════════════════ */}
      {activeTab === "ai-planner" && (
        <>
          {/* Stepper bar */}
          <div className="flex items-center gap-2">
            {[
              { n: 1, label: "Select Source" },
              { n: 2, label: "Pick Posts" },
              { n: 3, label: "Configure" },
              { n: 4, label: "Preview & Export" },
            ].map((s) => (
              <button
                key={s.n}
                onClick={() => s.n <= plannerStep && setPlannerStep(s.n as 1 | 2 | 3 | 4)}
                className={`flex items-center gap-2 px-4 py-2 text-xs rounded-lg transition ${
                  plannerStep === s.n
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                    : plannerStep > s.n
                    ? "bg-white/5 text-emerald-400 border border-white/10 cursor-pointer hover:bg-white/10"
                    : "bg-white/[0.02] text-white/20 border border-white/5 cursor-default"
                }`}
              >
                <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  plannerStep > s.n ? "bg-emerald-500/20" : plannerStep === s.n ? "bg-violet-500/30" : "bg-white/5"
                }`}>{plannerStep > s.n ? "✓" : s.n}</span>
                {s.label}
              </button>
            ))}
          </div>

          {/* ── Step 1: Select Source ─────────────────────── */}
          {plannerStep === 1 && (
            <div className="space-y-4">
              <div className="glass-card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white/60">Post Source</h3>
                <div className="flex gap-2">
                  <button onClick={() => setPlannerSource("feed")} className={`flex-1 py-2.5 text-xs rounded-lg transition border ${plannerSource === "feed" ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"}`}>
                    Competitor Feed
                  </button>
                  <button onClick={() => setPlannerSource("quickscan")} className={`flex-1 py-2.5 text-xs rounded-lg transition border ${plannerSource === "quickscan" ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"}`}>
                    Quick Scan URL
                  </button>
                  <button onClick={() => setPlannerSource("aisearch")} className={`flex-1 py-2.5 text-xs rounded-lg transition border ${plannerSource === "aisearch" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"}`}>
                    AI Search
                  </button>
                </div>

                {plannerSource === "feed" && (
                  <div className="flex items-end gap-3">
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Days</label>
                      <select value={plannerFeedDays} onChange={(e) => setPlannerFeedDays(Number(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none">
                        <option value={30}>30</option>
                        <option value={90}>90</option>
                        <option value={180}>180</option>
                        <option value={365}>365</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Sort</label>
                      <select value={plannerFeedSort} onChange={(e) => setPlannerFeedSort(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none">
                        <option value="virality_score">Virality</option>
                        <option value="reaction_count">Reactions</option>
                        <option value="comment_count">Comments</option>
                        <option value="share_count">Shares</option>
                        <option value="recency">Recent</option>
                      </select>
                    </div>
                    <button
                      disabled={plannerPostsLoading}
                      onClick={async () => {
                        setPlannerPostsLoading(true);
                        try {
                          const res = await competitorsApi.feed({ days: plannerFeedDays, sort_by: plannerFeedSort, page_size: 100 });
                          setPlannerPosts(res.data.items || []);
                          setSelectedPostIds(new Set());
                          if ((res.data.items || []).length === 0) showToast("error", "No posts found — add competitor pages first");
                        } catch { showToast("error", "Failed to load feed"); }
                        finally { setPlannerPostsLoading(false); }
                      }}
                      className="px-5 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-xs rounded-lg border border-violet-500/20 transition disabled:opacity-30 flex items-center gap-2"
                    >
                      {plannerPostsLoading && <div className="h-3 w-3 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" />}
                      Load Posts
                    </button>
                  </div>
                )}

                {plannerSource === "quickscan" && (
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-white/40 block mb-1">Page URL or ID</label>
                      <input
                        value={plannerScanUrl}
                        onChange={(e) => setPlannerScanUrl(e.target.value)}
                        placeholder="https://facebook.com/page or page ID"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none"
                      />
                    </div>
                    <button
                      disabled={plannerPostsLoading || !plannerScanUrl.trim()}
                      onClick={async () => {
                        setPlannerPostsLoading(true);
                        try {
                          let compId: string;
                          try {
                            const addRes = await competitorsApi.add({ input_value: plannerScanUrl.trim(), source: "manual" });
                            compId = addRes.data.id;
                          } catch (addErr: any) {
                            if (addErr?.response?.status === 409) {
                              const listRes = await competitorsApi.list();
                              const existing = listRes.data.items?.find((c: any) =>
                                plannerScanUrl.trim().includes(c.page_id) || c.page_url?.includes(plannerScanUrl.trim().split("/").pop() || "")
                              );
                              if (existing) { compId = existing.id; }
                              else throw addErr;
                            } else throw addErr;
                          }
                          const scanRes = await competitorsApi.quickScan(compId);
                          const posts = scanRes.data.items || scanRes.data.posts || [];
                          setPlannerPosts(posts);
                          setSelectedPostIds(new Set());
                          const scanCreditNote = scanRes.data.credits_used ? ` (${scanRes.data.credits_used} credit used)` : "";
                          if (posts.length === 0) showToast("error", "No posts found for this page");
                          else showToast("success", `Found ${posts.length} posts${scanCreditNote}`);
                        } catch (err: any) {
                          const msg = err?.response?.data?.detail || "Failed to scan page";
                          showToast("error", msg);
                        } finally { setPlannerPostsLoading(false); }
                      }}
                      className="px-5 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-xs rounded-lg border border-violet-500/20 transition disabled:opacity-30 flex items-center gap-2"
                    >
                      {plannerPostsLoading && <div className="h-3 w-3 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" />}
                      Scan
                    </button>
                    <span className="text-[10px] text-white/20 whitespace-nowrap pb-0.5">1 credit</span>
                  </div>
                )}

                {plannerSource === "aisearch" && (
                  <div className="space-y-3">
                    {/* Prompt input */}
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-white/40 block mb-1">Describe what you&apos;re looking for</label>
                        <input
                          value={aiSearchPrompt}
                          onChange={(e) => setAiSearchPrompt(e.target.value)}
                          placeholder="e.g. laptop sellers in Malaysia, kedai baju online..."
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-cyan-500 focus:outline-none"
                          onKeyDown={(e) => { if (e.key === "Enter" && aiSearchPrompt.trim() && !aiSearching) document.getElementById("ai-search-btn")?.click(); }}
                        />
                      </div>
                      <button
                        id="ai-search-btn"
                        disabled={aiSearching || !aiSearchPrompt.trim()}
                        onClick={async () => {
                          setAiSearching(true);
                          setAiSearchPages([]);
                          setAiSearchKeywords([]);
                          setAiSelectedPageIds(new Set());
                          try {
                            const res = await fbActionApi.aiPlanSearchPages({ prompt: aiSearchPrompt.trim() });
                            setAiSearchKeywords(res.data.keywords || []);
                            setAiSearchPages(res.data.pages || []);
                            const creditNote = res.data.credits_used ? ` (${res.data.credits_used} credit used)` : "";
                            if ((res.data.pages || []).length === 0) showToast("error", "No pages found — try different keywords");
                            else showToast("success", `Found ${res.data.pages.length} pages from ${res.data.keywords?.length || 0} keywords${creditNote}`);
                          } catch { showToast("error", "AI search failed"); }
                          finally { setAiSearching(false); }
                        }}
                        className="px-5 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs rounded-lg border border-cyan-500/20 transition disabled:opacity-30 flex items-center gap-2 whitespace-nowrap"
                      >
                        {aiSearching && <div className="h-3 w-3 border-2 border-cyan-300/30 border-t-cyan-300 rounded-full animate-spin" />}
                        Search with AI
                      </button>
                      <span className="text-[10px] text-white/20 whitespace-nowrap">1 credit</span>
                    </div>

                    {/* Keywords display */}
                    {aiSearchKeywords.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] text-white/30 mr-1">Keywords:</span>
                          {aiSearchKeywords.map((kw, i) => (
                            <span key={i} className="group px-2 py-0.5 bg-cyan-500/10 text-cyan-300 text-[10px] rounded-full border border-cyan-500/20 flex items-center gap-1">
                              {kw}
                              <button
                                onClick={() => setAiSearchKeywords(prev => prev.filter((_, idx) => idx !== i))}
                                className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-red-400 transition-opacity"
                              >&times;</button>
                            </span>
                          ))}
                        </div>
                        {/* Add keyword input */}
                        <div className="flex gap-2">
                          <input
                            value={aiExtraKeyword}
                            onChange={(e) => setAiExtraKeyword(e.target.value)}
                            placeholder="Add custom keyword..."
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/20 focus:border-cyan-500 focus:outline-none"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && aiExtraKeyword.trim()) {
                                setAiSearchKeywords(prev => [...prev, aiExtraKeyword.trim()]);
                                setAiExtraKeyword("");
                              }
                            }}
                          />
                          <button
                            disabled={!aiExtraKeyword.trim()}
                            onClick={() => {
                              if (aiExtraKeyword.trim()) {
                                setAiSearchKeywords(prev => [...prev, aiExtraKeyword.trim()]);
                                setAiExtraKeyword("");
                              }
                            }}
                            className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[10px] rounded-lg border border-cyan-500/20 transition disabled:opacity-30"
                          >
                            + Add
                          </button>
                          <button
                            disabled={aiLoadingMore || aiSearchKeywords.length === 0}
                            onClick={async () => {
                              setAiLoadingMore(true);
                              try {
                                const existingIds = aiSearchPages.map((p: any) => p.id);
                                const res = await fbActionApi.aiPlanSearchPages({
                                  prompt: "",
                                  keywords: aiSearchKeywords,
                                  limit_per_keyword: 15,
                                  exclude_ids: existingIds,
                                });
                                const newPages = res.data.pages || [];
                                if (newPages.length > 0) {
                                  setAiSearchPages(prev => [...prev, ...newPages]);
                                  showToast("success", `Found ${newPages.length} more pages`);
                                } else {
                                  showToast("success", "No more new pages found");
                                }
                              } catch { showToast("error", "Failed to load more"); }
                              finally { setAiLoadingMore(false); }
                            }}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 text-[10px] rounded-lg border border-white/10 transition disabled:opacity-30 flex items-center gap-1"
                          >
                            {aiLoadingMore && <div className="h-2.5 w-2.5 border border-white/30 border-t-white/70 rounded-full animate-spin" />}
                            Load More
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Page results */}
                    {aiSearchPages.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white/50">{aiSearchPages.length} pages found</span>
                          <button
                            onClick={() => {
                              if (aiSelectedPageIds.size === aiSearchPages.length) setAiSelectedPageIds(new Set());
                              else setAiSelectedPageIds(new Set(aiSearchPages.map((p: any) => p.id)));
                            }}
                            className="text-[10px] text-cyan-400 hover:text-cyan-300"
                          >
                            {aiSelectedPageIds.size === aiSearchPages.length ? "Deselect All" : "Select All"}
                          </button>
                        </div>
                        <div className="max-h-[280px] overflow-y-auto space-y-1 pr-1">
                          {aiSearchPages.map((page: any) => (
                            <label
                              key={page.id}
                              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${
                                aiSelectedPageIds.has(page.id) ? "bg-cyan-500/10 border-cyan-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={aiSelectedPageIds.has(page.id)}
                                onChange={() => {
                                  const next = new Set(aiSelectedPageIds);
                                  if (next.has(page.id)) next.delete(page.id);
                                  else next.add(page.id);
                                  setAiSelectedPageIds(next);
                                }}
                                className="accent-cyan-500 h-3.5 w-3.5"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-white truncate">{page.name}</p>
                                <p className="text-[10px] text-white/30 truncate">
                                  {page.location || page.link}
                                  {page.verification_status === "blue_verified" && " \u2713"}
                                </p>
                              </div>
                              <span className="text-[9px] text-white/20 shrink-0">{page.matched_keyword}</span>
                            </label>
                          ))}
                        </div>

                        {/* Bulk scan button */}
                        <button
                          disabled={aiSelectedPageIds.size === 0 || aiBulkScanning}
                          onClick={async () => {
                            setAiBulkScanning(true);
                            const selected = aiSearchPages.filter((p: any) => aiSelectedPageIds.has(p.id));
                            const allPosts: any[] = [];
                            let failCount = 0;
                            let totalCredits = 0;

                            for (let i = 0; i < selected.length; i++) {
                              setAiBulkScanProgress(`Scanning page ${i + 1} of ${selected.length}... (${allPosts.length} posts found)`);
                              try {
                                let compId: string;
                                try {
                                  const addRes = await competitorsApi.add({
                                    input_value: selected[i].id,
                                    source: "ai_search",
                                    name: selected[i].name,
                                    page_url: selected[i].link,
                                  });
                                  compId = addRes.data.id;
                                } catch (addErr: any) {
                                  if (addErr?.response?.status === 409) {
                                    const listRes = await competitorsApi.list();
                                    const existing = listRes.data.items?.find((c: any) => c.page_id === selected[i].id);
                                    if (existing) compId = existing.id;
                                    else { failCount++; continue; }
                                  } else { failCount++; continue; }
                                }
                                const scanRes = await competitorsApi.quickScan(compId);
                                const posts = scanRes.data.items || [];
                                allPosts.push(...posts);
                                if (scanRes.data.credits_used) totalCredits += scanRes.data.credits_used;
                              } catch (err: any) {
                                console.error(`[AI Bulk Scan] Failed for page ${selected[i].name} (${selected[i].id}):`, err?.response?.data || err?.message || err);
                                failCount++;
                              }
                            }

                            setPlannerPosts(allPosts);
                            setSelectedPostIds(new Set());
                            setAiBulkScanProgress("");
                            setAiBulkScanning(false);

                            const creditMsg = totalCredits > 0 ? ` (${totalCredits} credits used)` : "";
                            if (allPosts.length > 0) {
                              showToast("success", `Found ${allPosts.length} posts from ${selected.length - failCount} pages${creditMsg}`);
                            } else {
                              showToast("error", `No posts found from selected pages${failCount > 0 ? ` (${failCount} failed)` : ""}`);
                            }
                          }}
                          className="w-full py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs rounded-lg border border-cyan-500/20 transition disabled:opacity-30 flex items-center justify-center gap-2"
                        >
                          {aiBulkScanning && <div className="h-3 w-3 border-2 border-cyan-300/30 border-t-cyan-300 rounded-full animate-spin" />}
                          {aiBulkScanning ? aiBulkScanProgress : `Scan ${aiSelectedPageIds.size} Selected Pages for Posts`}
                        </button>
                        {aiSelectedPageIds.size > 0 && !aiBulkScanning && (
                          <p className="text-[10px] text-white/30 text-center">~{aiSelectedPageIds.size} credit{aiSelectedPageIds.size > 1 ? "s" : ""} will be used for scanning</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {plannerPosts.length > 0 && (
                  <p className="text-xs text-emerald-400">{plannerPosts.length} posts loaded</p>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  disabled={plannerPosts.length === 0}
                  onClick={() => setPlannerStep(2)}
                  className="px-6 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-sm rounded-lg border border-violet-500/20 transition disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Pick Posts ────────────────────────── */}
          {plannerStep === 2 && (
            <div className="space-y-4">
              <div className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white/60">
                    Select Posts
                    <span className="ml-2 text-xs text-violet-400">{selectedPostIds.size} of {plannerPosts.length} selected</span>
                    {selectedPostIds.size >= 20 && <span className="ml-2 text-xs text-yellow-400">(max 20)</span>}
                  </h3>
                  <button
                    onClick={() => {
                      if (selectedPostIds.size === plannerPosts.length || selectedPostIds.size >= 20) {
                        setSelectedPostIds(new Set());
                      } else {
                        setSelectedPostIds(new Set(plannerPosts.slice(0, 20).map((p: any) => p.post_id)));
                      }
                    }}
                    className="text-xs text-white/40 hover:text-white/60 transition"
                  >
                    {selectedPostIds.size > 0 ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="max-h-[500px] overflow-y-auto space-y-1">
                  {plannerPosts.map((p: any) => (
                    <label key={p.post_id} className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition ${selectedPostIds.has(p.post_id) ? "bg-violet-500/10 border border-violet-500/20" : "hover:bg-white/[0.03] border border-transparent"}`}>
                      <input
                        type="checkbox"
                        checked={selectedPostIds.has(p.post_id)}
                        onChange={(e) => {
                          const next = new Set(selectedPostIds);
                          if (e.target.checked) {
                            if (next.size >= 20) return;
                            next.add(p.post_id);
                          } else next.delete(p.post_id);
                          setSelectedPostIds(next);
                        }}
                        className="mt-1 h-3.5 w-3.5 rounded accent-violet-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/70 line-clamp-2">{p.message || p.post_id}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-white/30">
                          {p.from_name && <span>{p.from_name}</span>}
                          <span>{p.reaction_count || 0} reactions</span>
                          <span>{p.comment_count || 0} comments</span>
                          <span>{p.share_count || 0} shares</span>
                          {p.virality_score != null && <span className="text-amber-400/60">🔥 {Math.round(p.virality_score)}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setPlannerStep(1)} className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-lg transition">← Back</button>
                <button
                  disabled={selectedPostIds.size === 0}
                  onClick={() => setPlannerStep(3)}
                  className="px-6 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-sm rounded-lg border border-violet-500/20 transition disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Configure Strategy ───────────────── */}
          {plannerStep === 3 && (
            <div className="space-y-4">
              <div className="glass-card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white/60">Action Types</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "comment_to_post", label: "Comment on Post" },
                    { id: "reply_to_comment", label: "Reply to Comment" },
                    { id: "page_comment_to_post", label: "Comment as Page" },
                    { id: "add_friend", label: "Add Friend" },
                    { id: "post_to_my_feed", label: "Post to My Feed" },
                    { id: "post_to_group", label: "Post to Group" },
                    { id: "join_group", label: "Join Group" },
                  ].map((t) => (
                    <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={plannerActionTypes.has(t.id)}
                        onChange={(e) => {
                          const next = new Set(plannerActionTypes);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          setPlannerActionTypes(next);
                        }}
                        className="h-3.5 w-3.5 rounded accent-violet-500"
                      />
                      <span className="text-xs text-white/60">{t.label}</span>
                    </label>
                  ))}
                </div>

                {plannerActionTypes.has("page_comment_to_post") && (
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Page ID (for page comments)</label>
                    <input value={plannerPageId} onChange={(e) => setPlannerPageId(e.target.value)} placeholder="Your Facebook page ID" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none" />
                  </div>
                )}

                {plannerActionTypes.has("post_to_group") && (
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Group ID (for group posts)</label>
                    <input value={plannerGroupId} onChange={(e) => setPlannerGroupId(e.target.value)} placeholder="Target group ID" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none" />
                  </div>
                )}
              </div>

              <div className="glass-card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white/60">Business Context / Tone</h3>
                <textarea
                  value={plannerContext}
                  onChange={(e) => setPlannerContext(e.target.value)}
                  placeholder="Describe your business, brand voice, and goals. E.g., 'We sell handmade jewelry. Tone: friendly and complimentary. Goal: build awareness.'"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none h-20 resize-none"
                />
              </div>

              <div className="glass-card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white/60">Content & Media (optional)</h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Reference Content</label>
                  <textarea
                    value={plannerRefContent}
                    onChange={(e) => setPlannerRefContent(e.target.value)}
                    placeholder="Optional: provide example content or talking points for AI to use as reference. Leave empty for fully AI-generated content."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none h-16 resize-none"
                  />
                  <p className="text-[10px] text-white/20 mt-1">AI will use this as inspiration — not copy it directly</p>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Image URL (attached to comments/posts)</label>
                  <input
                    value={plannerImageUrl}
                    onChange={(e) => setPlannerImageUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg (optional — applied to all generated actions)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-white/20 mt-1">Attached to comments and posts that support images. Editable per action in step 4.</p>
                </div>
              </div>

              <div className="glass-card p-5 space-y-3">
                <label className="text-xs text-white/40 block">Actions per post: {plannerActionsPerPost}</label>
                <input type="range" min={1} max={5} value={plannerActionsPerPost} onChange={(e) => setPlannerActionsPerPost(Number(e.target.value))} className="w-full accent-violet-500" />
                <p className="text-xs text-white/20">
                  ~{selectedPostIds.size * plannerActionsPerPost * plannerActionTypes.size} actions will be generated · 2 credits for AI generation
                </p>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setPlannerStep(2)} className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-lg transition">← Back</button>
                <button
                  disabled={generating || plannerActionTypes.size === 0}
                  onClick={async () => {
                    setGenerating(true);
                    try {
                      const selected = plannerPosts.filter((p: any) => selectedPostIds.has(p.post_id));
                      // Build business context with reference content
                      let fullContext = plannerContext;
                      if (plannerRefContent.trim()) {
                        fullContext += `\n\nReference content to use as inspiration:\n${plannerRefContent}`;
                      }
                      const res = await fbActionApi.aiPlanGenerate({
                        posts: selected.map((p: any) => ({
                          post_id: p.post_id,
                          message: p.message || null,
                          from_name: p.from_name || null,
                          reaction_count: p.reaction_count || 0,
                          comment_count: p.comment_count || 0,
                          share_count: p.share_count || 0,
                          attachment_type: p.attachment_type || null,
                          post_url: p.post_url || null,
                        })),
                        action_types: Array.from(plannerActionTypes),
                        business_context: fullContext,
                        actions_per_post: plannerActionsPerPost,
                        page_id: plannerPageId || undefined,
                        group_id: plannerGroupId || undefined,
                        include_comments: plannerActionTypes.has("reply_to_comment") || plannerActionTypes.has("add_friend"),
                      });
                      // Attach image URL to actions that support it
                      const imgUrl = plannerImageUrl.trim();
                      const imageActions = new Set(["comment_to_post", "page_comment_to_post", "reply_to_comment", "post_to_my_feed", "post_to_group"]);
                      const actions = (res.data.actions || []).map((a: any, i: number) => ({
                        ...a,
                        _idx: i,
                        _accepted: true,
                        image: imgUrl && imageActions.has(a.action_name) ? imgUrl : (a.image || ""),
                      }));
                      setGeneratedActions(actions);
                      setPlannerActionFilter("all");
                      // Load login batches for export dropdown
                      fbActionApi.aiPlanLoginBatches().then((r) => setLoginBatchOptions(r.data.items || [])).catch(() => {});
                      setPlannerStep(4);
                      const genCreditNote = res.data.credits_used ? ` (${res.data.credits_used} credits used)` : "";
                      showToast("success", `Generated ${actions.length} actions${genCreditNote}`);
                    } catch {
                      showToast("error", "AI generation failed — check OpenAI key");
                    } finally { setGenerating(false); }
                  }}
                  className="px-6 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-sm rounded-lg border border-violet-500/20 transition disabled:opacity-30 flex items-center gap-2"
                >
                  {generating ? (
                    <><div className="h-4 w-4 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" /> Generating...</>
                  ) : (
                    "Generate"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Preview & Export ──────────────────── */}
          {plannerStep === 4 && (
            <div className="space-y-4">
              {/* Filter pills */}
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const counts: Record<string, number> = {};
                  generatedActions.forEach((a) => {
                    counts[a.action_name] = (counts[a.action_name] || 0) + 1;
                  });
                  return (
                    <>
                      <button onClick={() => setPlannerActionFilter("all")} className={`px-3 py-1 text-xs rounded-full transition border ${plannerActionFilter === "all" ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 text-white/40 border-white/10"}`}>
                        All ({generatedActions.length})
                      </button>
                      {Object.entries(counts).map(([name, count]) => (
                        <button key={name} onClick={() => setPlannerActionFilter(name)} className={`px-3 py-1 text-xs rounded-full transition border ${plannerActionFilter === name ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 text-white/40 border-white/10"}`}>
                          {name.replace(/_/g, " ")} ({count})
                        </button>
                      ))}
                    </>
                  );
                })()}
              </div>

              {/* Actions table */}
              <div className="glass-card p-5 space-y-2 max-h-[500px] overflow-y-auto">
                {generatedActions
                  .filter((a) => plannerActionFilter === "all" || a.action_name === plannerActionFilter)
                  .map((a, idx) => (
                    <div key={a._idx} className={`flex items-start gap-3 p-3 rounded-lg border transition ${a._accepted ? "border-white/5 bg-white/[0.02]" : "border-red-500/10 bg-red-500/[0.02] opacity-50"}`}>
                      <input
                        type="checkbox"
                        checked={a._accepted}
                        onChange={() => {
                          const next = [...generatedActions];
                          const realIdx = next.findIndex((x) => x._idx === a._idx);
                          if (realIdx >= 0) next[realIdx] = { ...next[realIdx], _accepted: !next[realIdx]._accepted };
                          setGeneratedActions(next);
                        }}
                        className="mt-1 h-3.5 w-3.5 rounded accent-violet-500"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full mb-1 ${
                          a.action_name === "comment_to_post" ? "bg-blue-500/15 text-blue-400"
                          : a.action_name === "add_friend" ? "bg-green-500/15 text-green-400"
                          : a.action_name === "reply_to_comment" ? "bg-amber-500/15 text-amber-400"
                          : a.action_name === "post_to_my_feed" || a.action_name === "post_to_group" ? "bg-purple-500/15 text-purple-400"
                          : a.action_name === "page_comment_to_post" ? "bg-cyan-500/15 text-cyan-400"
                          : "bg-white/10 text-white/40"
                        }`}>{a.action_name.replace(/_/g, " ")}{a.style ? ` · ${a.style}` : ""}</span>

                        {a.content ? (
                          editingIdx === a._idx ? (
                            <textarea
                              autoFocus
                              value={a.content}
                              onChange={(e) => {
                                const next = [...generatedActions];
                                const realIdx = next.findIndex((x) => x._idx === a._idx);
                                if (realIdx >= 0) next[realIdx] = { ...next[realIdx], content: e.target.value };
                                setGeneratedActions(next);
                              }}
                              onBlur={() => setEditingIdx(null)}
                              className="w-full bg-white/5 border border-violet-500/30 rounded px-2 py-1 text-xs text-white mt-1 resize-none focus:outline-none"
                              rows={2}
                            />
                          ) : (
                            <p className="text-xs text-white/60 mt-0.5 cursor-pointer hover:text-white/80" onClick={() => setEditingIdx(a._idx)}>
                              {a.content}
                              <span className="ml-1 text-white/20">✏</span>
                            </p>
                          )
                        ) : a.uid ? (
                          <p className="text-xs text-white/40 mt-0.5">uid: {a.uid}</p>
                        ) : a.group_id ? (
                          <p className="text-xs text-white/40 mt-0.5">group: {a.group_id}</p>
                        ) : null}

                        {a.post_id && <p className="text-[10px] text-white/20 mt-0.5">post: {a.post_id}</p>}

                        {/* Image URL — editable per action */}
                        {["comment_to_post", "page_comment_to_post", "reply_to_comment", "post_to_my_feed", "post_to_group"].includes(a.action_name) && (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] text-white/15 shrink-0">img:</span>
                            <input
                              value={a.image || ""}
                              onChange={(e) => {
                                const next = [...generatedActions];
                                const realIdx = next.findIndex((x) => x._idx === a._idx);
                                if (realIdx >= 0) next[realIdx] = { ...next[realIdx], image: e.target.value };
                                setGeneratedActions(next);
                              }}
                              placeholder="image URL (optional)"
                              className="flex-1 bg-transparent border-b border-white/5 focus:border-violet-500/30 text-[10px] text-white/30 placeholder-white/10 py-0 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setGeneratedActions((prev) => prev.filter((x) => x._idx !== a._idx))}
                        className="text-white/20 hover:text-red-400 transition text-xs mt-1"
                        title="Remove"
                      >✕</button>
                    </div>
                  ))}
              </div>

              {/* Export section */}
              <div className="glass-card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white/60">Export</h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Merge with login batch</label>
                  <select
                    value={selectedLoginBatchId}
                    onChange={(e) => setSelectedLoginBatchId(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                  >
                    <option value="">None (manual export)</option>
                    {loginBatchOptions.map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {new Date(b.created_at).toLocaleString()} — {b.success_count} accounts
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3">
                  <button
                    disabled={!selectedLoginBatchId || generatedActions.filter((a) => a._accepted).length === 0}
                    onClick={async () => {
                      setGenerating(true);
                      try {
                        const accepted = generatedActions.filter((a) => a._accepted).map(({ _idx, _accepted, style, source_post_message, ...rest }) => rest);
                        const res = await fbActionApi.aiPlanExportCsv({ actions: accepted, login_batch_id: selectedLoginBatchId });
                        const url = window.URL.createObjectURL(new Blob([res.data]));
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "ai_plan_with_cookies.csv";
                        a.click();
                        window.URL.revokeObjectURL(url);
                        showToast("success", `Exported ${accepted.length} actions with cookies — upload to Batch Mode`);
                      } catch { showToast("error", "Export failed"); }
                      finally { setGenerating(false); }
                    }}
                    className="flex-1 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs rounded-lg border border-emerald-500/20 transition disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Export with Cookies
                  </button>
                  <button
                    disabled={generatedActions.filter((a) => a._accepted).length === 0}
                    onClick={async () => {
                      setGenerating(true);
                      try {
                        const accepted = generatedActions.filter((a) => a._accepted).map(({ _idx, _accepted, style, source_post_message, ...rest }) => rest);
                        const res = await fbActionApi.aiPlanExportCsv({ actions: accepted });
                        const url = window.URL.createObjectURL(new Blob([res.data]));
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "ai_plan_actions.csv";
                        a.click();
                        window.URL.revokeObjectURL(url);
                        showToast("success", `Exported ${accepted.length} actions — merge with login CSV manually`);
                      } catch { showToast("error", "Export failed"); }
                      finally { setGenerating(false); }
                    }}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg border border-white/10 transition disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Export CSV Only
                  </button>
                </div>
                <p className="text-[10px] text-white/20">
                  {generatedActions.filter((a) => a._accepted).length} of {generatedActions.length} actions accepted
                </p>
              </div>

              <div className="flex justify-start">
                <button onClick={() => setPlannerStep(3)} className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-lg transition">← Back</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ LIVESTREAM TAB ═══════════════════ */}
      {activeTab === "livestream" && (
        <>
          {liveEngagePhase === "setup" ? (
            <div className="space-y-4 max-w-3xl">
              {/* Target */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                  <svg className="h-4 w-4 text-red-400" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
                  Target Livestream
                </h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Livestream URL (optional — for reference)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="https://facebook.com/page/videos/123..."
                    value={lePostUrl}
                    onChange={(e) => setLePostUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Post ID (required — for commenting)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="Post or video ID"
                    value={lePostId}
                    onChange={(e) => setLePostId(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Session Label (optional)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="e.g. Product Launch Live"
                    value={leTitle}
                    onChange={(e) => setLeTitle(e.target.value)}
                  />
                </div>
              </div>

              {/* Accounts */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60">Accounts</h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Login Batch</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                    value={leLoginBatchId}
                    onChange={(e) => setLeLoginBatchId(e.target.value)}
                  >
                    <option value="">Select a login batch...</option>
                    {loginBatchOptions.map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {b.success_count} accounts — {b.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-white/30 mt-1">1 account monitors comments, rest post comments</p>
                </div>
              </div>

              {/* Role Distribution */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60">Role Distribution (must total 100%)</h3>
                {Object.entries(leRoles).map(([role, pct]) => (
                  <div key={role} className="flex items-center gap-3">
                    <label className="text-xs text-white/50 w-40 capitalize">{role.replace(/_/g, " ")}</label>
                    <input
                      type="range" min={0} max={100} step={5} value={pct}
                      className="flex-1 accent-amber-400"
                      onChange={(e) => setLeRoles((prev) => ({ ...prev, [role]: parseInt(e.target.value) }))}
                    />
                    <span className="text-xs text-white/60 w-10 text-right">{pct}%</span>
                  </div>
                ))}
                <div className={`text-xs font-medium ${Object.values(leRoles).reduce((a, b) => a + b, 0) === 100 ? "text-emerald-400" : "text-red-400"}`}>
                  Total: {Object.values(leRoles).reduce((a, b) => a + b, 0)}%
                  {Object.values(leRoles).reduce((a, b) => a + b, 0) === 100 ? " ✓" : " (must be 100%)"}
                </div>
              </div>

              {/* AI Configuration */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60">AI Configuration</h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Product / Business Context</label>
                  <textarea
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    rows={3}
                    placeholder="We sell handmade jewelry, currently showing our new ring collection..."
                    value={leContext}
                    onChange={(e) => setLeContext(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Upload Past Comments (for AI style training)</label>
                  <textarea
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20 font-mono"
                    rows={4}
                    placeholder={"Paste past comments here, one per line...\nCantik sangat!\n+1 nak beli\nHow much is this ring?"}
                    value={leTrainingComments}
                    onChange={(e) => setLeTrainingComments(e.target.value)}
                  />
                  <div className="flex items-center gap-2 mt-1">
                    <label className="text-xs text-amber-400/80 cursor-pointer hover:text-amber-300">
                      <input
                        type="file"
                        accept=".txt,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              setLeTrainingComments(ev.target?.result as string || "");
                            };
                            reader.readAsText(file);
                          }
                        }}
                      />
                      Or upload .txt / .csv file
                    </label>
                    {leTrainingComments && (
                      <span className="text-xs text-white/30">
                        {leTrainingComments.split("\n").filter(l => l.trim()).length} lines loaded
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">AI Instructions (optional)</label>
                  <textarea
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    rows={2}
                    placeholder="Use Malay language, be excited about products, mention free shipping..."
                    value={leInstructions}
                    onChange={(e) => setLeInstructions(e.target.value)}
                  />
                </div>
              </div>

              {/* Timing */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60">Timing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Min Delay: {leMinDelay}s</label>
                    <input
                      type="range" min={5} max={120} step={5} value={leMinDelay}
                      className="w-full accent-amber-400"
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setLeMinDelay(v);
                        if (v > leMaxDelay) setLeMaxDelay(v);
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Max Delay: {leMaxDelay}s</label>
                    <input
                      type="range" min={10} max={300} step={5} value={leMaxDelay}
                      className="w-full accent-amber-400"
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setLeMaxDelay(v);
                        if (v < leMinDelay) setLeMinDelay(v);
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Start Button */}
              <button
                disabled={leStarting || !lePostId.trim() || !leLoginBatchId || Object.values(leRoles).reduce((a, b) => a + b, 0) !== 100}
                onClick={async () => {
                  setLeStarting(true);
                  try {
                    // Load login batches if not loaded
                    if (!loginBatchOptions.length) {
                      const lbRes = await fbActionApi.aiPlanLoginBatches();
                      setLoginBatchOptions(lbRes.data.batches || []);
                    }
                    const res = await fbActionApi.liveEngageStart({
                      post_id: lePostId.trim(),
                      post_url: lePostUrl.trim() || undefined,
                      title: leTitle.trim() || undefined,
                      login_batch_id: leLoginBatchId,
                      role_distribution: leRoles,
                      business_context: leContext,
                      training_comments: leTrainingComments || undefined,
                      ai_instructions: leInstructions || undefined,
                      min_delay_seconds: leMinDelay,
                      max_delay_seconds: leMaxDelay,
                    });
                    setLiveEngageSession(res.data);
                    setLiveEngagePhase("running");
                    showToast("success", "Livestream engagement started!");

                    // Start polling
                    const sid = res.data.id;
                    lePollRef.current = setInterval(async () => {
                      try {
                        const statusRes = await fbActionApi.liveEngageStatus(sid);
                        setLiveEngageSession(statusRes.data);
                        setLiveEngageLogs(statusRes.data.logs || []);
                        if (statusRes.data.status !== "running") {
                          if (lePollRef.current) clearInterval(lePollRef.current);
                        }
                      } catch { /* ignore poll errors */ }
                    }, 5000);
                  } catch (err: any) {
                    showToast("error", err?.response?.data?.detail || "Failed to start engagement");
                  } finally {
                    setLeStarting(false);
                  }
                }}
                className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-xl font-medium text-sm transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {leStarting ? (
                  <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Starting...</>
                ) : (
                  <>▶ Start Engagement</>
                )}
              </button>
            </div>
          ) : (
            /* ── Live Dashboard ── */
            <div className="space-y-4">
              {/* Header */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${liveEngageSession?.status === "running" ? "bg-red-500 animate-pulse" : "bg-white/20"}`} />
                    <div>
                      <h3 className="text-white font-medium">
                        {liveEngageSession?.title || "Livestream Engagement"}
                        <span className="text-white/40 text-sm ml-2">({liveEngageSession?.status})</span>
                      </h3>
                      <p className="text-white/40 text-xs mt-0.5">
                        {liveEngageSession?.total_comments_posted || 0} posted · {liveEngageSession?.total_errors || 0} errors · {liveEngageSession?.comments_monitored || 0} monitored · {liveEngageSession?.active_accounts || 0} accounts
                      </p>
                    </div>
                  </div>
                  {liveEngageSession?.status === "running" && (
                    <button
                      onClick={async () => {
                        try {
                          await fbActionApi.liveEngageStop(liveEngageSession.id);
                          showToast("success", "Engagement stopped");
                          setLiveEngageSession((prev: any) => prev ? { ...prev, status: "stopped" } : prev);
                          if (lePollRef.current) clearInterval(lePollRef.current);
                        } catch { showToast("error", "Failed to stop"); }
                      }}
                      className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition"
                    >
                      ⏹ Stop
                    </button>
                  )}
                  {liveEngageSession?.status !== "running" && (
                    <button
                      onClick={() => {
                        setLiveEngagePhase("setup");
                        setLiveEngageSession(null);
                        setLiveEngageLogs([]);
                        if (lePollRef.current) clearInterval(lePollRef.current);
                      }}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-sm font-medium transition"
                    >
                      New Session
                    </button>
                  )}
                </div>
              </div>

              {/* Role Stats */}
              <div className="glass-card p-5">
                <h3 className="text-xs font-medium text-white/40 mb-3">Role Stats</h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {Object.entries(liveEngageSession?.comments_by_role || {}).map(([role, count]) => (
                    <div key={role} className="bg-white/5 rounded-lg p-2 text-center">
                      <div className="text-lg font-semibold text-white">{count as number}</div>
                      <div className="text-[10px] text-white/40 capitalize">{role.replace(/_/g, " ")}</div>
                    </div>
                  ))}
                  {Object.keys(liveEngageSession?.comments_by_role || {}).length === 0 && (
                    <p className="text-white/30 text-xs col-span-full">Waiting for first comment...</p>
                  )}
                </div>
              </div>

              {/* Activity Log */}
              <div className="glass-card p-5">
                <h3 className="text-xs font-medium text-white/40 mb-3">Activity Log</h3>
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {liveEngageLogs.length === 0 && (
                    <p className="text-white/30 text-xs">No activity yet...</p>
                  )}
                  {liveEngageLogs.map((log: any) => (
                    <div key={log.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-white/5">
                      <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${log.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <span className="text-amber-400/60 w-28 flex-shrink-0 capitalize">{log.role?.replace(/_/g, " ")}</span>
                      <span className="text-white/30 w-28 flex-shrink-0 truncate">{log.account_email}</span>
                      <span className={`flex-1 truncate ${log.status === "success" ? "text-white/60" : "text-red-400/60"}`}>
                        {log.status === "success" ? log.content : log.error_message || "Error"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-2xl shadow-black/50 backdrop-blur-md ${
            toast.type === "success" ? "border-emerald-500/20 bg-emerald-500/10" : "border-red-500/20 bg-red-500/10"
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
