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
      top_level_comments?: number;
      reply_comments?: number;
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
  billing_interval: "one_time" | "monthly" | "annual";
  bonus_credits: number;
  is_active: boolean;
  sort_order: number;
  max_concurrent_jobs: number;
  daily_job_limit: number;
  monthly_credit_limit: number;
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
  stripe_subscription_id: string | null;
  bank_transfer_reference: string | null;
  bank_transfer_proof_url: string | null;
  admin_notes: string | null;
  completed_at: string | null;
  refunded_at: string | null;
  created_at: string;
}

export interface Platform {
  id: string;
  name: string;
  display_name: string;
  is_enabled: boolean;
  credit_cost_per_profile: number;
  credit_cost_per_comment_page: number;
  credit_cost_per_post: number;
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
  country: string;
  facebook_page_url: string;
  product_service_links: string[];
  target_audience_description: string;
}

export interface TenantSettings {
  email: EmailSettings | null;
  telegram: TelegramOrgSettings | null;
  business: BusinessProfileSettings | null;
  ai_suggestions: AIPageSuggestions | null;
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
  facebook_url: string | null;
  facebook_search_url?: string;
  reason: string;
}

export interface AIPageSuggestions {
  business_fit_analysis: string;
  suggested_pages: CompetitorSuggestion[];
  audience_insights: string[];
  targeting_recommendations: string[];
}

// Trends types
export interface ViralPost {
  id: string;
  post_id: string;
  message: string | null;
  created_time: string | null;
  from_name: string | null;
  comment_count: number;
  reaction_count: number;
  share_count: number;
  attachment_type: string | null;
  attachment_url: string | null;
  post_url: string | null;
  virality_score: number;
  engagement_total: number;
  source_page: string;
  above_average: number;
}

export interface ContentInsights {
  total_posts: number;
  avg_engagement: number;
  by_content_type: {
    type: string;
    count: number;
    avg_reactions: number;
    avg_comments: number;
    avg_shares: number;
  }[];
  by_day_of_week: {
    day: string;
    count: number;
    avg_engagement: number;
  }[];
  by_hour: {
    hour: number;
    count: number;
    avg_engagement: number;
  }[];
  top_keywords: string[];
  posting_frequency: number;
}

export interface GoogleTrendsData {
  keywords: string[];
  country: string;
  geo?: string;
  interest_over_time: Record<string, string | number>[];
  related_queries: Record<string, string[]>;
  error?: string;
}

export interface SourcePage {
  input_value: string;
  job_count: number;
  total_posts: number;
}

// Facebook Ads types
export interface FBConnectionStatus {
  connected: boolean;
  fb_user_name: string | null;
  fb_user_id: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
}

export interface FBAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  status: string;
  is_selected: boolean;
}

export interface FBPageItem {
  id: string;
  page_id: string;
  name: string;
  category: string | null;
  picture_url: string | null;
  is_selected: boolean;
}

export interface FBPixelItem {
  id: string;
  pixel_id: string;
  name: string;
  is_selected: boolean;
}

// Phase 2: Performance types
export interface FBCampaignItem {
  id: string;
  campaign_id: string;
  name: string;
  objective: string | null;
  status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  results: number;
  cost_per_result: number;
  purchase_value: number;
  roas: number;
  synced_at: string | null;
}

export interface PaginatedCampaigns {
  items: FBCampaignItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface FBAdSetItem {
  id: string;
  adset_id: string;
  campaign_id: string;
  name: string;
  status: string;
  daily_budget: number | null;
  targeting: Record<string, unknown>;
  optimization_goal: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  results: number;
  cost_per_result: number;
  purchase_value: number;
  roas: number;
}

export interface FBAdItem {
  id: string;
  ad_id: string;
  adset_id: string;
  name: string;
  status: string;
  creative_id: string | null;
  creative_data: Record<string, unknown>;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  results: number;
  cost_per_result: number;
  purchase_value: number;
  roas: number;
}

export interface FBInsightSummary {
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  avg_ctr: number;
  total_results: number;
  avg_cost_per_result: number;
  total_purchase_value: number;
  avg_roas: number;
}

// Phase 3: AI Insight Scores
export interface FBInsightScoreItem {
  id: string;
  group_type: string;
  group_value: string;
  score: number;
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    results: number;
    cpr: number;
    purchase_value: number;
    roas: number;
    ad_count: number;
  };
  date_range_start: string;
  date_range_end: string;
}

// Phase 5: AI Campaign Builder
export interface AICampaignAd {
  id: string;
  name: string;
  headline: string;
  primary_text: string;
  description: string | null;
  creative_source: string;
  cta_type: string;
  destination_url: string | null;
}

export interface AICampaignAdSet {
  id: string;
  name: string;
  targeting: Record<string, unknown>;
  daily_budget: number;
  ads: AICampaignAd[];
}

export interface AICampaignItem {
  id: string;
  status: string;
  name: string;
  objective: string;
  daily_budget: number;
  landing_page_url: string | null;
  conversion_event: string | null;
  audience_strategy: string;
  creative_strategy: string;
  custom_instructions: string | null;
  ai_summary: {
    strategy?: string;
    num_adsets?: number;
    num_ads?: number;
    total_daily_budget?: number;
    objective?: string;
    audience_strategy?: string;
    creative_strategy?: string;
    historical_winners_used?: number;
    business_name?: string;
  } | null;
  generation_progress: { stage: string; pct: number; error?: string } | null;
  credits_used: number;
  meta_campaign_id: string | null;
  published_at: string | null;
  created_at: string;
  adsets: AICampaignAdSet[];
}

// Phase 4: Winning Ads
export interface FBWinningAdItem {
  id: string;
  rank: number;
  score: number;
  ad_id: string;
  ad_name: string;
  ad_meta_id: string;
  ad_status: string;
  creative_data: Record<string, unknown>;
  targeting: Record<string, unknown>;
  total_spend: number;
  total_results: number;
  cost_per_result: number;
  roas: number;
  ctr: number;
  detected_at: string;
}

// Traffic Bot types
export interface TrafficBotService {
  id: string;
  external_service_id: number;
  name: string;
  category: string;
  type: string;
  rate: number;
  min_quantity: number;
  max_quantity: number;
  fee_pct: number;
  is_enabled: boolean;
  sort_order: number;
}

export interface TrafficBotOrder {
  id: string;
  service_id: string;
  service_name: string | null;
  external_order_id: number | null;
  link: string;
  quantity: number;
  base_cost: number;
  fee_amount: number;
  total_cost: number;
  status: string;
  start_count: number | null;
  remains: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrafficBotOrderList {
  items: TrafficBotOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface TrafficBotWallet {
  balance: number;
  updated_at: string | null;
}

export interface TrafficBotTransaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  reference_id: string | null;
  created_at: string;
}

export interface TrafficBotPriceCalc {
  base_cost: number;
  fee_amount: number;
  total_cost: number;
}

export interface TrafficBotWalletDeposit {
  id: string;
  tenant_id: string;
  user_id: string;
  amount: number;
  status: string;
  bank_reference: string;
  proof_url: string | null;
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}
