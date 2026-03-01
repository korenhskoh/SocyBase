"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";

const PAYMENT_MODELS = [
  { value: "one_time", label: "One-time Packages", desc: "Users buy credit packs once" },
  { value: "subscription", label: "Subscription Only", desc: "Monthly or annual billing" },
  { value: "both", label: "Both", desc: "Users choose one-time or subscription" },
];

const MASKED = "sk_****";

export default function AdminSettingsPage() {
  const { user } = useAuth(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Payment model
  const [paymentModel, setPaymentModel] = useState("one_time");

  // Stripe settings
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [stripePubKey, setStripePubKey] = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  // Track whether secrets are saved on server (came back masked)
  const [secretKeySaved, setSecretKeySaved] = useState(false);
  const [webhookSecretSaved, setWebhookSecretSaved] = useState(false);

  // Bank transfer settings
  const [bankEnabled, setBankEnabled] = useState(true);
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankDuitnowId, setBankDuitnowId] = useState("");
  const [bankSwiftCode, setBankSwiftCode] = useState("");

  // WhatsApp settings
  const [waEnabled, setWaEnabled] = useState(true);
  const [waServiceUrl, setWaServiceUrl] = useState("");
  const [waAdminNumber, setWaAdminNumber] = useState("");
  const [waSaving, setWaSaving] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [waStatus, setWaStatus] = useState<string | null>(null);

  // QR code pairing
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waQrMessage, setWaQrMessage] = useState("");
  const [waQrLoading, setWaQrLoading] = useState(false);

  // WhatsApp contact number for tenants
  const [waContactNumber, setWaContactNumber] = useState("");

  // Test notification
  const [waTestSending, setWaTestSending] = useState(false);
  const [waTestResult, setWaTestResult] = useState("");

  // Per-notification toggles
  const [notifyNewUser, setNotifyNewUser] = useState(true);
  const [notifyPaymentApproved, setNotifyPaymentApproved] = useState(true);
  const [notifyPaymentCompleted, setNotifyPaymentCompleted] = useState(true);
  const [notifyRefund, setNotifyRefund] = useState(true);
  const [notifyTrafficBotOrder, setNotifyTrafficBotOrder] = useState(true);
  const [notifyWalletDeposit, setNotifyWalletDeposit] = useState(true);

  useEffect(() => {
    if (user?.role === "super_admin") {
      Promise.all([
        adminApi.getPaymentSettings().then((r) => {
          const d = r.data;
          if (d.payment_model) setPaymentModel(d.payment_model);
          if (d.stripe_enabled !== undefined) setStripeEnabled(d.stripe_enabled);
          if (d.stripe_publishable_key) setStripePubKey(d.stripe_publishable_key);
          if (d.stripe_secret_key) {
            if (d.stripe_secret_key === MASKED) {
              setSecretKeySaved(true);
              setStripeSecretKey("");
            } else {
              setStripeSecretKey(d.stripe_secret_key);
            }
          }
          if (d.stripe_webhook_secret) {
            if (d.stripe_webhook_secret === MASKED) {
              setWebhookSecretSaved(true);
              setStripeWebhookSecret("");
            } else {
              setStripeWebhookSecret(d.stripe_webhook_secret);
            }
          }
          if (d.bank_transfer_enabled !== undefined) setBankEnabled(d.bank_transfer_enabled);
          if (d.bank_name) setBankName(d.bank_name);
          if (d.bank_account_name) setBankAccountName(d.bank_account_name);
          if (d.bank_account_number) setBankAccountNumber(d.bank_account_number);
          if (d.bank_duitnow_id) setBankDuitnowId(d.bank_duitnow_id);
          if (d.bank_swift_code) setBankSwiftCode(d.bank_swift_code);
        }).catch(() => {}),
        adminApi.getWhatsappSettings().then((r) => {
          const d = r.data;
          if (d.whatsapp_enabled !== undefined) setWaEnabled(d.whatsapp_enabled);
          if (d.whatsapp_service_url) setWaServiceUrl(d.whatsapp_service_url);
          if (d.whatsapp_admin_number) setWaAdminNumber(d.whatsapp_admin_number);
          if (d.whatsapp_contact_number) setWaContactNumber(d.whatsapp_contact_number);
          if (d.notify_new_user !== undefined) setNotifyNewUser(d.notify_new_user);
          if (d.notify_payment_approved !== undefined) setNotifyPaymentApproved(d.notify_payment_approved);
          if (d.notify_payment_completed !== undefined) setNotifyPaymentCompleted(d.notify_payment_completed);
          if (d.notify_refund !== undefined) setNotifyRefund(d.notify_refund);
          if (d.notify_traffic_bot_order !== undefined) setNotifyTrafficBotOrder(d.notify_traffic_bot_order);
          if (d.notify_wallet_deposit !== undefined) setNotifyWalletDeposit(d.notify_wallet_deposit);
        }).catch(() => {}),
      ]).finally(() => setLoading(false));
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      // Send masked placeholder for unchanged secrets so backend preserves them
      const secretToSend = stripeSecretKey || (secretKeySaved ? MASKED : undefined);
      const webhookToSend = stripeWebhookSecret || (webhookSecretSaved ? MASKED : undefined);
      await adminApi.updatePaymentSettings({
        payment_model: paymentModel,
        stripe_enabled: stripeEnabled,
        stripe_publishable_key: stripePubKey || undefined,
        stripe_secret_key: secretToSend,
        stripe_webhook_secret: webhookToSend,
        bank_transfer_enabled: bankEnabled,
        bank_name: bankName || undefined,
        bank_account_name: bankAccountName || undefined,
        bank_account_number: bankAccountNumber || undefined,
        bank_duitnow_id: bankDuitnowId || undefined,
        bank_swift_code: bankSwiftCode || undefined,
      });
      setMessage("Payment settings saved successfully!");
    } catch {
      setMessage("Failed to save payment settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWhatsApp = async () => {
    setWaSaving(true);
    setWaMessage("");
    try {
      await adminApi.updateWhatsappSettings({
        whatsapp_enabled: waEnabled,
        whatsapp_service_url: waServiceUrl || undefined,
        whatsapp_admin_number: waAdminNumber || undefined,
        whatsapp_contact_number: waContactNumber || undefined,
        notify_new_user: notifyNewUser,
        notify_payment_approved: notifyPaymentApproved,
        notify_payment_completed: notifyPaymentCompleted,
        notify_refund: notifyRefund,
        notify_traffic_bot_order: notifyTrafficBotOrder,
        notify_wallet_deposit: notifyWalletDeposit,
      });
      setWaMessage("WhatsApp settings saved successfully!");
    } catch {
      setWaMessage("Failed to save WhatsApp settings");
    } finally {
      setWaSaving(false);
    }
  };

  const checkWhatsAppStatus = async () => {
    setWaStatus(null);
    try {
      const { data } = await adminApi.getWhatsappStatus();
      setWaStatus(data.status || "unknown");
      return data.status || "unknown";
    } catch {
      setWaStatus("unreachable");
      return "unreachable";
    }
  };

  // Auto-poll status while QR is displayed
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await adminApi.getWhatsappStatus();
        if (data.status === "connected") {
          setWaStatus("connected");
          setWaQr(null);
          setWaQrMessage("WhatsApp connected successfully!");
          stopPolling();
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const fetchQrCode = async () => {
    setWaQrLoading(true);
    setWaQr(null);
    setWaQrMessage("");
    try {
      const { data } = await adminApi.getWhatsappQr();
      if (data.status === "connected") {
        setWaQrMessage("Already connected! No QR scan needed.");
        setWaStatus("connected");
        stopPolling();
      } else if (data.qr) {
        setWaQr(data.qr);
        setWaQrMessage("Scan this QR code with your WhatsApp app (Linked Devices > Link a Device)");
        startPolling();
      } else {
        setWaQrMessage(data.message || "No QR code available yet. Try again in a few seconds.");
      }
    } catch {
      setWaQrMessage("Cannot reach WhatsApp service. Make sure it is running and the Service URL is correct.");
    } finally {
      setWaQrLoading(false);
    }
  };

  const disconnectWhatsApp = async () => {
    if (!confirm("Disconnect WhatsApp? You will need to scan a new QR code to re-pair.")) return;
    setWaStatus(null);
    setWaQr(null);
    setWaQrMessage("");
    try {
      const { data } = await adminApi.disconnectWhatsapp();
      setWaStatus("disconnected");
      setWaQrMessage(data.message || "Disconnected. Click 'Pair WhatsApp (QR)' to link a new account.");
    } catch {
      setWaQrMessage("Failed to disconnect. Check if the service is running.");
    }
  };

  if (user?.role !== "super_admin") {
    return (
      <div className="text-center py-20 text-white/40">
        Access denied. Super admin only.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin" className="text-white/40 hover:text-white transition">
            &larr;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Platform Settings</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7">
          Configure payment methods, billing model, and notifications
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Payment Model */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
                <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Payment Model</h2>
                <p className="text-sm text-white/40">Choose how users purchase credits</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {PAYMENT_MODELS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setPaymentModel(m.value)}
                  className={`p-4 rounded-lg text-left transition-all border ${
                    paymentModel === m.value
                      ? "border-primary-500 bg-primary-500/10"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                  }`}
                >
                  <p className={`text-sm font-medium ${paymentModel === m.value ? "text-primary-400" : "text-white/70"}`}>
                    {m.label}
                  </p>
                  <p className="text-xs text-white/40 mt-1">{m.desc}</p>
                </button>
              ))}
            </div>

            {paymentModel !== "one_time" && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3">
                <p className="text-xs text-amber-300/80">
                  For subscriptions, create packages with &quot;Monthly&quot; or &quot;Annual&quot; billing type in Package Management.
                  Each package needs a recurring Stripe Price ID. Credits are automatically added on each renewal.
                </p>
              </div>
            )}
          </div>

          {/* Stripe Configuration */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
                  <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Stripe</h2>
                  <p className="text-sm text-white/40">Credit/Debit card payments</p>
                </div>
              </div>
              <button
                onClick={() => setStripeEnabled(!stripeEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  stripeEnabled ? "bg-primary-500" : "bg-white/10"
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  stripeEnabled ? "translate-x-5" : ""
                }`} />
              </button>
            </div>

            {stripeEnabled && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs text-white/60 mb-1">Publishable Key</label>
                  <input
                    type="text"
                    value={stripePubKey}
                    onChange={(e) => setStripePubKey(e.target.value)}
                    placeholder="pk_live_..."
                    className="input-glass text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">
                    Secret Key
                    {secretKeySaved && !stripeSecretKey && (
                      <span className="ml-2 text-emerald-400">Saved (hidden for security)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={stripeSecretKey}
                    onChange={(e) => setStripeSecretKey(e.target.value)}
                    placeholder={secretKeySaved ? "Enter new key to replace existing" : "sk_live_..."}
                    className="input-glass text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">
                    Webhook Secret
                    {webhookSecretSaved && !stripeWebhookSecret && (
                      <span className="ml-2 text-emerald-400">Saved (hidden for security)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={stripeWebhookSecret}
                    onChange={(e) => setStripeWebhookSecret(e.target.value)}
                    placeholder={webhookSecretSaved ? "Enter new key to replace existing" : "whsec_..."}
                    className="input-glass text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bank Transfer Configuration */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20">
                  <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Bank Transfer / DuitNow</h2>
                  <p className="text-sm text-white/40">Manual bank transfer payments</p>
                </div>
              </div>
              <button
                onClick={() => setBankEnabled(!bankEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  bankEnabled ? "bg-primary-500" : "bg-white/10"
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  bankEnabled ? "translate-x-5" : ""
                }`} />
              </button>
            </div>

            {bankEnabled && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs text-white/60 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Maybank, CIMB, Public Bank"
                    className="input-glass text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Account Holder Name</label>
                  <input
                    type="text"
                    value={bankAccountName}
                    onChange={(e) => setBankAccountName(e.target.value)}
                    placeholder="e.g. SocyBase Sdn Bhd"
                    className="input-glass text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/60 mb-1">Account Number</label>
                    <input
                      type="text"
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                      placeholder="1234 5678 9012"
                      className="input-glass text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/60 mb-1">DuitNow ID</label>
                    <input
                      type="text"
                      value={bankDuitnowId}
                      onChange={(e) => setBankDuitnowId(e.target.value)}
                      placeholder="company@duitnow"
                      className="input-glass text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">SWIFT Code (optional)</label>
                  <input
                    type="text"
                    value={bankSwiftCode}
                    onChange={(e) => setBankSwiftCode(e.target.value)}
                    placeholder="e.g. MABORUMYKL"
                    className="input-glass text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Webhook Setup Info */}
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 p-4 space-y-3">
            <p className="text-xs font-medium text-blue-300/90">Stripe Webhook Setup</p>
            <div>
              <p className="text-xs text-blue-300/60 mb-1">Webhook URL (paste this in Stripe Dashboard &gt; Developers &gt; Webhooks):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-white/5 rounded px-3 py-2 text-blue-300/80 font-mono break-all">
                  {(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000")}/api/v1/payments/stripe/webhook
                </code>
                <button
                  type="button"
                  onClick={() => {
                    const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/payments/stripe/webhook`;
                    navigator.clipboard.writeText(url);
                  }}
                  className="shrink-0 text-xs px-3 py-2 rounded-lg text-blue-400 bg-blue-400/10 border border-blue-400/20 hover:bg-blue-400/20 transition"
                >
                  Copy
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-blue-300/60 mb-1">Events to enable:</p>
              <div className="grid grid-cols-2 gap-1">
                {[
                  "checkout.session.completed",
                  "invoice.paid",
                  "customer.subscription.deleted",
                  "charge.refunded",
                ].map((evt) => (
                  <p key={evt} className="text-xs text-blue-300/60 font-mono">{evt}</p>
                ))}
              </div>
            </div>
            <p className="text-xs text-blue-300/50">
              After creating the webhook in Stripe, copy the Signing secret (whsec_...) and paste it in the Webhook Secret field above.
            </p>
          </div>

          {/* Save Payment Settings */}
          {message && (
            <p className={`text-sm ${message.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
              {message}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-glow w-full py-3 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Payment Settings"}
          </button>

          {/* WhatsApp Notifications */}
          <div className="glass-card p-6 space-y-4 mt-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-green-500/10 border border-green-500/20">
                  <svg className="h-5 w-5 text-green-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">WhatsApp Notifications</h2>
                  <p className="text-sm text-white/40">Admin alerts via WhatsApp (Baileys)</p>
                </div>
              </div>
              <button
                onClick={() => setWaEnabled(!waEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  waEnabled ? "bg-primary-500" : "bg-white/10"
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  waEnabled ? "translate-x-5" : ""
                }`} />
              </button>
            </div>

            {waEnabled && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs text-white/60 mb-1">Service URL</label>
                  <input
                    type="text"
                    value={waServiceUrl}
                    onChange={(e) => setWaServiceUrl(e.target.value)}
                    placeholder="http://whatsapp.railway.internal:3001"
                    className="input-glass text-sm"
                  />
                  <p className="text-xs text-white/30 mt-1">Internal URL of the WhatsApp service (backend connects to this)</p>
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Admin Phone Number</label>
                  <input
                    type="text"
                    value={waAdminNumber}
                    onChange={(e) => setWaAdminNumber(e.target.value)}
                    placeholder="60123456789 (no + prefix)"
                    className="input-glass text-sm"
                  />
                  <p className="text-xs text-white/30 mt-1">Phone number that receives all admin notifications</p>
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Contact Us Number (Tenant-facing)</label>
                  <input
                    type="text"
                    value={waContactNumber}
                    onChange={(e) => setWaContactNumber(e.target.value)}
                    placeholder="60123456789 (no + prefix)"
                    className="input-glass text-sm"
                  />
                  <p className="text-xs text-white/30 mt-1">Shown as floating WhatsApp button for tenants. Leave empty to use admin number above.</p>
                </div>

                {/* Connection Status & QR Pairing */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={checkWhatsAppStatus}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-green-400 bg-green-400/10 border border-green-400/20 hover:bg-green-400/20 transition"
                  >
                    Check Connection
                  </button>
                  <button
                    type="button"
                    onClick={fetchQrCode}
                    disabled={waQrLoading}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-blue-400 bg-blue-400/10 border border-blue-400/20 hover:bg-blue-400/20 transition disabled:opacity-50"
                  >
                    {waQrLoading ? "Loading..." : "Pair WhatsApp (QR)"}
                  </button>
                  {waStatus === "connected" && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          setWaTestSending(true);
                          setWaTestResult("");
                          try {
                            const { data } = await adminApi.sendWhatsappTest();
                            setWaTestResult(data.success ? data.message : data.message || "Failed to send test");
                          } catch {
                            setWaTestResult("Failed to send test notification");
                          } finally {
                            setWaTestSending(false);
                          }
                        }}
                        disabled={waTestSending}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 hover:bg-amber-400/20 transition disabled:opacity-50"
                      >
                        {waTestSending ? "Sending..." : "Send Test"}
                      </button>
                      <button
                        type="button"
                        onClick={disconnectWhatsApp}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                  {waStatus && (
                    <span className={`text-xs font-medium ${
                      waStatus === "connected"
                        ? "text-emerald-400"
                        : waStatus === "connecting"
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}>
                      {waStatus === "connected" ? "Connected" :
                       waStatus === "connecting" ? "Connecting (scan QR)" :
                       waStatus === "unreachable" ? "Service unreachable" :
                       waStatus}
                    </span>
                  )}
                </div>
                {waTestResult && (
                  <p className={`text-xs ${waTestResult.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
                    {waTestResult}
                  </p>
                )}

                {/* QR Code Display */}
                {(waQr || waQrMessage) && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-4 space-y-3">
                    {waQr && (
                      <div className="flex flex-col items-center gap-3">
                        <div className="bg-white rounded-xl p-3">
                          <img
                            src={waQr}
                            alt="WhatsApp QR Code"
                            className="w-56 h-56"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={fetchQrCode}
                          className="text-xs text-blue-400 hover:text-blue-300 transition"
                        >
                          Refresh QR Code
                        </button>
                      </div>
                    )}
                    {waQrMessage && (
                      <p className={`text-xs text-center ${waQr ? "text-white/50" : waQrMessage.includes("Connected") || waQrMessage.includes("connected") ? "text-emerald-400" : "text-amber-400"}`}>
                        {waQrMessage}
                      </p>
                    )}
                  </div>
                )}

                {/* Per-notification toggles */}
                <div className="pt-3 border-t border-white/5">
                  <p className="text-xs text-white/60 font-medium mb-3">Notification Types</p>
                  <div className="space-y-2">
                    {[
                      { label: "New User Registration", value: notifyNewUser, setter: setNotifyNewUser },
                      { label: "Payment Approved", value: notifyPaymentApproved, setter: setNotifyPaymentApproved },
                      { label: "Stripe Payment Completed", value: notifyPaymentCompleted, setter: setNotifyPaymentCompleted },
                      { label: "Refund Processed", value: notifyRefund, setter: setNotifyRefund },
                      { label: "Traffic Bot Order", value: notifyTrafficBotOrder, setter: setNotifyTrafficBotOrder },
                      { label: "Wallet Deposit Request", value: notifyWalletDeposit, setter: setNotifyWalletDeposit },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition">
                        <span className="text-sm text-white/70">{item.label}</span>
                        <button
                          type="button"
                          onClick={() => item.setter(!item.value)}
                          className={`relative w-9 h-5 rounded-full transition-colors ${
                            item.value ? "bg-green-500" : "bg-white/10"
                          }`}
                        >
                          <div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                            item.value ? "translate-x-4" : ""
                          }`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* WhatsApp Info */}
            <div className="rounded-lg bg-green-500/5 border border-green-500/15 p-3 space-y-2">
              <p className="text-xs font-medium text-green-300/90">Setup Guide</p>
              <ol className="text-xs text-green-300/70 space-y-1 list-decimal list-inside">
                <li>Enter the WhatsApp service URL (e.g. <strong>http://whatsapp.railway.internal:3001</strong> for Railway, or your service&apos;s internal/public URL)</li>
                <li>Enter the admin phone number that will receive notifications</li>
                <li>Click <strong>&quot;Pair WhatsApp (QR)&quot;</strong> and scan the QR code with WhatsApp on your phone (Settings &gt; Linked Devices &gt; Link a Device)</li>
                <li>Once connected, save settings and enable the notifications you want</li>
              </ol>
            </div>
          </div>

          {/* Save WhatsApp Settings */}
          {waMessage && (
            <p className={`text-sm ${waMessage.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
              {waMessage}
            </p>
          )}

          <button
            onClick={handleSaveWhatsApp}
            disabled={waSaving}
            className="btn-glow w-full py-3 disabled:opacity-50"
          >
            {waSaving ? "Saving..." : "Save WhatsApp Settings"}
          </button>
        </>
      )}
    </div>
  );
}
