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
  getPosts: (id: string, params?: { page?: number; page_size?: number }) =>
    api.get(`/jobs/${id}/posts`, { params }),
  createFromPosts: (data: { post_ids: string[]; settings?: Record<string, unknown> }) =>
    api.post("/jobs/create-from-posts", data),
  getAuthor: (id: string) => api.get(`/jobs/${id}/author`),
  getQueuePosition: (id: string) => api.get(`/jobs/${id}/queue-position`),
  getPostDiscoveryCursors: (inputValue: string) =>
    api.get("/jobs/post-discovery-cursors", { params: { input_value: inputValue } }),
  getFeatureFlags: () => api.get("/jobs/feature-flags"),
};

// Credits API
export const creditsApi = {
  getBalance: () => api.get("/credits/balance"),
  getHistory: (params?: { page?: number; page_size?: number }) =>
    api.get("/credits/history", { params }),
  getPackages: () => api.get("/credits/packages"),
  getPaymentInfo: () => api.get("/credits/payment-info"),
  getPublicConfig: () => api.get("/credits/public-config"),
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
  batchExport: (data: { job_ids: string[]; format?: string }) =>
    api.post("/export/batch", data, { responseType: "blob" }),
};

// Platforms API
export const platformsApi = {
  list: () => api.get("/platforms"),
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
    }
  ) => api.put(`/admin/packages/${id}`, data),
  deletePackage: (id: string) => api.delete(`/admin/packages/${id}`),
  scrapingOverview: () => api.get("/admin/scraping/overview"),
  getTenantConcurrency: (tenantId: string) =>
    api.get(`/admin/tenants/${tenantId}/concurrency`),
  setTenantConcurrency: (tenantId: string, maxConcurrentJobs: number) =>
    api.put(`/admin/tenants/${tenantId}/concurrency`, { max_concurrent_jobs: maxConcurrentJobs }),
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
    stripe_enabled?: boolean;
    bank_transfer_enabled?: boolean;
    payment_model?: string;
  }) => api.put("/admin/payment-settings", data),
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
    telegram?: {
      bot_token: string;
      notification_chat_id: string;
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

export default api;
