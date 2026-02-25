"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { authApi, telegramApi, tenantSettingsApi } from "@/lib/api-client";
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

  useEffect(() => {
    telegramApi
      .getStatus()
      .then((r) => setTelegramLinked(r.data.linked))
      .catch(() => {})
      .finally(() => setTelegramLoading(false));
  }, []);

  // Tenant settings (email + telegram org)
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

  // Telegram org form
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgSaving, setTgSaving] = useState(false);
  const [tgMessage, setTgMessage] = useState("");


  useEffect(() => {
    if (!isAdmin) return;
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
        if (s.telegram) {
          setTgBotToken(s.telegram.bot_token);
          setTgChatId(s.telegram.notification_chat_id);
        }
      })
      .catch(() => {});
  }, [isAdmin]);

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

  const handleSaveTelegram = async () => {
    setTgSaving(true);
    setTgMessage("");
    try {
      const res = await tenantSettingsApi.update({
        telegram: {
          bot_token: tgBotToken,
          notification_chat_id: tgChatId,
        },
      });
      setTenantSettings(res.data);
      setTgBotToken(res.data.telegram?.bot_token || "");
      setTgMessage("Telegram settings saved successfully!");
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

        {/* Organization Telegram — admin only */}
        {isAdmin && (
          <div className="border-t border-white/10 pt-4 mt-4">
            <h3 className="text-sm font-semibold text-white mb-1">Organization Notifications</h3>
            <p className="text-xs text-white/30 mb-4">
              Configure a custom bot token and notification channel for your team.
              This is separate from your personal Telegram link above.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Bot Token</label>
                <input
                  type="password"
                  value={tgBotToken}
                  onChange={(e) => setTgBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  className="input-glass text-sm"
                />
                <p className="text-xs text-white/20 mt-1">Get this from @BotFather on Telegram.</p>
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
                <p className="text-xs text-white/20 mt-1">Group or channel chat ID where job notifications are sent.</p>
              </div>
            </div>

            {tgMessage && (
              <p className={`text-sm mt-3 ${tgMessage.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
                {tgMessage}
              </p>
            )}

            <button
              onClick={handleSaveTelegram}
              disabled={tgSaving}
              className="mt-3 text-sm px-4 py-2 rounded-lg font-medium text-white bg-[#00AAFF]/15 border border-[#00AAFF]/25 hover:bg-[#00AAFF]/25 transition disabled:opacity-50"
            >
              {tgSaving ? "Saving..." : "Save Telegram Settings"}
            </button>
          </div>
        )}
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
