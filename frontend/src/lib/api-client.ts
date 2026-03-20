import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle 401 responses - attempt refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem("refresh_token");

      if (refreshToken) {
        try {
          const res = await axios.post(`${API_BASE}/api/v1/auth/refresh`, {
            refresh_token: refreshToken,
          });
          const { access_token, refresh_token } = res.data;
          localStorage.setItem("access_token", access_token);
          localStorage.setItem("refresh_token", refresh_token);
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
        }
      } else {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: (data: {
    email: string;
    password: string;
    full_name: string;
    tenant_name: string;
  }) => api.post("/auth/register", data),
  login: (data: { email: string; password: string }) =>
    api.post("/auth/login", data),
  forgotPassword: (email: string) =>
    api.post("/auth/forgot-password", { email }),
  resetPassword: (data: { token: string; new_password: string }) =>
    api.post("/auth/reset-password", data),
  me: () => api.get("/auth/me"),
  updateProfile: (data: { full_name?: string; language?: string }) =>
    api.put("/auth/me", data),
  exchangeOAuthCode: (code: string) =>
    api.post(`/auth/google/exchange?code=${encodeURIComponent(code)}`),
};

// Jobs API
export const jobsApi = {
  create: (data: {
    platform: string;
    job_type?: string;
    input_type: string;
    input_value: string;
    scheduled_at?: string;
    settings?: Record<string, unknown>;
  }) => api.post("/jobs", data),
  list: (params?: { page?: number; page_size?: number; status?: string }) =>
    api.get("/jobs", { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  getProgress: (id: string) => api.get(`/jobs/${id}/progress`),
  cancel: (id: string) => api.delete(`/jobs/${id}`),
  resume: (id: string, data?: { profile_retry_count?: number }) =>
    api.post(`/jobs/${id}/resume`, data || {}),
  getResults: (id: string, params?: { page?: number; page_size?: number }) =>
    api.get(`/jobs/${id}/results`, { params }),
  estimate: (data: { platform: string; input_type: string; input_value: string }) =>
    api.post("/jobs/estimate", data),
  getReport: (id: string) => api.get(`/jobs/${id}/report`),
  getCursorHistory: (inputValue: string) =>
    api.get("/jobs/cursor-history", { params: { input_value: inputValue } }),
  getProgressStreamUrl: (id: string) =>
    `${API_BASE}/api/v1/sse/jobs/${id}/stream`,
  pause: (id: string) => api.post(`/jobs/${id}/pause`),
  hardDelete: (id: string) => api.delete(`/jobs/${id}/delete`),
  batchAction: (data: { action: string; job_ids: string[] }) => api.post("/jobs/batch", data),
  getLogs: (id: string) => api.get(`/jobs/${id}/logs`),
  getPosts: (id: string, params?: { page?: number; page_size?: number; include_related?: boolean }) =>
    api.get(`/jobs/${id}/posts`, { params }),
  createFromPosts: (data: { post_ids: string[]; settings?: Record<string, unknown> }) =>
    api.post("/jobs/create-from-posts", data),
  getAuthor: (id: string) => api.get(`/jobs/${id}/author`),
  getQueuePosition: (id: string) => api.get(`/jobs/${id}/queue-position`),
  getPostDiscoveryCursors: (inputValue: string) =>
    api.get("/jobs/post-discovery-cursors", { params: { input_value: inputValue } }),
  getFeatureFlags: () => api.get("/jobs/feature-flags"),
  preCheck: (inputValue: string) =>
    api.get("/jobs/pre-check", { params: { input_value: inputValue } }),
};

// Credits API
export const creditsApi = {
  getBalance: () => api.get("/credits/balance"),
  getHistory: (params?: { page?: number; page_size?: number }) =>
    api.get("/credits/history", { params }),
  getPackages: () => api.get("/credits/packages"),
  getPaymentInfo: () => api.get("/credits/payment-info"),
  getPublicConfig: () => api.get("/credits/public-config"),
  getWhatsappContact: () => api.get("/credits/whatsapp-contact"),
  getTutorialVideos: () => api.get("/credits/tutorial-videos"),
  getPromoBanners: () => api.get("/credits/promo-banners"),
  getMessengerTemplates: () => api.get("/credits/messenger-templates"),
  getCosts: () => api.get("/credits/costs"),
};

// Payments API
export const paymentsApi = {
  createStripeCheckout: (packageId: string) =>
    api.post("/payments/stripe/checkout", { package_id: packageId }),
  submitBankTransfer: (data: {
    package_id: string;
    reference: string;
    proof_url: string;
  }) => api.post("/payments/bank-transfer", data),
  getHistory: (params?: { page?: number }) =>
    api.get("/payments/history", { params }),
  getSubscriptionStatus: () => api.get("/payments/subscription-status"),
  cancelSubscription: () => api.post("/payments/stripe/cancel-subscription"),
};

// Export API
export const exportApi = {
  downloadCsv: (jobId: string) =>
    api.get(`/export/${jobId}/csv`, { responseType: "blob" }),
  downloadFbAds: (jobId: string) =>
    api.get(`/export/${jobId}/facebook-ads`, { responseType: "blob" }),
  downloadXlsx: (jobId: string) =>
    api.get(`/export/${jobId}/xlsx`, { responseType: "blob" }),
  batchExport: (data: { job_ids: string[]; format?: string; mode?: string }) =>
    api.post("/export/batch", data, { responseType: "blob" }),
};

// Platforms API
export const platformsApi = {
  list: () => api.get("/platforms"),
  adminList: () => api.get("/admin/platforms"),
  create: (data: {
    name: string;
    display_name: string;
    is_enabled?: boolean;
    credit_cost_per_profile?: number;
    credit_cost_per_comment_page?: number;
    credit_cost_per_page?: number;
  }) => api.post("/admin/platforms", data),
  update: (id: string, data: {
    display_name?: string;
    is_enabled?: boolean;
    credit_cost_per_profile?: number;
    credit_cost_per_comment_page?: number;
    credit_cost_per_page?: number;
  }) => api.put(`/admin/platforms/${id}`, data),
  delete: (id: string) => api.delete(`/admin/platforms/${id}`),
};

// Uploads API
export const uploadsApi = {
  uploadProof: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/uploads/proof", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

// Admin API
export const adminApi = {
  dashboard: () => api.get("/admin/dashboard"),
  listUsers: (params?: { page?: number }) =>
    api.get("/admin/users", { params }),
  updateUser: (id: string, data: { role?: string; is_active?: boolean }) =>
    api.put(`/admin/users/${id}`, data),
  listPayments: (params?: { page?: number; status?: string }) =>
    api.get("/admin/payments", { params }),
  approvePayment: (id: string, notes?: string) =>
    api.post(`/admin/payments/${id}/approve`, { admin_notes: notes }),
  rejectPayment: (id: string, notes?: string) =>
    api.post(`/admin/payments/${id}/reject`, { admin_notes: notes }),
  refundPayment: (id: string, notes?: string) =>
    api.post(`/admin/payments/${id}/refund`, { admin_notes: notes }),
  grantCredits: (data: { tenant_id: string; amount: number; description: string }) =>
    api.post("/admin/credits/grant", data),
  getCreditBalances: () => api.get("/admin/credits/balances"),
  getAuditLogs: (params?: { page?: number }) =>
    api.get("/admin/audit-logs", { params }),
  listPackages: () => api.get("/admin/packages"),
  createPackage: (data: {
    name: string;
    credits: number;
    price_cents: number;
    currency?: string;
    stripe_price_id?: string;
    billing_interval?: string;
    bonus_credits?: number;
    is_active?: boolean;
    sort_order?: number;
    max_concurrent_jobs?: number;
    daily_job_limit?: number;
    monthly_credit_limit?: number;
  }) => api.post("/admin/packages", data),
  updatePackage: (
    id: string,
    data: {
      name?: string;
      credits?: number;
      price_cents?: number;
      currency?: string;
      stripe_price_id?: string;
      billing_interval?: string;
      bonus_credits?: number;
      is_active?: boolean;
      sort_order?: number;
      max_concurrent_jobs?: number;
      daily_job_limit?: number;
      monthly_credit_limit?: number;
    }
  ) => api.put(`/admin/packages/${id}`, data),
  deletePackage: (id: string) => api.delete(`/admin/packages/${id}`),
  scrapingOverview: () => api.get("/admin/scraping/overview"),
  getTenantConcurrency: (tenantId: string) =>
    api.get(`/admin/tenants/${tenantId}/concurrency`),
  setTenantConcurrency: (tenantId: string, maxConcurrentJobs: number) =>
    api.put(`/admin/tenants/${tenantId}/concurrency`, { max_concurrent_jobs: maxConcurrentJobs }),
  updateTenantStatus: (tenantId: string, isActive: boolean) =>
    api.put(`/admin/tenants/${tenantId}/status`, { is_active: isActive }),
  getFeatureFlags: () => api.get("/admin/feature-flags"),
  updateFeatureFlag: (key: string, enabled: boolean) =>
    api.put("/admin/feature-flags", { key, enabled }),
  getPaymentSettings: () => api.get("/admin/payment-settings"),
  updatePaymentSettings: (data: {
    stripe_publishable_key?: string;
    stripe_secret_key?: string;
    stripe_webhook_secret?: string;
    bank_name?: string;
    bank_account_name?: string;
    bank_account_number?: string;
    bank_duitnow_id?: string;
    bank_swift_code?: string;
    bank_qr_url?: string;
    stripe_enabled?: boolean;
    bank_transfer_enabled?: boolean;
    payment_model?: string;
  }) => api.put("/admin/payment-settings", data),
  getWhatsappSettings: () => api.get("/admin/whatsapp-settings"),
  updateWhatsappSettings: (data: {
    whatsapp_service_url?: string;
    whatsapp_admin_number?: string;
    whatsapp_contact_number?: string;
    whatsapp_enabled?: boolean;
    notify_new_user?: boolean;
    notify_payment_approved?: boolean;
    notify_payment_completed?: boolean;
    notify_refund?: boolean;
    notify_traffic_bot_order?: boolean;
    notify_wallet_deposit?: boolean;
  }) => api.put("/admin/whatsapp-settings", data),
  getWhatsappStatus: () => api.get("/admin/whatsapp-status"),
  getWhatsappQr: () => api.get("/admin/whatsapp-qr"),
  disconnectWhatsapp: () => api.post("/admin/whatsapp-disconnect"),
  sendWhatsappTest: () => api.post("/admin/whatsapp-test"),
  // Telegram bot settings
  getTelegramSettings: () => api.get("/admin/telegram-settings"),
  updateTelegramSettings: (data: {
    bot_token?: string;
    notification_chat_id?: string;
  }) => api.put("/admin/telegram-settings", data),
  getTelegramBotStatus: () => api.get("/admin/telegram-bot/status"),
  // Tenant settings (detail page)
  getTenantSettings: (tenantId: string) =>
    api.get(`/admin/tenants/${tenantId}/settings`),
  updateTenantSettings: (tenantId: string, data: {
    max_concurrent_jobs?: number;
    daily_job_limit?: number;
    monthly_credit_limit?: number;
  }) => api.put(`/admin/tenants/${tenantId}/settings`, data),
  // Admin job management (cross-tenant)
  listAllJobs: (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    tenant_id?: string;
    search?: string;
  }) => api.get("/admin/jobs", { params }),
  adminCancelJob: (jobId: string) =>
    api.post(`/admin/jobs/${jobId}/cancel`),
  adminPauseJob: (jobId: string) =>
    api.post(`/admin/jobs/${jobId}/pause`),
  // Tutorial video settings
  getTutorialVideos: () => api.get("/admin/tutorial-videos"),
  updateTutorialVideos: (data: {
    comment_scraper_url?: string;
    post_discovery_url?: string;
  }) => api.put("/admin/tutorial-videos", data),
  // Promo banner settings
  getPromoBanners: () => api.get("/admin/promo-banners"),
  updatePromoBanners: (banners: Array<{
    image_url?: string;
    video_url?: string;
    link_url?: string;
    is_active?: boolean;
    position?: string;
    title?: string;
  }>) => api.put("/admin/promo-banners", { banners }),
  // Messenger template settings
  getMessengerTemplates: () => api.get("/admin/messenger-templates"),
  updateMessengerTemplates: (templates: Array<{
    name: string;
    body: string;
    is_default?: boolean;
  }>) => api.put("/admin/messenger-templates", { templates }),
  liveVisitors: () => api.get("/admin/live-visitors"),
};

// Telegram API
export const telegramApi = {
  getLinkToken: () => api.post("/telegram/link-token"),
  getStatus: () => api.get("/telegram/status"),
  unlink: () => api.delete("/telegram/unlink"),
};

// Tenant Dashboard API
export const tenantDashboardApi = {
  getStats: () => api.get("/tenant/dashboard/stats"),
};

// Tenant Settings API
export const tenantSettingsApi = {
  get: () => api.get("/tenant/settings"),
  update: (data: {
    email?: {
      smtp_host: string;
      smtp_port: number;
      smtp_user: string;
      smtp_password: string;
      email_from: string;
    };
    business?: {
      business_name: string;
      business_type: string;
      industry: string;
      country: string;
      facebook_page_url: string;
      product_service_links: string[];
      target_audience_description: string;
    };
    ai_suggestions?: Record<string, unknown>;
  }) => api.put("/tenant/settings", data),
};

// Fan Analysis API
export const fanAnalysisApi = {
  getFans: (jobId: string, params?: {
    page?: number;
    page_size?: number;
    sort_by?: string;
    show_bots?: boolean;
  }) => api.get(`/fan-analysis/jobs/${jobId}`, { params }),
  analyzeFan: (data: { job_id: string; commenter_user_ids: string[] }) =>
    api.post("/fan-analysis/ai-analyze", data),
  batchAnalyze: (jobId: string, params?: { min_comments?: number; limit?: number }) =>
    api.post(`/fan-analysis/ai-batch/${jobId}`, null, { params }),
  exportFans: (jobId: string, format: string = "csv") =>
    api.get(`/fan-analysis/export/${jobId}`, { params: { format }, responseType: "blob" }),
};

// Trends API
export const trendsApi = {
  getViralPosts: (params?: {
    page_id?: string;
    min_score?: number;
    content_type?: string;
    days?: number;
    page?: number;
    page_size?: number;
    sort_by?: string;
  }) => api.get("/trends/viral-posts", { params }),
  getContentInsights: (params?: { page_id?: string; days?: number }) =>
    api.get("/trends/content-insights", { params }),
  getGoogleTrends: (params?: { keywords?: string; days?: number }) =>
    api.get("/trends/google-trends", { params }),
  getSourcePages: () => api.get("/trends/source-pages"),
};

// Business Profile API
export const businessProfileApi = {
  getSuggestions: () => api.post("/business-profile/suggest-pages"),
};

// Facebook Ads API
export const fbAdsApi = {
  // OAuth
  getConnectUrl: () => api.get("/fb-ads/connect/url"),
  getConnection: () => api.get("/fb-ads/connection"),
  disconnect: () => api.delete("/fb-ads/connection"),
  // Ad Accounts
  listAdAccounts: () => api.get("/fb-ads/ad-accounts"),
  selectAdAccount: (id: string) => api.post("/fb-ads/ad-accounts/select", { id }),
  // Pages
  listPages: () => api.get("/fb-ads/pages"),
  selectPage: (id: string) => api.post("/fb-ads/pages/select", { id }),
  getPagePosts: (pageId: string, limit?: number) =>
    api.get(`/fb-ads/pages/${pageId}/posts`, { params: { limit: limit || 50 } }),
  // Pixels
  listPixels: () => api.get("/fb-ads/pixels"),
  selectPixel: (id: string) => api.post("/fb-ads/pixels/select", { id }),
  // Performance (Phase 2)
  listCampaigns: (params: {
    date_from?: string; date_to?: string;
    page?: number; per_page?: number;
    sort_by?: string; sort_order?: string;
    status_filter?: string;
  } = {}) =>
    api.get("/fb-ads/campaigns", { params }),
  listCampaignAdSets: (campaignId: string, dateFrom?: string, dateTo?: string) =>
    api.get(`/fb-ads/campaigns/${campaignId}/adsets`, { params: { date_from: dateFrom, date_to: dateTo } }),
  listAdSetAds: (adsetId: string, dateFrom?: string, dateTo?: string) =>
    api.get(`/fb-ads/adsets/${adsetId}/ads`, { params: { date_from: dateFrom, date_to: dateTo } }),
  getInsightsSummary: (dateFrom?: string, dateTo?: string) =>
    api.get("/fb-ads/insights/summary", { params: { date_from: dateFrom, date_to: dateTo } }),
  triggerSync: () => api.post("/fb-ads/sync"),
  debugToken: () => api.get("/fb-ads/debug-token"),
  updateCampaignStatus: (id: string, status: string) =>
    api.post(`/fb-ads/campaigns/${id}/status`, { status }),
  updateAdSetStatus: (id: string, status: string) =>
    api.post(`/fb-ads/adsets/${id}/status`, { status }),
  updateAdStatus: (id: string, status: string) =>
    api.post(`/fb-ads/ads/${id}/status`, { status }),
  // AI Insights (Phase 3)
  listInsightScores: (groupType: string, dateFrom?: string, dateTo?: string) =>
    api.get("/fb-ads/insights/scores", { params: { group_type: groupType, date_from: dateFrom, date_to: dateTo } }),
  runAIScoring: (groupType: string, dateFrom?: string, dateTo?: string) =>
    api.post("/fb-ads/insights/score", { group_type: groupType, date_from: dateFrom, date_to: dateTo }),
  // Winning Ads (Phase 4)
  listWinningAds: () => api.get("/fb-ads/winning-ads"),
  detectWinningAds: () => api.post("/fb-ads/winning-ads/detect"),
  // Custom Audience
  createCustomAudience: (jobId: string, audienceName?: string, createLookalike?: boolean) =>
    api.post("/fb-ads/custom-audience", {
      job_id: jobId,
      audience_name: audienceName,
      create_lookalike: createLookalike || false,
    }),
  previewMultiJobAudience: (jobIds: string[]) =>
    api.post("/fb-ads/custom-audience/multi/preview", { job_ids: jobIds }),
  createMultiJobAudience: (jobIds: string[], audienceName?: string, createLookalike?: boolean) =>
    api.post("/fb-ads/custom-audience/multi", {
      job_ids: jobIds,
      audience_name: audienceName,
      create_lookalike: createLookalike || false,
    }),
  listCustomAudiences: (limit?: number) =>
    api.get("/fb-ads/custom-audiences", { params: { limit: limit || 100 } }),
  // AI Launch (Phase 5)
  createAICampaign: (data: Record<string, unknown>) => api.post("/fb-ads/launch", data),
  listAICampaigns: () => api.get("/fb-ads/launch/history"),
  getAICampaign: (id: string) => api.get(`/fb-ads/launch/${id}`),
  updateAICampaign: (id: string, data: Record<string, unknown>) => api.put(`/fb-ads/launch/${id}`, data),
  generateAICampaign: (id: string) => api.post(`/fb-ads/launch/${id}/generate`),
  publishAICampaign: (id: string) => api.post(`/fb-ads/launch/${id}/publish`),
  deleteAICampaign: (id: string) => api.delete(`/fb-ads/launch/${id}`),
  regenerateAd: (campaignId: string, adId: string, instructions?: string) =>
    api.post(`/fb-ads/launch/${campaignId}/ads/${adId}/regenerate`, { custom_instructions: instructions || null }),
  duplicateAICampaign: (id: string) => api.post(`/fb-ads/launch/${id}/duplicate`),
};

// Competitors API
export const competitorsApi = {
  list: () => api.get("/competitors"),
  add: (data: { input_value: string; source?: string; name?: string; category?: string; picture_url?: string; page_url?: string }) =>
    api.post("/competitors", data),
  remove: (id: string) => api.delete(`/competitors/${id}`),
  search: (q: string, limit?: number) =>
    api.get("/competitors/search", { params: { q, limit: limit || 10 } }),
  searchByLocation: (q: string, location: string, limit?: number) =>
    api.get("/competitors/search-location", { params: { q, location, limit: limit || 20 } }),
  quickScan: (id: string) => api.get(`/competitors/${id}/quick-scan`),
  feed: (params?: {
    livestream_only?: boolean;
    content_type?: string;
    sort_by?: string;
    days?: number;
    page?: number;
    page_size?: number;
  }) => api.get("/competitors/feed", { params }),
  scrape: (id: string) => api.post(`/competitors/${id}/scrape`),
  exportFeed: (params?: { livestream_only?: boolean; sort_by?: string; days?: number }) =>
    api.get("/competitors/feed/export", { params, responseType: "blob" }),
  scanHistory: () => api.get("/competitors/scan-history"),
};

// FB Action Blaster API
export const fbActionApi = {
  execute: (data: { action_name: string; params: Record<string, unknown>; user_agent?: string; proxy?: { host: string; port: string; username: string; password: string } }) =>
    api.post("/fb-action/execute", data),
  history: (params?: { page?: number; page_size?: number; action_name?: string }) =>
    api.get("/fb-action/history", { params }),
  getConfig: () => api.get("/fb-action/config"),
  saveConfig: (data: { user_agent?: string; proxy?: { host: string; port: string; username: string; password: string } }) =>
    api.post("/fb-action/save-config", data),
  connectCookies: (data: { c_user: string; xs: string; user_agent?: string }) =>
    api.post("/fb-action/connect-cookies", data),
  // Batch mode
  downloadTemplate: () =>
    api.get("/fb-action/batch/csv-template", { responseType: "blob" }),
  uploadBatch: (file: File, settings: { execution_mode: string; delay_seconds: number; max_parallel: number; proxy?: { host: string; port: string; username: string; password: string } }) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("settings_json", JSON.stringify(settings));
    return api.post("/fb-action/batch/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
  },
  getBatchStatus: (batchId: string) =>
    api.get(`/fb-action/batch/${batchId}`),
  getBatchHistory: (params?: { page?: number; page_size?: number }) =>
    api.get("/fb-action/batch/history", { params }),
  cancelBatch: (batchId: string) =>
    api.post(`/fb-action/batch/${batchId}/cancel`),
  exportBatchResults: (batchId: string) =>
    api.get(`/fb-action/batch/${batchId}/export`, { responseType: "blob" }),
  // Bulk Login
  getLoginSystemInfo: () =>
    api.get("/fb-action/login-batch/system-info"),
  downloadLoginTemplate: () =>
    api.get("/fb-action/login-batch/accounts-template", { responseType: "blob" }),
  uploadLoginBatch: (file: File, settings: {
    execution_mode: string;
    delay_seconds: number;
    max_parallel: number;
    headless?: boolean;
    proxy_pool?: Array<{ host: string; port: string; username: string; password: string }>;
  }) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("settings_json", JSON.stringify(settings));
    return api.post("/fb-action/login-batch/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
  },
  getLoginBatchStatus: (batchId: string) =>
    api.get(`/fb-action/login-batch/${batchId}`),
  getLoginBatchHistory: (params?: { page?: number; page_size?: number }) =>
    api.get("/fb-action/login-batch/history", { params }),
  cancelLoginBatch: (batchId: string) =>
    api.post(`/fb-action/login-batch/${batchId}/cancel`),
  exportLoginResults: (batchId: string) =>
    api.get(`/fb-action/login-batch/${batchId}/export`, { responseType: "blob" }),
  downloadWorkerScript: () =>
    api.get("/fb-action/login-batch/worker-script", { responseType: "blob" }),
  // Warm-up Batch
  createWarmupBatch: (data: { login_batch_id: string; preset: string; delay_seconds: number; scheduled_at?: string }) =>
    api.post("/fb-action/warmup-batch", data),
  getWarmupBatchStatus: (batchId: string) =>
    api.get(`/fb-action/warmup-batch/${batchId}`),
  getWarmupBatchHistory: (params?: { page?: number; page_size?: number }) =>
    api.get("/fb-action/warmup-batch/history", { params }),
  getScheduledWarmups: () =>
    api.get("/fb-action/warmup-batch/scheduled"),
  cancelScheduledWarmup: (batchId: string) =>
    api.delete(`/fb-action/warmup-batch/${batchId}/cancel-schedule`),
  // DOM Selectors
  startDOMCheck: (data: { login_batch_id: string }) =>
    api.post("/fb-action/dom-selectors/check", data),
  submitDOMSnapshot: (data: { snapshot: Record<string, unknown>; account_email: string }) =>
    api.post("/fb-action/dom-selectors/submit", data),
  getCurrentSelectors: () =>
    api.get("/fb-action/dom-selectors/current"),
  // AI Planner
  aiPlanGenerate: (data: {
    posts: Array<{ post_id: string; message?: string | null; from_name?: string | null; reaction_count?: number; comment_count?: number; share_count?: number; attachment_type?: string | null; post_url?: string | null }>;
    action_types: string[];
    business_context?: string;
    actions_per_post?: number;
    page_id?: string;
    group_id?: string;
    include_comments?: boolean;
  }) => api.post("/fb-action/ai-plan/generate", data),
  aiPlanExportCsv: (data: { actions: Array<Record<string, unknown>>; login_batch_id?: string }) =>
    api.post("/fb-action/ai-plan/export-csv", data, { responseType: "blob" }),
  aiPlanLoginBatches: () =>
    api.get("/fb-action/ai-plan/login-batches"),
  aiPlanSearchPages: (data: { prompt?: string; keywords?: string[]; limit_per_keyword?: number; exclude_ids?: string[] }) =>
    api.post("/fb-action/ai-plan/search-pages", data),
  aiPlanSearchHistory: () =>
    api.get("/fb-action/ai-plan/search-history"),
  aiPlanMyJobs: () =>
    api.get("/fb-action/ai-plan/my-jobs"),
  aiPlanMyPosts: (data: { job_ids: string[] }) =>
    api.post("/fb-action/ai-plan/my-posts", data),
  // Livestream Engagement
  liveEngageStart: (data: {
    post_id: string;
    post_url?: string;
    title?: string;
    login_batch_id?: string;
    direct_accounts?: Array<{
      cookies: string;
      email: string;
      token?: string;
      twofa?: string;
      proxy_host?: string;
      proxy_port?: string;
      proxy_username?: string;
      proxy_password?: string;
      user_agent?: string;
    }>;
    role_distribution: Record<string, number>;
    business_context?: string;
    training_comments?: string;
    ai_instructions?: string;
    page_owner_id?: string;
    scrape_interval_seconds?: number;
    product_codes?: string;
    code_pattern?: string;
    quantity_variation?: boolean;
    aggressive_level?: string;
    target_comments_enabled?: boolean;
    target_comments_count?: number;
    target_comments_period_minutes?: number;
    languages?: string[];
    comment_without_new?: boolean;
    comment_without_new_max?: number;
    blacklist_words?: string;
    stream_end_threshold?: number;
    scheduled_at?: string;
    min_delay_seconds?: number;
    max_delay_seconds?: number;
    max_duration_minutes?: number;
  }) => api.post("/fb-action/live-engage/start", data),
  liveEngageParseAccountsCsv: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/fb-action/live-engage/parse-accounts-csv", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  liveEngageAccountsTemplate: () =>
    api.get("/fb-action/live-engage/accounts-template", { responseType: "blob" }),
  liveEngagePreview: (data: Record<string, unknown>) =>
    api.post("/fb-action/live-engage/preview-comments", data),
  liveEngagePresets: () =>
    api.get("/fb-action/live-engage/presets"),
  liveEngageSavePreset: (data: Record<string, unknown>) =>
    api.post("/fb-action/live-engage/presets", data),
  liveEngageDeletePreset: (presetId: string) =>
    api.delete(`/fb-action/live-engage/presets/${presetId}`),
  liveEngageStatus: (sessionId: string) =>
    api.get(`/fb-action/live-engage/${sessionId}`),
  liveEngageRecentAccounts: () =>
    api.get("/fb-action/live-engage/recent-accounts"),
  liveEngageImportComments: (jobId: string, limit?: number) =>
    api.get(`/fb-action/live-engage/import-comments/${jobId}`, { params: { limit: limit || 500 } }),
  liveEngageExport: (sessionId: string, format: string = "csv") =>
    api.get(`/fb-action/live-engage/${sessionId}/export`, {
      params: { format },
      responseType: format === "csv" ? "blob" : undefined,
    }),
  liveEngageTriggerCode: (sessionId: string, data: { code: string; count: number; duration_minutes: number }) =>
    api.post(`/fb-action/live-engage/${sessionId}/trigger-code`, data),
  liveEngageUpdateTrigger: (sessionId: string, triggerId: string, data: { action: string }) =>
    api.patch(`/fb-action/live-engage/${sessionId}/trigger-code/${triggerId}`, data),
  liveEngageUpdateSettings: (sessionId: string, data: Record<string, unknown>) =>
    api.patch(`/fb-action/live-engage/${sessionId}/settings`, data),
  liveEngageStop: (sessionId: string) =>
    api.post(`/fb-action/live-engage/${sessionId}/stop`),
  liveEngagePause: (sessionId: string) =>
    api.post(`/fb-action/live-engage/${sessionId}/pause`),
  liveEngageResume: (sessionId: string) =>
    api.post(`/fb-action/live-engage/${sessionId}/resume`),
  liveEngageHistory: (params?: { page?: number; page_size?: number; status?: string; search?: string }) =>
    api.get("/fb-action/live-engage/history", { params }),
};

// Traffic Bot API
export const trafficBotApi = {
  // Services
  getServices: (category?: string) =>
    api.get("/traffic-bot/services", { params: category ? { category } : {} }),
  getCategories: () => api.get("/traffic-bot/services/categories"),
  calculatePrice: (serviceId: string, quantity: number) =>
    api.get(`/traffic-bot/services/${serviceId}/price`, { params: { quantity } }),
  // Orders
  createOrder: (data: { service_id: string; link: string; quantity: number }) =>
    api.post("/traffic-bot/orders", data),
  getOrders: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get("/traffic-bot/orders", { params }),
  getOrder: (id: string, refresh?: boolean) =>
    api.get(`/traffic-bot/orders/${id}`, { params: refresh ? { refresh: true } : {} }),
  cancelOrder: (id: string) => api.post(`/traffic-bot/orders/${id}/cancel`),
  refillOrder: (id: string) => api.post(`/traffic-bot/orders/${id}/refill`),
  // Wallet
  getWallet: () => api.get("/traffic-bot/wallet"),
  getTransactions: (params?: { limit?: number; offset?: number }) =>
    api.get("/traffic-bot/wallet/transactions", { params }),
  submitDepositRequest: (data: { amount: number; bank_reference: string; proof_url?: string }) =>
    api.post("/traffic-bot/wallet/deposit-request", data),
  getMyDeposits: () => api.get("/traffic-bot/wallet/deposits"),
  // Admin
  syncServices: () => api.post("/admin/traffic-bot/services/sync"),
  getAllServices: (category?: string) =>
    api.get("/admin/traffic-bot/services", { params: category ? { category } : {} }),
  updateService: (id: string, data: { fee_pct?: number; is_enabled?: boolean; sort_order?: number }) =>
    api.patch(`/admin/traffic-bot/services/${id}`, data),
  bulkUpdateFee: (data: { category: string; fee_pct: number }) =>
    api.patch("/admin/traffic-bot/services/bulk-fee", data),
  getAllOrders: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get("/admin/traffic-bot/orders", { params }),
  depositWallet: (data: { tenant_id: string; amount: number; description?: string }) =>
    api.post("/admin/traffic-bot/wallet/deposit", data),
  getApiBalance: () => api.get("/admin/traffic-bot/api-balance"),
  getDepositRequests: (status?: string) =>
    api.get("/admin/traffic-bot/wallet/deposits", { params: status ? { status } : {} }),
  approveDeposit: (id: string, admin_notes?: string) =>
    api.post(`/admin/traffic-bot/wallet/deposits/${id}/approve`, { admin_notes }),
  rejectDeposit: (id: string, admin_notes?: string) =>
    api.post(`/admin/traffic-bot/wallet/deposits/${id}/reject`, { admin_notes }),
};

export const extensionApi = {
  getStatus: () => api.get("/extension/status"),
  saveCookies: (cookiesJson: string) =>
    api.post("/extension/cookies", { cookies_json: cookiesJson }),
  deleteCookies: () => api.delete("/extension/cookies"),
  getPendingTasks: () => api.get("/extension/tasks"),
};

// ── Live Sell ───────────────────────────────────────────────

export const liveSellApi = {
  // Videos
  listVideos: () => api.get("/live-sell/videos"),

  // Sessions
  startSession: (data: { video_id: string; title?: string }) =>
    api.post("/live-sell/sessions", data),
  stopSession: (sessionId: string) =>
    api.post(`/live-sell/sessions/${sessionId}/stop`),
  listSessions: (params?: { page?: number; page_size?: number }) =>
    api.get("/live-sell/sessions", { params }),
  getSession: (sessionId: string) =>
    api.get(`/live-sell/sessions/${sessionId}`),

  // Comments
  listComments: (
    sessionId: string,
    params?: { orders_only?: boolean; page?: number; page_size?: number }
  ) => api.get(`/live-sell/sessions/${sessionId}/comments`, { params }),
  replyToComment: (sessionId: string, commentId: string, message: string) =>
    api.post(`/live-sell/sessions/${sessionId}/comments/${commentId}/reply`, {
      message,
    }),
  exportOrders: (sessionId: string) =>
    api.get(`/live-sell/sessions/${sessionId}/orders/export`, {
      responseType: "blob",
    }),

  // Settings
  getSettings: () => api.get("/live-sell/settings"),
  updateSettings: (data: {
    order_keywords?: string[];
    auto_reply_enabled?: boolean;
    auto_reply_mode?: string;
    auto_reply_template?: string;
    ai_reply_instructions?: string;
  }) => api.put("/live-sell/settings", data),

  // SSE stream URL
  getCommentStreamUrl: (sessionId: string) =>
    `${API_BASE}/api/v1/sse/live-sell/${sessionId}/stream`,
};

export default api;
