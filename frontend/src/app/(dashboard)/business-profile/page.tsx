"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { tenantSettingsApi, businessProfileApi } from "@/lib/api-client";
import type { TenantSettings, AIPageSuggestions } from "@/types";

export default function BusinessProfilePage() {
  const { user } = useAuthStore();

  const [bizName, setBizName] = useState("");
  const [bizType, setBizType] = useState("");
  const [bizIndustry, setBizIndustry] = useState("");
  const [bizCountry, setBizCountry] = useState("");
  const [bizFbUrl, setBizFbUrl] = useState("");
  const [bizProductLinks, setBizProductLinks] = useState<string[]>([""]);
  const [bizTargetAudience, setBizTargetAudience] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [bizMessage, setBizMessage] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<AIPageSuggestions | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tenantSettingsApi
      .get()
      .then((r) => {
        const s: TenantSettings = r.data;
        if (s.business) {
          setBizName(s.business.business_name || "");
          setBizType(s.business.business_type || "");
          setBizIndustry(s.business.industry || "");
          setBizCountry(s.business.country || "");
          setBizFbUrl(s.business.facebook_page_url || "");
          setBizProductLinks(
            s.business.product_service_links?.length ? s.business.product_service_links : [""]
          );
          setBizTargetAudience(s.business.target_audience_description || "");
        }
        if (s.ai_suggestions) {
          setAiSuggestions(s.ai_suggestions as AIPageSuggestions);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSaveBusiness = async () => {
    setBizSaving(true);
    setBizMessage("");
    try {
      await tenantSettingsApi.update({
        business: {
          business_name: bizName,
          business_type: bizType,
          industry: bizIndustry,
          country: bizCountry,
          facebook_page_url: bizFbUrl,
          product_service_links: bizProductLinks.filter((l) => l.trim()),
          target_audience_description: bizTargetAudience,
        },
      });
      setBizMessage("Business profile saved successfully!");
    } catch {
      setBizMessage("Failed to save business profile");
    } finally {
      setBizSaving(false);
    }
  };

  const handleGetSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const res = await businessProfileApi.getSuggestions();
      setAiSuggestions(res.data);
      // Fire-and-forget save to tenant settings
      tenantSettingsApi.update({ ai_suggestions: res.data }).catch(() => {});
    } catch {
      alert("Failed to get AI suggestions. Make sure your business profile is saved and OpenAI API key is configured.");
    } finally {
      setSuggestionsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">AI Business Profile</h1>
        <p className="text-white/50 mt-1">Help AI understand your business for smarter fan analysis and competitor discovery</p>
      </div>

      {/* Business Details Form */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-purple-500/10 border border-purple-500/20">
            <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Business Details</h2>
            <p className="text-sm text-white/40">Tell us about your business so AI can provide better insights</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Business Name</label>
              <input
                type="text"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                placeholder="My Company"
                className="input-glass"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Business Type</label>
              <select
                value={bizType}
                onChange={(e) => setBizType(e.target.value)}
                className="input-glass [&>option]:bg-[#1a1a2e] [&>option]:text-white"
              >
                <option value="">Select type...</option>
                <option value="ecommerce">E-Commerce</option>
                <option value="saas">SaaS / Software</option>
                <option value="agency">Agency / Services</option>
                <option value="retail">Retail</option>
                <option value="restaurant">Restaurant / F&B</option>
                <option value="education">Education</option>
                <option value="healthcare">Healthcare</option>
                <option value="real_estate">Real Estate</option>
                <option value="finance">Finance / Insurance</option>
                <option value="media">Media / Entertainment</option>
                <option value="nonprofit">Non-Profit</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Industry</label>
              <input
                type="text"
                value={bizIndustry}
                onChange={(e) => setBizIndustry(e.target.value)}
                placeholder="e.g. Fashion, Technology, Food & Beverage"
                className="input-glass"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Country</label>
              <input
                type="text"
                value={bizCountry}
                onChange={(e) => setBizCountry(e.target.value)}
                placeholder="e.g. Malaysia, Thailand, Indonesia"
                className="input-glass"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1.5">Facebook Page URL</label>
            <input
              type="url"
              value={bizFbUrl}
              onChange={(e) => setBizFbUrl(e.target.value)}
              placeholder="https://facebook.com/yourpage"
              className="input-glass"
            />
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1.5">Product / Service Links</label>
            {bizProductLinks.map((link, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="url"
                  value={link}
                  onChange={(e) => {
                    const updated = [...bizProductLinks];
                    updated[i] = e.target.value;
                    setBizProductLinks(updated);
                  }}
                  placeholder="https://yoursite.com/product"
                  className="input-glass flex-1"
                />
                {bizProductLinks.length > 1 && (
                  <button
                    onClick={() => setBizProductLinks(bizProductLinks.filter((_, j) => j !== i))}
                    className="px-2 text-red-400/60 hover:text-red-400 transition"
                    title="Remove"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {bizProductLinks.length < 5 && (
              <button
                onClick={() => setBizProductLinks([...bizProductLinks, ""])}
                className="text-xs text-purple-400 hover:text-purple-300 transition"
              >
                + Add another link
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1.5">Target Audience Description</label>
            <textarea
              value={bizTargetAudience}
              onChange={(e) => setBizTargetAudience(e.target.value)}
              placeholder="Describe your target audience, demographics, interests..."
              rows={3}
              className="input-glass resize-none"
            />
          </div>
        </div>

        {bizMessage && (
          <p className={`text-sm ${bizMessage.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
            {bizMessage}
          </p>
        )}

        <button onClick={handleSaveBusiness} disabled={bizSaving} className="btn-glow disabled:opacity-50">
          {bizSaving ? "Saving..." : "Save AI Business Profile"}
        </button>
      </div>

      {/* AI Competitor Discovery */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-violet-500/10 border border-violet-500/20">
            <svg className="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">AI Competitor Discovery</h2>
            <p className="text-sm text-white/40">Let AI suggest competitor Facebook pages to scrape based on your business</p>
          </div>
        </div>

        <p className="text-sm text-white/50">
          Save your business profile above first, then click below to get AI-powered suggestions for competitor pages you should be monitoring.
        </p>

        <button
          onClick={handleGetSuggestions}
          disabled={suggestionsLoading || !bizName.trim()}
          className="text-sm px-5 py-2.5 rounded-lg font-medium text-white bg-gradient-to-r from-purple-500/20 to-violet-500/20 border border-purple-500/30 hover:from-purple-500/30 hover:to-violet-500/30 transition disabled:opacity-50 flex items-center gap-2"
        >
          {suggestionsLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
              Analyzing your business...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
              </svg>
              Get AI Competitor Suggestions
            </>
          )}
        </button>

        {/* AI Suggestions Results */}
        {aiSuggestions && (
          <div className="border-t border-white/10 pt-4 mt-4 space-y-4">
            <h3 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
              </svg>
              AI Analysis Results
            </h3>

            {aiSuggestions.business_fit_analysis && (
              <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/15">
                <p className="text-xs font-medium text-purple-300 mb-1">Business Fit Analysis</p>
                <p className="text-sm text-white/70">{aiSuggestions.business_fit_analysis}</p>
              </div>
            )}

            {aiSuggestions.suggested_pages?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-white/50 mb-2">Recommended Pages to Scrape</p>
                <div className="space-y-2">
                  {aiSuggestions.suggested_pages.map((page, i) => (
                    <div key={i} className="p-3 rounded-lg bg-white/[0.03] border border-white/10 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{page.name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{page.reason}</p>
                        {page.facebook_url && (
                          <a
                            href={page.facebook_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-purple-400/70 hover:text-purple-300 font-mono mt-1 truncate block underline decoration-purple-400/30 hover:decoration-purple-300/60 transition-colors"
                          >
                            {page.facebook_url}
                          </a>
                        )}
                      </div>
                      {page.facebook_url && (
                        <a
                          href={`/jobs/new?input=${encodeURIComponent(page.facebook_url)}&type=post_discovery`}
                          className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium text-purple-300 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition"
                        >
                          Scrape This
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiSuggestions.audience_insights?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-white/50 mb-2">Audience Insights</p>
                <ul className="space-y-1">
                  {aiSuggestions.audience_insights.map((insight, i) => (
                    <li key={i} className="text-sm text-white/60 flex items-start gap-2">
                      <span className="text-purple-400 mt-0.5">&#8226;</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {aiSuggestions.targeting_recommendations?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-white/50 mb-2">Targeting Recommendations</p>
                <ul className="space-y-1">
                  {aiSuggestions.targeting_recommendations.map((rec, i) => (
                    <li key={i} className="text-sm text-white/60 flex items-start gap-2">
                      <span className="text-violet-400 mt-0.5">&#8226;</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
