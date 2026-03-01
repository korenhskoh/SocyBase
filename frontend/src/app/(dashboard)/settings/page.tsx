"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { authApi, telegramApi, tenantSettingsApi, adminApi } from "@/lib/api-client";
import type { TenantSettings } from "@/types";

export default function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [language, setLanguage] = useState(user?.language || "en");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Scraping defaults
  const [retryCount, setRetryCount] = useState(2);

  useEffect(() => {
    const stored = localStorage.getItem("socybase_scraping_retry_count");
    if (stored !== null) setRetryCount(Number(stored));
  }, []);

  // Telegram personal linking state
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramLink, setTelegramLink] = useState("");

  // Telegram bot config (super_admin only)
  const isSuperAdmin = user?.role === "super_admin";
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgBotTokenSaved, setTgBotTokenSaved] = useState(false);
  const [tgChatId, setTgChatId] = useState("");
  const [tgSaving, setTgSaving] = useState(false);
  const [tgMessage, setTgMessage] = useState("");
  const [tgBotStatus, setTgBotStatus] = useState<"idle" | "restarting" | "online" | "timeout">("idle");
  const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tgPollStartRef = useRef<number>(0);

  useEffect(() => {
    telegramApi
      .getStatus()
      .then((r) => setTelegramLinked(r.data.linked))
      .catch(() => {})
      .finally(() => setTelegramLoading(false));
  }, []);

  // Load Telegram bot config for super_admin
  useEffect(() => {
    if (isSuperAdmin) {
      adminApi.getTelegramSettings().then((r) => {
        const d = r.data;
        if (d.bot_token === "tok_****") {
          setTgBotTokenSaved(true);
          setTgBotToken("");
        } else if (d.bot_token) {
          setTgBotToken(d.bot_token);
        }
        if (d.notification_chat_id) setTgChatId(d.notification_chat_id);
      }).catch(() => {});
    }
  }, [isSuperAdmin]);

  // Tenant settings (email)
  const isAdmin = user?.role === "tenant_admin" || user?.role === "super_admin";
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);

  // Email form
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");

  useEffect(() => {
    tenantSettingsApi
      .get()
      .then((r) => {
        const s: TenantSettings = r.data;
        setTenantSettings(s);
        if (s.email) {
          setSmtpHost(s.email.smtp_host);
          setSmtpPort(s.email.smtp_port);
          setSmtpUser(s.email.smtp_user);
          setSmtpPassword(s.email.smtp_password);
          setEmailFrom(s.email.email_from);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await authApi.updateProfile({ full_name: fullName, language });
      setUser(res.data);
      setMessage("Settings saved successfully!");
    } catch {
      setMessage("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleLinkTelegram = async () => {
    try {
      const res = await telegramApi.getLinkToken();
      const link = res.data.link;
      setTelegramLink(link);
      window.open(link, "_blank");
    } catch {
      alert("Failed to generate link. Is the Telegram bot configured?");
    }
  };

  const handleUnlinkTelegram = async () => {
    try {
      await telegramApi.unlink();
      setTelegramLinked(false);
    } catch {
      alert("Failed to unlink Telegram");
    }
  };

  const handleSaveEmail = async () => {
    setEmailSaving(true);
    setEmailMessage("");
    try {
      const res = await tenantSettingsApi.update({
        email: {
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_user: smtpUser,
          smtp_password: smtpPassword,
          email_from: emailFrom,
        },
      });
      setTenantSettings(res.data);
      setSmtpPassword(res.data.email?.smtp_password || "");
      setEmailMessage("Email settings saved successfully!");
    } catch {
      setEmailMessage("Failed to save email settings");
    } finally {
      setEmailSaving(false);
    }
  };

  const stopTgPoll = () => {
    if (tgPollRef.current) {
      clearInterval(tgPollRef.current);
      tgPollRef.current = null;
    }
  };

  const startTgBotStatusPoll = () => {
    stopTgPoll();
    setTgBotStatus("restarting");
    tgPollStartRef.current = Date.now();
    tgPollRef.current = setInterval(async () => {
      const elapsed = Date.now() - tgPollStartRef.current;
      try {
        const res = await adminApi.getTelegramBotStatus();
        if (res.data.status === "running") {
          stopTgPoll();
          setTgBotStatus("online");
          setTimeout(() => setTgBotStatus("idle"), 8000);
          return;
        }
      } catch { /* ignore */ }
      if (elapsed > 45000) {
        stopTgPoll();
        setTgBotStatus("timeout");
        setTimeout(() => setTgBotStatus("idle"), 10000);
      }
    }, 3000);
  };

  // Cleanup polling on unmount
  useEffect(() => () => stopTgPoll(), []);

  const handleSaveTelegram = async () => {
    setTgSaving(true);
    setTgMessage("");
    try {
      const tokenToSend = tgBotToken || (tgBotTokenSaved ? "tok_****" : undefined);
      await adminApi.updateTelegramSettings({
        bot_token: tokenToSend,
        notification_chat_id: tgChatId || undefined,
      });
      if (tgBotToken) setTgBotTokenSaved(true);
      if (tgBotToken) setTgBotToken("");
      setTgMessage("Settings saved! Restarting bot...");
      startTgBotStatusPoll();
    } catch {
      setTgMessage("Failed to save Telegram settings");
    } finally {
      setTgSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Settings</h1>
        <p className="text-white/50 mt-1">Manage your account settings</p>
      </div>

      {/* Profile */}
      <div className="glass-card p-6 space-y-6">
        <h2 className="text-lg font-semibold text-white">Profile</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1.5">Email</label>
            <input
              type="email"
              value={user?.email || ""}
              disabled
              className="input-glass opacity-50 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1.5">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-glass"
            />
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1.5">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="input-glass"
            >
              <option value="en">English</option>
              <option value="zh">Chinese (Simplified)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1.5">Role</label>
            <input
              type="text"
              value={user?.role?.replace("_", " ").toUpperCase() || ""}
              disabled
              className="input-glass opacity-50 cursor-not-allowed"
            />
          </div>
        </div>

        {message && (
          <p className={`text-sm ${message.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
            {message}
          </p>
        )}

        <button onClick={handleSave} disabled={saving} className="btn-glow disabled:opacity-50">
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {/* Email Configuration — admin only */}
      {isAdmin && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-violet-500/10 border border-violet-500/20">
              <svg className="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Email Configuration</h2>
              <p className="text-sm text-white/40">Configure SMTP settings for your organization</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1.5">SMTP Host</label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="input-glass"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1.5">SMTP Port</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))}
                  className="input-glass"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1.5">SMTP Username</label>
              <input
                type="text"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="user@yourcompany.com"
                className="input-glass"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1.5">SMTP Password</label>
              <input
                type="password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                className="input-glass"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Sender Email</label>
              <input
                type="email"
                value={emailFrom}
                onChange={(e) => setEmailFrom(e.target.value)}
                placeholder="noreply@yourcompany.com"
                className="input-glass"
              />
            </div>
          </div>

          {emailMessage && (
            <p className={`text-sm ${emailMessage.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
              {emailMessage}
            </p>
          )}

          <button onClick={handleSaveEmail} disabled={emailSaving} className="btn-glow disabled:opacity-50">
            {emailSaving ? "Saving..." : "Save Email Settings"}
          </button>
        </div>
      )}

      {/* Telegram Bot */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,170,255,0.1)", border: "1px solid rgba(0,170,255,0.2)" }}>
            <svg className="h-5 w-5" style={{ color: "#00AAFF" }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Telegram Bot</h2>
            <p className="text-sm text-white/40">Manage jobs and get notifications via Telegram</p>
          </div>
        </div>

        {/* Personal account linking */}
        {telegramLoading ? (
          <div className="flex items-center gap-2 text-sm text-white/30">
            <div className="h-4 w-4 border-2 border-white/20 border-t-transparent rounded-full animate-spin" />
            Checking status...
          </div>
        ) : telegramLinked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">Connected</span>
            </div>
            <p className="text-xs text-white/30">
              You can use /jobs, /newjob, /credits, and /status commands in the SocyBase Telegram bot.
              Job completion notifications are sent automatically.
            </p>
            <button
              onClick={handleUnlinkTelegram}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
            >
              Unlink Telegram
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-white/40">
              Link your Telegram account to manage scraping jobs remotely and receive
              notifications when jobs complete.
            </p>
            <div className="space-y-2">
              <button
                onClick={handleLinkTelegram}
                className="text-sm px-4 py-2 rounded-lg font-medium text-white bg-[#00AAFF]/15 border border-[#00AAFF]/25 hover:bg-[#00AAFF]/25 transition flex items-center gap-2"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Link Telegram
              </button>
              {telegramLink && (
                <p className="text-xs text-white/30">
                  A new tab should open. If it didn&apos;t,{" "}
                  <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="text-[#00AAFF] hover:underline">
                    click here
                  </a>.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Bot Configuration — super_admin only */}
        {isSuperAdmin && (
          <div className="border-t border-white/10 pt-4 mt-4 space-y-3">
            <p className="text-xs font-semibold text-white/50 mb-2">Bot Configuration (Admin)</p>
            <div>
              <label className="block text-xs text-white/60 mb-1">
                Bot Token
                {tgBotTokenSaved && !tgBotToken && (
                  <span className="ml-2 text-emerald-400">Saved (hidden for security)</span>
                )}
              </label>
              <input
                type="password"
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                placeholder={tgBotTokenSaved ? "Enter new token to replace existing" : "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"}
                className="input-glass text-sm"
              />
              <p className="text-xs text-white/30 mt-1">Get this from @BotFather on Telegram</p>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Notification Chat ID</label>
              <input
                type="text"
                value={tgChatId}
                onChange={(e) => setTgChatId(e.target.value)}
                placeholder="-1001234567890"
                className="input-glass text-sm"
              />
              <p className="text-xs text-white/30 mt-1">Group/channel chat ID for admin notifications (optional)</p>
            </div>

            {tgMessage && tgBotStatus === "idle" && (
              <p className={`text-xs ${tgMessage.includes("Failed") ? "text-red-400" : "text-emerald-400"}`}>
                {tgMessage}
              </p>
            )}

            {/* Bot restart status indicator */}
            {tgBotStatus === "restarting" && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-400/10 border border-amber-400/20">
                <div className="h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-400">Bot is restarting...</p>
                  <p className="text-xs text-amber-400/60">Applying new settings. Estimated wait: ~15 seconds</p>
                </div>
              </div>
            )}

            {tgBotStatus === "online" && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-400/10 border border-emerald-400/20">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-400">Bot is online and ready!</p>
                  <p className="text-xs text-emerald-400/60">You can now use /start in Telegram</p>
                </div>
              </div>
            )}

            {tgBotStatus === "timeout" && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-400/10 border border-red-400/20">
                <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-400">Bot restart is taking longer than expected</p>
                  <p className="text-xs text-red-400/60">Check your server logs or restart the telegram-bot service manually</p>
                </div>
              </div>
            )}

            <button
              onClick={handleSaveTelegram}
              disabled={tgSaving || tgBotStatus === "restarting"}
              className="text-sm px-4 py-2 rounded-lg font-medium text-[#00AAFF] bg-[#00AAFF]/10 border border-[#00AAFF]/20 hover:bg-[#00AAFF]/20 transition disabled:opacity-50"
            >
              {tgSaving ? "Saving..." : tgBotStatus === "restarting" ? "Restarting Bot..." : "Save Bot Settings"}
            </button>
          </div>
        )}

        {/* Available Commands */}
        <div className="border-t border-white/10 pt-4 mt-4">
          <p className="text-xs font-semibold text-white/50 mb-2">Available Bot Commands</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {[
              { cmd: "/login", desc: "Log in with email & OTP" },
              { cmd: "/jobs", desc: "List your recent scraping jobs" },
              { cmd: "/newjob", desc: "Start a new scraping job" },
              { cmd: "/tborder", desc: "Place a traffic bot order" },
              { cmd: "/tborders", desc: "View your TB orders" },
              { cmd: "/tbwallet", desc: "Check TB wallet balance" },
              { cmd: "/credits", desc: "View your credit balance" },
              { cmd: "/help", desc: "Show all available commands" },
            ].map((item) => (
              <div key={item.cmd} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
                <span className="text-xs font-mono text-[#00AAFF] font-medium w-16 shrink-0">{item.cmd}</span>
                <span className="text-xs text-white/40">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scraping Defaults */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
            <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Scraping Defaults</h2>
            <p className="text-sm text-white/40">Configure default settings for new scraping jobs</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-white/60 mb-1.5">Profile Fetch Retry Count</label>
            <select
              value={retryCount}
              onChange={(e) => {
                const val = Number(e.target.value);
                setRetryCount(val);
                localStorage.setItem("socybase_scraping_retry_count", String(val));
              }}
              className="input-glass w-40"
            >
              <option value={0}>0 — No retries</option>
              <option value={1}>1 retry</option>
              <option value={2}>2 retries (default)</option>
              <option value={3}>3 retries</option>
            </select>
            <p className="text-xs text-white/30 mt-1.5">
              How many times to retry fetching a profile if it fails. Higher values are more thorough but slower.
            </p>
          </div>
        </div>
      </div>

      {/* Account Info */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Account</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-white/40">Account ID</p>
            <p className="text-white/60 font-mono text-xs mt-1">{user?.id}</p>
          </div>
          <div>
            <p className="text-white/40">Tenant ID</p>
            <p className="text-white/60 font-mono text-xs mt-1">{user?.tenant_id}</p>
          </div>
          <div>
            <p className="text-white/40">Email Verified</p>
            <p className={`mt-1 ${user?.email_verified ? "text-emerald-400" : "text-yellow-400"}`}>
              {user?.email_verified ? "Verified" : "Not verified"}
            </p>
          </div>
          <div>
            <p className="text-white/40">Member Since</p>
            <p className="text-white/60 mt-1">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : "-"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
