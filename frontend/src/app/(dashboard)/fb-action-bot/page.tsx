"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fbActionApi, jobsApi, competitorsApi, creditsApi } from "@/lib/api-client";

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
  result_url: string | null;
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
  results?: Array<{ email: string; status: string; fb_user_id?: string; error_message?: string; has_token?: boolean }>;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export default function FBActionBotPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"single" | "batch" | "livestream">("single");
  const [batchSubTab, setBatchSubTab] = useState<"accounts" | "manual" | "ai-planner" | "warmup">("accounts");

  // Config state
  const [hasCookies, setHasCookies] = useState(false);
  const [fbUserId, setFbUserId] = useState<string | null>(null);
  const [userAgent, setUserAgent] = useState("");
  const [proxy, setProxy] = useState({ host: "", port: "", username: "", password: "" });
  const [configLoading, setConfigLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [cookieCUser, setCookieCUser] = useState("");
  const [cookieXs, setCookieXs] = useState("");
  const [connectingCookies, setConnectingCookies] = useState(false);

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
  const [twoFaWaitSeconds, setTwoFaWaitSeconds] = useState(60);
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [extensionLoginStarted, setExtensionLoginStarted] = useState(false);

  // AI Planner state
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [plannerStep, setPlannerStep] = useState<1 | 2 | 3 | 4>(1);
  const [plannerSource, setPlannerSource] = useState<"myposts" | "quickscan" | "aisearch">("myposts");
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
  const [plannerScanUrl, setPlannerScanUrl] = useState("");
  const [scanHistoryList, setScanHistoryList] = useState<any[]>([]);
  const [scanHistoryOpen, setScanHistoryOpen] = useState(false);
  // My Posts (scraped jobs) state
  const [myJobsList, setMyJobsList] = useState<any[]>([]);
  const [myJobsLoading, setMyJobsLoading] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [plannerActionFilter, setPlannerActionFilter] = useState("all");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [plannerRefContent, setPlannerRefContent] = useState("");
  const [plannerImageUrl, setPlannerImageUrl] = useState("");
  const [useContentDirectly, setUseContentDirectly] = useState(false);
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
  const [aiSearchHistoryList, setAiSearchHistoryList] = useState<any[]>([]);
  const [aiSearchHistoryOpen, setAiSearchHistoryOpen] = useState(false);
  const [creditCostPerAction, setCreditCostPerAction] = useState(3);

  // Livestream Engagement state
  const [liveEngagePhase, setLiveEngagePhase] = useState<"setup" | "running">("setup");
  const [liveEngageSession, setLiveEngageSession] = useState<any>(null);
  const [liveEngageLogs, setLiveEngageLogs] = useState<any[]>([]);
  const [smartSetupUrl, setSmartSetupUrl] = useState("");
  const [smartSetupLoading, setSmartSetupLoading] = useState(false);
  const [smartSetupResult, setSmartSetupResult] = useState<any>(null);
  const [smartSetupStep, setSmartSetupStep] = useState("");
  const [lePostUrl, setLePostUrl] = useState("");
  const [lePostId, setLePostId] = useState("");
  const [leTitle, setLeTitle] = useState("");
  const [leLoginBatchId, setLeLoginBatchId] = useState("");
  const [leAccountSource, setLeAccountSource] = useState<"batch" | "csv">("batch");
  const [leDirectAccounts, setLeDirectAccounts] = useState<any[]>([]);
  const [leRoles, setLeRoles] = useState<Record<string, number>>({
    ask_question: 10, place_order: 10, repeat_question: 20,
    good_vibe: 30, react_comment: 15, share_experience: 15,
  });
  const [leContext, setLeContext] = useState("");
  const [leTrainingComments, setLeTrainingComments] = useState("");
  const [leInstructions, setLeInstructions] = useState("");
  const [leScrapeInterval, setLeScrapeInterval] = useState(8);
  const [leContextWindow, setLeContextWindow] = useState(50);
  const [leAiContextCount, setLeAiContextCount] = useState(15);
  const [lePageOwnerId, setLePageOwnerId] = useState("");
  const [leProductCodes, setLeProductCodes] = useState("");
  const [leCodePattern, setLeCodePattern] = useState("");
  const [leQuantityVariation, setLeQuantityVariation] = useState(true);
  const [leAutoOrderTrending, setLeAutoOrderTrending] = useState(false);
  const [leAutoOrderThreshold, setLeAutoOrderThreshold] = useState(3);
  const [leAutoOrderCooldown, setLeAutoOrderCooldown] = useState(60);
  const [leLanguages, setLeLanguages] = useState<string[]>([]);
  const [leAggressiveLevel, setLeAggressiveLevel] = useState<"low" | "medium" | "high">("medium");
  const [leTargetEnabled, setLeTargetEnabled] = useState(false);
  const [leTargetCount, setLeTargetCount] = useState(100);
  const [leTargetPeriod, setLeTargetPeriod] = useState(60);
  const [leMinDelay, setLeMinDelay] = useState(15);
  const [leMaxDelay, setLeMaxDelay] = useState(60);
  const [leMaxDuration, setLeMaxDuration] = useState(180);
  const [leCommentWithoutNew, setLeCommentWithoutNew] = useState(false);
  const [leCommentWithoutNewMax, setLeCommentWithoutNewMax] = useState(3);
  const [leBlacklistWords, setLeBlacklistWords] = useState("");
  const [leStreamEndEnabled, setLeStreamEndEnabled] = useState(true);
  const [leStreamEndThreshold, setLeStreamEndThreshold] = useState(10);
  const [leScheduledAt, setLeScheduledAt] = useState("");
  const [lePresets, setLePresets] = useState<any[]>([]);
  const [lePreviewSamples, setLePreviewSamples] = useState<any[]>([]);
  const [lePreviewLoading, setLePreviewLoading] = useState(false);
  const [leImportJobs, setLeImportJobs] = useState<any[]>([]);
  const [leImportLoading, setLeImportLoading] = useState(false);
  const [leRecentAccounts, setLeRecentAccounts] = useState<any[]>([]);
  const [leHistory, setLeHistory] = useState<any[]>([]);
  const [leHistoryFilter, setLeHistoryFilter] = useState("");
  const [leHistorySearch, setLeHistorySearch] = useState("");
  const [leTriggerCode, setLeTriggerCode] = useState("");
  const [leTriggerCount, setLeTriggerCount] = useState(5);
  const [leTriggerDuration, setLeTriggerDuration] = useState(2);
  const [leTriggerLoading, setLeTriggerLoading] = useState(false);
  const [leEditSettings, setLeEditSettings] = useState(false);
  const [leStarting, setLeStarting] = useState(false);
  const lePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (lePollRef.current) clearInterval(lePollRef.current);
    };
  }, []);
  // Warm-up Batch state
  const [warmupPreset, setWarmupPreset] = useState<"light" | "medium" | "heavy">("light");
  const [warmupDelay, setWarmupDelay] = useState(10);
  const [warmupLoginBatchId, setWarmupLoginBatchId] = useState("");
  const [warmupLoginBatches, setWarmupLoginBatches] = useState<any[]>([]);
  const [warmupStarting, setWarmupStarting] = useState(false);
  const [warmupActive, setWarmupActive] = useState<{
    id: string; status: string; preset: string;
    total_accounts: number; completed_accounts: number;
    success_count: number; failed_count: number;
    currentEmail?: string | null; currentAction?: string | null;
    startedAt?: number | null;
    accountResults?: Array<{ email: string; success: boolean; actions: string[]; error: string | null }>;
  } | null>(null);
  const [warmupHistory, setWarmupHistory] = useState<any[]>([]);
  const [warmupHistoryTotal, setWarmupHistoryTotal] = useState(0);
  const [warmupHistoryPage, setWarmupHistoryPage] = useState(1);
  const warmupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [warmupLogExpanded, setWarmupLogExpanded] = useState(false);
  const [warmupElapsed, setWarmupElapsed] = useState(0);
  const warmupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Schedule state
  const [warmupScheduleMode, setWarmupScheduleMode] = useState(false);
  const [warmupScheduleAt, setWarmupScheduleAt] = useState("");
  const [scheduledWarmups, setScheduledWarmups] = useState<any[]>([]);
  const scheduledCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // DOM Selector check state
  const [selectorConfig, setSelectorConfig] = useState<any>(null);
  const [selectorChecking, setSelectorChecking] = useState(false);
  const [selectorExpanded, setSelectorExpanded] = useState(false);
  const [domBatchPickerOpen, setDomBatchPickerOpen] = useState(false);
  const [domBatchPickerBatches, setDomBatchPickerBatches] = useState<any[]>([]);
  const [domBatchPickerLoading, setDomBatchPickerLoading] = useState(false);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const showToast = (type: "success" | "error", message: any) => {
    const safeMsg = typeof message === "string" ? message : (message?.message || JSON.stringify(message) || "Unknown error");
    setToast({ type, message: safeMsg });
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
    creditsApi.getCosts().then((res) => {
      if (res.data.credit_cost_per_action) setCreditCostPerAction(res.data.credit_cost_per_action);
    }).catch(() => {});
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

  useEffect(() => { if (activeTab === "batch" && batchSubTab === "manual") loadBatchHistory(); }, [activeTab, batchSubTab, loadBatchHistory]);

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

  useEffect(() => {
    if (activeTab === "batch" && batchSubTab === "accounts") {
      loadLoginHistory();
    }
  }, [activeTab, batchSubTab, loadLoginHistory]);

  // Load warmup history
  const loadWarmupHistory = useCallback(() => {
    fbActionApi.getWarmupBatchHistory({ page: warmupHistoryPage, page_size: 10 }).then((res) => {
      setWarmupHistory(res.data.items || []);
      setWarmupHistoryTotal(res.data.total || 0);
    }).catch(() => {});
  }, [warmupHistoryPage]);

  const loadScheduledWarmups = useCallback(() => {
    fbActionApi.getScheduledWarmups().then((res) => {
      setScheduledWarmups(res.data.items || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "batch" && batchSubTab === "warmup") {
      loadWarmupHistory();
      loadScheduledWarmups();
      // Also load login batch options for the selector
      fbActionApi.getLoginBatchHistory({ page: 1, page_size: 50 }).then((res) => {
        const items = (res.data.items || []).filter((b: any) => b.success_count > 0);
        setWarmupLoginBatches(items);
        if (items.length > 0 && !warmupLoginBatchId) setWarmupLoginBatchId(items[0].id);
      }).catch(() => {});
      // Load current DOM selector config
      fbActionApi.getCurrentSelectors().then((res) => {
        setSelectorConfig(res.data);
      }).catch(() => setSelectorConfig(null));
    }
  }, [activeTab, batchSubTab, warmupHistoryPage, loadWarmupHistory, loadScheduledWarmups]);

  // Load presets when livestream tab is active
  useEffect(() => {
    if (activeTab === "livestream") {
      fbActionApi.liveEngagePresets().then((r) => setLePresets(r.data.presets || [])).catch(() => {});
      fbActionApi.liveEngageHistory({ page: 1, page_size: 20 }).then((r) => setLeHistory(r.data.sessions || [])).catch(() => {});
    }
  }, [activeTab]);

  // Poll active warmup batch
  useEffect(() => {
    if (warmupActive && (warmupActive.status === "pending" || warmupActive.status === "running")) {
      warmupPollRef.current = setInterval(() => {
        fbActionApi.getWarmupBatchStatus(warmupActive.id).then((res) => {
          setWarmupActive(res.data);
          if (res.data.status !== "pending" && res.data.status !== "running") {
            if (warmupPollRef.current) clearInterval(warmupPollRef.current);
            loadWarmupHistory();
          }
        }).catch(() => {});
      }, 3000);
      return () => { if (warmupPollRef.current) clearInterval(warmupPollRef.current); };
    }
  }, [warmupActive?.id, warmupActive?.status, loadWarmupHistory]);

  // Elapsed timer for active warmup
  useEffect(() => {
    if (warmupActive && (warmupActive.status === "running" || warmupActive.status === "pending") && warmupActive.startedAt) {
      const tick = () => setWarmupElapsed(Math.floor((Date.now() - (warmupActive.startedAt || Date.now())) / 1000));
      tick();
      warmupTimerRef.current = setInterval(tick, 1000);
      return () => { if (warmupTimerRef.current) clearInterval(warmupTimerRef.current); };
    } else {
      setWarmupElapsed(0);
    }
  }, [warmupActive?.id, warmupActive?.status, warmupActive?.startedAt]);

  // Auto-trigger scheduled warmups
  useEffect(() => {
    if (activeTab !== "batch" || batchSubTab !== "warmup") return;
    scheduledCheckRef.current = setInterval(() => {
      if (!extensionDetected || warmupActive) return;
      const now = new Date();
      const due = scheduledWarmups.find((s: any) => new Date(s.scheduled_at) <= now);
      if (due) {
        setWarmupActive({ id: due.id, status: "pending", preset: due.preset, total_accounts: due.total_accounts, completed_accounts: 0, success_count: 0, failed_count: 0 });
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const authToken = localStorage.getItem("access_token") || "";
        window.postMessage({ type: "SOCYBASE_START_WARMUP_BATCH", batchId: due.id, apiUrl, authToken }, "*");
        setScheduledWarmups((prev: any[]) => prev.filter((s: any) => s.id !== due.id));
        showToast("success", `Scheduled warm-up started: ${due.preset}`);
      }
    }, 30000);
    return () => { if (scheduledCheckRef.current) clearInterval(scheduledCheckRef.current); };
  }, [activeTab, batchSubTab, extensionDetected, warmupActive, scheduledWarmups]);

  // Detect Chrome extension
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "SOCYBASE_EXTENSION_INSTALLED") {
        setExtensionDetected(true);
        // Auto-connect extension with API credentials so it's ready for login batches
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const authToken = localStorage.getItem("access_token") || "";
        if (apiUrl && authToken) {
          window.postMessage({ type: "SOCYBASE_EXTENSION_CONNECT", apiUrl, authToken }, "*");
        }
      }
      if (event.data?.type === "SOCYBASE_EXTENSION_LOGIN_STARTED") {
        if (event.data.success) {
          setExtensionLoginStarted(true);
          showToast("success", "Login started via Chrome extension");
        } else {
          showToast("error", event.data.error || "Failed to start extension login");
        }
      }
      if (event.data?.type === "SOCYBASE_LOGIN_PROGRESS" && event.data.progress) {
        const p = event.data.progress;
        if (activeLoginBatch && p.batchId === activeLoginBatch.id) {
          setActiveLoginBatch(prev => prev ? {
            ...prev,
            completed_rows: p.current,
            success_count: p.success,
            failed_count: p.failed,
            status: p.status === "completed" || p.status === "cancelled" ? p.status : prev.status,
          } : prev);
        }
      }
      if (event.data?.type === "SOCYBASE_WARMUP_PROGRESS" && event.data.progress) {
        const p = event.data.progress;
        setWarmupActive(prev => prev && p.batchId === prev.id ? {
          ...prev,
          completed_accounts: p.current,
          success_count: p.success,
          failed_count: p.failed,
          status: p.status === "completed" || p.status === "cancelled" || p.status === "failed" ? p.status : prev.status,
          currentEmail: p.currentEmail || null,
          currentAction: p.currentAction || null,
          startedAt: p.startedAt || prev.startedAt,
          accountResults: p.accountResults || prev.accountResults,
        } : prev);
      }
      if (event.data?.type === "SOCYBASE_WARMUP_STARTED") {
        if (!event.data.success) {
          showToast("error", event.data.error || "Failed to start warm-up via extension");
        }
      }
      // DOM check results
      if (event.data?.type === "SOCYBASE_DOM_CHECK_STARTED") {
        if (!event.data.success) {
          setSelectorChecking(false);
          showToast("error", event.data.error || "Failed to start DOM check");
        }
      }
      if (event.data?.type === "SOCYBASE_DOM_CHECK_COMPLETE") {
        setSelectorChecking(false);
        if (event.data.success && event.data.result) {
          showToast("success", `Selectors verified — confidence ${Math.round((event.data.result.confidence || 0) * 100)}%`);
          // Reload full config from API (includes verified_at, verified_by)
          fbActionApi.getCurrentSelectors().then((res) => {
            setSelectorConfig(res.data);
          }).catch(() => setSelectorConfig(event.data.result));
        } else {
          showToast("error", event.data.error || "DOM check failed");
        }
      }
    }
    window.addEventListener("message", handleMessage);
    // Ping extension to check if installed
    window.postMessage({ type: "SOCYBASE_EXTENSION_PING" }, "*");
    return () => window.removeEventListener("message", handleMessage);
  }, [activeLoginBatch, showToast]);

  // Poll active login batch
  useEffect(() => {
    if (activeLoginBatch && (activeLoginBatch.status === "pending" || activeLoginBatch.status === "running")) {
      loginPollRef.current = setInterval(() => {
        fbActionApi.getLoginBatchStatus(activeLoginBatch.id).then(async (res) => {
          setActiveLoginBatch(res.data);
          if (res.data.status !== "pending" && res.data.status !== "running") {
            if (loginPollRef.current) clearInterval(loginPollRef.current);
            setExtensionLoginStarted(false);
            loadLoginHistory();

            // Auto-download CSV after all accounts logged in
            if (autoGoToBatch && res.data.success_count > 0) {
              try {
                const csvRes = await fbActionApi.exportLoginResults(res.data.id);
                const url = window.URL.createObjectURL(new Blob([csvRes.data]));
                const a = document.createElement("a");
                a.href = url;
                a.download = `login_${res.data.id.slice(0, 8)}_action_ready.csv`;
                a.click();
                window.URL.revokeObjectURL(url);
                showToast("success", `${res.data.success_count} accounts CSV downloaded successfully`);
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

  // Connect with cookies (manual c_user + xs)
  const handleConnectCookies = async () => {
    if (!cookieCUser.trim() || !cookieXs.trim()) {
      showToast("error", "Both c_user and xs are required");
      return;
    }
    setConnectingCookies(true);
    try {
      const res = await fbActionApi.connectCookies({
        c_user: cookieCUser.trim(),
        xs: cookieXs.trim(),
        user_agent: userAgent || undefined,
      });
      setHasCookies(true);
      setFbUserId(res.data.fb_user_id);
      setCookieCUser("");
      setCookieXs("");
      showToast("success", `Connected as ${res.data.fb_user_id}`);
    } catch {
      showToast("error", "Failed to connect with cookies");
    } finally {
      setConnectingCookies(false);
    }
  };

  // Auto-get cookies from extension — extract and auto-save
  const handleAutoGetCookies = () => {
    setConnectingCookies(true);
    window.postMessage({ type: "SOCYBASE_EXTENSION_GET_COOKIES" }, "*");
    const handler = async (event: MessageEvent) => {
      if (event.data?.type === "SOCYBASE_EXTENSION_COOKIES_RESPONSE") {
        window.removeEventListener("message", handler);
        if (event.data.success) {
          try {
            const res = await fbActionApi.connectCookies({
              c_user: event.data.c_user,
              xs: event.data.xs,
              user_agent: userAgent || undefined,
            });
            setHasCookies(true);
            setFbUserId(res.data.fb_user_id);
            setCookieCUser("");
            setCookieXs("");
            showToast("success", `Connected as ${res.data.fb_user_id}`);
          } catch {
            setCookieCUser(event.data.c_user);
            setCookieXs(event.data.xs);
            showToast("error", "Found cookies but failed to save — click Connect to retry");
          }
        } else {
          showToast("error", event.data.error || "No Facebook session found in browser");
        }
        setConnectingCookies(false);
      }
    };
    window.addEventListener("message", handler);
    setTimeout(() => {
      window.removeEventListener("message", handler);
      setConnectingCookies(false);
    }, 5000);
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
      setExtensionLoginStarted(false);
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
        showToast("success", `Batch created: ${res.data.total_rows} accounts — run the worker script below`);
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
      setExtensionLoginStarted(false);
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
          Facebook Action Blaster
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
          Batch
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
                      {hasCookies ? `Connected (${fbUserId || "unknown"})` : "Not connected"}
                    </span>
                  </div>
                  {/* Cookie connection inputs */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-white/40 block mb-1">c_user</label>
                        <input type="text" value={cookieCUser} onChange={(e) => setCookieCUser(e.target.value)} placeholder="e.g. 1658396629" className={inputClass} />
                      </div>
                      <div>
                        <label className="text-xs text-white/40 block mb-1">xs</label>
                        <input type="text" value={cookieXs} onChange={(e) => setCookieXs(e.target.value)} placeholder="xs cookie value" className={inputClass} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleConnectCookies} disabled={connectingCookies || (!cookieCUser && !cookieXs)} className="flex-1 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs rounded-lg border border-emerald-500/20 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        {connectingCookies ? "Connecting..." : "Connect"}
                      </button>
                      {extensionDetected && (
                        <button onClick={handleAutoGetCookies} className="flex-1 px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs rounded-lg border border-blue-500/20 transition">
                          Auto-get from Browser
                        </button>
                      )}
                    </div>
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
                {typeof result.result_url === "string" && result.result_url && (
                  <a href={result.result_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-amber-400/80 hover:text-amber-400 mb-2">
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                    {result.result_url}
                  </a>
                )}
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
                            <td className="py-2 px-3 text-xs max-w-[300px]">
                              {log.status === "success" ? (
                                <div className="flex items-center gap-2">
                                  {log.result_url ? (
                                    <a href={log.result_url} target="_blank" rel="noopener noreferrer" className="text-amber-400/80 hover:text-amber-400 flex items-center gap-1 truncate">
                                      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                                      <span className="truncate">{resultData ? Object.entries(resultData).map(([k, v]) => `${k}: ${v}`).join(", ") : "View"}</span>
                                    </a>
                                  ) : (
                                    <span className="text-white/50 truncate">{resultData ? Object.entries(resultData).map(([k, v]) => `${k}: ${v}`).join(", ") : "OK"}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-red-400/60 truncate block">{log.error_message || ""}</span>
                              )}
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

      {/* ═══════════════════ BATCH TAB ═══════════════════ */}
      {activeTab === "batch" && (
        <>
          {/* Sub-tabs */}
          <div className="flex gap-1 bg-white/[0.02] p-1 rounded-lg w-fit border border-white/5">
            {([
              { key: "accounts" as const, label: "Accounts" },
              { key: "manual" as const, label: "Manual Actions" },
              { key: "ai-planner" as const, label: "AI Planner" },
              { key: "warmup" as const, label: "Warm-up" },
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setBatchSubTab(t.key)}
                className={`px-4 py-1.5 text-xs rounded-md transition font-medium ${
                  batchSubTab === t.key
                    ? "bg-white/10 text-white"
                    : "text-white/35 hover:text-white/55"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Manual Actions sub-tab (was Batch Mode) ── */}
          {batchSubTab === "manual" && (
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
            <p className="text-xs text-white/30 mt-2">{creditCostPerAction} credit{creditCostPerAction !== 1 ? "s" : ""} per successful action</p>
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

              {/* Per-account results with errors */}
              {(activeBatch.results?.length ?? 0) > 0 && (
                <div className="mb-3 max-h-40 overflow-y-auto space-y-1">
                  {(activeBatch.results || []).map((r: any, i: number) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${r.status === "success" ? "bg-emerald-500/5 text-emerald-400" : "bg-red-500/5 text-red-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <span className="truncate">{r.email}</span>
                      {r.status === "success" && r.has_token && <span className="text-amber-400/60 shrink-0" title="EAAB token extracted">TK</span>}
                      {r.status === "success" && r.fb_user_id && <span className="text-white/20 ml-auto shrink-0">uid: {r.fb_user_id}</span>}
                      {r.status !== "success" && r.error_message && <span className="text-red-300/60 ml-auto shrink-0 truncate max-w-[50%]">{r.error_message}</span>}
                    </div>
                  ))}
                </div>
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

          {/* ── Accounts sub-tab (was Bulk Login) ── */}
          {batchSubTab === "accounts" && (
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                  <label className="text-xs text-white/40 block mb-2">
                    Workers: <span className="text-white/70">{loginParallel}</span>
                    <span className="text-white/20 ml-1">(browsers)</span>
                  </label>
                  <input type="range" min={1} max={20} value={loginParallel} onChange={(e) => setLoginParallel(Number(e.target.value))} className="w-full accent-primary-500" />
                </div>
              )}
              <div>
                <label className="text-xs text-white/40 block mb-2">2FA Wait: {twoFaWaitSeconds}s</label>
                <input type="range" min={30} max={300} step={10} value={twoFaWaitSeconds} onChange={(e) => setTwoFaWaitSeconds(Number(e.target.value))} className="w-full accent-primary-500" />
              </div>
              <div className="flex flex-col items-end gap-3">
                <label className="flex items-center gap-2 cursor-pointer self-start">
                  <input
                    type="checkbox"
                    checked={autoGoToBatch}
                    onChange={(e) => setAutoGoToBatch(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-amber-500"
                  />
                  <span className="text-xs text-white/40">Auto-download CSV after done</span>
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
                  {loginUploading ? "Uploading..." : "Upload & Prepare Login Batch"}
                </button>
              </div>
            </div>
          </div>

          {/* Active Login — Pending (waiting for worker) */}
          {activeLoginBatch && activeLoginBatch.status === "pending" && (
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-amber-400 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  Ready to Login ({activeLoginBatch.total_rows} accounts)
                </h3>
                <button onClick={handleCancelLoginBatch} className="text-xs text-red-400 hover:text-red-300 transition px-3 py-1 rounded-lg border border-red-500/20 hover:border-red-500/30">
                  Cancel
                </button>
              </div>

              {/* Option 1: Chrome Extension (shown when detected) */}
              {extensionDetected && (
                <div className="space-y-3">
                  <p className="text-xs text-white/40">
                    Login runs on <span className="text-white/70">your Chrome browser</span> via the SocyBase extension.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                        const authToken = localStorage.getItem("access_token") || "";
                        window.postMessage({
                          type: "SOCYBASE_EXTENSION_START_LOGIN",
                          batchId: activeLoginBatch.id,
                          apiUrl,
                          authToken,
                          twoFaWaitSeconds,
                        }, "*");
                      }}
                      disabled={extensionLoginStarted}
                      className="flex-1 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm font-medium rounded-xl border border-emerald-500/20 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" /></svg>
                      {extensionLoginStarted ? "Login Started..." : "Run via Chrome Extension"}
                    </button>
                    {extensionLoginStarted && (
                      <button
                        onClick={() => {
                          setExtensionLoginStarted(false);
                          window.postMessage({ type: "SOCYBASE_EXTENSION_CANCEL_LOGIN" }, "*");
                        }}
                        className="px-3 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-xl border border-red-500/20 transition"
                        title="Reset login state so you can start again"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-white/20">
                    The extension will open tabs in your Chrome and log into each account automatically. Keep Chrome open until done.
                  </p>
                </div>
              )}

              {/* Option 2: Python Script (shown as fallback or primary if no extension) */}
              <details className={extensionDetected ? "mt-2" : ""} open={!extensionDetected}>
                <summary className="text-xs text-white/30 cursor-pointer hover:text-white/50 transition">
                  {extensionDetected ? "Alternative: Python script" : "Run via Python script"}
                </summary>
                <div className="space-y-3 mt-3">
                  {!extensionDetected && (
                    <p className="text-xs text-white/40">
                      Login runs on <span className="text-white/70">your machine</span> using a real browser. Install the <span className="text-primary-300">SocyBase Chrome extension</span> for a simpler one-click flow.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/30 font-mono bg-white/5 rounded px-2 py-1">1.</span>
                    <span className="text-xs text-white/50">Install requirements (one-time):</span>
                  </div>
                  <div className="bg-black/40 rounded-lg p-3 font-mono text-xs text-emerald-300/80 select-all overflow-x-auto">
                    pip install playwright httpx pyotp && playwright install chromium
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/30 font-mono bg-white/5 rounded px-2 py-1">2.</span>
                    <span className="text-xs text-white/50">Download &amp; run the worker:</span>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fbActionApi.downloadWorkerScript();
                        const url = window.URL.createObjectURL(new Blob([res.data]));
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "fb_login_worker.py";
                        a.click();
                        window.URL.revokeObjectURL(url);
                      } catch {
                        showToast("error", "Failed to download worker script");
                      }
                    }}
                    className="px-4 py-2 bg-primary-500/15 hover:bg-primary-500/25 text-primary-300 text-xs rounded-lg transition border border-primary-500/20 flex items-center gap-2"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Download fb_login_worker.py
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/30 font-mono bg-white/5 rounded px-2 py-1">3.</span>
                    <span className="text-xs text-white/50">Run this command in your terminal:</span>
                  </div>
                  <div className="relative bg-black/40 rounded-lg p-3 font-mono text-[11px] text-emerald-300/80 overflow-x-auto">
                    <button
                      onClick={() => {
                        const cmd = `python fb_login_worker.py --url ${window.location.origin} --token ${localStorage.getItem("access_token") || "YOUR_TOKEN"} --batch ${activeLoginBatch.id}`;
                        navigator.clipboard.writeText(cmd);
                        showToast("success", "Command copied to clipboard");
                      }}
                      className="absolute top-2 right-2 text-white/20 hover:text-white/50 transition"
                      title="Copy command"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                    </button>
                    python fb_login_worker.py --url {typeof window !== "undefined" ? window.location.origin : "https://YOUR_SERVER"} --token <span className="text-amber-300/60">YOUR_TOKEN</span> --batch {activeLoginBatch.id}
                  </div>
                  <p className="text-[10px] text-white/20">
                    The browser will open on your machine. Keep the terminal running until all logins complete.
                  </p>
                </div>
              </details>
            </div>
          )}

          {/* Active Login Progress (running) */}
          {activeLoginBatch && activeLoginBatch.status === "running" && (
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Login Progress
                </h3>
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
              {/* Per-account results with errors */}
              {(activeLoginBatch.results?.length ?? 0) > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {(activeLoginBatch.results || []).map((r, i) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${r.status === "success" ? "bg-emerald-500/5 text-emerald-400" : "bg-red-500/5 text-red-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <span className="truncate">{r.email}</span>
                      {r.status === "success" && r.has_token && <span className="text-amber-400/60 shrink-0" title="EAAB token extracted">TK</span>}
                      {r.status === "success" && r.fb_user_id && <span className="text-white/20 ml-auto shrink-0">uid: {r.fb_user_id}</span>}
                      {r.status !== "success" && r.error_message && <span className="text-red-300/60 ml-auto shrink-0 truncate max-w-[60%]">{r.error_message}</span>}
                    </div>
                  ))}
                </div>
              )}

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

          {/* ── AI Planner sub-tab ── */}
          {batchSubTab === "ai-planner" && (
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
                  <button onClick={() => setPlannerSource("myposts")} className={`flex-1 py-2.5 text-xs rounded-lg transition border ${plannerSource === "myposts" ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"}`}>
                    My Posts
                  </button>
                  <button onClick={() => setPlannerSource("quickscan")} className={`flex-1 py-2.5 text-xs rounded-lg transition border ${plannerSource === "quickscan" ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"}`}>
                    Quick Scan URL
                  </button>
                  <button onClick={() => setPlannerSource("aisearch")} className={`flex-1 py-2.5 text-xs rounded-lg transition border ${plannerSource === "aisearch" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"}`}>
                    AI Search
                  </button>
                </div>

                {plannerSource === "myposts" && (
                  <div className="space-y-3">
                    <button
                      disabled={myJobsLoading}
                      onClick={async () => {
                        setMyJobsLoading(true);
                        try {
                          const res = await fbActionApi.aiPlanMyJobs();
                          setMyJobsList(res.data.items || []);
                          if ((res.data.items || []).length === 0) showToast("error", "No completed post discovery jobs found — run a scrape first");
                        } catch { showToast("error", "Failed to load jobs"); }
                        finally { setMyJobsLoading(false); }
                      }}
                      className="px-5 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-xs rounded-lg border border-violet-500/20 transition disabled:opacity-30 flex items-center gap-2"
                    >
                      {myJobsLoading && <div className="h-3 w-3 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" />}
                      Load My Scraping Jobs
                    </button>

                    {myJobsList.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white/50">{myJobsList.length} jobs · {selectedJobIds.size} selected</span>
                          <button
                            onClick={() => {
                              if (selectedJobIds.size === myJobsList.length) setSelectedJobIds(new Set());
                              else setSelectedJobIds(new Set(myJobsList.map((j: any) => j.id)));
                            }}
                            className="text-[10px] text-violet-400 hover:text-violet-300"
                          >
                            {selectedJobIds.size === myJobsList.length ? "Deselect All" : "Select All"}
                          </button>
                        </div>
                        <div className="max-h-[250px] overflow-y-auto space-y-1 pr-1">
                          {myJobsList.map((job: any) => (
                            <label
                              key={job.id}
                              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${
                                selectedJobIds.has(job.id)
                                  ? "bg-violet-500/10 border-violet-500/30"
                                  : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedJobIds.has(job.id)}
                                onChange={() => {
                                  const next = new Set(selectedJobIds);
                                  if (next.has(job.id)) next.delete(job.id);
                                  else next.add(job.id);
                                  setSelectedJobIds(next);
                                }}
                                className="accent-violet-500 h-3.5 w-3.5"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-white truncate">{job.input_value}</p>
                                <p className="text-[10px] text-white/30">
                                  {job.result_row_count} posts · {job.completed_at ? new Date(job.completed_at).toLocaleDateString() : ""}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                        <button
                          disabled={selectedJobIds.size === 0 || plannerPostsLoading}
                          onClick={async () => {
                            setPlannerPostsLoading(true);
                            try {
                              const res = await fbActionApi.aiPlanMyPosts({ job_ids: Array.from(selectedJobIds) });
                              setPlannerPosts(res.data.items || []);
                              setSelectedPostIds(new Set());
                              if ((res.data.items || []).length === 0) showToast("error", "No posts found in selected jobs");
                              else showToast("success", `Loaded ${res.data.items.length} posts from ${selectedJobIds.size} job${selectedJobIds.size !== 1 ? "s" : ""}`);
                            } catch { showToast("error", "Failed to load posts"); }
                            finally { setPlannerPostsLoading(false); }
                          }}
                          className="w-full py-2.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-xs rounded-lg border border-violet-500/20 transition disabled:opacity-30 flex items-center justify-center gap-2"
                        >
                          {plannerPostsLoading && <div className="h-3 w-3 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" />}
                          Load Posts from {selectedJobIds.size} Selected Job{selectedJobIds.size !== 1 ? "s" : ""}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {plannerSource === "quickscan" && (
                  <div className="space-y-3">
                    {/* Recent Scans */}
                    <div>
                      <button
                        onClick={async () => {
                          setScanHistoryOpen(!scanHistoryOpen);
                          if (!scanHistoryOpen && scanHistoryList.length === 0) {
                            try {
                              const res = await competitorsApi.scanHistory();
                              setScanHistoryList(res.data.items || []);
                            } catch { /* ignore */ }
                          }
                        }}
                        className="text-[11px] text-violet-400/70 hover:text-violet-300 flex items-center gap-1"
                      >
                        <span>{scanHistoryOpen ? "\u25BE" : "\u25B8"}</span>
                        Recent Scans{scanHistoryList.length > 0 ? ` (${scanHistoryList.length})` : ""}
                      </button>
                      {scanHistoryOpen && scanHistoryList.length > 0 && (
                        <div className="mt-1.5 max-h-[160px] overflow-y-auto space-y-1">
                          {scanHistoryList.map((h: any) => (
                            <button
                              key={h.id}
                              onClick={() => {
                                setPlannerPosts(h.posts || []);
                                setSelectedPostIds(new Set());
                                setScanHistoryOpen(false);
                                showToast("success", `Loaded scan: ${h.page_name} (${h.posts_count} posts)`);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-violet-500/10 border border-white/5 hover:border-violet-500/20 transition"
                            >
                              <p className="text-xs text-white/70 truncate">{h.page_name || h.page_id}</p>
                              <p className="text-[10px] text-white/30">
                                {h.posts_count} posts · {h.credits_used > 0 ? `${h.credits_used} credit · ` : ""}{new Date(h.created_at).toLocaleString()}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                      {scanHistoryOpen && scanHistoryList.length === 0 && (
                        <p className="text-[10px] text-white/20 mt-1 ml-3">No previous scans</p>
                      )}
                    </div>
                    {/* URL input */}
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
                            // Refresh scan history
                            competitorsApi.scanHistory().then((r) => setScanHistoryList(r.data.items || [])).catch(() => {});
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
                  </div>
                )}

                {plannerSource === "aisearch" && (
                  <div className="space-y-3">
                    {/* Recent Searches */}
                    <div>
                      <button
                        onClick={async () => {
                          setAiSearchHistoryOpen(!aiSearchHistoryOpen);
                          if (!aiSearchHistoryOpen && aiSearchHistoryList.length === 0) {
                            try {
                              const res = await fbActionApi.aiPlanSearchHistory();
                              setAiSearchHistoryList(res.data.items || []);
                            } catch { /* ignore */ }
                          }
                        }}
                        className="text-[11px] text-cyan-400/70 hover:text-cyan-300 flex items-center gap-1"
                      >
                        <span>{aiSearchHistoryOpen ? "\u25BE" : "\u25B8"}</span>
                        Recent Searches{aiSearchHistoryList.length > 0 ? ` (${aiSearchHistoryList.length})` : ""}
                      </button>
                      {aiSearchHistoryOpen && aiSearchHistoryList.length > 0 && (
                        <div className="mt-1.5 max-h-[160px] overflow-y-auto space-y-1">
                          {aiSearchHistoryList.map((h: any) => (
                            <button
                              key={h.id}
                              onClick={() => {
                                setAiSearchPrompt(h.prompt);
                                setAiSearchKeywords(h.keywords || []);
                                setAiSearchPages(h.pages || []);
                                setAiSelectedPageIds(new Set());
                                setAiSearchHistoryOpen(false);
                                showToast("success", `Loaded search: "${h.prompt}" (${h.pages_count} pages)`);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-cyan-500/10 border border-white/5 hover:border-cyan-500/20 transition"
                            >
                              <p className="text-xs text-white/70 truncate">{h.prompt}</p>
                              <p className="text-[10px] text-white/30">
                                {h.pages_count} pages · {h.keywords?.length || 0} keywords · {new Date(h.created_at).toLocaleDateString()}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                      {aiSearchHistoryOpen && aiSearchHistoryList.length === 0 && (
                        <p className="text-[10px] text-white/20 mt-1 ml-3">No previous searches</p>
                      )}
                    </div>
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
                            else {
                              showToast("success", `Found ${res.data.pages.length} pages from ${res.data.keywords?.length || 0} keywords${creditNote}`);
                              // Refresh search history
                              fbActionApi.aiPlanSearchHistory().then((r) => setAiSearchHistoryList(r.data.items || [])).catch(() => {});
                            }
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
                    placeholder={useContentDirectly ? "Enter exact content to use for all actions (required when using direct mode)" : "Optional: provide example content or talking points for AI to use as reference. Leave empty for fully AI-generated content."}
                    className={`w-full bg-white/5 border rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:border-violet-500 focus:outline-none h-16 resize-none ${useContentDirectly ? "border-amber-500/40" : "border-white/10"}`}
                  />
                  <p className="text-[10px] text-white/20 mt-1">{useContentDirectly ? "This exact content will be used for all actions — no AI generation" : "AI will use this as inspiration — not copy it directly"}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={useContentDirectly}
                    onChange={(e) => setUseContentDirectly(e.target.checked)}
                    className="accent-amber-500 w-3.5 h-3.5"
                  />
                  <span className="text-xs text-white/60 group-hover:text-white/80 transition">Use content directly (skip AI generation — saves credits)</span>
                </label>
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
                  ~{selectedPostIds.size * plannerActionsPerPost * plannerActionTypes.size} actions will be generated · {useContentDirectly ? "0 credits (direct content)" : "2 credits for AI generation"} · {creditCostPerAction} credit{creditCostPerAction !== 1 ? "s" : ""}/action on execute
                </p>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setPlannerStep(2)} className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-lg transition">← Back</button>
                <button
                  disabled={generating || plannerActionTypes.size === 0 || (useContentDirectly && !plannerRefContent.trim())}
                  onClick={async () => {
                    setGenerating(true);
                    try {
                      const selected = plannerPosts.filter((p: any) => selectedPostIds.has(p.post_id));
                      const imgUrl = plannerImageUrl.trim();
                      const imageActions = new Set(["comment_to_post", "page_comment_to_post", "reply_to_comment", "post_to_my_feed", "post_to_group"]);

                      if (useContentDirectly) {
                        // Direct mode — skip AI, use content as-is
                        const directContent = plannerRefContent.trim();
                        const directActions: any[] = [];
                        let idx = 0;
                        const actionTypes = Array.from(plannerActionTypes);
                        for (const post of selected) {
                          for (const actionType of actionTypes) {
                            for (let n = 0; n < plannerActionsPerPost; n++) {
                              directActions.push({
                                post_id: post.post_id,
                                post_url: post.post_url || null,
                                from_name: post.from_name || null,
                                action_name: actionType,
                                content: directContent,
                                image: imgUrl && imageActions.has(actionType) ? imgUrl : "",
                                _idx: idx++,
                                _accepted: true,
                              });
                            }
                          }
                        }
                        setGeneratedActions(directActions);
                        setPlannerActionFilter("all");
                        fbActionApi.aiPlanLoginBatches().then((r) => {
                          const items = r.data.items || [];
                          setLoginBatchOptions(items);
                          if (items.length > 0 && !selectedLoginBatchId) setSelectedLoginBatchId(items[0].id);
                        }).catch(() => {});
                        setPlannerStep(4);
                        showToast("success", `Created ${directActions.length} actions (direct content — no credits used)`);
                      } else {
                        // AI mode — call backend to generate
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
                        const actions = (res.data.actions || []).map((a: any, i: number) => ({
                          ...a,
                          _idx: i,
                          _accepted: true,
                          image: imgUrl && imageActions.has(a.action_name) ? imgUrl : (a.image || ""),
                        }));
                        setGeneratedActions(actions);
                        setPlannerActionFilter("all");
                        fbActionApi.aiPlanLoginBatches().then((r) => {
                          const items = r.data.items || [];
                          setLoginBatchOptions(items);
                          if (items.length > 0 && !selectedLoginBatchId) setSelectedLoginBatchId(items[0].id);
                        }).catch(() => {});
                        setPlannerStep(4);
                        const genCreditNote = res.data.credits_used ? ` (${res.data.credits_used} credits used)` : "";
                        showToast("success", `Generated ${actions.length} actions${genCreditNote}`);
                      }
                    } catch {
                      showToast("error", useContentDirectly ? "Failed to create actions" : "AI generation failed — check OpenAI key");
                    } finally { setGenerating(false); }
                  }}
                  className="px-6 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-sm rounded-lg border border-violet-500/20 transition disabled:opacity-30 flex items-center gap-2"
                >
                  {generating ? (
                    <><div className="h-4 w-4 border-2 border-violet-300/30 border-t-violet-300 rounded-full animate-spin" /> {useContentDirectly ? "Creating..." : "Generating..."}</>
                  ) : (
                    useContentDirectly ? "Create Actions" : "Generate"
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
                {generatedActions.length === 0 && (
                  <p className="text-xs text-white/30 text-center py-6">No actions generated. Go back and make sure you have posts selected and action types chosen.</p>
                )}
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

                {/* Login batch selector — prominent */}
                <div className={`p-3 rounded-lg border ${
                  loginBatchOptions.length === 0
                    ? "border-amber-500/30 bg-amber-500/5"
                    : selectedLoginBatchId
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-white/10 bg-white/[0.02]"
                }`}>
                  <label className="text-xs text-white/60 font-medium block mb-1.5">Login Batch (required for cookie-merged export)</label>
                  {loginBatchOptions.length === 0 ? (
                    <div className="text-xs text-amber-300/80 space-y-1">
                      <p>No login batches found. You need completed bulk logins to export with cookies.</p>
                      <button
                        onClick={() => setBatchSubTab("accounts")}
                        className="text-amber-400 underline hover:text-amber-300"
                      >
                        Go to Accounts tab to create one
                      </button>
                    </div>
                  ) : (
                    <select
                      value={selectedLoginBatchId}
                      onChange={(e) => setSelectedLoginBatchId(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                    >
                      <option value="">Select a login batch...</option>
                      {loginBatchOptions.map((b: any) => (
                        <option key={b.id} value={b.id}>
                          {new Date(b.created_at).toLocaleString()} — {b.success_count} accounts
                        </option>
                      ))}
                    </select>
                  )}
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
                {!selectedLoginBatchId && loginBatchOptions.length > 0 && (
                  <p className="text-[10px] text-amber-400/60">Select a login batch above to enable &quot;Export with Cookies&quot;</p>
                )}
                <p className="text-[10px] text-white/20">
                  {generatedActions.filter((a) => a._accepted).length} of {generatedActions.length} actions accepted · Execution cost: ~{generatedActions.filter((a) => a._accepted).length * creditCostPerAction} credits ({creditCostPerAction}/action)
                </p>
              </div>

              <div className="flex justify-start">
                <button onClick={() => setPlannerStep(3)} className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-lg transition">← Back</button>
              </div>
            </div>
          )}
        </>
          )}

          {/* ── Warm-up sub-tab ── */}
          {batchSubTab === "warmup" && (
            <div className="space-y-4 max-w-3xl">
              {/* Active warm-up progress */}
              {warmupActive && (warmupActive.status === "running" || warmupActive.status === "pending") && (() => {
                const maskEmail = (email: string) => {
                  if (!email) return "---";
                  const [local, domain] = email.split("@");
                  if (!domain) return email[0] + "***";
                  return local[0] + "***@" + domain;
                };
                const formatTime = (seconds: number) => {
                  const h = Math.floor(seconds / 3600);
                  const m = Math.floor((seconds % 3600) / 60);
                  const s = seconds % 60;
                  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
                };
                return (
                <div className="glass-card p-5 space-y-3 border border-amber-500/20">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                      <svg className="h-4 w-4 text-amber-400 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                      Warm-up Running — {warmupActive.preset}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded">
                        {warmupActive.completed_accounts}/{warmupActive.total_accounts}
                      </span>
                      <button
                        onClick={() => window.postMessage({ type: "SOCYBASE_CANCEL_WARMUP_BATCH" }, "*")}
                        className="text-xs text-red-400/60 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 px-2 py-0.5 rounded transition"
                      >Cancel</button>
                    </div>
                  </div>

                  {/* Current account + action */}
                  {warmupActive.currentEmail && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-white/40">Account:</span>
                      <span className="text-white/70 font-mono">{maskEmail(warmupActive.currentEmail)}</span>
                      {warmupActive.currentAction && (
                        <>
                          <span className="text-white/20">|</span>
                          <span className="text-amber-400/70 italic">{warmupActive.currentAction}</span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="w-full bg-white/5 rounded-full h-2">
                    <div
                      className="bg-amber-400/70 h-2 rounded-full transition-all"
                      style={{ width: `${warmupActive.total_accounts ? (warmupActive.completed_accounts / warmupActive.total_accounts) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
                    <span className="text-green-400">{warmupActive.success_count} success</span>
                    <span className="text-red-400">{warmupActive.failed_count} failed</span>
                    <span>{warmupActive.total_accounts - warmupActive.completed_accounts} remaining</span>
                    <span className="text-white/20">|</span>
                    <span>Elapsed: {formatTime(warmupElapsed)}</span>
                    {warmupActive.completed_accounts > 0 && (
                      <span>ETA: {formatTime(Math.round((warmupElapsed / warmupActive.completed_accounts) * (warmupActive.total_accounts - warmupActive.completed_accounts)))}</span>
                    )}
                  </div>

                  {/* Per-account result log */}
                  {warmupActive.accountResults && warmupActive.accountResults.length > 0 && (
                    <div>
                      <button
                        onClick={() => setWarmupLogExpanded(!warmupLogExpanded)}
                        className="text-xs text-amber-400/60 hover:text-amber-400 transition"
                      >
                        {warmupLogExpanded ? "Hide" : "Show"} account log ({warmupActive.accountResults.length})
                      </button>
                      {warmupLogExpanded && (
                        <div className="mt-2 max-h-48 overflow-y-auto space-y-1 bg-white/[0.02] rounded-lg p-2 border border-white/5">
                          {warmupActive.accountResults.map((r, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-[10px]">
                              <span className={r.success ? "text-green-400" : "text-red-400"}>
                                {r.success ? "OK" : "FAIL"}
                              </span>
                              <span className="text-white/50 font-mono">{maskEmail(r.email)}</span>
                              <span className="text-white/30 truncate">{r.actions.join(", ")}</span>
                              {r.error && <span className="text-red-400/60 truncate" title={r.error}>{r.error.slice(0, 40)}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Warm-up completed message */}
              {warmupActive && warmupActive.status !== "running" && warmupActive.status !== "pending" && (
                <div className={`glass-card p-4 border ${warmupActive.status === "completed" ? "border-green-500/20" : "border-red-500/20"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/60">
                      Warm-up {warmupActive.status}: {warmupActive.success_count} ok, {warmupActive.failed_count} failed
                    </span>
                    <button onClick={() => setWarmupActive(null)} className="text-xs text-white/30 hover:text-white/60">Dismiss</button>
                  </div>
                </div>
              )}

              {/* Scheduled Warm-ups */}
              {scheduledWarmups.length > 0 && (
                <div className="glass-card p-5 space-y-3">
                  <h3 className="text-sm font-medium text-white/40 flex items-center gap-2">
                    <svg className="h-4 w-4 text-amber-400/60" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Scheduled Warm-ups
                  </h3>
                  <div className="space-y-2">
                    {scheduledWarmups.map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between bg-white/[0.02] rounded-lg p-3 border border-white/5">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-white/50 font-mono">{s.id.slice(0, 8)}</span>
                          <span className="capitalize text-amber-400/80">{s.preset}</span>
                          <span className="text-white/40">{s.total_accounts} accounts</span>
                          <span className="text-white/30">{new Date(s.scheduled_at).toLocaleString()}</span>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await fbActionApi.cancelScheduledWarmup(s.id);
                              setScheduledWarmups((prev: any[]) => prev.filter((x: any) => x.id !== s.id));
                              showToast("success", "Scheduled warm-up cancelled");
                            } catch { showToast("error", "Failed to cancel"); }
                          }}
                          className="text-[10px] text-red-400/60 hover:text-red-400 transition"
                        >Cancel</button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-400/40">Keep this page open with the extension active. Warm-up starts automatically at the scheduled time.</p>
                </div>
              )}

              {/* DOM Selector Status */}
              <div className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                    <svg className="h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
                    DOM Selector Agent
                  </h3>
                  {selectorConfig && selectorConfig.confidence != null && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      selectorConfig.confidence >= 0.8 ? "bg-green-500/10 text-green-400" :
                      selectorConfig.confidence >= 0.6 ? "bg-amber-500/10 text-amber-400" :
                      "bg-red-500/10 text-red-400"
                    }`}>
                      {Math.round(selectorConfig.confidence * 100)}% confidence
                    </span>
                  )}
                </div>

                {selectorConfig && selectorConfig.selectors ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-xs text-white/40">
                      {selectorConfig.verified_at && (
                        <span>Verified: {new Date(selectorConfig.verified_at).toLocaleString()}</span>
                      )}
                      {selectorConfig.verified_by && (
                        <span>Account: {selectorConfig.verified_by}</span>
                      )}
                      {selectorConfig.facebook_version && (
                        <span>FB: {selectorConfig.facebook_version}</span>
                      )}
                    </div>
                    {selectorConfig.warnings && selectorConfig.warnings.length > 0 && (
                      <div className="text-xs text-amber-400/60 bg-amber-400/5 p-2 rounded border border-amber-400/10">
                        {selectorConfig.warnings.map((w: string, i: number) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => setSelectorExpanded(!selectorExpanded)}
                      className="text-xs text-purple-400/60 hover:text-purple-400 transition"
                    >
                      {selectorExpanded ? "Hide details" : "Show selector details"}
                    </button>
                    {selectorExpanded && (
                      <pre className="text-[10px] text-white/30 bg-white/[0.02] rounded-lg p-3 overflow-auto max-h-48 border border-white/5">
                        {JSON.stringify(selectorConfig.selectors, null, 2)}
                      </pre>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-white/30">No verified selectors. Using default (hardcoded) selectors.</p>
                )}

                <button
                  disabled={selectorChecking || domBatchPickerLoading || !extensionDetected}
                  onClick={async () => {
                    setDomBatchPickerLoading(true);
                    try {
                      const res = await fbActionApi.getLoginBatchHistory({ page: 1, page_size: 50 });
                      const batches = (res.data.items || []).filter((b: any) => b.success_count > 0);
                      setDomBatchPickerBatches(batches);
                      if (batches.length === 0) {
                        showToast("error", "No login batches with valid cookies. Go to Accounts tab to batch login first.");
                      } else {
                        setDomBatchPickerOpen(true);
                      }
                    } catch {
                      showToast("error", "Failed to load login batches");
                    } finally {
                      setDomBatchPickerLoading(false);
                    }
                  }}
                  className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs rounded-lg border border-purple-500/20 transition disabled:opacity-30 flex items-center gap-2"
                >
                  {selectorChecking ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Logging in &amp; checking DOM...
                    </>
                  ) : domBatchPickerLoading ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Loading batches...
                    </>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
                      Check Selectors
                    </>
                  )}
                </button>
                {!extensionDetected && (
                  <p className="text-[10px] text-white/20">Extension required to check selectors</p>
                )}
                <p className="text-[10px] text-white/20">Select a login batch, log in one account, extract DOM, keep tab open.</p>
              </div>

              {/* Start new warm-up */}
              {(!warmupActive || (warmupActive.status !== "running" && warmupActive.status !== "pending")) && (
                <div className="glass-card p-5 space-y-4">
                  <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                    <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" /></svg>
                    Start Warm-up
                  </h3>

                  {/* Login batch selector */}
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Select Login Batch (accounts to warm up)</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                      value={warmupLoginBatchId}
                      onChange={(e) => setWarmupLoginBatchId(e.target.value)}
                    >
                      <option value="">Select a login batch...</option>
                      {warmupLoginBatches.map((b: any) => (
                        <option key={b.id} value={b.id}>
                          {b.id.slice(0, 8)} — {b.success_count} accounts ({b.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Preset selector */}
                  <div>
                    <label className="text-xs text-white/40 block mb-2">Warm-up Preset</label>
                    <div className="flex gap-2">
                      {([
                        { key: "light" as const, label: "Light", desc: "Scroll x3, pause, watch video x1" },
                        { key: "medium" as const, label: "Medium", desc: "Scroll x5, like x2, video, stories, notifications" },
                        { key: "heavy" as const, label: "Heavy", desc: "Full simulation: reactions, videos, stories, marketplace, search, comment" },
                      ]).map((p) => (
                        <button
                          key={p.key}
                          onClick={() => setWarmupPreset(p.key)}
                          className={`flex-1 p-3 rounded-lg border text-left transition ${
                            warmupPreset === p.key
                              ? "border-amber-400/40 bg-amber-400/10"
                              : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                          }`}
                        >
                          <div className={`text-xs font-medium ${warmupPreset === p.key ? "text-amber-400" : "text-white/60"}`}>{p.label}</div>
                          <div className="text-[10px] text-white/30 mt-0.5">{p.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Delay slider */}
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Delay between accounts: {warmupDelay}s</label>
                    <input
                      type="range"
                      min={5}
                      max={30}
                      step={1}
                      value={warmupDelay}
                      onChange={(e) => setWarmupDelay(Number(e.target.value))}
                      className="w-full accent-amber-400"
                    />
                    <div className="flex justify-between text-[10px] text-white/20">
                      <span>5s</span>
                      <span>30s</span>
                    </div>
                  </div>

                  {/* Schedule toggle */}
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-white/40 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={warmupScheduleMode}
                        onChange={(e) => { setWarmupScheduleMode(e.target.checked); setWarmupScheduleAt(""); }}
                        className="accent-amber-400"
                      />
                      Schedule for later
                    </label>
                  </div>

                  {warmupScheduleMode && (
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Schedule date & time</label>
                      <input
                        type="datetime-local"
                        value={warmupScheduleAt}
                        onChange={(e) => setWarmupScheduleAt(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 [color-scheme:dark]"
                      />
                      <p className="text-[10px] text-amber-400/50 mt-1">Keep this page open. Warm-up will auto-start when the time arrives (requires extension).</p>
                    </div>
                  )}

                  {/* Extension notice */}
                  {!extensionDetected && (
                    <div className="text-xs text-amber-400/60 bg-amber-400/5 p-3 rounded-lg border border-amber-400/10">
                      Chrome extension required — warm-up runs in your browser for realistic activity.
                    </div>
                  )}

                  {/* Warning for accounts */}
                  {warmupLoginBatches.length === 0 && (
                    <div className="text-xs text-amber-400/60 bg-amber-400/5 p-2.5 rounded-lg border border-amber-400/10 flex items-center gap-2">
                      <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                      No login batches found. Go to Accounts tab and upload CSV to batch login first.
                    </div>
                  )}

                  {/* Start / Schedule button */}
                  <button
                    disabled={!warmupLoginBatchId || warmupStarting || !extensionDetected || (warmupScheduleMode && !warmupScheduleAt)}
                    onClick={async () => {
                      setWarmupStarting(true);
                      try {
                        const payload: { login_batch_id: string; preset: string; delay_seconds: number; scheduled_at?: string } = {
                          login_batch_id: warmupLoginBatchId,
                          preset: warmupPreset,
                          delay_seconds: warmupDelay,
                        };
                        if (warmupScheduleMode && warmupScheduleAt) {
                          payload.scheduled_at = new Date(warmupScheduleAt).toISOString();
                        }

                        const res = await fbActionApi.createWarmupBatch(payload);
                        const batchId = res.data.id;

                        if (warmupScheduleMode) {
                          showToast("success", "Warm-up scheduled");
                          loadScheduledWarmups();
                          setWarmupScheduleMode(false);
                          setWarmupScheduleAt("");
                        } else {
                          setWarmupActive({ ...res.data, completed_accounts: 0, success_count: 0, failed_count: 0 });
                          const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                          const authToken = localStorage.getItem("access_token") || "";
                          window.postMessage({ type: "SOCYBASE_START_WARMUP_BATCH", batchId, apiUrl, authToken }, "*");
                          showToast("success", "Warm-up batch started via Chrome extension");
                        }
                      } catch (e: any) {
                        showToast("error", typeof e.response?.data?.detail === "string" ? e.response.data.detail : "Failed to start warm-up");
                      } finally {
                        setWarmupStarting(false);
                      }
                    }}
                    className="w-full py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm rounded-lg border border-amber-500/20 transition disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {warmupStarting ? (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    ) : warmupScheduleMode ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /></svg>
                    )}
                    {warmupScheduleMode ? "Schedule Warm-up" : "Start Warm-up"}
                  </button>
                </div>
              )}

              {/* Warm-up History */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/40">Warm-up History</h3>
                {warmupHistory.length === 0 ? (
                  <p className="text-xs text-white/20">No warm-up batches yet</p>
                ) : (
                  <>
                    <div className="overflow-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-white/30 border-b border-white/5">
                          <th className="text-left py-1.5 pr-3">ID</th>
                          <th className="text-left py-1.5 pr-3">Preset</th>
                          <th className="text-left py-1.5 pr-3">Status</th>
                          <th className="text-right py-1.5 pr-3">Accounts</th>
                          <th className="text-right py-1.5 pr-3">OK</th>
                          <th className="text-right py-1.5">Fail</th>
                        </tr></thead>
                        <tbody>
                          {warmupHistory.map((b: any) => (
                            <tr key={b.id} className="border-b border-white/[0.03] text-white/50 hover:bg-white/[0.02]">
                              <td className="py-1.5 pr-3 font-mono">{b.id.slice(0, 8)}</td>
                              <td className="py-1.5 pr-3 capitalize">{b.preset}</td>
                              <td className="py-1.5 pr-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  b.status === "completed" ? "bg-green-500/10 text-green-400" :
                                  b.status === "running" ? "bg-amber-500/10 text-amber-400" :
                                  b.status === "failed" ? "bg-red-500/10 text-red-400" :
                                  b.status === "scheduled" ? "bg-purple-500/10 text-purple-400" :
                                  "bg-white/5 text-white/30"
                                }`}>{b.status}</span>
                              </td>
                              <td className="py-1.5 pr-3 text-right">{b.total_accounts}</td>
                              <td className="py-1.5 pr-3 text-right text-green-400/60">{b.success_count}</td>
                              <td className="py-1.5 text-right text-red-400/60">{b.failed_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {warmupHistoryTotal > 10 && (
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-xs text-white/30">Page {warmupHistoryPage} of {Math.ceil(warmupHistoryTotal / 10)}</span>
                        <div className="flex gap-2">
                          <button onClick={() => setWarmupHistoryPage((p) => Math.max(1, p - 1))} disabled={warmupHistoryPage <= 1} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Previous</button>
                          <button onClick={() => setWarmupHistoryPage((p) => p + 1)} disabled={warmupHistoryPage * 10 >= warmupHistoryTotal} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition disabled:opacity-30">Next</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
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

              {/* ── How It Works Guide ── */}
              <details className="glass-card p-4 group">
                <summary className="text-sm font-medium text-white/60 cursor-pointer flex items-center gap-2 select-none">
                  <svg className="h-4 w-4 text-blue-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  How Livestream Engagement Works
                  <span className="text-[10px] text-white/20 ml-2">(click to expand)</span>
                </summary>
                <div className="mt-3 space-y-4 text-xs text-white/50 leading-relaxed">

                  {/* Overview */}
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <p className="text-white/70 font-medium">Overview</p>
                    <p>The system monitors real comments on your Facebook livestream, then generates and posts AI comments that blend naturally with viewer conversation. It uses your product info and live chat context to create relevant, believable comments.</p>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="bg-white/5 rounded p-2 text-center">
                        <p className="text-emerald-400 text-lg font-bold">Monitor</p>
                        <p>Scrapes live comments every 4-12s</p>
                      </div>
                      <div className="bg-white/5 rounded p-2 text-center">
                        <p className="text-blue-400 text-lg font-bold">Generate</p>
                        <p>AI creates comments based on context</p>
                      </div>
                      <div className="bg-white/5 rounded p-2 text-center">
                        <p className="text-amber-400 text-lg font-bold">Post</p>
                        <p>Posts via your uploaded accounts</p>
                      </div>
                    </div>
                  </div>

                  {/* Setup Steps */}
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <p className="text-white/70 font-medium">Quick Setup (4 steps)</p>
                    <div className="space-y-1.5">
                      <p><span className="text-amber-400 font-bold">1.</span> <span className="text-white/60">Paste your livestream URL</span> — system auto-extracts the Post ID</p>
                      <p><span className="text-amber-400 font-bold">2.</span> <span className="text-white/60">Upload accounts CSV</span> — cookies + email (min 2 accounts). These accounts post the comments</p>
                      <p><span className="text-amber-400 font-bold">3.</span> <span className="text-white/60">Set business context</span> — describe what you sell so AI generates relevant comments</p>
                      <p><span className="text-amber-400 font-bold">4.</span> <span className="text-white/60">Click Start</span> — system begins monitoring and posting automatically</p>
                    </div>
                  </div>

                  {/* Roles */}
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <p className="text-white/70 font-medium">Role Distribution</p>
                    <p>Each comment is assigned a role. Adjust the sliders to control what types of comments are posted:</p>
                    <div className="space-y-1">
                      <p><span className="text-amber-400">Place Order</span> — posts order comments using detected product codes. <span className="text-white/30">Example: &quot;480 +1&quot;, &quot;L6 nak&quot;</span></p>
                      <p><span className="text-blue-400">Ask Question</span> — AI asks about product details based on your business context. <span className="text-white/30">Example: &quot;这个有不同尺寸吗？&quot;</span></p>
                      <p><span className="text-purple-400">Repeat Question</span> — AI paraphrases a real viewer question to show demand. <span className="text-white/30">Example: viewer asks &quot;多少钱&quot; → bot: &quot;价格怎么算？&quot;</span></p>
                      <p><span className="text-emerald-400">Good Vibe</span> — brief positive reaction. <span className="text-white/30">Example: &quot;质感不错&quot;, &quot;性价比高&quot;</span></p>
                      <p><span className="text-cyan-400">React Comment</span> — responds to a specific viewer comment naturally. <span className="text-white/30">Example: &quot;对啊我也觉得好看&quot;</span></p>
                      <p><span className="text-pink-400">Share Experience</span> — brief personal note about the product. <span className="text-white/30">Example: &quot;上次买的朋友都说好看&quot;</span></p>
                    </div>
                  </div>

                  {/* AI Config */}
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <p className="text-white/70 font-medium">AI Configuration</p>
                    <div className="space-y-1">
                      <p><span className="text-white/60 font-medium">Business Context</span> — Tell the AI what you sell. The more detail, the better the comments. <span className="text-white/30">Example: &quot;翡翠珠宝，20年经验，直播卖玉，品质保证&quot;</span></p>
                      <p><span className="text-white/60 font-medium">Style Guide Comments</span> — Upload or paste real past comments. AI learns the tone, slang, and writing style — but content comes from live comments. <span className="text-white/30">Upload a .txt file with 100+ real comments for best results.</span></p>
                      <p><span className="text-white/60 font-medium">AI Instructions</span> — Custom rules for the AI. <span className="text-white/30">Example: &quot;用华语，自然式，正常字数&quot;</span></p>
                      <p><span className="text-white/60 font-medium">Comment Language</span> — Tick which languages to use. AI will only generate in selected languages.</p>
                    </div>
                  </div>

                  {/* Code Detection */}
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <p className="text-white/70 font-medium">Product Code Detection</p>
                    <p>The system auto-detects product codes from live viewer comments for Place Order comments:</p>
                    <div className="space-y-1">
                      <p><span className="text-white/60 font-medium">Known Product Codes</span> — enter codes you already know (e.g. <code className="bg-white/10 px-1 rounded">480,388,168</code>). These are matched instantly from the first comment.</p>
                      <p><span className="text-white/60 font-medium">Code Pattern Examples</span> — teach the system what codes look like by example (e.g. <code className="bg-white/10 px-1 rounded">8,1,E204</code>). System learns: &quot;codes are numbers or letter+number&quot; and auto-detects new ones.</p>
                      <p><span className="text-white/60 font-medium">Auto-detection</span> — when 2+ different viewers post the same short message (e.g. &quot;8&quot;, &quot;8&quot;, &quot;8&quot;), system recognizes it as a product code automatically.</p>
                    </div>
                  </div>

                  {/* Trending & Trigger */}
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <p className="text-white/70 font-medium">Auto-Order Trending & Priority Trigger</p>
                    <div className="space-y-1">
                      <p><span className="text-white/60 font-medium">Auto-Order Trending</span> — when a code gets 3+ mentions in 60 seconds, system auto-generates Place Order comments with that code. Alternates 50/50 with normal comments. Configurable cooldown between triggers.</p>
                      <p><span className="text-white/60 font-medium">Priority Trigger</span> — during a running session, manually add a code to burst-post immediately. Set count (how many) and duration (spread over how many minutes). Use when you want to push a specific product NOW.</p>
                    </div>
                  </div>

                  {/* Tips */}
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-1">
                    <p className="text-amber-300 font-medium">Tips for Best Results</p>
                    <p>• Set Place Order to 40-60% — it drives sales and uses no AI credits</p>
                    <p>• Write detailed Business Context — AI generates better questions/reactions</p>
                    <p>• Upload 100+ real past comments as Style Guide — AI matches your audience tone</p>
                    <p>• Use &quot;Preview 5 Sample Comments&quot; button to test before starting</p>
                    <p>• Start with Medium aggressive level, adjust if needed while running</p>
                    <p>• Enter known product codes for instant detection, or leave empty for auto-detect</p>
                  </div>
                </div>
              </details>

              {/* ── Smart Setup ── */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                  <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  Smart Setup
                  <span className="text-[10px] text-white/20">— auto-generate config from Facebook page/video</span>
                </h3>
                <div className="flex gap-2">
                  <input placeholder="Paste Facebook page URL or livestream video URL" value={smartSetupUrl}
                    onChange={(e) => setSmartSetupUrl(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50" />
                  <button disabled={smartSetupLoading || !smartSetupUrl.trim()}
                    onClick={async () => {
                      setSmartSetupLoading(true);
                      setSmartSetupStep("Fetching page & comments...");
                      setSmartSetupResult(null);
                      try {
                        const url = smartSetupUrl.trim();
                        const isVideo = url.includes("/videos/") || url.includes("/posts/") || /^\d{10,}$/.test(url);
                        setSmartSetupStep("AI analyzing data...");
                        const res = await fbActionApi.liveEngageSmartSetup({
                          page_url: url,
                          video_url: isVideo ? url : undefined,
                          max_comments: 200,
                        });
                        setSmartSetupResult(res.data);
                        setSmartSetupStep("");
                        showToast("success", `Analyzed ${res.data.stats?.comments_analyzed || 0} comments`);
                      } catch (err: any) {
                        showToast("error", err.response?.data?.detail || "Analysis failed");
                        setSmartSetupStep("");
                      }
                      setSmartSetupLoading(false);
                    }}
                    className="px-5 py-2.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-300 rounded-lg text-sm font-medium transition disabled:opacity-40 whitespace-nowrap">
                    {smartSetupLoading ? (<span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                      Analyzing...
                    </span>) : "Analyze"}
                  </button>
                </div>
                {smartSetupLoading && smartSetupStep && (
                  <p className="text-xs text-amber-300/60 animate-pulse">{smartSetupStep}</p>
                )}
                {smartSetupResult && (
                  <div className="space-y-3 border-t border-white/10 pt-3">
                    {smartSetupResult.page_info?.name && (
                      <div className="flex items-center gap-3">
                        {smartSetupResult.page_info.picture && (
                          <img src={smartSetupResult.page_info.picture} alt="" className="w-10 h-10 rounded-full" />
                        )}
                        <div>
                          <p className="text-sm text-white/80 font-medium">{smartSetupResult.page_info.name}</p>
                          <p className="text-xs text-white/30">{smartSetupResult.page_info.category}</p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="bg-white/5 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold text-emerald-400">{smartSetupResult.stats?.comments_analyzed || 0}</p>
                        <p className="text-[10px] text-white/30">Comments</p>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold text-blue-400">{Object.keys(smartSetupResult.stats?.languages || {}).length}</p>
                        <p className="text-[10px] text-white/30">Languages</p>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold text-amber-400">{smartSetupResult.stats?.codes_detected?.length || 0}</p>
                        <p className="text-[10px] text-white/30">Codes</p>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold text-purple-400">{smartSetupResult.stats?.avg_comment_length || 0}</p>
                        <p className="text-[10px] text-white/30">Avg Len</p>
                      </div>
                    </div>
                    {smartSetupResult.stats?.languages && (
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(smartSetupResult.stats.languages).map(([lang, count]: [string, any]) => (
                          <span key={lang} className="px-2 py-0.5 bg-blue-500/10 text-blue-300 rounded text-xs">{lang}: {count}</span>
                        ))}
                      </div>
                    )}
                    {smartSetupResult.stats?.codes_detected?.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <span className="text-xs text-white/30">Codes:</span>
                        {smartSetupResult.stats.codes_detected.map((code: string) => (
                          <span key={code} className="px-2 py-0.5 bg-amber-500/10 text-amber-300 rounded text-xs font-mono">{code}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => {
                        const cfg = smartSetupResult.config;
                        if (!cfg) return;
                        if (smartSetupResult.post_id) { setLePostId(smartSetupResult.post_id); if (smartSetupUrl.includes("facebook.com")) setLePostUrl(smartSetupUrl); }
                        if (smartSetupResult.page_owner_id) setLePageOwnerId(smartSetupResult.page_owner_id);
                        if (cfg.suggested_title) setLeTitle(cfg.suggested_title);
                        if (cfg.business_context) setLeContext(cfg.business_context);
                        if (cfg.ai_instructions) setLeInstructions(cfg.ai_instructions);
                        if (cfg.training_comments) setLeTrainingComments(Array.isArray(cfg.training_comments) ? cfg.training_comments.join("\n") : cfg.training_comments);
                        if (cfg.product_codes) setLeProductCodes(Array.isArray(cfg.product_codes) ? cfg.product_codes.join(", ") : cfg.product_codes);
                        if (cfg.code_pattern) {
                          // Normalize GPT variations to valid presets
                          const normalized = cfg.code_pattern.toLowerCase().trim();
                          const presetMap: Record<string, string> = { "numeric": "numbers", "number": "numbers", "alphanumeric": "any_alphanumeric", "letter_number": "letters_numbers", "letter+number": "letters_numbers" };
                          setLeCodePattern(presetMap[normalized] || cfg.code_pattern);
                        }
                        if (cfg.role_distribution) setLeRoles(cfg.role_distribution);
                        if (cfg.aggressive_level) setLeAggressiveLevel(cfg.aggressive_level);
                        if (cfg.languages) setLeLanguages(Array.isArray(cfg.languages) ? cfg.languages : typeof cfg.languages === "string" ? cfg.languages.split(",").map((s: string) => s.trim()).filter(Boolean) : []);
                        if (cfg.quantity_variation !== undefined) setLeQuantityVariation(cfg.quantity_variation);
                        if (cfg.auto_order_trending !== undefined) setLeAutoOrderTrending(cfg.auto_order_trending);
                        if (cfg.auto_order_trending_threshold) setLeAutoOrderThreshold(cfg.auto_order_trending_threshold);
                        if (cfg.auto_order_trending_cooldown) setLeAutoOrderCooldown(cfg.auto_order_trending_cooldown);
                        setSmartSetupResult(null);
                        showToast("success", "Config applied! Review and adjust before starting.");
                      }} className="flex-1 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-sm font-medium transition">
                        Apply Config
                      </button>
                      <button onClick={() => setSmartSetupResult(null)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/40 rounded-lg text-sm transition">
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Target */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
                  <svg className="h-4 w-4 text-red-400" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
                  Target Livestream
                </h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Livestream URL or Post ID</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="Paste URL or Post ID — auto-detects post ID from URL"
                    value={lePostUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLePostUrl(val);
                      if (!val.trim()) { setLePostId(""); return; }
                      // Auto-extract post_id from Facebook URL
                      if (val.includes("facebook.com") || val.includes("fb.watch")) {
                        const videoMatch = val.match(/\/videos\/(\d+)/);
                        const reelMatch = val.match(/\/reel\/(\d+)/);
                        const watchMatch = val.match(/[?&]v=(\d+)/);
                        const postMatch = val.match(/\/posts\/(pfbid\w+|\d+)/);
                        const fbidMatch = val.match(/fbid=(\d+)/);
                        const storyMatch = val.match(/story_fbid=(\d+)/);
                        const id = videoMatch?.[1] || reelMatch?.[1] || watchMatch?.[1] || postMatch?.[1] || fbidMatch?.[1] || storyMatch?.[1];
                        setLePostId(id || "");
                      } else if (/^\d+$/.test(val.trim())) {
                        setLePostId(val.trim());
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Post ID {lePostId ? <span className="text-emerald-400">(detected)</span> : "(required)"}</label>
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
                <div>
                  <label className="text-xs text-white/40 block mb-1">Page Owner ID (optional — auto-detected from Post ID)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="Facebook Page ID — comments from this ID will be ignored"
                    value={lePageOwnerId}
                    onChange={(e) => setLePageOwnerId(e.target.value)}
                  />
                  <p className="text-xs text-white/30 mt-1">Livestream host comments are filtered out so AI only responds to viewers</p>
                </div>
              </div>

              {/* Accounts */}
              <div className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white/60">Accounts</h3>
                  <div className="flex bg-white/5 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => { setLeAccountSource("batch"); setLeDirectAccounts([]); }}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        leAccountSource === "batch" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"
                      }`}
                    >Login Batch</button>
                    <button
                      type="button"
                      onClick={() => {
                        setLeAccountSource("csv"); setLeLoginBatchId("");
                        if (leRecentAccounts.length === 0) {
                          fbActionApi.liveEngageRecentAccounts().then((r) => setLeRecentAccounts(r.data.recent || [])).catch(() => {});
                        }
                      }}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        leAccountSource === "csv" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"
                      }`}
                    >Upload CSV</button>
                  </div>
                </div>

                {leAccountSource === "batch" ? (
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
                    <p className="text-xs text-white/30 mt-1">Use accounts from an existing login batch</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label
                        className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-dashed border-white/20 rounded-lg px-4 py-3 cursor-pointer hover:bg-white/10 transition-all"
                      >
                        <svg className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                        <span className="text-xs text-white/40">
                          {leDirectAccounts.length > 0
                            ? `${leDirectAccounts.length} accounts loaded`
                            : "Upload accounts CSV (cookies, email, proxy...)"}
                        </span>
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const res = await fbActionApi.liveEngageParseAccountsCsv(file);
                              setLeDirectAccounts(res.data.accounts);
                              const parts = [`${res.data.total} accounts loaded`];
                              if (res.data.duplicates?.length) parts.push(`${res.data.duplicates.length} duplicates removed`);
                              if (res.data.errors?.length) parts.push(`${res.data.errors.length} rows skipped`);
                              showToast("success", parts.join(", "));
                            } catch (err: any) {
                              showToast("error", typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Failed to parse CSV");
                            }
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fbActionApi.liveEngageAccountsTemplate();
                            const url = window.URL.createObjectURL(res.data instanceof Blob ? res.data : new Blob([res.data]));
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "live_engage_accounts_template.csv";
                            a.click();
                            window.URL.revokeObjectURL(url);
                          } catch { showToast("error", "Failed to download template"); }
                        }}
                        className="px-3 py-3 bg-white/5 border border-white/10 rounded-lg text-xs text-white/40 hover:bg-white/10 transition-all whitespace-nowrap"
                      >
                        Template
                      </button>
                    </div>
                    {leDirectAccounts.length > 0 && (
                      <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                        <span className="text-xs text-emerald-300">{leDirectAccounts.length} accounts ready</span>
                        <button
                          type="button"
                          onClick={() => setLeDirectAccounts([])}
                          className="text-xs text-white/30 hover:text-red-300"
                        >Clear</button>
                      </div>
                    )}
                    <p className="text-xs text-white/30">CSV columns: cookies (required), email (required), token, twofa, proxy_host, proxy_port, proxy_username, proxy_password, user_agent</p>
                    {leRecentAccounts.length > 0 && leDirectAccounts.length === 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-white/30 mb-1">Recent uploads:</p>
                        <div className="flex flex-wrap gap-1">
                          {leRecentAccounts.map((r: any) => (
                            <button
                              key={r.session_id}
                              type="button"
                              onClick={() => {
                                setLeDirectAccounts(r.accounts);
                                showToast("success", `Loaded ${r.account_count} accounts from "${r.title}"`);
                              }}
                              className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white/50 hover:bg-white/10 hover:text-white/70 transition"
                            >
                              {r.title} ({r.account_count})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
                  <label className="text-xs text-white/40 block mb-1">Style Guide Comments (tone & writing pattern only — content comes from live comments)</label>
                  <textarea
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20 font-mono"
                    rows={4}
                    placeholder={"Paste past comments for style reference, one per line...\nCantik sangat!\nBerapa harga ni?\nBest quality la this one"}
                    value={leTrainingComments}
                    onChange={(e) => setLeTrainingComments(e.target.value)}
                  />
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                    <span className="text-white/15">|</span>
                    <button
                      type="button"
                      onClick={async () => {
                        setLeImportLoading(true);
                        try {
                          const res = await jobsApi.list({ page: 1, page_size: 50, status: "completed" });
                          const jobs = Array.isArray(res.data) ? res.data : (res.data.items || res.data.jobs || []);
                          setLeImportJobs(jobs);
                        } catch { showToast("error", "Failed to load jobs"); }
                        setLeImportLoading(false);
                      }}
                      className="text-xs text-blue-400/80 cursor-pointer hover:text-blue-300"
                    >
                      {leImportLoading ? "Loading..." : "Import from Scrape Job"}
                    </button>
                    {leTrainingComments && (
                      <>
                        <span className="text-white/15">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            const lines = leTrainingComments.split("\n").map((l: string) => l.trim()).filter(Boolean);
                            // Deduplicate: exact match + fuzzy similarity
                            const unique: string[] = [];
                            const seen = new Set<string>();
                            for (const line of lines) {
                              const key = line.toLowerCase().replace(/\s+/g, " ");
                              // Skip exact duplicates
                              if (seen.has(key)) continue;
                              // Skip very similar (same first 10 chars + same length ±3)
                              let tooSimilar = false;
                              for (const u of unique) {
                                const uKey = u.toLowerCase().replace(/\s+/g, " ");
                                if (key.length > 5 && uKey.length > 5 &&
                                    key.substring(0, 10) === uKey.substring(0, 10) &&
                                    Math.abs(key.length - uKey.length) <= 3) {
                                  tooSimilar = true;
                                  break;
                                }
                              }
                              if (!tooSimilar) {
                                unique.push(line);
                                seen.add(key);
                              }
                            }
                            // Remove very short lines (≤2 chars) and pure numbers
                            const cleaned = unique.filter(l => l.length > 2 && !/^\d+$/.test(l.trim()));
                            const removed = lines.length - cleaned.length;
                            setLeTrainingComments(cleaned.join("\n"));
                            showToast("success", `Optimized: ${removed} duplicates/noise removed, ${cleaned.length} unique lines kept`);
                          }}
                          className="text-xs text-emerald-400/80 cursor-pointer hover:text-emerald-300"
                        >
                          Optimize
                        </button>
                        <span className="text-xs text-white/30">
                          {leTrainingComments.split("\n").filter((l: string) => l.trim()).length} lines loaded
                        </span>
                      </>
                    )}
                  </div>
                  {leImportJobs.length > 0 && (
                    <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                      <p className="text-xs text-white/30 mb-1">Select a job to import comment messages:</p>
                      {leImportJobs.map((j: any) => (
                        <button
                          key={j.id}
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fbActionApi.liveEngageImportComments(j.id);
                              const messages = (res.data.comments || []).map((c: any) => c.message).filter(Boolean);
                              if (messages.length === 0) {
                                showToast("error", "No comments found in this job");
                                return;
                              }
                              setLeTrainingComments((prev: string) =>
                                prev ? prev + "\n" + messages.join("\n") : messages.join("\n")
                              );
                              showToast("success", `Imported ${messages.length} comments from "${j.input_value}"`);
                              setLeImportJobs([]);
                            } catch { showToast("error", "Failed to import comments"); }
                          }}
                          className="w-full text-left px-2 py-1.5 rounded text-xs text-white/60 hover:bg-white/10 transition flex justify-between"
                        >
                          <span className="truncate">{j.input_value}</span>
                          <span className="text-white/25 flex-shrink-0 ml-2">{j.total_items || j.processed_items || 0} items</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">AI Instructions (optional)</label>
                  <textarea
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    rows={2}
                    placeholder="Use Chinese language, keep comments short, reference product codes..."
                    value={leInstructions}
                    onChange={(e) => setLeInstructions(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Comment Language (optional)</label>
                  <div className="flex gap-3">
                    {[
                      { key: "chinese", label: "Chinese" },
                      { key: "english", label: "English" },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={leLanguages.includes(key)}
                          onChange={(e) => {
                            setLeLanguages((prev) =>
                              e.target.checked ? [...prev, key] : prev.filter((l) => l !== key)
                            );
                          }}
                          className="w-4 h-4 rounded bg-white/10 border-white/20 text-amber-500 focus:ring-amber-500/30"
                        />
                        <span className="text-sm text-white/60">{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-white/30 mt-1">Leave unchecked to auto-detect from live comments</p>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Known Product Codes (instant match, e.g. 480,388,168)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="e.g. m763, E769, R2000, G1024"
                    value={leProductCodes}
                    onChange={(e) => setLeProductCodes(e.target.value)}
                  />
                  <p className="text-xs text-white/30 mt-1">Comma-separated. Bot also auto-detects codes from real viewer comments.</p>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Code Pattern Examples (teach format, e.g. 8,1,E204)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="e.g. [a-zA-Z]{1,3}\d{2,5}"
                    value={leCodePattern}
                    onChange={(e) => setLeCodePattern(e.target.value)}
                  />
                  <p className="text-xs text-white/30 mt-1">Custom regex to detect product codes. Default: 1-3 letters + 2-5 digits (m763, AB12).</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={leQuantityVariation}
                      onChange={(e) => setLeQuantityVariation(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-amber-500/60 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                  <div>
                    <span className="text-sm text-white/70">Quantity Variation</span>
                    <p className="text-xs text-white/30">Add +1, +2, +3 to order comments (e.g. &quot;m763 +2&quot;)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={leAutoOrderTrending}
                      onChange={(e) => setLeAutoOrderTrending(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-amber-500/60 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                  <div>
                    <span className="text-sm text-white/70">Auto-Order Trending Codes</span>
                    <p className="text-xs text-white/30">Automatically place orders when a code is mentioned {leAutoOrderThreshold}+ times in 60s</p>
                  </div>
                </div>
                {leAutoOrderTrending && (
                  <div className="pl-12 space-y-2">
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Threshold: {leAutoOrderThreshold} mentions in 60s</label>
                      <input
                        type="range" min={2} max={20} step={1} value={leAutoOrderThreshold}
                        className="w-full accent-amber-400"
                        onChange={(e) => setLeAutoOrderThreshold(parseInt(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Cooldown: {leAutoOrderCooldown}s between auto-orders</label>
                      <input
                        type="range" min={10} max={600} step={10} value={leAutoOrderCooldown}
                        className="w-full accent-amber-400"
                        onChange={(e) => setLeAutoOrderCooldown(parseInt(e.target.value))}
                      />
                      <p className="text-xs text-white/30 mt-0.5">Wait time after each auto-order before next can trigger</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Aggressive Level & Timing */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60">Speed & Timing</h3>

                {/* Aggressive Level */}
                <div>
                  <label className="text-xs text-white/40 block mb-2">Aggressive Level</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["low", "medium", "high"] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => {
                          setLeAggressiveLevel(level);
                          if (level === "low") {
                            setLeScrapeInterval(12); setLeMinDelay(30); setLeMaxDelay(90);
                          } else if (level === "medium") {
                            setLeScrapeInterval(8); setLeMinDelay(15); setLeMaxDelay(60);
                          } else {
                            setLeScrapeInterval(4); setLeMinDelay(5); setLeMaxDelay(20);
                          }
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          leAggressiveLevel === level
                            ? level === "high"
                              ? "bg-red-500/30 border border-red-400/50 text-red-300"
                              : level === "medium"
                                ? "bg-amber-500/30 border border-amber-400/50 text-amber-300"
                                : "bg-emerald-500/30 border border-emerald-400/50 text-emerald-300"
                            : "bg-white/5 border border-white/10 text-white/40 hover:bg-white/10"
                        }`}
                      >
                        {level === "low" ? "Low — Careful" : level === "medium" ? "Medium — Balanced" : "High — Aggressive"}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-white/30 mt-1">
                    {leAggressiveLevel === "low" && "Longer delays, slower pace — safer for smaller streams"}
                    {leAggressiveLevel === "medium" && "Balanced speed — good for most livestreams"}
                    {leAggressiveLevel === "high" && "Short delays, fast commenting — for high-traffic streams"}
                  </p>
                </div>

                {/* Target Comments */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={leTargetEnabled}
                        onChange={(e) => setLeTargetEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-amber-500/60 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                    </label>
                    <div>
                      <span className="text-sm text-white/70">Target Comments</span>
                      <p className="text-xs text-white/30">Set a target number of comments per period — system adjusts pacing automatically</p>
                    </div>
                  </div>
                  {leTargetEnabled && (
                    <div className="grid grid-cols-2 gap-3 pl-12">
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Comments</label>
                        <input
                          type="number"
                          min={1} max={5000} step={10}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                          value={leTargetCount}
                          onChange={(e) => setLeTargetCount(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Per (minutes)</label>
                        <select
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                          value={leTargetPeriod}
                          onChange={(e) => setLeTargetPeriod(parseInt(e.target.value))}
                        >
                          <option value={15}>15 min</option>
                          <option value={30}>30 min</option>
                          <option value={60}>1 hour</option>
                          <option value={120}>2 hours</option>
                          <option value={180}>3 hours</option>
                        </select>
                      </div>
                      <p className="col-span-2 text-xs text-white/30">
                        Pace: ~{(leTargetCount / leTargetPeriod).toFixed(1)} comments/min ({(leTargetPeriod * 60 / leTargetCount).toFixed(0)}s between each)
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1">Scrape Interval: {leScrapeInterval}s</label>
                  <input
                    type="range" min={3} max={30} step={1} value={leScrapeInterval}
                    className="w-full accent-amber-400"
                    onChange={(e) => setLeScrapeInterval(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-white/30 mt-1">How often to fetch new livestream comments</p>
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1">Context Window: {leContextWindow} comments</label>
                  <input
                    type="range" min={10} max={200} step={10} value={leContextWindow}
                    className="w-full accent-amber-400"
                    onChange={(e) => setLeContextWindow(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-white/30 mt-1">How many recent comments to keep for code detection and analysis</p>
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1">AI Context: {leAiContextCount} comments sent to AI</label>
                  <input
                    type="range" min={5} max={50} step={5} value={leAiContextCount}
                    className="w-full accent-amber-400"
                    onChange={(e) => setLeAiContextCount(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-white/30 mt-1">How many recent comments AI reads for generating replies (higher = better context but more tokens)</p>
                </div>

                {/* Comment without new */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={leCommentWithoutNew}
                        onChange={(e) => setLeCommentWithoutNew(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-amber-500/60 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                    </label>
                    <div>
                      <span className="text-sm text-white/70">Comment Without New Viewers</span>
                      <p className="text-xs text-white/30">Generate AI comments even when no new viewer comments arrive</p>
                    </div>
                  </div>
                  {leCommentWithoutNew && (
                    <div className="pl-12">
                      <label className="text-xs text-white/40 block mb-1">Max idle attempts before waiting: {leCommentWithoutNewMax}</label>
                      <input
                        type="range" min={1} max={20} step={1} value={leCommentWithoutNewMax}
                        className="w-full accent-amber-400"
                        onChange={(e) => setLeCommentWithoutNewMax(parseInt(e.target.value))}
                      />
                      <p className="text-xs text-white/30 mt-1">After this many comments without new viewers, pause and wait for activity</p>
                    </div>
                  )}
                </div>
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
                <div>
                  <label className="text-xs text-white/40 block mb-1">Max Duration: {leMaxDuration >= 60 ? `${Math.floor(leMaxDuration / 60)}h${leMaxDuration % 60 > 0 ? ` ${leMaxDuration % 60}m` : ""}` : `${leMaxDuration}m`}</label>
                  <input
                    type="range" min={10} max={720} step={10} value={leMaxDuration}
                    className="w-full accent-amber-400"
                    onChange={(e) => setLeMaxDuration(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-white/30 mt-1">Session auto-stops after this duration</p>
                </div>
              </div>

              {/* Safety & Controls */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="text-sm font-medium text-white/60">Safety & Auto-Stop</h3>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Blacklist Words (optional)</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                    placeholder="spam, scam, fake — comma-separated"
                    value={leBlacklistWords}
                    onChange={(e) => setLeBlacklistWords(e.target.value)}
                  />
                  <p className="text-xs text-white/30 mt-1">Comments containing these words will be skipped and regenerated</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={leStreamEndEnabled}
                        onChange={(e) => setLeStreamEndEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-amber-500/60 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                    </label>
                    <div>
                      <span className="text-sm text-white/70">Stream End Detection</span>
                      <p className="text-xs text-white/30">Auto-stop when stream likely ended (no new comments)</p>
                    </div>
                  </div>
                  {leStreamEndEnabled && (
                    <div className="pl-12">
                      <label className="text-xs text-white/40 block mb-1">Threshold: {leStreamEndThreshold} consecutive empty polls</label>
                      <input
                        type="range" min={3} max={50} step={1} value={leStreamEndThreshold}
                        className="w-full accent-amber-400"
                        onChange={(e) => setLeStreamEndThreshold(parseInt(e.target.value))}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Schedule Start (optional)</label>
                  <input
                    type="datetime-local"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                    value={leScheduledAt}
                    onChange={(e) => setLeScheduledAt(e.target.value)}
                  />
                  <p className="text-xs text-white/30 mt-1">{leScheduledAt ? "Session will start at the scheduled time" : "Leave empty to start immediately"}</p>
                </div>
              </div>

              {/* Presets */}
              <div className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white/60">Presets</h3>
                  <button
                    type="button"
                    onClick={async () => {
                      const name = prompt("Preset name:");
                      if (!name) return;
                      try {
                        await fbActionApi.liveEngageSavePreset({
                          name,
                          role_distribution: leRoles,
                          business_context: leContext,
                          training_comments: leTrainingComments || undefined,
                          ai_instructions: leInstructions || undefined,
                      languages: leLanguages.length > 0 ? leLanguages : undefined,
                          product_codes: leProductCodes.trim() || undefined,
                          code_pattern: leCodePattern.trim() || undefined,
                          quantity_variation: leQuantityVariation,
                          aggressive_level: leAggressiveLevel,
                          scrape_interval_seconds: leScrapeInterval,
                      context_window: leContextWindow,
                      ai_context_count: leAiContextCount,
                          min_delay_seconds: leMinDelay,
                          max_delay_seconds: leMaxDelay,
                          max_duration_minutes: leMaxDuration,
                          target_comments_enabled: leTargetEnabled,
                          target_comments_count: leTargetCount,
                          target_comments_period_minutes: leTargetPeriod,
                          comment_without_new: leCommentWithoutNew,
                      auto_order_trending: leAutoOrderTrending,
                      auto_order_trending_threshold: leAutoOrderTrending ? leAutoOrderThreshold : undefined,
                      auto_order_trending_cooldown: leAutoOrderTrending ? leAutoOrderCooldown : undefined,
                          comment_without_new_max: leCommentWithoutNew ? leCommentWithoutNewMax : undefined,
                          blacklist_words: leBlacklistWords.trim() || undefined,
                          stream_end_threshold: leStreamEndEnabled ? leStreamEndThreshold : 0,
                        });
                        showToast("success", `Preset "${name}" saved`);
                        const res = await fbActionApi.liveEngagePresets();
                        setLePresets(res.data.presets || []);
                      } catch { showToast("error", "Failed to save preset"); }
                    }}
                    className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white/40 hover:bg-white/10"
                  >Save Current</button>
                </div>
                {lePresets.length > 0 ? (
                  <div className="space-y-1">
                    {lePresets.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (p.role_distribution) setLeRoles(p.role_distribution);
                            setLeContext(p.business_context || "");
                            setLeTrainingComments(p.training_comments || "");
                            setLeInstructions(p.ai_instructions || "");
                            setLeProductCodes(p.product_codes || "");
                            setLeCodePattern(p.code_pattern || "");
                            setLeQuantityVariation(p.quantity_variation ?? true);
                            setLeAggressiveLevel(p.aggressive_level || "medium");
                            setLeScrapeInterval(p.scrape_interval_seconds || 8);
                            setLeContextWindow(p.context_window || 50);
                            setLeAiContextCount(p.ai_context_count || 15);
                            setLeMinDelay(p.min_delay_seconds || 15);
                            setLeMaxDelay(p.max_delay_seconds || 60);
                            setLeMaxDuration(p.max_duration_minutes || 180);
                            setLeTargetEnabled(p.target_comments_enabled || false);
                            setLeTargetCount(p.target_comments_count || 100);
                            setLeTargetPeriod(p.target_comments_period_minutes || 60);
                            setLeLanguages(Array.isArray(p.languages) ? p.languages : typeof p.languages === "string" ? p.languages.split(",").map((s: string) => s.trim()).filter(Boolean) : []);
                            setLeCommentWithoutNew(p.comment_without_new || false);
                            setLeCommentWithoutNewMax(p.comment_without_new_max || 3);
                            setLeBlacklistWords(p.blacklist_words || "");
                            setLeStreamEndEnabled((p.stream_end_threshold || 0) > 0);
                            setLeStreamEndThreshold(p.stream_end_threshold || 10);
                            setLeAutoOrderTrending(p.auto_order_trending || false);
                            setLeAutoOrderThreshold(p.auto_order_trending_threshold || 3);
                            setLeAutoOrderCooldown(p.auto_order_trending_cooldown || 60);
                            showToast("success", `Loaded preset: ${p.name}`);
                          }}
                          className="text-xs text-white/70 hover:text-white"
                        >{p.name}</button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await fbActionApi.liveEngageDeletePreset(p.id);
                              setLePresets((prev) => prev.filter((x: any) => x.id !== p.id));
                            } catch { showToast("error", "Failed to delete"); }
                          }}
                          className="text-xs text-white/20 hover:text-red-300"
                        >Delete</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-white/30">No presets saved yet — save your current config for quick reuse</p>
                )}
              </div>

              {/* Preview + Start */}
              <div className="space-y-2">
                {/* Preview Button */}
                <button
                  type="button"
                  disabled={lePreviewLoading}
                  onClick={async () => {
                    setLePreviewLoading(true);
                    try {
                      const res = await fbActionApi.liveEngagePreview({
                        post_id: lePostId.trim() || "preview",
                        role_distribution: leRoles,
                        business_context: leContext,
                        training_comments: leTrainingComments || undefined,
                        ai_instructions: leInstructions || undefined,
                      languages: leLanguages.length > 0 ? leLanguages : undefined,
                        product_codes: leProductCodes.trim() || undefined,
                        quantity_variation: leQuantityVariation,
                      });
                      setLePreviewSamples(res.data.samples || []);
                    } catch { showToast("error", "Preview failed"); }
                    setLePreviewLoading(false);
                  }}
                  className="w-full py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 transition-all"
                >
                  {lePreviewLoading ? "Generating..." : "Preview 5 Sample Comments"}
                </button>
                {lePreviewSamples.length > 0 && (
                  <div className="glass-card p-3 space-y-1">
                    {lePreviewSamples.map((s: any, i: number) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="text-amber-400/60 w-28 shrink-0">{s.role?.replace(/_/g, " ")}</span>
                        <span className="text-white/70">{s.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Start Button */}
              <button
                disabled={leStarting || !lePostId.trim() || (leAccountSource === "batch" ? !leLoginBatchId : leDirectAccounts.length < 2) || Object.values(leRoles).reduce((a, b) => a + b, 0) !== 100}
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
                      page_owner_id: lePageOwnerId.trim() || undefined,
                      login_batch_id: leAccountSource === "batch" ? leLoginBatchId : undefined,
                      direct_accounts: leAccountSource === "csv" ? leDirectAccounts : undefined,
                      role_distribution: leRoles,
                      business_context: leContext,
                      training_comments: leTrainingComments || undefined,
                      ai_instructions: leInstructions || undefined,
                      languages: leLanguages.length > 0 ? leLanguages : undefined,
                      scrape_interval_seconds: leScrapeInterval,
                      context_window: leContextWindow,
                      ai_context_count: leAiContextCount,
                      product_codes: leProductCodes.trim() || undefined,
                      code_pattern: leCodePattern.trim() || undefined,
                      quantity_variation: leQuantityVariation,
                      aggressive_level: leAggressiveLevel,
                      target_comments_enabled: leTargetEnabled,
                      target_comments_count: leTargetEnabled ? leTargetCount : undefined,
                      target_comments_period_minutes: leTargetEnabled ? leTargetPeriod : undefined,
                      comment_without_new: leCommentWithoutNew,
                      auto_order_trending: leAutoOrderTrending,
                      auto_order_trending_threshold: leAutoOrderTrending ? leAutoOrderThreshold : undefined,
                      auto_order_trending_cooldown: leAutoOrderTrending ? leAutoOrderCooldown : undefined,
                      comment_without_new_max: leCommentWithoutNew ? leCommentWithoutNewMax : undefined,
                      blacklist_words: leBlacklistWords.trim() || undefined,
                      stream_end_threshold: leStreamEndEnabled ? leStreamEndThreshold : 0,
                      scheduled_at: leScheduledAt ? new Date(leScheduledAt).toISOString() : undefined,
                      min_delay_seconds: leMinDelay,
                      max_delay_seconds: leMaxDelay,
                      max_duration_minutes: leMaxDuration,
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
                        if (!["running", "paused"].includes(statusRes.data.status)) {
                          if (lePollRef.current) clearInterval(lePollRef.current);
                        }
                      } catch { /* ignore poll errors */ }
                    }, 5000);
                  } catch (err: any) {
                    showToast("error", typeof err?.response?.data?.detail === "string" ? err.response.data.detail : "Failed to start engagement");
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
              {/* Session History */}
              {leHistory.length > 0 && (
                <div className="glass-card p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white/60">Session History</h3>
                    <div className="flex gap-2">
                      <select
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/60 focus:outline-none"
                        value={leHistoryFilter}
                        onChange={(e) => {
                          setLeHistoryFilter(e.target.value);
                          fbActionApi.liveEngageHistory({ page: 1, page_size: 20, status: e.target.value || undefined, search: leHistorySearch || undefined })
                            .then((r) => setLeHistory(r.data.sessions || [])).catch(() => {});
                        }}
                      >
                        <option value="">All Status</option>
                        <option value="running">Running</option>
                        <option value="paused">Paused</option>
                        <option value="completed">Completed</option>
                        <option value="stopped">Stopped</option>
                        <option value="failed">Failed</option>
                      </select>
                      <input
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/60 placeholder-white/20 w-32 focus:outline-none"
                        placeholder="Search..."
                        value={leHistorySearch}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLeHistorySearch(val);
                          // Debounce search — wait 400ms after typing stops
                          clearTimeout((window as any).__leSearchTimer);
                          (window as any).__leSearchTimer = setTimeout(() => {
                            fbActionApi.liveEngageHistory({ page: 1, page_size: 20, status: leHistoryFilter || undefined, search: val || undefined })
                              .then((r) => setLeHistory(r.data.sessions || [])).catch(() => {});
                          }, 400);
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    {leHistory.map((s: any) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 hover:bg-white/10 cursor-pointer transition"
                        onClick={() => {
                          fbActionApi.liveEngageStatus(s.id).then((r) => {
                            setLiveEngageSession(r.data);
                            setLiveEngageLogs(r.data.logs || []);
                            setLiveEngagePhase("running");
                            // Start polling if session is still active
                            if (["running", "paused"].includes(r.data.status)) {
                              if (lePollRef.current) clearInterval(lePollRef.current);
                              const sid = r.data.id;
                              lePollRef.current = setInterval(async () => {
                                try {
                                  const statusRes = await fbActionApi.liveEngageStatus(sid);
                                  setLiveEngageSession(statusRes.data);
                                  setLiveEngageLogs(statusRes.data.logs || []);
                                  if (!["running", "paused"].includes(statusRes.data.status)) {
                                    if (lePollRef.current) clearInterval(lePollRef.current);
                                  }
                                } catch { /* ignore poll errors */ }
                              }, 5000);
                            }
                          }).catch(() => showToast("error", "Failed to load session"));
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            s.status === "running" ? "bg-red-500 animate-pulse" :
                            s.status === "paused" ? "bg-amber-500" :
                            s.status === "completed" ? "bg-emerald-500" :
                            "bg-white/20"
                          }`} />
                          <span className="text-xs text-white/70">{s.title || s.post_id}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            s.status === "running" ? "bg-red-500/20 text-red-300" :
                            s.status === "paused" ? "bg-amber-500/20 text-amber-300" :
                            s.status === "completed" ? "bg-emerald-500/20 text-emerald-300" :
                            "bg-white/10 text-white/40"
                          }`}>{s.status}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-white/30">
                          <span>{s.total_comments_posted} posted</span>
                          <span>{s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Live Dashboard ── */
            <div className="space-y-4">
              {/* Header */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      liveEngageSession?.status === "running" ? "bg-red-500 animate-pulse" :
                      liveEngageSession?.status === "paused" ? "bg-amber-500" : "bg-white/20"
                    }`} />
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
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await fbActionApi.liveEngagePause(liveEngageSession.id);
                            showToast("success", "Engagement paused");
                            setLiveEngageSession((prev: any) => prev ? { ...prev, status: "paused" } : prev);
                          } catch { showToast("error", "Failed to pause"); }
                        }}
                        className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-sm font-medium transition"
                      >
                        ⏸ Pause
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm("Are you sure you want to stop this engagement session? This cannot be undone.")) return;
                          try {
                            await fbActionApi.liveEngageStop(liveEngageSession.id);
                            showToast("success", "Engagement stopped");
                            setLiveEngageSession((prev: any) => prev ? { ...prev, status: "stopped" } : prev);
                            if (lePollRef.current) clearInterval(lePollRef.current);
                          } catch (err: any) { showToast("error", typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Failed to stop"); }
                        }}
                        className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition"
                      >
                        ⏹ Stop
                      </button>
                    </div>
                  )}
                  {liveEngageSession?.status === "paused" && (
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await fbActionApi.liveEngageResume(liveEngageSession.id);
                            showToast("success", "Engagement resumed");
                            setLiveEngageSession((prev: any) => prev ? { ...prev, status: "running" } : prev);
                          } catch { showToast("error", "Failed to resume"); }
                        }}
                        className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-sm font-medium transition"
                      >
                        ▶ Resume
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm("Are you sure you want to stop this engagement session? This cannot be undone.")) return;
                          try {
                            await fbActionApi.liveEngageStop(liveEngageSession.id);
                            showToast("success", "Engagement stopped");
                            setLiveEngageSession((prev: any) => prev ? { ...prev, status: "stopped" } : prev);
                            if (lePollRef.current) clearInterval(lePollRef.current);
                          } catch (err: any) { showToast("error", typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Failed to stop"); }
                        }}
                        className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition"
                      >
                        ⏹ Stop
                      </button>
                    </div>
                  )}
                  {liveEngageSession?.status && !["running", "paused"].includes(liveEngageSession.status) && (
                    <button
                      onClick={() => {
                        setLiveEngagePhase("setup");
                        setLiveEngageSession(null);
                        setLiveEngageLogs([]);
                        if (lePollRef.current) { clearInterval(lePollRef.current); lePollRef.current = null; }
                        // Reload history
                        fbActionApi.liveEngageHistory({ page: 1, page_size: 20 }).then((r) => setLeHistory(r.data.sessions || [])).catch(() => {});
                      }}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-sm font-medium transition"
                    >
                      New Session
                    </button>
                  )}
                </div>
              </div>

              {/* Priority Code Trigger Queue */}
              {["running", "paused"].includes(liveEngageSession?.status) && (
                <div className="glass-card p-5 space-y-3">
                  <h3 className="text-xs font-medium text-white/40">Priority Trigger Queue</h3>
                  {/* Add trigger form */}
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="text-xs text-white/30 block mb-1">Code</label>
                      <input
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                        placeholder="e.g. L6, m763, 8号"
                        value={leTriggerCode}
                        onChange={(e) => setLeTriggerCode(e.target.value)}
                      />
                    </div>
                    <div className="w-20">
                      <label className="text-xs text-white/30 block mb-1">Count</label>
                      <input type="number" min={1} max={50} value={leTriggerCount}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm text-white focus:outline-none"
                        onChange={(e) => setLeTriggerCount(Math.max(1, parseInt(e.target.value) || 1))} />
                    </div>
                    <div className="w-20">
                      <label className="text-xs text-white/30 block mb-1">Minutes</label>
                      <input type="number" min={1} max={10} value={leTriggerDuration}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm text-white focus:outline-none"
                        onChange={(e) => setLeTriggerDuration(Math.max(1, parseInt(e.target.value) || 1))} />
                    </div>
                    <button
                      disabled={leTriggerLoading || !leTriggerCode.trim()}
                      onClick={async () => {
                        setLeTriggerLoading(true);
                        try {
                          await fbActionApi.liveEngageTriggerCode(liveEngageSession.id, {
                            code: leTriggerCode.trim(), count: leTriggerCount, duration_minutes: leTriggerDuration,
                          });
                          showToast("success", `Added to queue: ${leTriggerCode} x${leTriggerCount}`);
                          setLeTriggerCode("");
                        } catch (err: any) { showToast("error", typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Failed"); }
                        setLeTriggerLoading(false);
                      }}
                      className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-sm font-medium transition disabled:opacity-40"
                    >{leTriggerLoading ? "..." : "+ Add"}</button>
                  </div>
                  {/* Detected codes quick-select */}
                  {liveEngageSession?.live_metrics?.detected_codes?.length > 0 && (
                    <div>
                      <p className="text-xs text-white/30 mb-1">Detected codes (click to add):</p>
                      <div className="flex flex-wrap gap-1">
                        {liveEngageSession.live_metrics.detected_codes.map((code: string, i: number) => (
                          <button key={i} type="button" onClick={() => setLeTriggerCode(code)}
                            className={`px-2 py-0.5 rounded text-xs transition ${leTriggerCode === code ? "bg-amber-500/30 border border-amber-400/50 text-amber-300" : "bg-white/5 border border-white/10 text-white/50 hover:bg-white/10"}`}
                          >{code}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Queue list */}
                  {(liveEngageSession?.pending_actions?.trigger_queue || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-white/30">Queue ({(liveEngageSession.pending_actions.trigger_queue || []).filter((t: any) => t.status !== "completed").length} active):</p>
                      {(liveEngageSession.pending_actions.trigger_queue || []).map((t: any, i: number) => (
                        <div key={t.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                          t.status === "running" ? "bg-red-500/10 border border-red-500/20" :
                          t.status === "paused" ? "bg-amber-500/10 border border-amber-500/20" :
                          t.status === "completed" ? "bg-white/5 border border-white/5 opacity-50" :
                          "bg-white/5 border border-white/10"
                        }`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              t.status === "running" ? "bg-red-500 animate-pulse" :
                              t.status === "paused" ? "bg-amber-500" :
                              t.status === "completed" ? "bg-emerald-500" : "bg-white/30"
                            }`} />
                            <span className="text-white/70 font-medium">{t.code}</span>
                            <span className="text-white/30">x{t.count} / {t.duration_minutes}min</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              t.status === "running" ? "bg-red-500/20 text-red-300" :
                              t.status === "paused" ? "bg-amber-500/20 text-amber-300" :
                              t.status === "completed" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/40"
                            }`}>{t.status}</span>
                          </div>
                          {t.status !== "completed" && (
                            <div className="flex gap-1">
                              {i > 0 && t.status === "pending" && (
                                <button type="button" onClick={() => fbActionApi.liveEngageUpdateTrigger(liveEngageSession.id, t.id, { action: "move_up" })}
                                  className="px-1.5 py-0.5 text-white/30 hover:text-white/60">↑</button>
                              )}
                              {t.status === "pending" && (
                                <button type="button" onClick={() => fbActionApi.liveEngageUpdateTrigger(liveEngageSession.id, t.id, { action: "move_down" })}
                                  className="px-1.5 py-0.5 text-white/30 hover:text-white/60">↓</button>
                              )}
                              {t.status === "running" && (
                                <button type="button" onClick={() => fbActionApi.liveEngageUpdateTrigger(liveEngageSession.id, t.id, { action: "pause" })}
                                  className="px-1.5 py-0.5 text-amber-400/60 hover:text-amber-300">⏸</button>
                              )}
                              {t.status === "paused" && (
                                <button type="button" onClick={() => fbActionApi.liveEngageUpdateTrigger(liveEngageSession.id, t.id, { action: "resume" })}
                                  className="px-1.5 py-0.5 text-emerald-400/60 hover:text-emerald-300">▶</button>
                              )}
                              <button type="button" onClick={() => fbActionApi.liveEngageUpdateTrigger(liveEngageSession.id, t.id, { action: "delete" })}
                                className="px-1.5 py-0.5 text-red-400/60 hover:text-red-300">✕</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Edit Settings (live) */}
              {["running", "paused"].includes(liveEngageSession?.status) && (
                <div className="glass-card p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium text-white/40">Live Settings</h3>
                    <button
                      type="button"
                      onClick={() => setLeEditSettings(!leEditSettings)}
                      className="text-xs text-white/40 hover:text-white/60"
                    >{leEditSettings ? "Close" : "Edit Settings"}</button>
                  </div>
                  {leEditSettings && (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-white/30 block mb-1">Aggressive Level</label>
                          <select id="le-live-aggro" defaultValue={liveEngageSession?.aggressive_level || "medium"}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-white/30 block mb-1">Quantity Variation</label>
                          <select id="le-live-qty" defaultValue={liveEngageSession?.quantity_variation !== false ? "true" : "false"}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
                            <option value="true">On</option>
                            <option value="false">Off</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-white/30 block mb-1">Min Delay (s)</label>
                          <input id="le-live-min" type="number" min={3} max={120} defaultValue={liveEngageSession?.min_delay_seconds || 15}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-white/30 block mb-1">Max Delay (s)</label>
                          <input id="le-live-max" type="number" min={5} max={300} defaultValue={liveEngageSession?.max_delay_seconds || 60}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-white/30 block mb-1">Blacklist Words</label>
                        <input id="le-live-blacklist" defaultValue={liveEngageSession?.blacklist_words || ""}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none"
                          placeholder="comma-separated" />
                      </div>
                      <div>
                        <label className="text-xs text-white/30 block mb-1">AI Instructions</label>
                        <textarea id="le-live-ai" defaultValue={liveEngageSession?.ai_instructions || ""} rows={2}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none" />
                      </div>
                      <button
                        onClick={async () => {
                          const updates: Record<string, unknown> = {};
                          const aggro = (document.getElementById("le-live-aggro") as HTMLSelectElement)?.value;
                          const qty = (document.getElementById("le-live-qty") as HTMLSelectElement)?.value;
                          const minD = parseInt((document.getElementById("le-live-min") as HTMLInputElement)?.value);
                          const maxD = parseInt((document.getElementById("le-live-max") as HTMLInputElement)?.value);
                          const bl = (document.getElementById("le-live-blacklist") as HTMLInputElement)?.value;
                          const ai = (document.getElementById("le-live-ai") as HTMLTextAreaElement)?.value;
                          if (aggro) updates.aggressive_level = aggro;
                          updates.quantity_variation = qty === "true";
                          if (!isNaN(minD) && minD > 0) updates.min_delay_seconds = minD;
                          if (!isNaN(maxD) && maxD > 0) updates.max_delay_seconds = maxD;
                          updates.blacklist_words = bl || "";
                          updates.ai_instructions = ai || "";
                          try {
                            const res = await fbActionApi.liveEngageUpdateSettings(liveEngageSession.id, updates);
                            showToast("success", `Updated: ${(res.data.updated || []).join(", ")}`);
                            setLeEditSettings(false);
                          } catch (err: any) { showToast("error", typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Update failed"); }
                        }}
                        className="w-full py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-xs font-medium transition"
                      >Apply Changes</button>
                    </div>
                  )}
                </div>
              )}

              {/* Live Metrics */}
              {liveEngageSession?.live_metrics && (
                <div className="glass-card p-5">
                  <h3 className="text-xs font-medium text-white/40 mb-3">Live Metrics</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-lg font-medium text-amber-300">{liveEngageSession.live_metrics.velocity_cpm || 0}</div>
                      <div className="text-xs text-white/30">CPM</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-lg font-medium text-emerald-300">{((liveEngageSession.live_metrics.code_ratio || 0) * 100).toFixed(0)}%</div>
                      <div className="text-xs text-white/30">Code Ratio</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-lg font-medium text-blue-300">{liveEngageSession.live_metrics.active_accounts || liveEngageSession.active_accounts}</div>
                      <div className="text-xs text-white/30">Active Accounts</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className={`text-lg font-medium ${(liveEngageSession.live_metrics.consecutive_errors || 0) > 5 ? "text-red-300" : "text-white/60"}`}>{liveEngageSession.live_metrics.consecutive_errors || 0}</div>
                      <div className="text-xs text-white/30">Consec. Errors</div>
                    </div>
                  </div>
                  {/* Current Product */}
                  {liveEngageSession.live_metrics.current_product && (
                    <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-xs text-white/40">Current Product:</span>
                        <span className="text-sm font-bold text-emerald-300">{liveEngageSession.live_metrics.current_product}</span>
                        <span className="text-[10px] text-white/20">— place_order uses this code</span>
                      </div>
                    </div>
                  )}

                  {/* Product History */}
                  {(liveEngageSession.live_metrics.product_history || []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-white/30 mb-1">Product Timeline:</div>
                      <div className="flex flex-wrap gap-1">
                        {(liveEngageSession.live_metrics.product_history || []).map((p: any, i: number) => (
                          <span key={i} className={`px-2 py-0.5 rounded text-xs ${
                            !p.ended_at ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                            "bg-white/5 text-white/30"
                          }`}>
                            {p.code} {!p.ended_at ? "(now)" : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detected Codes */}
                  {(liveEngageSession.live_metrics.detected_codes || []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-white/30 mb-1">All Detected Codes:</div>
                      <div className="flex flex-wrap gap-1">
                        {liveEngageSession.live_metrics.detected_codes.map((code: string, i: number) => (
                          <span key={i} className={`px-2 py-0.5 rounded text-xs ${
                            code === liveEngageSession.live_metrics.current_product
                              ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                              : "bg-amber-500/10 border border-amber-500/20 text-amber-300"
                          }`}>{code}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity + Role Distribution */}
              {liveEngageLogs.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Activity Timeline (CSS bars) */}
                  <div className="glass-card p-5">
                    <h3 className="text-xs font-medium text-white/40 mb-3">Activity Timeline</h3>
                    <div className="flex items-end gap-0.5 h-32">
                      {(() => {
                        const buckets: Record<string, { success: number; error: number }> = {};
                        liveEngageLogs.slice().reverse().forEach((log: any) => {
                          if (!log.created_at) return;
                          const key = new Date(log.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                          if (!buckets[key]) buckets[key] = { success: 0, error: 0 };
                          if (log.status === "success") buckets[key].success++;
                          else buckets[key].error++;
                        });
                        const entries = Object.entries(buckets).slice(-20);
                        const maxVal = Math.max(...entries.map(([, v]) => v.success + v.error), 1);
                        return entries.map(([time, v]) => (
                          <div key={time} className="flex-1 flex flex-col justify-end items-center group relative">
                            <div className="absolute -top-5 hidden group-hover:block text-[9px] text-white/50 whitespace-nowrap">{time} ({v.success}✓ {v.error}✗)</div>
                            <div className="w-full bg-emerald-500/40 rounded-t" style={{ height: `${(v.success / maxVal) * 100}%`, minHeight: v.success ? 2 : 0 }} />
                            <div className="w-full bg-red-500/40 rounded-b" style={{ height: `${(v.error / maxVal) * 100}%`, minHeight: v.error ? 2 : 0 }} />
                          </div>
                        ));
                      })()}
                    </div>
                    <div className="flex justify-between mt-1 text-[9px] text-white/20">
                      <span>Older</span>
                      <span className="flex gap-3"><span className="text-emerald-400">■ Success</span><span className="text-red-400">■ Error</span></span>
                      <span>Recent</span>
                    </div>
                  </div>

                  {/* Role Distribution (CSS bars) */}
                  <div className="glass-card p-5">
                    <h3 className="text-xs font-medium text-white/40 mb-3">Role Distribution</h3>
                    {(() => {
                      const roles = Object.entries(liveEngageSession?.comments_by_role || {});
                      const total = roles.reduce((sum, [, c]) => sum + (c as number), 0) || 1;
                      const colors = ["bg-amber-500", "bg-blue-500", "bg-purple-500", "bg-emerald-500", "bg-pink-500", "bg-cyan-500"];
                      return roles.length > 0 ? (
                        <div className="space-y-2">
                          {roles.map(([role, count], i) => (
                            <div key={role}>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-white/50 capitalize">{role.replace(/_/g, " ")}</span>
                                <span className="text-white/40">{count as number} ({((count as number) / total * 100).toFixed(0)}%)</span>
                              </div>
                              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <div className={`h-full ${colors[i % 6]} rounded-full transition-all`} style={{ width: `${((count as number) / total) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-white/30 text-xs text-center py-4">Waiting for data...</p>;
                    })()}
                  </div>
                </div>
              )}

              {/* Role Stats + Distribution Chart */}
              <div className="glass-card p-5">
                <h3 className="text-xs font-medium text-white/40 mb-3">Role Stats</h3>
                {(() => {
                  const roleData = liveEngageSession?.comments_by_role || {};
                  const totalPosted = Object.values(roleData).reduce((a: number, b: any) => a + (b as number), 0);
                  const roleColors: Record<string, string> = {
                    place_order: "bg-amber-500", ask_question: "bg-blue-500",
                    repeat_question: "bg-purple-500", good_vibe: "bg-emerald-500",
                    react_comment: "bg-cyan-500", share_experience: "bg-pink-500",
                    auto_order: "bg-red-500", triggered: "bg-orange-500",
                  };
                  return Object.keys(roleData).length > 0 ? (
                    <div className="space-y-3">
                      {/* Number grid */}
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {Object.entries(roleData).map(([role, count]) => (
                          <div key={role} className="bg-white/5 rounded-lg p-2 text-center">
                            <div className="text-lg font-semibold text-white">{count as number}</div>
                            <div className="text-[10px] text-white/40 capitalize">{role.replace(/_/g, " ")}</div>
                          </div>
                        ))}
                      </div>
                      {/* Progress bar chart */}
                      {totalPosted > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-white/5">
                          {Object.entries(roleData)
                            .sort(([,a]: any, [,b]: any) => b - a)
                            .map(([role, count]) => {
                              const pct = Math.round(((count as number) / totalPosted) * 100);
                              return (
                                <div key={role} className="flex items-center gap-2 text-xs">
                                  <span className="w-28 text-white/40 capitalize truncate">{role.replace(/_/g, " ")}</span>
                                  <div className="flex-1 bg-white/5 rounded-full h-3 overflow-hidden">
                                    <div className={`h-full rounded-full ${roleColors[role] || "bg-white/30"} transition-all duration-500`}
                                      style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="w-14 text-right text-white/30">{count as number} ({pct}%)</span>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-white/30 text-xs">Waiting for first comment...</p>
                  );
                })()}
              </div>

              {/* Activity Log */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium text-white/40">Activity Log ({liveEngageLogs.length} entries)</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fbActionApi.liveEngageExport(liveEngageSession.id, "csv");
                          const url = window.URL.createObjectURL(res.data instanceof Blob ? res.data : new Blob([res.data]));
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `engagement_report_${liveEngageSession.post_id}.csv`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch { showToast("error", "Export failed"); }
                      }}
                      className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white/40 hover:bg-white/10"
                    >Export CSV</button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fbActionApi.liveEngageExport(liveEngageSession.id, "json");
                          const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `engagement_report_${liveEngageSession.post_id}.json`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch { showToast("error", "Export failed"); }
                      }}
                      className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white/40 hover:bg-white/10"
                    >Export JSON</button>
                  </div>
                </div>
                <div className="space-y-0 max-h-[500px] overflow-y-auto">
                  {liveEngageLogs.length === 0 && (
                    <p className="text-white/30 text-xs py-4 text-center">No activity yet...</p>
                  )}
                  {liveEngageLogs.map((log: any) => (
                    <details key={log.id} className="group border-b border-white/5">
                      <summary className="flex items-center gap-2 text-xs py-2 cursor-pointer hover:bg-white/5 px-2 rounded">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${log.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                        <span className="text-white/25 w-16 flex-shrink-0 font-mono">
                          {log.created_at ? new Date(log.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
                        </span>
                        <span className={`w-24 flex-shrink-0 capitalize font-medium ${
                          log.role === "auto_order" ? "text-orange-400/90 font-bold" :
                          log.role === "triggered" ? "text-red-400/90 font-bold" :
                          log.role === "place_order" ? "text-amber-400/70" :
                          log.role === "ask_question" ? "text-blue-400/70" :
                          log.role === "react_comment" ? "text-purple-400/70" :
                          log.role === "repeat_question" ? "text-cyan-400/70" :
                          log.role === "good_vibe" ? "text-emerald-400/70" :
                          "text-pink-400/70"
                        }`}>{log.role === "auto_order" ? "🔥 Auto Order" : log.role === "triggered" ? "⚡ Triggered" : log.role?.replace(/_/g, " ")}</span>
                        <span className="text-white/25 w-32 flex-shrink-0 truncate">{log.account_email}</span>
                        <span className={`flex-1 truncate ${log.status === "success" ? "text-white/60" : "text-red-400/60"}`}>
                          {log.status === "success" ? log.content : (log.error_message || "Error")}
                        </span>
                      </summary>
                      <div className="pl-8 pr-4 pb-3 pt-1 space-y-1.5 bg-white/[0.02] rounded-b">
                        <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-xs">
                          <span className="text-white/25">Status</span>
                          <span className={log.status === "success" ? "text-emerald-400" : "text-red-400"}>{log.status}</span>
                          <span className="text-white/25">Account</span>
                          <span className="text-white/50 font-mono">{log.account_email}</span>
                          <span className="text-white/25">Time</span>
                          <span className="text-white/50">{log.created_at ? new Date(log.created_at).toLocaleString() : "N/A"}</span>
                          {log.status === "success" && (
                            <>
                              <span className="text-white/25">Content</span>
                              <span className="text-white/70">{log.content}</span>
                            </>
                          )}
                          {log.reference_comment && (
                            <>
                              <span className="text-white/25">Replying to</span>
                              <span className="text-white/40 italic">{log.reference_comment}</span>
                            </>
                          )}
                          {log.error_message && (
                            <>
                              <span className="text-white/25">Error</span>
                              <span className="text-red-400/70 break-all">{log.error_message}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Toast */}
      {/* DOM Batch Picker Modal */}
      {domBatchPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDomBatchPickerOpen(false)} />
          <div className="relative bg-[#0f1729] border border-white/10 rounded-2xl w-full max-w-md max-h-[60vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-[#0f1729] border-b border-white/5 p-5 flex items-center justify-between z-10">
              <h3 className="text-sm font-semibold text-white">Select Login Batch for DOM Check</h3>
              <button onClick={() => setDomBatchPickerOpen(false)} className="text-white/40 hover:text-white transition">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-4 space-y-2">
              {domBatchPickerBatches.length === 0 ? (
                <div className="text-xs text-amber-400/60 bg-amber-400/5 p-3 rounded-lg border border-amber-400/10">
                  No login batches with valid cookies found. Go to Accounts tab to batch login first.
                </div>
              ) : (
                <>
                  <p className="text-[10px] text-white/30 mb-2">Click a batch to start DOM check with one of its logged-in accounts.</p>
                  {domBatchPickerBatches.map((b: any) => (
                    <button
                      key={b.id}
                      onClick={async () => {
                        setDomBatchPickerOpen(false);
                        setSelectorChecking(true);
                        try {
                          const res = await fbActionApi.startDOMCheck({ login_batch_id: b.id });
                          const checkData = res.data;
                          const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                          const authToken = localStorage.getItem("access_token") || "";
                          window.postMessage({ type: "SOCYBASE_START_DOM_CHECK", checkData, apiUrl, authToken }, "*");
                        } catch (e: any) {
                          setSelectorChecking(false);
                          showToast("error", typeof e.response?.data?.detail === "string" ? e.response.data.detail : "Failed to start DOM check");
                        }
                      }}
                      className="w-full flex items-center justify-between p-3 bg-white/[0.02] hover:bg-white/[0.05] rounded-lg border border-white/5 hover:border-purple-500/20 transition text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/50 font-mono">{b.id.slice(0, 8)}</span>
                        <span className="text-xs text-green-400">{b.success_count} accounts</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          b.status === "completed" ? "bg-green-500/10 text-green-400" :
                          b.status === "running" ? "bg-amber-500/10 text-amber-400" :
                          "bg-white/5 text-white/30"
                        }`}>{b.status}</span>
                      </div>
                      <span className="text-[10px] text-white/30">
                        {b.created_at ? new Date(b.created_at).toLocaleDateString() : ""}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
              {typeof toast.message === "string" ? toast.message : JSON.stringify(toast.message)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
