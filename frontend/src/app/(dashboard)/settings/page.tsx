"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { authApi, telegramApi, tenantSettingsApi, adminApi, jobsApi } from "@/lib/api-client";
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

  // Browser extension state
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [extensionLoading, setExtensionLoading] = useState(true);
  const [extensionMessage, setExtensionMessage] = useState("");
  const [playwrightEnabled, setPlaywrightEnabled] = useState(true);

  useEffect(() => {
    telegramApi
      .getStatus()
      .then((r) => setTelegramLinked(r.data.linked))
      .catch(() => {})
      .finally(() => setTelegramLoading(false));
    jobsApi
      .getFeatureFlags()
      .then((r) => {
        const flags = r.data?.flags || {};
        if (flags.playwright_scraping !== undefined) setPlaywrightEnabled(flags.playwright_scraping);
      })
      .catch(() => {});

    // Detect browser extension via window message
    const handleExtensionMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type === "SOCYBASE_EXTENSION_INSTALLED") {
        setExtensionInstalled(true);
        setExtensionLoading(false);
        // Check if already configured
        window.postMessage({ type: "SOCYBASE_EXTENSION_STATUS" }, "*");
      }
      if (event.data?.type === "SOCYBASE_EXTENSION_STATUS_RESPONSE") {
        setExtensionConnected(event.data.configured || false);
      }
      if (event.data?.type === "SOCYBASE_EXTENSION_CONNECTED") {
        if (event.data.success) {
          setExtensionConnected(true);
          setExtensionMessage("Extension connected successfully!");
        }
      }
      if (event.data?.type === "SOCYBASE_EXTENSION_DISCONNECTED") {
        setExtensionConnected(false);
        setExtensionMessage("Extension disconnected.");
      }
    };
    window.addEventListener("message", handleExtensionMessage);
    // Give extension content script time to load and announce
    const timeout = setTimeout(() => setExtensionLoading(false), 2000);
    return () => {
      window.removeEventListener("message", handleExtensionMessage);
      clearTimeout(timeout);
    };
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
      if (res.data.error) {
        alert(res.data.error);
        return;
      }
      const link = res.data.link;
      if (!link) {
        alert("Failed to generate link. Is the Telegram bot configured?");
        return;
      }
      setTelegramLink(link);
      // Use location.href for reliable navigation (window.open gets blocked by popup blockers after async)
      window.location.href = link;
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
              <span className="text-sm text-emerald-400 font-medium">Telegram Connected</span>
            </div>
            <p className="text-sm text-white/40">
              Your Telegram account is linked. You&apos;ll receive job completion notifications automatically and can manage jobs via the bot.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://t.me/Socybase_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm px-4 py-2 rounded-lg font-medium text-white bg-[#00AAFF]/15 border border-[#00AAFF]/25 hover:bg-[#00AAFF]/25 transition flex items-center gap-2"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Open @Socybase_bot
              </a>
              <button
                onClick={handleUnlinkTelegram}
                className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
              >
                Unlink
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* How to connect - step by step */}
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-4 space-y-3">
              <p className="text-sm font-medium text-white/70">How to connect:</p>
              <ol className="space-y-2 text-sm text-white/50">
                <li className="flex items-start gap-2">
                  <span className="text-[#00AAFF] font-bold shrink-0">1.</span>
                  Click the <strong className="text-white/70">Link Telegram</strong> button below to open <span className="text-[#00AAFF]">@Socybase_bot</span> in Telegram
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#00AAFF] font-bold shrink-0">2.</span>
                  Press <strong className="text-white/70">Start</strong> in the Telegram chat — your account will be linked automatically
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#00AAFF] font-bold shrink-0">3.</span>
                  Use <span className="font-mono text-[#00AAFF] text-xs">/login</span> to verify with your email, then you&apos;re all set!
                </li>
              </ol>
            </div>

            <p className="text-xs text-white/30">
              Once connected, you can create and monitor AI-Scraping jobs, check credits, place traffic bot orders, and receive real-time notifications — all from Telegram.
            </p>

            <div className="space-y-2">
              <button
                onClick={handleLinkTelegram}
                className="text-sm px-4 py-2.5 rounded-lg font-medium text-white bg-[#00AAFF]/15 border border-[#00AAFF]/25 hover:bg-[#00AAFF]/25 transition flex items-center gap-2"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Link Telegram
              </button>
              {telegramLink ? (
                <p className="text-xs text-white/30">
                  A new tab should open. If it didn&apos;t,{" "}
                  <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="text-[#00AAFF] hover:underline">
                    click here to open @Socybase_bot
                  </a>.
                </p>
              ) : (
                <p className="text-xs text-white/30">
                  Or open Telegram and search for{" "}
                  <a href="https://t.me/Socybase_bot" target="_blank" rel="noopener noreferrer" className="text-[#00AAFF] hover:underline font-medium">
                    @Socybase_bot
                  </a>{" "}
                  directly.
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
              { cmd: "/jobs", desc: "List your recent AI-Scraping jobs" },
              { cmd: "/newjob", desc: "Start a new AI-Scraping job" },
              { cmd: "/tborder", desc: "Place a traffic bot order" },
              { cmd: "/tborders", desc: "View your TB orders" },
              { cmd: "/tbwallet", desc: "Check TB wallet balance" },
              { cmd: "/credits", desc: "View your credit balance" },
              { cmd: "/help", desc: "Show all available commands" },
            ].map((item) => (
              <div key={item.cmd} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
                <span className="text-xs font-mono text-[#00AAFF] font-medium w-20 shrink-0">{item.cmd}</span>
                <span className="text-xs text-white/40">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI-Scraping Defaults */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
            <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">AI-Scraping Defaults</h2>
            <p className="text-sm text-white/40">Configure default settings for new AI-Scraping jobs</p>
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

      {/* Browser Extension — only shown when admin enables the feature */}
      {playwrightEnabled && <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
            <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Browser Extension</h2>
            <p className="text-sm text-white/40">Enhanced <strong>AI-Scraping</strong> for restricted Facebook pages</p>
          </div>
        </div>

        {extensionLoading ? (
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            Detecting extension...
          </div>
        ) : extensionConnected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">Extension Connected</span>
            </div>
            <p className="text-sm text-white/40">
              The extension is actively polling for tasks. When a restricted Facebook page needs scraping, it will use your browser session automatically.
            </p>
            <button
              onClick={() => {
                window.postMessage({ type: "SOCYBASE_EXTENSION_DISCONNECT" }, "*");
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              Disconnect Extension
            </button>
          </div>
        ) : extensionInstalled ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="text-sm text-amber-400 font-medium">Extension Installed — Not Connected</span>
            </div>
            <p className="text-sm text-white/40">
              Click the button below to connect the extension. It will use your current login session.
            </p>
            <button
              onClick={() => {
                const token = localStorage.getItem("access_token");
                const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
                if (!token) {
                  setExtensionMessage("No auth token found. Please log in first.");
                  return;
                }
                window.postMessage({
                  type: "SOCYBASE_EXTENSION_CONNECT",
                  apiUrl,
                  authToken: token,
                }, "*");
              }}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-indigo-500/15 border border-indigo-500/25 hover:bg-indigo-500/25 transition flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
              Connect Extension
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="text-sm text-white/50">Extension Not Installed</span>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-4 space-y-3">
              <p className="text-sm font-medium text-white/70">How to install:</p>
              <ol className="space-y-2 text-sm text-white/50">
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold shrink-0">1.</span>
                  Download the <strong className="text-white/70">SocyBase Browser Operator</strong> extension folder
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold shrink-0">2.</span>
                  Open <span className="font-mono text-indigo-400 text-xs">chrome://extensions</span> and enable Developer mode
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold shrink-0">3.</span>
                  Click <strong className="text-white/70">Load unpacked</strong> and select the extension folder
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold shrink-0">4.</span>
                  Refresh this page — the extension will be detected automatically
                </li>
              </ol>
            </div>
            <p className="text-xs text-white/25">
              The extension uses your browser&apos;s Facebook session to scrape restricted pages safely — no account lockouts.
            </p>
          </div>
        )}

        {extensionMessage && (
          <p className={`text-sm ${extensionMessage.includes("success") || extensionMessage.includes("Connected") ? "text-emerald-400" : "text-red-400"}`}>
            {extensionMessage}
          </p>
        )}
      </div>}

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
