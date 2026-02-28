"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
const STAGE_DESCRIPTIONS: Record<string, string> = {
  analyze: "Reviewing your historical ad performance and business context",
  structure: "Determining optimal campaign architecture and budget allocation",
  targeting: "Building audience segments based on proven winners",
  creative: "Writing compelling ad copy and headlines",
  finalize: "Assembling the complete campaign structure",
  complete: "Your campaign is ready for review",
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
        <svg className="h-3.5 w-3.5 text-white/20 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
        </svg>
        <span className="text-white/40 w-16 shrink-0 text-xs">Age</span>
        <span className="text-white/70 text-sm">{ageMin} - {ageMax ?? 65}+</span>
      </div>
    );
  }

  const genders = targeting.genders as number[] | undefined;
  if (genders && Array.isArray(genders)) {
    const labels = genders.map((g: number) => g === 1 ? "Male" : g === 2 ? "Female" : "All");
    items.push(
      <div key="gender" className="flex items-center gap-2">
        <svg className="h-3.5 w-3.5 text-white/20 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
        <span className="text-white/40 w-16 shrink-0 text-xs">Gender</span>
        <span className="text-white/70 text-sm">{labels.join(", ")}</span>
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
          <svg className="h-3.5 w-3.5 text-white/20 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          <span className="text-white/40 w-16 shrink-0 text-xs">Location</span>
          <span className="text-white/70 text-sm">{parts.join(", ")}</span>
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
          <svg className="h-3.5 w-3.5 text-white/20 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <span className="text-white/40 w-16 shrink-0 text-xs">Interests</span>
          <div className="flex flex-wrap gap-1">
            {interests.map((interest, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400/70 border border-blue-500/10">
                {interest}
              </span>
            ))}
          </div>
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

  return <div className="space-y-2.5">{items}</div>;
}

function statusColor(status: string) {
  switch (status) {
    case "published": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "ready": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "failed": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "generating": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default: return "bg-white/5 text-white/40 border-white/10";
  }
}

function statusDot(status: string) {
  switch (status) {
    case "published": return "bg-emerald-400";
    case "ready": return "bg-blue-400";
    case "failed": return "bg-red-400";
    case "generating": return "bg-amber-400 animate-pulse";
    default: return "bg-white/30";
  }
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
  const [regeneratingAdId, setRegeneratingAdId] = useState<string | null>(null);

  // Polling ref for cleanup
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [configStep, setConfigStep] = useState<1 | 2 | 3>(1);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const refreshCampaign = useCallback(async (id: string) => {
    const res = await fbAdsApi.getAICampaign(id);
    setActiveCampaign(res.data);
    return res.data;
  }, []);

  const startPolling = useCallback((campaignId: string, onComplete?: (data: AICampaignItem) => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fbAdsApi.getAICampaign(campaignId);
        setActiveCampaign(res.data);
        if (res.data.status === "ready" || res.data.status === "failed" || res.data.status === "published") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          onComplete?.(res.data);
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 2000);
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

      // Set generating view and start polling
      setActiveCampaign({ id: res.data.id, status: "generating", generation_progress: { stage: "analyze", pct: 0 } } as AICampaignItem);
      setView("generating");
      startPolling(res.data.id, (data) => {
        if (data.status === "ready") {
          setReviewStep("summary");
          setView("review");
        }
      });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
      const msg = axiosErr?.response?.data?.detail || "Failed to create campaign.";
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!activeCampaign || !confirm("Regenerate this campaign? This will replace all existing ad sets and ads.\n\nCosts 20 credits.")) return;
    setCreating(true);
    try {
      const genRes = await fbAdsApi.generateAICampaign(activeCampaign.id);
      if (genRes.data.campaign) {
        setActiveCampaign(genRes.data.campaign);
        setReviewStep("summary");
        setView("review");
        setCreating(false);
        return;
      }
      setView("generating");
      startPolling(activeCampaign.id, (data) => {
        setCreating(false);
        if (data.status === "ready") {
          setReviewStep("summary");
          setView("review");
        }
      });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      alert(axiosErr?.response?.data?.detail || "Failed to regenerate.");
      setCreating(false);
    }
  };

  const handlePublish = async () => {
    if (!activeCampaign || !confirm("Publish this campaign to Meta Ads Manager?\n\nIt will be created in PAUSED state so you can review it in Ads Manager before activating.")) return;
    setPublishing(true);
    try {
      const pubRes = await fbAdsApi.publishAICampaign(activeCampaign.id);
      if (pubRes.data.meta_campaign_id) {
        await refreshCampaign(activeCampaign.id);
        setPublishing(false);
        return;
      }
      // Poll for publish completion
      startPolling(activeCampaign.id, () => setPublishing(false));
    } catch {
      alert("Failed to publish campaign.");
      setPublishing(false);
    }
  };

  // Batch save: send all changed fields in a single API call
  const handleSaveEdit = useCallback(async (adId: string, changes: Record<string, string>) => {
    if (!activeCampaign) return;
    setSaving(true);
    try {
      const adsetWithAd = activeCampaign.adsets.find(s => s.ads.some(a => a.id === adId));
      if (!adsetWithAd) return;

      await fbAdsApi.updateAICampaign(activeCampaign.id, {
        adsets: [{
          id: adsetWithAd.id,
          ads: [{ id: adId, ...changes }],
        }],
      });
      await refreshCampaign(activeCampaign.id);
    } catch {
      alert("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }, [activeCampaign, refreshCampaign]);

  const handleRegenerateAd = useCallback(async (adId: string) => {
    if (!activeCampaign) return;
    setRegeneratingAdId(adId);
    try {
      const res = await fbAdsApi.regenerateAd(activeCampaign.id, adId);
      setActiveCampaign(res.data);
    } catch {
      alert("Failed to regenerate ad copy.");
    } finally {
      setRegeneratingAdId(null);
    }
  }, [activeCampaign]);

  const handleDuplicate = async () => {
    if (!activeCampaign) return;
    try {
      const res = await fbAdsApi.duplicateAICampaign(activeCampaign.id);
      setActiveCampaign(res.data);
      setReviewStep("summary");
      setView("review");
      // Refresh history
      const histRes = await fbAdsApi.listAICampaigns();
      setCampaigns(histRes.data);
    } catch {
      alert("Failed to duplicate campaign.");
    }
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    try {
      await fbAdsApi.deleteAICampaign(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (activeCampaign?.id === id) {
        setActiveCampaign(null);
        setView("config");
      }
    } catch {
      alert("Failed to delete campaign.");
    }
  };

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
      <div className="max-w-2xl mx-auto text-center py-20 space-y-6">
        <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/15 flex items-center justify-center mx-auto">
          <svg className="h-10 w-10 text-blue-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">AI Campaign Builder</h1>
          <p className="text-white/40 mt-2 max-w-md mx-auto">Connect your Facebook account to start building AI-powered campaigns that leverage your best-performing ads.</p>
        </div>
        <a href="/fb-ads/connect" className="btn-glow inline-block">Connect Facebook</a>
      </div>
    );
  }

  // --- Generating View ---
  if (view === "generating" && activeCampaign) {
    const progress = activeCampaign.generation_progress;
    const stage = progress?.stage || "analyze";
    const pct = progress?.pct || 0;

    return (
      <div className="max-w-xl mx-auto py-16 space-y-10">
        {/* Animated header */}
        <div className="text-center space-y-4">
          <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-emerald-500/20 via-blue-500/20 to-purple-500/20 border border-emerald-500/15 flex items-center justify-center mx-auto relative">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-500/10 to-blue-500/10 animate-pulse" />
            <div className="h-12 w-12 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Building Your Campaign</h2>
            <p className="text-white/40 text-sm mt-2 max-w-sm mx-auto">
              AI is analyzing your data and creating an optimized campaign structure.
            </p>
          </div>
        </div>

        {/* Progress section */}
        <div className="glass-card p-6 space-y-6">
          {/* Overall progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-white/60 font-medium">{STAGE_LABELS[stage] || stage}</span>
              <span className="text-white/40">{pct}%</span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500 h-2 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-white/30">{STAGE_DESCRIPTIONS[stage] || ""}</p>
          </div>

          {/* Stage steps */}
          <div className="space-y-2">
            {STAGES.slice(0, 5).map((s, i) => {
              const idx = STAGES.indexOf(stage);
              const isActive = idx === i;
              const isDone = idx > i;
              return (
                <div key={s} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  isActive ? "bg-emerald-500/5 border border-emerald-500/10" : "border border-transparent"
                }`}>
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    isDone ? "bg-emerald-500/20" : isActive ? "bg-emerald-500/10 ring-2 ring-emerald-500/30" : "bg-white/5"
                  }`}>
                    {isDone ? (
                      <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : isActive ? (
                      <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    ) : (
                      <span className="text-[10px] text-white/20 font-medium">{i + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isDone ? "text-emerald-400/70" : isActive ? "text-white" : "text-white/30"}`}>
                      {STAGE_LABELS[s]}
                    </p>
                  </div>
                  {isActive && <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                </div>
              );
            })}
          </div>
        </div>

        {stage === "error" && (
          <div className="glass-card p-6 border-red-500/20 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <p className="text-red-400 font-medium">Generation Failed</p>
                <p className="text-white/40 text-sm mt-1">{progress?.error || "An unexpected error occurred during generation."}</p>
                <p className="text-white/30 text-xs mt-2">Credits have been refunded to your account.</p>
              </div>
            </div>
            <button
              onClick={() => { setView("config"); setActiveCampaign(null); }}
              className="w-full text-sm py-2.5 rounded-lg text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition"
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
    const REVIEW_STEPS: { key: ReviewStep; label: string; icon: string }[] = [
      { key: "summary", label: "AI Summary", icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" },
      { key: "campaign", label: "Campaign", icon: "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" },
      { key: "adsets", label: "Ad Sets", icon: "M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" },
      { key: "ads", label: "Ads", icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" },
      { key: "publish", label: "Publish", icon: "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" },
    ];

    const totalAds = activeCampaign.adsets.reduce((sum, adsetItem) => sum + adsetItem.ads.length, 0);
    const stepIdx = REVIEW_STEPS.findIndex(s => s.key === reviewStep);

    return (
      <div className="flex gap-6">
        {/* Sidebar Steps */}
        <div className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-6 space-y-1">
            <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-3 px-3">Review Steps</p>
            {REVIEW_STEPS.map((step, i) => (
              <button
                key={step.key}
                onClick={() => setReviewStep(step.key)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition flex items-center gap-2.5 ${
                  reviewStep === step.key
                    ? "bg-white/10 text-white font-medium"
                    : i < stepIdx ? "text-white/50 hover:text-white/70 hover:bg-white/5" : "text-white/30 hover:text-white/50 hover:bg-white/5"
                }`}
              >
                <div className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 ${
                  reviewStep === step.key ? "bg-blue-500/20" : i < stepIdx ? "bg-emerald-500/10" : "bg-white/5"
                }`}>
                  {i < stepIdx ? (
                    <svg className="h-3 w-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className={`h-3 w-3 ${reviewStep === step.key ? "text-blue-400" : "text-white/20"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
                    </svg>
                  )}
                </div>
                {step.label}
              </button>
            ))}

            {/* Sidebar Actions */}
            <div className="pt-4 mt-4 border-t border-white/5 space-y-1">
              {activeCampaign.status === "ready" && (
                <button
                  onClick={handleRegenerate}
                  disabled={creating}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition flex items-center gap-2"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  Regenerate
                </button>
              )}
              <button
                onClick={handleDuplicate}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition flex items-center gap-2"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5" />
                </svg>
                Duplicate
              </button>
              {activeCampaign.status !== "published" && (
                <button
                  onClick={() => handleDelete(activeCampaign.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-400/50 hover:text-red-400 hover:bg-red-500/5 transition flex items-center gap-2"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916" />
                  </svg>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/15 flex items-center justify-center shrink-0">
                <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{activeCampaign.name}</h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusColor(activeCampaign.status)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot(activeCampaign.status)}`} />
                    {activeCampaign.status}
                  </span>
                  <span className="text-xs text-white/30">{activeCampaign.objective}</span>
                  <span className="text-white/10">&middot;</span>
                  <span className="text-xs text-white/30">{formatCents(activeCampaign.daily_budget)}/day</span>
                  <span className="text-white/10">&middot;</span>
                  <span className="text-xs text-white/30">{activeCampaign.adsets.length} ad sets, {totalAds} ads</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => { setView("config"); setActiveCampaign(null); setConfigStep(1); }}
              className="text-sm px-4 py-2 rounded-lg text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition flex items-center gap-1.5"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Campaign
            </button>
          </div>

          {/* Mobile step tabs */}
          <div className="lg:hidden flex gap-1 overflow-x-auto pb-1">
            {REVIEW_STEPS.map((step, i) => (
              <button
                key={step.key}
                onClick={() => setReviewStep(step.key)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition flex items-center gap-1.5 ${
                  reviewStep === step.key ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-white/40"
                }`}
              >
                {i < stepIdx && (
                  <svg className="h-2.5 w-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
                {step.label}
              </button>
            ))}
          </div>

          {/* Mobile action buttons */}
          <div className="lg:hidden flex gap-2 flex-wrap">
            {activeCampaign.status === "ready" && (
              <button onClick={handleRegenerate} disabled={creating} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/60 border border-white/10 transition">
                Regenerate
              </button>
            )}
            <button onClick={handleDuplicate} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/60 border border-white/10 transition">
              Duplicate
            </button>
            {activeCampaign.status !== "published" && (
              <button onClick={() => handleDelete(activeCampaign.id)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/5 text-red-400/50 hover:text-red-400 border border-red-500/10 transition">
                Delete
              </button>
            )}
          </div>

          {/* Step Content */}
          {reviewStep === "summary" && (
            <div className="space-y-4">
              {activeCampaign.ai_summary && (
                <div className="glass-card p-6 space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                      <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-white font-semibold">AI Strategy</h3>
                      <p className="text-white/50 text-sm mt-1.5 leading-relaxed">{String(activeCampaign.ai_summary.strategy || "Campaign generated successfully.")}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Ad Sets", value: String(activeCampaign.ai_summary.num_adsets || activeCampaign.adsets.length), icon: "M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75z", color: "text-blue-400" },
                      { label: "Total Ads", value: String(activeCampaign.ai_summary.num_ads || totalAds), icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227", color: "text-purple-400" },
                      { label: "Daily Budget", value: formatCents(activeCampaign.daily_budget), icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0", color: "text-emerald-400" },
                      { label: "Credits Used", value: String(activeCampaign.credits_used), icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12", color: "text-amber-400" },
                    ].map(stat => (
                      <div key={stat.label} className="bg-white/[0.03] rounded-xl p-3.5 border border-white/5">
                        <p className="text-[10px] text-white/30 uppercase tracking-wider">{stat.label}</p>
                        <p className={`text-lg font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  {activeCampaign.ai_summary.historical_winners_used != null && activeCampaign.ai_summary.historical_winners_used > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                      <svg className="h-4 w-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                      <p className="text-xs text-amber-400/80">Based on {activeCampaign.ai_summary.historical_winners_used} proven winning ads from your account</p>
                    </div>
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
              <div className="glass-card p-6 space-y-5">
                <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Campaign Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-4">
                    {[
                      { label: "Campaign Name", value: activeCampaign.name },
                      { label: "Objective", value: activeCampaign.objective },
                      { label: "Daily Budget", value: formatCents(activeCampaign.daily_budget) },
                    ].map(item => (
                      <div key={item.label}>
                        <span className="text-white/30 block text-xs mb-0.5">{item.label}</span>
                        <span className="text-white font-medium text-sm">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: "Landing Page", value: activeCampaign.landing_page_url || "Not set" },
                      { label: "Conversion Event", value: activeCampaign.conversion_event || "Not set" },
                      { label: "Strategy", value: `${activeCampaign.audience_strategy} audience \u00B7 ${activeCampaign.creative_strategy} creative` },
                    ].map(item => (
                      <div key={item.label}>
                        <span className="text-white/30 block text-xs mb-0.5">{item.label}</span>
                        <span className="text-white/70 text-sm break-all">{item.value}</span>
                      </div>
                    ))}
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
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/15 flex items-center justify-center shrink-0">
                        <span className="text-xs text-blue-400 font-bold">{i + 1}</span>
                      </div>
                      <div>
                        <h3 className="text-white font-semibold text-sm">{adset.name}</h3>
                        <p className="text-xs text-white/40 mt-0.5">{formatCents(adset.daily_budget)}/day &middot; {adset.ads.length} ad{adset.ads.length !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-3">Targeting</p>
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
                  <div className="flex items-center gap-2.5">
                    <div className="h-5 w-5 rounded bg-blue-500/10 flex items-center justify-center">
                      <span className="text-[9px] text-blue-400 font-bold">{i + 1}</span>
                    </div>
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">{adset.name}</p>
                  </div>
                  {adset.ads.map((ad) => (
                    <AdCard
                      key={ad.id}
                      ad={ad}
                      isEditing={editingAdId === ad.id}
                      saving={saving}
                      canEdit={activeCampaign.status === "ready"}
                      regenerating={regeneratingAdId === ad.id}
                      onEdit={() => setEditingAdId(editingAdId === ad.id ? null : ad.id)}
                      onSave={handleSaveEdit}
                      onRegenerate={handleRegenerateAd}
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
                  <div className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center">
                    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-lg">Ready to Publish</h3>
                    <p className="text-white/40 text-sm">Your campaign will be created in Meta Ads Manager in <span className="text-amber-400 font-medium">PAUSED</span> state.</p>
                  </div>
                </div>

                <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 space-y-2.5 text-sm">
                  {[
                    { label: "Campaign", value: activeCampaign.name },
                    { label: "Objective", value: activeCampaign.objective },
                    { label: "Daily Budget", value: formatCents(activeCampaign.daily_budget) },
                    { label: "Ad Sets", value: String(activeCampaign.adsets.length) },
                    { label: "Total Ads", value: String(totalAds) },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between">
                      <span className="text-white/40">{row.label}</span>
                      <span className="text-white font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>

                {activeCampaign.status === "published" ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 text-center space-y-2">
                    <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                      <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <p className="text-emerald-400 font-semibold">Campaign Published Successfully</p>
                    <p className="text-white/40 text-xs">Campaign ID: {activeCampaign.meta_campaign_id}</p>
                    <p className="text-white/30 text-xs">{activeCampaign.published_at ? new Date(activeCampaign.published_at).toLocaleString() : ""}</p>
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
                ) : activeCampaign.status === "failed" ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 text-center space-y-3">
                    <p className="text-red-400 text-sm font-medium">Publishing failed. You can try again.</p>
                    <button onClick={handlePublish} className="text-sm text-white/50 hover:text-white transition px-4 py-2 rounded-lg bg-white/5 border border-white/10">
                      Retry Publish
                    </button>
                  </div>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-pink-500/20 border border-blue-500/15 flex items-center justify-center shrink-0">
            <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">AI Campaign Builder</h1>
            <p className="text-white/40 text-sm mt-0.5">Generate optimized Facebook ad campaigns with AI</p>
          </div>
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
          {campaigns.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-white/30">No campaigns created yet.</p>
            </div>
          ) : campaigns.map(c => (
            <div
              key={c.id}
              onClick={() => viewCampaign(c.id)}
              className="glass-card p-4 hover:bg-white/[0.03] transition group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-9 w-9 rounded-lg border flex items-center justify-center shrink-0 ${statusColor(c.status)}`}>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium group-hover:text-blue-400 transition">{c.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-white/30">{c.objective}</span>
                      <span className="text-white/10">&middot;</span>
                      <span className="text-xs text-white/30">{formatCents(c.daily_budget)}/day</span>
                      <span className="text-white/10">&middot;</span>
                      <span className="text-xs text-white/30">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium border inline-flex items-center gap-1.5 ${statusColor(c.status)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot(c.status)}`} />
                    {c.status}
                  </span>
                  {c.status !== "published" && c.status !== "generating" && (
                    <button
                      onClick={(e) => handleDelete(c.id, e)}
                      className="text-white/20 hover:text-red-400 transition p-1 opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Campaign Configuration Form - Multi-step */
        <div className="space-y-6">
          {/* Step indicator */}
          <div className="flex items-center gap-3">
            {[
              { step: 1 as const, label: "Campaign Setup" },
              { step: 2 as const, label: "AI Strategy" },
              { step: 3 as const, label: "Generate" },
            ].map((s, i) => (
              <button
                key={s.step}
                onClick={() => setConfigStep(s.step)}
                className="flex items-center gap-2"
              >
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium transition ${
                  configStep === s.step ? "bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/30" :
                  configStep > s.step ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"
                }`}>
                  {configStep > s.step ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : s.step}
                </div>
                <span className={`text-sm font-medium hidden sm:inline ${
                  configStep === s.step ? "text-white" : configStep > s.step ? "text-white/50" : "text-white/30"
                }`}>{s.label}</span>
                {i < 2 && <div className="h-px w-8 bg-white/10 hidden sm:block" />}
              </button>
            ))}
          </div>

          {/* Step 1: Campaign Setup */}
          {configStep === 1 && (
            <div className="space-y-6">
              <div className="glass-card p-6 space-y-5">
                <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider flex items-center gap-2">
                  <svg className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                  </svg>
                  Campaign Setup
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Campaign Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="My AI Campaign"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Max Daily Budget ($)</label>
                    <input
                      type="number"
                      value={dailyBudget}
                      onChange={e => setDailyBudget(e.target.value)}
                      min="1"
                      step="1"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition"
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
                        className={`p-4 rounded-xl border text-left transition flex items-start gap-3 ${
                          objective === o.value
                            ? "bg-blue-500/10 border-blue-500/30"
                            : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10"
                        }`}
                      >
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                          objective === o.value ? "bg-blue-500/20" : "bg-white/5"
                        }`}>
                          <svg className={`h-4.5 w-4.5 ${objective === o.value ? "text-blue-400" : "text-white/30"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={o.icon} />
                          </svg>
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${objective === o.value ? "text-white" : "text-white/60"}`}>{o.label}</p>
                          <p className="text-xs text-white/30 mt-0.5">{o.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Facebook Page</label>
                    <select value={pageId} onChange={e => setPageId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 transition">
                      <option value="">Select a page...</option>
                      {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Meta Pixel</label>
                    <select value={pixelId} onChange={e => setPixelId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 transition">
                      <option value="">Select a pixel...</option>
                      {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Landing Page URL</label>
                    <input type="url" value={landingPage} onChange={e => setLandingPage(e.target.value)} placeholder="https://yoursite.com/offer" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Conversion Event</label>
                    <select value={conversionEvent} onChange={e => setConversionEvent(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 transition">
                      <option value="Lead">Lead</option>
                      <option value="Purchase">Purchase</option>
                      <option value="AddToCart">Add to Cart</option>
                      <option value="InitiateCheckout">Initiate Checkout</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={() => setConfigStep(2)} className="btn-glow flex items-center gap-1.5">
                  Next: AI Strategy
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: AI Strategy */}
          {configStep === 2 && (
            <div className="space-y-6">
              <div className="glass-card p-6 space-y-5">
                <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider flex items-center gap-2">
                  <svg className="h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  AI Strategy
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="text-xs text-white/40 block mb-2">Audience Strategy</label>
                    <div className="space-y-2">
                      {[
                        { value: "conservative", label: "Conservative", desc: "Use proven targeting from winning ads", icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" },
                        { value: "experimental", label: "Experimental", desc: "Test new audiences with AI suggestions", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
                      ].map(s => (
                        <button
                          key={s.value}
                          onClick={() => setAudienceStrategy(s.value)}
                          className={`w-full p-3.5 rounded-xl border text-left transition flex items-start gap-3 ${
                            audienceStrategy === s.value
                              ? "bg-purple-500/10 border-purple-500/30"
                              : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10"
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            audienceStrategy === s.value ? "bg-purple-500/20" : "bg-white/5"
                          }`}>
                            <svg className={`h-4 w-4 ${audienceStrategy === s.value ? "text-purple-400" : "text-white/30"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                            </svg>
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${audienceStrategy === s.value ? "text-white" : "text-white/60"}`}>{s.label}</p>
                            <p className="text-xs text-white/30 mt-0.5">{s.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-2">Creative Strategy</label>
                    <div className="space-y-2">
                      {[
                        { value: "proven_winners", label: "Proven Winners", desc: "Reuse copy from your best-performing ads", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602" },
                        { value: "ai_generated", label: "All New", desc: "Generate entirely new ad copy with AI", icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846" },
                      ].map(s => (
                        <button
                          key={s.value}
                          onClick={() => setCreativeStrategy(s.value)}
                          className={`w-full p-3.5 rounded-xl border text-left transition flex items-start gap-3 ${
                            creativeStrategy === s.value
                              ? "bg-purple-500/10 border-purple-500/30"
                              : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10"
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            creativeStrategy === s.value ? "bg-purple-500/20" : "bg-white/5"
                          }`}>
                            <svg className={`h-4 w-4 ${creativeStrategy === s.value ? "text-purple-400" : "text-white/30"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                            </svg>
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${creativeStrategy === s.value ? "text-white" : "text-white/60"}`}>{s.label}</p>
                            <p className="text-xs text-white/30 mt-0.5">{s.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1.5">Historical Data Range</label>
                  <select value={historicalRange} onChange={e => setHistoricalRange(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 transition md:w-64">
                    <option value="30">Last 30 days</option>
                    <option value="60">Last 60 days</option>
                    <option value="90">Last 90 days</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-white/40 block mb-1.5">Custom AI Instructions (optional)</label>
                  <textarea
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    placeholder="e.g., Focus on women aged 25-45 interested in skincare. Use a friendly, conversational tone."
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 resize-none transition"
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setConfigStep(1)} className="text-sm text-white/40 hover:text-white transition flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                  Back
                </button>
                <button onClick={() => setConfigStep(3)} className="btn-glow flex items-center gap-1.5">
                  Next: Review &amp; Generate
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Generate */}
          {configStep === 3 && (
            <div className="space-y-6">
              <div className="glass-card p-6 space-y-5">
                <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider flex items-center gap-2">
                  <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Review Configuration
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: "Campaign Name", value: name || "Not set", highlight: !name },
                    { label: "Daily Budget", value: `$${dailyBudget}`, highlight: false },
                    { label: "Objective", value: objective, highlight: false },
                    { label: "Conversion Event", value: conversionEvent, highlight: false },
                    { label: "Audience Strategy", value: audienceStrategy === "conservative" ? "Conservative" : "Experimental", highlight: false },
                    { label: "Creative Strategy", value: creativeStrategy === "proven_winners" ? "Proven Winners" : "All New", highlight: false },
                    { label: "Historical Range", value: `Last ${historicalRange} days`, highlight: false },
                    { label: "Landing Page", value: landingPage || "Not set", highlight: false },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                      <span className="text-xs text-white/40">{item.label}</span>
                      <span className={`text-sm font-medium ${item.highlight ? "text-red-400" : "text-white"}`}>{item.value}</span>
                    </div>
                  ))}
                </div>

                {instructions && (
                  <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1.5">Custom Instructions</p>
                    <p className="text-sm text-white/60">{instructions}</p>
                  </div>
                )}
              </div>

              {/* What AI will do */}
              <div className="glass-card p-5 space-y-3">
                <p className="text-xs text-white/40 font-semibold uppercase tracking-wider">What AI will do</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z", label: "Analyze your historical ad data" },
                    { icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07", label: "Build optimized audience targeting" },
                    { icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227", label: "Generate compelling ad copy" },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-2.5 p-2">
                      <svg className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      <p className="text-xs text-white/50">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={() => setConfigStep(2)} className="text-sm text-white/40 hover:text-white transition flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                  Back
                </button>
                <div className="flex items-center gap-4">
                  <p className="text-xs text-white/30">Costs 20 credits</p>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// --- Ad Card with inline editing + preview mockup + regenerate ---
function AdCard({
  ad,
  isEditing,
  saving,
  canEdit,
  regenerating,
  onEdit,
  onSave,
  onRegenerate,
}: {
  ad: AICampaignAd;
  isEditing: boolean;
  saving: boolean;
  canEdit: boolean;
  regenerating: boolean;
  onEdit: () => void;
  onSave: (adId: string, changes: Record<string, string>) => void;
  onRegenerate: (adId: string) => void;
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
  }, [ad.headline, ad.primary_text, ad.description, ad.cta_type]);

  const hasChanges = headline !== ad.headline || primaryText !== ad.primary_text || description !== (ad.description || "") || ctaType !== ad.cta_type;

  const handleSaveAll = () => {
    const changes: Record<string, string> = {};
    if (headline !== ad.headline) changes.headline = headline;
    if (primaryText !== ad.primary_text) changes.primary_text = primaryText;
    if (description !== (ad.description || "")) changes.description = description;
    if (ctaType !== ad.cta_type) changes.cta_type = ctaType;
    if (Object.keys(changes).length > 0) {
      onSave(ad.id, changes);
    }
    onEdit(); // close edit mode
  };

  return (
    <div className="glass-card overflow-hidden">
      {/* Ad header */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center">
            <svg className="h-3.5 w-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <p className="text-white text-sm font-medium">{ad.name}</p>
          {ad.creative_source === "proven_winners" && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/15 font-medium">Winner</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/5">{isEditing ? ctaType.replace(/_/g, " ") : ad.cta_type.replace(/_/g, " ")}</span>
          {canEdit && (
            <>
              <button
                onClick={() => onRegenerate(ad.id)}
                disabled={regenerating}
                className="text-white/20 hover:text-blue-400 transition p-1.5 rounded-lg hover:bg-blue-500/5"
                title="Regenerate this ad copy with AI"
              >
                {regenerating ? (
                  <div className="h-3.5 w-3.5 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                )}
              </button>
              <button onClick={onEdit} className="text-white/20 hover:text-white transition p-1.5 rounded-lg hover:bg-white/5" title="Edit">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="px-5 pb-5 space-y-3">
          <div>
            <label className="text-[10px] text-white/30 block mb-0.5">Headline</label>
            <input
              type="text"
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              maxLength={40}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 resize-none"
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/30 block mb-0.5">CTA</label>
            <select value={ctaType} onChange={e => setCtaType(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50">
              {CTA_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onEdit} className="text-xs text-white/40 hover:text-white transition px-4 py-1.5 rounded-lg">Cancel</button>
            {hasChanges && (
              <button onClick={handleSaveAll} disabled={saving} className="text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition px-4 py-1.5 rounded-lg disabled:opacity-50 font-medium">
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row">
          {/* Ad copy */}
          <div className="flex-1 px-5 pb-4 space-y-2">
            <p className="text-white font-semibold text-sm">{ad.headline}</p>
            <p className="text-white/50 text-sm leading-relaxed">{ad.primary_text}</p>
            {ad.description && <p className="text-white/30 text-xs">{ad.description}</p>}
          </div>
          {/* Facebook ad preview mockup */}
          <div className="md:w-56 shrink-0 p-3">
            <div className="border border-white/5 rounded-xl overflow-hidden bg-white/[0.02]">
              <div className="h-20 bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center">
                <svg className="h-6 w-6 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5" />
                </svg>
              </div>
              <div className="p-3 space-y-1.5">
                <p className="text-[10px] text-white/70 font-semibold truncate">{ad.headline}</p>
                <p className="text-[9px] text-white/40 line-clamp-2 leading-relaxed">{ad.primary_text}</p>
                <div className="pt-1">
                  <span className="text-[8px] px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
                    {(ad.cta_type || "LEARN_MORE").replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
