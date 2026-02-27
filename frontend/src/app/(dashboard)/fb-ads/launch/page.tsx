"use client";

import { useEffect, useState, useCallback } from "react";
import { fbAdsApi } from "@/lib/api-client";
import type { AICampaignItem, AICampaignAdSet, AICampaignAd, FBConnectionStatus, FBPageItem, FBPixelItem } from "@/types";

type View = "config" | "generating" | "review" | "history";
type ReviewStep = "summary" | "campaign" | "adsets" | "ads" | "publish";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STAGES = ["analyze", "structure", "targeting", "creative", "finalize", "complete"];
const STAGE_LABELS: Record<string, string> = {
  analyze: "Analyzing Data",
  structure: "Building Structure",
  targeting: "Generating Targeting",
  creative: "Creating Ads",
  finalize: "Finalizing",
  complete: "Complete",
  error: "Failed",
};

const CTA_OPTIONS = ["LEARN_MORE", "SIGN_UP", "SHOP_NOW", "GET_OFFER", "CONTACT_US"];

function formatTargeting(targeting: Record<string, unknown>): React.ReactNode {
  if (!targeting || Object.keys(targeting).length === 0) {
    return <span className="text-white/30 italic">No targeting specified</span>;
  }
  const items: React.ReactNode[] = [];

  const ageMin = targeting.age_min as number | undefined;
  const ageMax = targeting.age_max as number | undefined;
  if (ageMin != null) {
    items.push(
      <div key="age" className="flex items-center gap-2">
        <span className="text-white/30 w-20 shrink-0">Age</span>
        <span className="text-white/70">{ageMin} - {ageMax ?? 65}+</span>
      </div>
    );
  }

  const genders = targeting.genders as number[] | undefined;
  if (genders && Array.isArray(genders)) {
    const labels = genders.map((g: number) => g === 1 ? "Male" : g === 2 ? "Female" : "All");
    items.push(
      <div key="gender" className="flex items-center gap-2">
        <span className="text-white/30 w-20 shrink-0">Gender</span>
        <span className="text-white/70">{labels.join(", ")}</span>
      </div>
    );
  }

  const geo = targeting.geo_locations as Record<string, unknown> | undefined;
  if (geo) {
    const parts: string[] = [];
    if (Array.isArray(geo.countries)) parts.push(...(geo.countries as string[]));
    if (Array.isArray(geo.cities)) parts.push(...(geo.cities as { name: string }[]).map(c => c.name || JSON.stringify(c)));
    if (parts.length > 0) {
      items.push(
        <div key="geo" className="flex items-center gap-2">
          <span className="text-white/30 w-20 shrink-0">Locations</span>
          <span className="text-white/70">{parts.join(", ")}</span>
        </div>
      );
    }
  }

  const flex = targeting.flexible_spec as Record<string, unknown>[] | undefined;
  if (flex && Array.isArray(flex)) {
    const interests: string[] = [];
    for (const spec of flex) {
      const ints = spec.interests as { name: string }[] | undefined;
      if (ints && Array.isArray(ints)) {
        interests.push(...ints.map(i => i.name));
      }
    }
    if (interests.length > 0) {
      items.push(
        <div key="interests" className="flex items-start gap-2">
          <span className="text-white/30 w-20 shrink-0">Interests</span>
          <span className="text-white/70">{interests.join(", ")}</span>
        </div>
      );
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-white/40">
        <pre className="whitespace-pre-wrap break-words">{JSON.stringify(targeting, null, 2)}</pre>
      </div>
    );
  }

  return <div className="space-y-1.5 text-sm">{items}</div>;
}

export default function FBAILaunchPage() {
  const [view, setView] = useState<View>("config");
  const [connection, setConnection] = useState<FBConnectionStatus | null>(null);
  const [pages, setPages] = useState<FBPageItem[]>([]);
  const [pixels, setPixels] = useState<FBPixelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<AICampaignItem[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<AICampaignItem | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [reviewStep, setReviewStep] = useState<ReviewStep>("summary");
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("LEADS");
  const [dailyBudget, setDailyBudget] = useState("20");
  const [pageId, setPageId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [landingPage, setLandingPage] = useState("");
  const [conversionEvent, setConversionEvent] = useState("Lead");
  const [audienceStrategy, setAudienceStrategy] = useState("conservative");
  const [creativeStrategy, setCreativeStrategy] = useState("proven_winners");
  const [historicalRange, setHistoricalRange] = useState("90");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const connRes = await fbAdsApi.getConnection();
        setConnection(connRes.data);
        if (!connRes.data.connected) { setLoading(false); return; }
        const [pgRes, pxRes, histRes] = await Promise.all([
          fbAdsApi.listPages(),
          fbAdsApi.listPixels(),
          fbAdsApi.listAICampaigns(),
        ]);
        setPages(pgRes.data);
        setPixels(pxRes.data);
        setCampaigns(histRes.data);
        const selectedPage = pgRes.data.find((p: FBPageItem) => p.is_selected);
        if (selectedPage) setPageId(selectedPage.id);
        const selectedPixel = pxRes.data.find((p: FBPixelItem) => p.is_selected);
        if (selectedPixel) setPixelId(selectedPixel.id);
      } catch {
        // error
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) { alert("Please enter a campaign name."); return; }
    setCreating(true);
    try {
      const res = await fbAdsApi.createAICampaign({
        name,
        objective,
        daily_budget: Math.round(parseFloat(dailyBudget) * 100),
        page_id: pageId || null,
        pixel_id: pixelId || null,
        conversion_event: conversionEvent,
        landing_page_url: landingPage || null,
        audience_strategy: audienceStrategy,
        creative_strategy: creativeStrategy,
        historical_data_range: parseInt(historicalRange),
        custom_instructions: instructions || null,
      });

      // Start generation
      const genRes = await fbAdsApi.generateAICampaign(res.data.id);

      // If inline generation returned the campaign directly
      if (genRes.data.campaign) {
        setActiveCampaign(genRes.data.campaign);
        setReviewStep("summary");
        setView("review");
        return;
      }

      setView("generating");

      // Poll for progress
      const poll = setInterval(async () => {
        try {
          const campRes = await fbAdsApi.getAICampaign(res.data.id);
          setActiveCampaign(campRes.data);
          if (campRes.data.status === "ready" || campRes.data.status === "failed") {
            clearInterval(poll);
            if (campRes.data.status === "ready") {
              setReviewStep("summary");
              setView("review");
            }
          }
        } catch {
          clearInterval(poll);
        }
      }, 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create campaign.";
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async () => {
    if (!activeCampaign || !confirm("Publish this campaign to Meta Ads Manager?\n\nIt will be created in PAUSED state so you can review it in Ads Manager before activating.")) return;
    setPublishing(true);
    try {
      const pubRes = await fbAdsApi.publishAICampaign(activeCampaign.id);
      if (pubRes.data.meta_campaign_id) {
        // Inline publish completed
        const campRes = await fbAdsApi.getAICampaign(activeCampaign.id);
        setActiveCampaign(campRes.data);
        setPublishing(false);
        return;
      }
      // Poll for publish completion
      const poll = setInterval(async () => {
        try {
          const res = await fbAdsApi.getAICampaign(activeCampaign.id);
          setActiveCampaign(res.data);
          if (res.data.status === "published" || res.data.status === "failed") {
            clearInterval(poll);
            setPublishing(false);
          }
        } catch {
          clearInterval(poll);
          setPublishing(false);
        }
      }, 2000);
    } catch {
      alert("Failed to publish campaign.");
      setPublishing(false);
    }
  };

  const handleSaveEdit = useCallback(async (adId: string, field: string, value: string) => {
    if (!activeCampaign) return;
    setSaving(true);
    try {
      // Find the ad set containing this ad
      const adsetWithAd = activeCampaign.adsets.find(as => as.ads.some(a => a.id === adId));
      if (!adsetWithAd) return;

      await fbAdsApi.updateAICampaign(activeCampaign.id, {
        adsets: [{
          id: adsetWithAd.id,
          ads: [{ id: adId, [field]: value }],
        }],
      });

      // Refresh
      const res = await fbAdsApi.getAICampaign(activeCampaign.id);
      setActiveCampaign(res.data);
    } catch {
      alert("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }, [activeCampaign]);

  const viewCampaign = async (id: string) => {
    try {
      const res = await fbAdsApi.getAICampaign(id);
      setActiveCampaign(res.data);
      setReviewStep("summary");
      if (res.data.status === "generating") setView("generating");
      else setView("review");
    } catch {
      alert("Failed to load campaign.");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!connection?.connected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
          <svg className="h-8 w-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">AI Launch</h1>
        <p className="text-white/40">Connect your Facebook account to start building AI-powered campaigns.</p>
        <a href="/fb-ads/connect" className="btn-glow inline-block">Go to Connection</a>
      </div>
    );
  }

  // --- Generating View ---
  if (view === "generating" && activeCampaign) {
    const progress = activeCampaign.generation_progress;
    const stage = progress?.stage || "analyze";
    const pct = progress?.pct || 0;

    return (
      <div className="max-w-lg mx-auto py-20 text-center space-y-8">
        <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/20 flex items-center justify-center mx-auto">
          <div className="h-10 w-10 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Generating Your Campaign</h2>
          <p className="text-white/40 text-sm mt-2">AI is analyzing your data and building an optimized campaign structure.</p>
        </div>

        {/* Progress bar */}
        <div className="space-y-3">
          <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-500 to-blue-500 h-2.5 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/30">
            <span>{STAGE_LABELS[stage] || stage}</span>
            <span>{pct}%</span>
          </div>
        </div>

        {/* Stage indicators */}
        <div className="flex justify-center gap-4">
          {STAGES.slice(0, 5).map((s, i) => {
            const idx = STAGES.indexOf(stage);
            const isActive = idx === i;
            const isDone = idx > i;
            return (
              <div key={s} className="flex flex-col items-center gap-1.5">
                <div className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
                  isDone ? "bg-emerald-500" : isActive ? "bg-emerald-400 animate-pulse" : "bg-white/10"
                }`} />
                <span className={`text-[10px] ${isActive ? "text-emerald-400" : isDone ? "text-white/40" : "text-white/20"}`}>
                  {STAGE_LABELS[s]?.split(" ").pop()}
                </span>
              </div>
            );
          })}
        </div>

        {stage === "error" && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-red-400 text-sm">{progress?.error || "An error occurred during generation."}</p>
            <button
              onClick={() => { setView("config"); setActiveCampaign(null); }}
              className="mt-3 text-sm text-white/50 hover:text-white transition"
            >
              Back to Configuration
            </button>
          </div>
        )}
      </div>
    );
  }

  // --- Review View ---
  if (view === "review" && activeCampaign) {
    const REVIEW_STEPS: { key: ReviewStep; label: string }[] = [
      { key: "summary", label: "AI Summary" },
      { key: "campaign", label: "Campaign" },
      { key: "adsets", label: "Ad Sets" },
      { key: "ads", label: "Ads" },
      { key: "publish", label: "Publish" },
    ];

    const totalAds = activeCampaign.adsets.reduce((sum, as) => sum + as.ads.length, 0);

    return (
      <div className="flex gap-6">
        {/* Sidebar Steps */}
        <div className="hidden lg:block w-48 shrink-0">
          <div className="sticky top-6 space-y-1">
            {REVIEW_STEPS.map((step, i) => (
              <button
                key={step.key}
                onClick={() => setReviewStep(step.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                  reviewStep === step.key
                    ? "bg-white/10 text-white font-medium"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <span className={`h-5 w-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${
                  reviewStep === step.key ? "bg-blue-500 text-white" : "bg-white/10 text-white/30"
                }`}>{i + 1}</span>
                {step.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{activeCampaign.name}</h1>
              <p className="text-white/40 text-sm mt-1 flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                  activeCampaign.status === "published" ? "bg-emerald-500/10 text-emerald-400" :
                  activeCampaign.status === "ready" ? "bg-blue-500/10 text-blue-400" :
                  activeCampaign.status === "failed" ? "bg-red-500/10 text-red-400" :
                  "bg-white/5 text-white/40"
                }`}>
                  {activeCampaign.status === "published" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                  {activeCampaign.status}
                </span>
                <span>{activeCampaign.objective}</span>
                <span>&middot;</span>
                <span>{formatCents(activeCampaign.daily_budget)}/day</span>
                <span>&middot;</span>
                <span>{activeCampaign.adsets.length} ad sets, {totalAds} ads</span>
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setView("config"); setActiveCampaign(null); }}
                className="text-sm px-4 py-2 rounded-lg text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition"
              >
                New Campaign
              </button>
            </div>
          </div>

          {/* Mobile step tabs */}
          <div className="lg:hidden flex gap-1 overflow-x-auto pb-1">
            {REVIEW_STEPS.map((step, i) => (
              <button
                key={step.key}
                onClick={() => setReviewStep(step.key)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
                  reviewStep === step.key ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-white/40"
                }`}
              >
                {i + 1}. {step.label}
              </button>
            ))}
          </div>

          {/* Step Content */}
          {reviewStep === "summary" && (
            <div className="space-y-4">
              {activeCampaign.ai_summary && (
                <div className="glass-card p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                      <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">AI Strategy</h3>
                      <p className="text-white/50 text-sm mt-1 leading-relaxed">{String(activeCampaign.ai_summary.strategy || "Campaign generated successfully.")}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Ad Sets", value: String(activeCampaign.ai_summary.num_adsets || activeCampaign.adsets.length) },
                      { label: "Total Ads", value: String(activeCampaign.ai_summary.num_ads || totalAds) },
                      { label: "Daily Budget", value: formatCents(activeCampaign.daily_budget) },
                      { label: "Credits Used", value: String(activeCampaign.credits_used) },
                    ].map(stat => (
                      <div key={stat.label} className="bg-white/[0.03] rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-white">{stat.value}</p>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mt-0.5">{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  {activeCampaign.ai_summary.historical_winners_used != null && activeCampaign.ai_summary.historical_winners_used > 0 && (
                    <p className="text-xs text-white/30 flex items-center gap-1">
                      <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                      Based on {activeCampaign.ai_summary.historical_winners_used} proven winning ads from your account
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={() => setReviewStep("campaign")} className="btn-glow flex items-center gap-1.5">
                  Review Campaign
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {reviewStep === "campaign" && (
            <div className="space-y-4">
              <div className="glass-card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Campaign Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-3">
                    <div><span className="text-white/30 block text-xs">Name</span><span className="text-white">{activeCampaign.name}</span></div>
                    <div><span className="text-white/30 block text-xs">Objective</span><span className="text-white">{activeCampaign.objective}</span></div>
                    <div><span className="text-white/30 block text-xs">Daily Budget</span><span className="text-white">{formatCents(activeCampaign.daily_budget)}</span></div>
                  </div>
                  <div className="space-y-3">
                    <div><span className="text-white/30 block text-xs">Landing Page</span><span className="text-white/70 break-all">{activeCampaign.landing_page_url || "Not set"}</span></div>
                    <div><span className="text-white/30 block text-xs">Conversion Event</span><span className="text-white">{activeCampaign.conversion_event || "Not set"}</span></div>
                    <div><span className="text-white/30 block text-xs">Audience Strategy</span><span className="text-white capitalize">{activeCampaign.audience_strategy}</span></div>
                  </div>
                </div>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setReviewStep("summary")} className="text-sm text-white/40 hover:text-white transition flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                  Back
                </button>
                <button onClick={() => setReviewStep("adsets")} className="btn-glow flex items-center gap-1.5">
                  Review Ad Sets
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </button>
              </div>
            </div>
          )}

          {reviewStep === "adsets" && (
            <div className="space-y-4">
              {activeCampaign.adsets.map((adset, i) => (
                <div key={adset.id} className="glass-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">Set {i + 1}</span>
                        <h3 className="text-white font-semibold">{adset.name}</h3>
                      </div>
                      <p className="text-xs text-white/40 mt-1">{formatCents(adset.daily_budget)}/day &middot; {adset.ads.length} ad{adset.ads.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  <div className="bg-white/[0.02] rounded-lg p-4 border border-white/5">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-2">Targeting</p>
                    {formatTargeting(adset.targeting)}
                  </div>
                </div>
              ))}
              <div className="flex justify-between">
                <button onClick={() => setReviewStep("campaign")} className="text-sm text-white/40 hover:text-white transition flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                  Back
                </button>
                <button onClick={() => setReviewStep("ads")} className="btn-glow flex items-center gap-1.5">
                  Review Ads
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </button>
              </div>
            </div>
          )}

          {reviewStep === "ads" && (
            <div className="space-y-5">
              {activeCampaign.adsets.map((adset, i) => (
                <div key={adset.id} className="space-y-3">
                  <p className="text-xs text-white/30 uppercase tracking-wider font-semibold flex items-center gap-2">
                    <span className="h-4 w-4 rounded bg-blue-500/10 text-blue-400 flex items-center justify-center text-[9px]">{i + 1}</span>
                    {adset.name}
                  </p>
                  {adset.ads.map((ad) => (
                    <AdCard
                      key={ad.id}
                      ad={ad}
                      isEditing={editingAdId === ad.id}
                      saving={saving}
                      canEdit={activeCampaign.status === "ready"}
                      onEdit={() => setEditingAdId(editingAdId === ad.id ? null : ad.id)}
                      onSave={handleSaveEdit}
                    />
                  ))}
                </div>
              ))}
              <div className="flex justify-between">
                <button onClick={() => setReviewStep("adsets")} className="text-sm text-white/40 hover:text-white transition flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                  Back
                </button>
                <button onClick={() => setReviewStep("publish")} className="btn-glow flex items-center gap-1.5">
                  Ready to Publish
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </button>
              </div>
            </div>
          )}

          {reviewStep === "publish" && (
            <div className="space-y-4">
              <div className="glass-card p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-lg">Ready to Publish</h3>
                    <p className="text-white/40 text-sm">Your campaign will be created in Meta Ads Manager in <span className="text-amber-400 font-medium">PAUSED</span> state.</p>
                  </div>
                </div>

                <div className="bg-white/[0.02] rounded-lg p-4 border border-white/5 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-white/40">Campaign</span><span className="text-white">{activeCampaign.name}</span></div>
                  <div className="flex justify-between"><span className="text-white/40">Objective</span><span className="text-white">{activeCampaign.objective}</span></div>
                  <div className="flex justify-between"><span className="text-white/40">Daily Budget</span><span className="text-white">{formatCents(activeCampaign.daily_budget)}</span></div>
                  <div className="flex justify-between"><span className="text-white/40">Ad Sets</span><span className="text-white">{activeCampaign.adsets.length}</span></div>
                  <div className="flex justify-between"><span className="text-white/40">Total Ads</span><span className="text-white">{totalAds}</span></div>
                </div>

                {activeCampaign.status === "published" ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 text-center">
                    <p className="text-emerald-400 font-medium">Campaign Published Successfully</p>
                    <p className="text-white/40 text-xs mt-1">Campaign ID: {activeCampaign.meta_campaign_id}</p>
                    <p className="text-white/30 text-xs mt-0.5">Published: {activeCampaign.published_at ? new Date(activeCampaign.published_at).toLocaleString() : ""}</p>
                  </div>
                ) : activeCampaign.status === "ready" ? (
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className="w-full btn-glow disabled:opacity-50 flex items-center justify-center gap-2 py-3"
                  >
                    {publishing ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Publishing to Meta...
                      </>
                    ) : (
                      <>
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                        </svg>
                        Publish to Meta Ads Manager
                      </>
                    )}
                  </button>
                ) : null}
              </div>

              <div className="flex justify-start">
                <button onClick={() => setReviewStep("ads")} className="text-sm text-white/40 hover:text-white transition flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                  Back to Ads
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Config + History View ---
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">AI Launch</h1>
          <p className="text-white/40 text-sm mt-1">Configure and generate AI-powered Facebook ad campaigns</p>
        </div>
        {campaigns.length > 0 && (
          <button
            onClick={() => setView(view === "history" ? "config" : "history")}
            className="text-sm px-4 py-2 rounded-lg text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition flex items-center gap-1.5"
          >
            {view === "history" ? (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                New Campaign
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                History ({campaigns.length})
              </>
            )}
          </button>
        )}
      </div>

      {view === "history" ? (
        <div className="space-y-3">
          {campaigns.map(c => (
            <button
              key={c.id}
              onClick={() => viewCampaign(c.id)}
              className="w-full text-left glass-card p-4 hover:bg-white/[0.03] transition group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium group-hover:text-blue-400 transition">{c.name}</p>
                  <p className="text-xs text-white/40 mt-0.5 flex items-center gap-2">
                    <span>{c.objective}</span>
                    <span>&middot;</span>
                    <span>{formatCents(c.daily_budget)}/day</span>
                    <span>&middot;</span>
                    <span>{new Date(c.created_at).toLocaleDateString()}</span>
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  c.status === "published" ? "bg-emerald-500/10 text-emerald-400" :
                  c.status === "ready" ? "bg-blue-500/10 text-blue-400" :
                  c.status === "failed" ? "bg-red-500/10 text-red-400" :
                  c.status === "generating" ? "bg-amber-500/10 text-amber-400" :
                  "bg-white/5 text-white/30"
                }`}>
                  {c.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        /* Campaign Configuration Form */
        <div className="space-y-6">
          {/* Basic Config */}
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Campaign Setup</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-1">Campaign Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="My AI Campaign"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">Max Daily Budget ($)</label>
                <input
                  type="number"
                  value={dailyBudget}
                  onChange={e => setDailyBudget(e.target.value)}
                  min="1"
                  step="1"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>

            {/* Objective */}
            <div>
              <label className="text-xs text-white/40 block mb-2">Campaign Objective</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: "LEADS", label: "Leads", desc: "Collect leads from forms", icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" },
                  { value: "SALES", label: "Sales", desc: "Drive purchases on your site", icon: "M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" },
                ].map(o => (
                  <button
                    key={o.value}
                    onClick={() => setObjective(o.value)}
                    className={`p-3 rounded-lg border text-left transition flex items-start gap-3 ${
                      objective === o.value
                        ? "bg-blue-500/10 border-blue-500/30 text-white"
                        : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                    }`}
                  >
                    <svg className="h-5 w-5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={o.icon} />
                    </svg>
                    <div>
                      <p className="text-sm font-medium">{o.label}</p>
                      <p className="text-xs text-white/40 mt-0.5">{o.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-1">Facebook Page</label>
                <select value={pageId} onChange={e => setPageId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
                  <option value="">Select a page...</option>
                  {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">Meta Pixel</label>
                <select value={pixelId} onChange={e => setPixelId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
                  <option value="">Select a pixel...</option>
                  {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-1">Landing Page URL</label>
                <input type="url" value={landingPage} onChange={e => setLandingPage(e.target.value)} placeholder="https://yoursite.com/offer" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">Conversion Event</label>
                <select value={conversionEvent} onChange={e => setConversionEvent(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
                  <option value="Lead">Lead</option>
                  <option value="Purchase">Purchase</option>
                  <option value="AddToCart">Add to Cart</option>
                  <option value="InitiateCheckout">Initiate Checkout</option>
                </select>
              </div>
            </div>
          </div>

          {/* AI Strategy */}
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">AI Strategy</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-2">Audience Strategy</label>
                <div className="space-y-2">
                  {[
                    { value: "conservative", label: "Conservative", desc: "Use proven targeting from winning ads" },
                    { value: "experimental", label: "Experimental", desc: "Test new audiences with AI suggestions" },
                  ].map(s => (
                    <button
                      key={s.value}
                      onClick={() => setAudienceStrategy(s.value)}
                      className={`w-full p-3 rounded-lg border text-left transition ${
                        audienceStrategy === s.value
                          ? "bg-purple-500/10 border-purple-500/30 text-white"
                          : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                      }`}
                    >
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-white/40 mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-2">Creative Strategy</label>
                <div className="space-y-2">
                  {[
                    { value: "proven_winners", label: "Proven Winners", desc: "Reuse copy from your best-performing ads" },
                    { value: "ai_generated", label: "All New", desc: "Generate entirely new ad copy with AI" },
                  ].map(s => (
                    <button
                      key={s.value}
                      onClick={() => setCreativeStrategy(s.value)}
                      className={`w-full p-3 rounded-lg border text-left transition ${
                        creativeStrategy === s.value
                          ? "bg-purple-500/10 border-purple-500/30 text-white"
                          : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                      }`}
                    >
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-white/40 mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-1">Historical Data Range</label>
                <select value={historicalRange} onChange={e => setHistoricalRange(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
                  <option value="30">Last 30 days</option>
                  <option value="60">Last 60 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-white/40 block mb-1">Custom AI Instructions (optional)</label>
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="e.g., Focus on women aged 25-45 interested in skincare. Use a friendly, conversational tone."
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 resize-none"
              />
            </div>
          </div>

          {/* Generate Button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/30">Costs 20 credits per generation</p>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="btn-glow disabled:opacity-50 flex items-center gap-2 px-6"
            >
              {creating ? (
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              )}
              {creating ? "Generating..." : "Generate Campaign"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// --- Ad Card with inline editing ---
function AdCard({
  ad,
  isEditing,
  saving,
  canEdit,
  onEdit,
  onSave,
}: {
  ad: AICampaignAd;
  isEditing: boolean;
  saving: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onSave: (adId: string, field: string, value: string) => void;
}) {
  const [headline, setHeadline] = useState(ad.headline);
  const [primaryText, setPrimaryText] = useState(ad.primary_text);
  const [description, setDescription] = useState(ad.description || "");
  const [ctaType, setCtaType] = useState(ad.cta_type);

  // Reset on ad change
  useEffect(() => {
    setHeadline(ad.headline);
    setPrimaryText(ad.primary_text);
    setDescription(ad.description || "");
    setCtaType(ad.cta_type);
  }, [ad]);

  const hasChanges = headline !== ad.headline || primaryText !== ad.primary_text || description !== (ad.description || "") || ctaType !== ad.cta_type;

  const handleSaveAll = async () => {
    if (headline !== ad.headline) await onSave(ad.id, "headline", headline);
    if (primaryText !== ad.primary_text) await onSave(ad.id, "primary_text", primaryText);
    if (description !== (ad.description || "")) await onSave(ad.id, "description", description);
    if (ctaType !== ad.cta_type) await onSave(ad.id, "cta_type", ctaType);
    onEdit(); // close edit mode
  };

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-medium">{ad.name}</p>
          {ad.creative_source === "proven_winners" && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">Winner</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{isEditing ? ctaType : ad.cta_type}</span>
          {canEdit && (
            <button onClick={onEdit} className="text-white/30 hover:text-white transition">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-white/30 block mb-0.5">Headline</label>
            <input
              type="text"
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              maxLength={40}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
            />
            <span className="text-[9px] text-white/20">{headline.length}/40</span>
          </div>
          <div>
            <label className="text-[10px] text-white/30 block mb-0.5">Primary Text</label>
            <textarea
              value={primaryText}
              onChange={e => setPrimaryText(e.target.value)}
              maxLength={125}
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50 resize-none"
            />
            <span className="text-[9px] text-white/20">{primaryText.length}/125</span>
          </div>
          <div>
            <label className="text-[10px] text-white/30 block mb-0.5">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={30}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/30 block mb-0.5">CTA</label>
            <select value={ctaType} onChange={e => setCtaType(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50">
              {CTA_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onEdit} className="text-xs text-white/40 hover:text-white transition px-3 py-1">Cancel</button>
            {hasChanges && (
              <button onClick={handleSaveAll} disabled={saving} className="text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition px-3 py-1 rounded disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="text-white/70 text-sm font-semibold">{ad.headline}</p>
          <p className="text-white/50 text-sm">{ad.primary_text}</p>
          {ad.description && <p className="text-white/30 text-xs">{ad.description}</p>}
        </>
      )}
    </div>
  );
}
