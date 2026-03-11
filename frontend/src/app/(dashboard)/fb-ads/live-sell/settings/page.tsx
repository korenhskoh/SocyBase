"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { liveSellApi } from "@/lib/api-client";
import type { LiveSellSettings } from "@/types";

const DEFAULT_KEYWORDS = ["+1", "order", "nak", "beli", "want", "buy", "pm"];

export default function LiveSellSettingsPage() {
  const [settings, setSettings] = useState<LiveSellSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await liveSellApi.getSettings();
      setSettings(res.data);
    } catch {
      // ignore
    }
    setLoading(false);
  }

  async function save(partial: Partial<LiveSellSettings>) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await liveSellApi.updateSettings(partial);
      setSettings(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // ignore
    }
    setSaving(false);
  }

  function addKeyword() {
    if (!settings || !newKeyword.trim()) return;
    const kw = newKeyword.trim().toLowerCase();
    if (settings.order_keywords.includes(kw)) {
      setNewKeyword("");
      return;
    }
    const updated = [...settings.order_keywords, kw];
    setSettings({ ...settings, order_keywords: updated });
    save({ order_keywords: updated });
    setNewKeyword("");
  }

  function removeKeyword(kw: string) {
    if (!settings) return;
    const updated = settings.order_keywords.filter((k) => k !== kw);
    setSettings({ ...settings, order_keywords: updated });
    save({ order_keywords: updated });
  }

  function resetKeywords() {
    if (!settings) return;
    setSettings({ ...settings, order_keywords: [...DEFAULT_KEYWORDS] });
    save({ order_keywords: [...DEFAULT_KEYWORDS] });
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/5 border-t-primary-400" />
        <p className="text-sm text-white/30">Loading settings...</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-20 text-white/30">
        Failed to load settings.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/fb-ads/live-sell"
          className="p-1.5 text-white/30 hover:text-white rounded-lg hover:bg-white/5 transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Live Sell Settings</h1>
          <p className="text-sm text-white/30 mt-0.5">Configure order detection and auto-reply behavior</p>
        </div>
        {saving && (
          <span className="text-xs text-white/30 flex items-center gap-1.5">
            <div className="animate-spin h-3 w-3 border border-white/10 border-t-white/40 rounded-full" />
            Saving...
          </span>
        )}
        {saved && !saving && (
          <span className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-fade-in-up">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Saved
          </span>
        )}
      </div>

      <div className="space-y-6">
        {/* ── Order Keywords ── */}
        <section className="bg-navy-800/30 rounded-xl border border-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <svg className="h-4.5 w-4.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-white">Order Keywords</h2>
              <p className="text-xs text-white/30 mt-0.5">
                Comments containing these keywords are flagged as orders
              </p>
            </div>
            <button
              onClick={resetKeywords}
              className="text-[11px] text-white/20 hover:text-white/50 transition px-2 py-1 rounded hover:bg-white/5"
            >
              Reset defaults
            </button>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap gap-2 mb-4">
              {settings.order_keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/15 text-amber-400 text-xs font-medium px-3 py-1.5 rounded-lg group transition hover:border-amber-500/30"
                >
                  {kw}
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="text-amber-400/40 hover:text-red-400 transition -mr-0.5"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              {settings.order_keywords.length === 0 && (
                <p className="text-xs text-white/15 italic">No keywords configured</p>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="Add keyword (e.g., mine, dibs, +1)..."
                className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-primary-500/30 focus:ring-1 focus:ring-primary-500/10 transition"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
              />
              <button
                onClick={addKeyword}
                disabled={!newKeyword.trim()}
                className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white/60 hover:bg-white/10 transition disabled:opacity-20 font-medium"
              >
                Add
              </button>
            </div>
          </div>
        </section>

        {/* ── Auto-Reply ── */}
        <section className="bg-navy-800/30 rounded-xl border border-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary-500/10 flex items-center justify-center shrink-0">
              <svg className="h-4.5 w-4.5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-white">Auto-Reply</h2>
              <p className="text-xs text-white/30 mt-0.5">
                Automatically reply to detected order comments
              </p>
            </div>
            <button
              onClick={() => {
                const enabled = !settings.auto_reply_enabled;
                setSettings({ ...settings, auto_reply_enabled: enabled });
                save({ auto_reply_enabled: enabled });
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.auto_reply_enabled
                  ? "bg-primary-500"
                  : "bg-white/10"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                  settings.auto_reply_enabled
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {settings.auto_reply_enabled && (
            <div className="p-5 space-y-5">
              {/* Mode selector */}
              <div>
                <label className="text-xs font-medium text-white/40 mb-2 block">Reply Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["template", "ai"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setSettings({ ...settings, auto_reply_mode: mode });
                        save({ auto_reply_mode: mode });
                      }}
                      className={`flex items-center gap-3 p-3.5 rounded-xl border transition text-left ${
                        settings.auto_reply_mode === mode
                          ? "bg-primary-500/[0.08] border-primary-500/20 ring-1 ring-primary-500/10"
                          : "bg-white/[0.02] border-white/5 hover:border-white/10"
                      }`}
                    >
                      <div
                        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                          settings.auto_reply_mode === mode
                            ? "bg-primary-500/15"
                            : "bg-white/[0.03]"
                        }`}
                      >
                        {mode === "template" ? (
                          <svg className={`h-4 w-4 ${settings.auto_reply_mode === mode ? "text-primary-400" : "text-white/20"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                        ) : (
                          <svg className={`h-4 w-4 ${settings.auto_reply_mode === mode ? "text-primary-400" : "text-white/20"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className={`text-xs font-semibold ${settings.auto_reply_mode === mode ? "text-white" : "text-white/50"}`}>
                          {mode === "template" ? "Template" : "AI Generated"}
                        </p>
                        <p className="text-[10px] text-white/20 mt-0.5">
                          {mode === "template"
                            ? "Use a fixed message with variables"
                            : "AI crafts contextual replies"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Template mode */}
              {settings.auto_reply_mode === "template" && (
                <div>
                  <label className="text-xs font-medium text-white/40 mb-2 block">
                    Reply Template
                  </label>
                  <div className="mb-2 flex gap-1.5">
                    {["{name}", "{first_name}"].map((v) => (
                      <button
                        key={v}
                        onClick={() => {
                          setSettings({
                            ...settings,
                            auto_reply_template: settings.auto_reply_template + " " + v,
                          });
                        }}
                        className="text-[10px] bg-primary-500/10 text-primary-400 px-2 py-1 rounded-md hover:bg-primary-500/20 transition font-mono"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={settings.auto_reply_template}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_reply_template: e.target.value,
                      })
                    }
                    onBlur={() =>
                      save({
                        auto_reply_template: settings.auto_reply_template,
                      })
                    }
                    rows={3}
                    className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-primary-500/30 focus:ring-1 focus:ring-primary-500/10 resize-none transition"
                    placeholder="Hi {name}, thank you for your order!"
                  />
                  {/* Preview */}
                  <div className="mt-3 p-4 bg-white/[0.015] rounded-xl border border-white/[0.03]">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-5 w-5 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-[8px] font-bold text-white">
                        Y
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/20">Preview</p>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {(settings.auto_reply_template || "Hi {name}, thank you!")
                        .replace(/\{name\}/g, "Ahmad bin Ali")
                        .replace(/\{first_name\}/g, "Ahmad")}
                    </p>
                  </div>
                </div>
              )}

              {/* AI mode */}
              {settings.auto_reply_mode === "ai" && (
                <div>
                  <label className="text-xs font-medium text-white/40 mb-2 block">
                    AI Instructions
                  </label>
                  <textarea
                    value={settings.ai_reply_instructions}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        ai_reply_instructions: e.target.value,
                      })
                    }
                    onBlur={() =>
                      save({
                        ai_reply_instructions: settings.ai_reply_instructions,
                      })
                    }
                    rows={4}
                    className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-primary-500/30 focus:ring-1 focus:ring-primary-500/10 resize-none transition"
                    placeholder="Reply politely confirming the order. Mention that we will DM them for payment details. Keep it friendly and in Bahasa Melayu."
                  />
                  <p className="text-[11px] text-white/15 mt-2">
                    The AI will use these instructions to craft a unique reply for each order comment.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Disabled state */}
          {!settings.auto_reply_enabled && (
            <div className="px-5 py-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-white/[0.02] flex items-center justify-center mx-auto mb-3">
                <svg className="h-6 w-6 text-white/[0.07]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
              </div>
              <p className="text-xs text-white/20">Auto-reply is disabled</p>
              <p className="text-[11px] text-white/10 mt-0.5">
                Enable it above to automatically respond to order comments
              </p>
            </div>
          )}
        </section>

        {/* ── How it works ── */}
        <section className="bg-navy-800/30 rounded-xl border border-white/5 p-5">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">How it works</h3>
          <div className="space-y-3">
            {[
              { step: "1", title: "Start a monitoring session", desc: "Select a live or recent video from your Facebook page" },
              { step: "2", title: "Comments are scanned in real-time", desc: "The system checks each comment against your order keywords" },
              { step: "3", title: "Orders are detected and flagged", desc: "Matching comments are highlighted and counted as orders" },
              { step: "4", title: "Auto-reply (if enabled)", desc: "The system replies to order comments using your template or AI" },
            ].map((item) => (
              <div key={item.step} className="flex gap-3">
                <div className="h-6 w-6 rounded-md bg-white/[0.03] flex items-center justify-center text-[10px] font-bold text-white/20 shrink-0 mt-0.5">
                  {item.step}
                </div>
                <div>
                  <p className="text-xs font-medium text-white/60">{item.title}</p>
                  <p className="text-[11px] text-white/20 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
