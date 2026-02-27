"use client";

import { useEffect, useState } from "react";
import { fbAdsApi } from "@/lib/api-client";
import type { AICampaignItem, FBConnectionStatus, FBPageItem, FBPixelItem } from "@/types";

type View = "config" | "generating" | "review" | "history";

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

export default function FBAILaunchPage() {
  const [view, setView] = useState<View>("config");
  const [connection, setConnection] = useState<FBConnectionStatus | null>(null);
  const [pages, setPages] = useState<FBPageItem[]>([]);
  const [pixels, setPixels] = useState<FBPixelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<AICampaignItem[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<AICampaignItem | null>(null);
  const [publishing, setPublishing] = useState(false);

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
      await fbAdsApi.generateAICampaign(res.data.id);
      setView("generating");

      // Poll for progress
      const poll = setInterval(async () => {
        try {
          const campRes = await fbAdsApi.getAICampaign(res.data.id);
          setActiveCampaign(campRes.data);
          if (campRes.data.status === "ready" || campRes.data.status === "failed") {
            clearInterval(poll);
            if (campRes.data.status === "ready") setView("review");
          }
        } catch {
          clearInterval(poll);
        }
      }, 2000);
    } catch {
      alert("Failed to create campaign.");
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async () => {
    if (!activeCampaign || !confirm("Publish this campaign to Meta Ads Manager? It will be created in PAUSED state.")) return;
    setPublishing(true);
    try {
      await fbAdsApi.publishAICampaign(activeCampaign.id);
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

  const viewCampaign = async (id: string) => {
    try {
      const res = await fbAdsApi.getAICampaign(id);
      setActiveCampaign(res.data);
      if (res.data.status === "ready") setView("review");
      else if (res.data.status === "generating") setView("generating");
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
        <h1 className="text-2xl font-bold text-white">AI Launch</h1>
        <p className="text-white/40">Connect your Facebook account first.</p>
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
        <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
          <div className="h-8 w-8 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Generating Your Campaign</h2>
          <p className="text-white/40 text-sm mt-1">{STAGE_LABELS[stage] || stage}</p>
        </div>
        <div className="w-full bg-white/5 rounded-full h-2">
          <div className="bg-emerald-500 h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-center gap-1.5">
          {STAGES.slice(0, 5).map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-8 rounded-full transition ${
                STAGES.indexOf(stage) >= i ? "bg-emerald-500" : "bg-white/10"
              }`}
            />
          ))}
        </div>
        {stage === "error" && (
          <p className="text-red-400 text-sm">{progress?.error || "An error occurred."}</p>
        )}
      </div>
    );
  }

  // --- Review View ---
  if (view === "review" && activeCampaign) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{activeCampaign.name}</h1>
            <p className="text-white/40 text-sm mt-1">
              {activeCampaign.objective} &middot; {formatCents(activeCampaign.daily_budget)}/day
              &middot; {activeCampaign.credits_used} credits used
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setView("config"); setActiveCampaign(null); }}
              className="text-sm px-4 py-2 rounded-lg text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition"
            >
              New Campaign
            </button>
            {activeCampaign.status === "ready" && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="btn-glow disabled:opacity-50 flex items-center gap-2"
              >
                {publishing ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                  </svg>
                )}
                {publishing ? "Publishing..." : "Publish to Meta"}
              </button>
            )}
            {activeCampaign.status === "published" && (
              <span className="text-sm px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Published
              </span>
            )}
          </div>
        </div>

        {/* AI Summary */}
        {activeCampaign.ai_summary && (
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-2">AI Strategy</h3>
            <p className="text-white/50 text-sm">{String(activeCampaign.ai_summary.strategy || "")}</p>
            <div className="flex gap-4 mt-3 text-xs text-white/40">
              <span>{String(activeCampaign.ai_summary.num_adsets || 0)} ad sets</span>
              <span>{String(activeCampaign.ai_summary.num_ads || 0)} ads</span>
            </div>
          </div>
        )}

        {/* Ad Sets & Ads */}
        {activeCampaign.adsets.map((adset, i) => (
          <div key={adset.id} className="glass-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold">{adset.name}</h3>
                <p className="text-xs text-white/40 mt-0.5">{formatCents(adset.daily_budget)}/day &middot; {adset.ads.length} ad{adset.ads.length !== 1 ? "s" : ""}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400">Ad Set {i + 1}</span>
            </div>

            {Object.keys(adset.targeting).length > 0 && (
              <div className="text-xs text-white/40 bg-white/[0.02] rounded-lg p-3 border border-white/5">
                <p className="font-semibold text-white/50 mb-1">Targeting</p>
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(adset.targeting, null, 2)}</pre>
              </div>
            )}

            <div className="space-y-2">
              {adset.ads.map(ad => (
                <div key={ad.id} className="bg-white/[0.02] rounded-lg p-3 border border-white/5 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-white text-sm font-medium">{ad.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{ad.cta_type}</span>
                  </div>
                  <p className="text-white/70 text-sm font-semibold">{ad.headline}</p>
                  <p className="text-white/50 text-sm">{ad.primary_text}</p>
                  {ad.description && <p className="text-white/30 text-xs">{ad.description}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // --- Config + History View ---
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">AI Launch</h1>
          <p className="text-white/40 text-sm mt-1">Configure and generate AI-powered campaigns</p>
        </div>
        {campaigns.length > 0 && (
          <button
            onClick={() => setView(view === "history" ? "config" : "history")}
            className="text-sm px-4 py-2 rounded-lg text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition"
          >
            {view === "history" ? "New Campaign" : `History (${campaigns.length})`}
          </button>
        )}
      </div>

      {view === "history" ? (
        <div className="space-y-3">
          {campaigns.map(c => (
            <button
              key={c.id}
              onClick={() => viewCampaign(c.id)}
              className="w-full text-left glass-card p-4 hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">{c.name}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {c.objective} &middot; {formatCents(c.daily_budget)}/day &middot; {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  c.status === "published" ? "bg-emerald-500/10 text-emerald-400" :
                  c.status === "ready" ? "bg-blue-500/10 text-blue-400" :
                  c.status === "failed" ? "bg-red-500/10 text-red-400" :
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
                <label className="text-xs text-white/40 block mb-1">Campaign Name</label>
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
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>

            {/* Objective */}
            <div>
              <label className="text-xs text-white/40 block mb-2">Campaign Objective</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: "LEADS", label: "Leads", desc: "Collect leads from forms" },
                  { value: "SALES", label: "Sales", desc: "Drive purchases on your site" },
                ].map(o => (
                  <button
                    key={o.value}
                    onClick={() => setObjective(o.value)}
                    className={`p-3 rounded-lg border text-left transition ${
                      objective === o.value
                        ? "bg-blue-500/10 border-blue-500/30 text-white"
                        : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                    }`}
                  >
                    <p className="text-sm font-medium">{o.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{o.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-1">Facebook Page</label>
                <select
                  value={pageId}
                  onChange={e => setPageId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="">Select a page...</option>
                  {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">Meta Pixel</label>
                <select
                  value={pixelId}
                  onChange={e => setPixelId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="">Select a pixel...</option>
                  {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-white/40 block mb-1">Landing Page URL</label>
                <input
                  type="url"
                  value={landingPage}
                  onChange={e => setLandingPage(e.target.value)}
                  placeholder="https://yoursite.com/offer"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">Conversion Event</label>
                <select
                  value={conversionEvent}
                  onChange={e => setConversionEvent(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                >
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
                <select
                  value={historicalRange}
                  onChange={e => setHistoricalRange(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                >
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
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58" />
                </svg>
              )}
              {creating ? "Creating..." : "Generate Campaign"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
