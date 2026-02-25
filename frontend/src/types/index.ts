export interface User {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "super_admin" | "tenant_admin" | "member";
  is_active: boolean;
  email_verified: boolean;
  language: string;
  last_login_at: string | null;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface ScrapingJob {
  id: string;
  tenant_id: string;
  user_id: string;
  platform_id: string;
  job_type: string;
  status: "pending" | "scheduled" | "queued" | "running" | "completed" | "failed" | "cancelled" | "paused";
  input_type: string;
  input_value: string;
  input_metadata: Record<string, unknown>;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_items: number;
  processed_items: number;
  failed_items: number;
  progress_pct: number;
  credits_estimated: number;
  credits_used: number;
  result_file_url: string | null;
  result_row_count: number;
  error_message: string | null;
  error_details: {
    pipeline_state?: {
      current_stage: string;
      comment_pages_fetched?: number;
      last_cursor?: string;
      total_comments_fetched?: number;
      unique_user_ids_found?: number;
      profiles_enriched?: number;
      profiles_failed?: number;
      // Post discovery fields
      pages_fetched?: number;
      total_posts_fetched?: number;
      first_before_cursor?: string;
      last_after_cursor?: string;
    };
    error?: {
      stage: string;
      exception_type: string;
      message: string;
      timestamp: string;
    };
  } | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScrapedProfile {
  id: string;
  platform_user_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  birthday: string | null;
  relationship: string | null;
  education: string | null;
  work: string | null;
  position: string | null;
  hometown: string | null;
  location: string | null;
  website: string | null;
  languages: string | null;
  username_link: string | null;
  username: string | null;
  about: string | null;
  phone: string | null;
  picture_url: string | null;
  scrape_status: string;
  scraped_at: string | null;
}

export interface ScrapedPost {
  id: string;
  post_id: string;
  message: string | null;
  created_time: string | null;
  updated_time: string | null;
  from_name: string | null;
  from_id: string | null;
  comment_count: number;
  reaction_count: number;
  share_count: number;
  attachment_type: string | null;
  attachment_url: string | null;
  post_url: string | null;
  created_at: string;
}

export interface PageAuthorProfile {
  id: string;
  platform_object_id: string;
  name: string | null;
  about: string | null;
  category: string | null;
  description: string | null;
  location: string | null;
  phone: string | null;
  website: string | null;
  picture_url: string | null;
  cover_url: string | null;
  fetched_at: string | null;
}

export interface CreditBalance {
  balance: number;
  lifetime_purchased: number;
  lifetime_used: number;
}

export interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  bonus_credits: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  user_id: string;
  credit_package_id: string | null;
  amount_cents: number;
  currency: string;
  method: "stripe" | "bank_transfer";
  status: "pending" | "completed" | "failed" | "refunded";
  bank_transfer_reference: string | null;
  bank_transfer_proof_url: string | null;
  admin_notes: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Platform {
  id: string;
  name: string;
  display_name: string;
  is_enabled: boolean;
  credit_cost_per_profile: number;
  credit_cost_per_comment_page: number;
}

export interface AdminDashboard {
  total_users: number;
  total_tenants: number;
  total_jobs: number;
  total_credits_sold: number;
  total_revenue_cents: number;
  active_jobs: number;
  jobs_today: number;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface CursorHistoryItem {
  job_id: string;
  status: string;
  created_at: string;
  last_cursor: string;
  comment_pages_fetched: number;
  total_comments_fetched: number;
}

export interface JobLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  stage: string;
  msg: string;
}

export interface EmailSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  email_from: string;
}

export interface TelegramOrgSettings {
  bot_token: string;
  notification_chat_id: string;
}

export interface BusinessProfileSettings {
  business_name: string;
  business_type: string;
  industry: string;
  facebook_page_url: string;
  product_service_links: string[];
  target_audience_description: string;
}

export interface TenantSettings {
  email: EmailSettings | null;
  telegram: TelegramOrgSettings | null;
  business: BusinessProfileSettings | null;
}

export interface FanEngagementMetrics {
  commenter_user_id: string;
  commenter_name: string | null;
  total_comments: number;
  unique_posts_commented: number;
  avg_comment_length: number;
  first_seen: string | null;
  last_seen: string | null;
  engagement_score: number;
  profile: {
    name: string | null;
    phone: string | null;
    location: string | null;
    picture_url: string | null;
    gender: string | null;
  } | null;
  ai_analysis: AIAnalysisResult | null;
  bot_score: number;
  is_bot: boolean;
  bot_indicators: Record<string, boolean> | null;
  bot_details: Record<string, number> | null;
}

export interface AIAnalysisResult {
  buying_intent_score: number;
  interests: string[];
  sentiment: "positive" | "neutral" | "negative";
  persona_type: string;
  summary: string;
  key_phrases: string[];
}

export interface CompetitorSuggestion {
  name: string;
  facebook_url: string;
  reason: string;
}

export interface AIPageSuggestions {
  business_fit_analysis: string;
  suggested_pages: CompetitorSuggestion[];
  audience_insights: string[];
  targeting_recommendations: string[];
}
