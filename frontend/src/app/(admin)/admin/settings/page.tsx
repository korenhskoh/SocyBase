"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";

export default function AdminSettingsPage() {
  const { user } = useAuth(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Stripe settings
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [stripePubKey, setStripePubKey] = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");

  // Bank transfer settings
  const [bankEnabled, setBankEnabled] = useState(true);
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankDuitnowId, setBankDuitnowId] = useState("");
  const [bankSwiftCode, setBankSwiftCode] = useState("");

  useEffect(() => {
    if (user?.role === "super_admin") {
      adminApi
        .getPaymentSettings()
        .then((r) => {
          const d = r.data;
          if (d.stripe_enabled !== undefined) setStripeEnabled(d.stripe_enabled);
          if (d.stripe_publishable_key) setStripePubKey(d.stripe_publishable_key);
          if (d.stripe_secret_key) setStripeSecretKey(d.stripe_secret_key);
          if (d.stripe_webhook_secret) setStripeWebhookSecret(d.stripe_webhook_secret);
          if (d.bank_transfer_enabled !== undefined) setBankEnabled(d.bank_transfer_enabled);
          if (d.bank_name) setBankName(d.bank_name);
          if (d.bank_account_name) setBankAccountName(d.bank_account_name);
          if (d.bank_account_number) setBankAccountNumber(d.bank_account_number);
          if (d.bank_duitnow_id) setBankDuitnowId(d.bank_duitnow_id);
          if (d.bank_swift_code) setBankSwiftCode(d.bank_swift_code);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await adminApi.updatePaymentSettings({
        stripe_enabled: stripeEnabled,
        stripe_publishable_key: stripePubKey || undefined,
        stripe_secret_key: stripeSecretKey || undefined,
        stripe_webhook_secret: stripeWebhookSecret || undefined,
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
          <h1 className="text-2xl md:text-3xl font-bold text-white">Payment Settings</h1>
        </div>
        <p className="text-white/50 mt-1 ml-7">
          Configure Stripe and bank transfer payment methods
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
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
                  <label className="block text-xs text-white/60 mb-1">Secret Key</label>
                  <input
                    type="password"
                    value={stripeSecretKey}
                    onChange={(e) => setStripeSecretKey(e.target.value)}
                    placeholder="sk_live_..."
                    className="input-glass text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Webhook Secret</label>
                  <input
                    type="password"
                    value={stripeWebhookSecret}
                    onChange={(e) => setStripeWebhookSecret(e.target.value)}
                    placeholder="whsec_..."
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

          {/* Info box */}
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 p-4">
            <p className="text-xs text-blue-300/80">
              These settings control what users see on the Credits page when making payments.
              Bank details will be shown in the bank transfer modal. Stripe keys are used for
              checkout session creation. Disabling a method hides it from the payment options.
            </p>
          </div>

          {/* Save */}
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
        </>
      )}
    </div>
  );
}
