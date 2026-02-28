"use client";

import { useEffect, useState } from "react";
import { creditsApi, paymentsApi, uploadsApi } from "@/lib/api-client";
import { formatCredits } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import type { CreditBalance, CreditPackage } from "@/types";

interface SubscriptionStatus {
  has_subscription: boolean;
  subscription_id?: string;
  status?: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  package_id?: string;
}

export default function CreditsPage() {
  const { formatPrice } = useCurrency();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "bank_transfer">("stripe");
  const [loading, setLoading] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankReference, setBankReference] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);

  // Payment info from admin settings
  const [paymentInfo, setPaymentInfo] = useState<{
    stripe_enabled: boolean;
    bank_transfer_enabled: boolean;
    bank_name: string;
    bank_account_name: string;
    bank_account_number: string;
    bank_duitnow_id: string;
    payment_model: string;
  } | null>(null);

  useEffect(() => {
    creditsApi.getBalance().then((r) => setBalance(r.data)).catch(() => {});
    creditsApi.getPackages().then((r) => setPackages(r.data)).catch(() => {});
    creditsApi.getPaymentInfo().then((r) => setPaymentInfo(r.data)).catch(() => {});
    paymentsApi.getSubscriptionStatus().then((r) => setSubscription(r.data)).catch(() => {});
  }, []);

  // Filter packages based on admin payment model setting
  const paymentModel = paymentInfo?.payment_model || "one_time";
  const visiblePackages = packages.filter((pkg) => {
    if (paymentModel === "one_time") return pkg.billing_interval === "one_time";
    if (paymentModel === "subscription") return pkg.billing_interval !== "one_time";
    return true; // "both" — show all
  });

  // Group packages for "both" mode
  const oneTimePackages = visiblePackages.filter((p) => p.billing_interval === "one_time");
  const subscriptionPackages = visiblePackages.filter((p) => p.billing_interval !== "one_time");
  const showBothSections = paymentModel === "both" && oneTimePackages.length > 0 && subscriptionPackages.length > 0;

  const handlePurchase = async () => {
    if (!selectedPkg) return;
    const pkg = packages.find((p) => p.id === selectedPkg);
    const isSubscription = pkg && pkg.billing_interval !== "one_time";

    // Subscriptions always go through Stripe
    if (isSubscription || paymentMethod === "stripe") {
      setLoading(true);
      try {
        const res = await paymentsApi.createStripeCheckout(selectedPkg);
        window.location.href = res.data.checkout_url;
      } catch (err: any) {
        alert(err.response?.data?.detail || "Payment failed");
      } finally {
        setLoading(false);
      }
    } else {
      setShowBankModal(true);
    }
  };

  const handleBankTransferSubmit = async () => {
    if (!selectedPkg || !proofFile || !bankReference.trim()) {
      alert("Please fill in the reference number and upload proof of payment");
      return;
    }
    setUploading(true);
    try {
      const uploadRes = await uploadsApi.uploadProof(proofFile);
      const proofUrl = uploadRes.data.proof_url;
      await paymentsApi.submitBankTransfer({
        package_id: selectedPkg,
        reference: bankReference.trim(),
        proof_url: proofUrl,
      });
      setShowBankModal(false);
      setBankReference("");
      setProofFile(null);
      alert("Bank transfer submitted successfully! Awaiting admin approval.");
    } catch (err: any) {
      alert(err.response?.data?.detail || "Submission failed");
    } finally {
      setUploading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm("Are you sure you want to cancel your subscription? You will keep your remaining credits.")) return;
    setCancellingSubscription(true);
    try {
      await paymentsApi.cancelSubscription();
      setSubscription({ has_subscription: false });
      alert("Subscription cancelled successfully.");
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to cancel subscription");
    } finally {
      setCancellingSubscription(false);
    }
  };

  const selectedPackage = packages.find((p) => p.id === selectedPkg);
  const isSelectedSubscription = selectedPackage && selectedPackage.billing_interval !== "one_time";

  const packageColors = [
    "from-primary-500 to-blue-600",
    "from-accent-purple to-purple-700",
    "from-accent-pink to-rose-600",
    "from-cyan-500 to-teal-600",
  ];

  const renderPackageCard = (pkg: CreditPackage, i: number) => (
    <button
      key={pkg.id}
      onClick={() => setSelectedPkg(pkg.id)}
      className={`glass-card p-6 text-left transition-all hover:scale-[1.02] ${
        selectedPkg === pkg.id
          ? "border-primary-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
          : ""
      }`}
    >
      <div className={`h-2 w-12 rounded-full bg-gradient-to-r ${packageColors[i % packageColors.length]} mb-4`} />
      <h3 className="text-lg font-bold text-white">{pkg.name}</h3>
      <p className="text-3xl font-bold text-white mt-2">
        {formatPrice(pkg.price_cents, pkg.currency)}
        {pkg.billing_interval !== "one_time" && (
          <span className="text-sm font-normal text-white/40">
            /{pkg.billing_interval === "monthly" ? "mo" : "yr"}
          </span>
        )}
      </p>
      <div className="mt-3 space-y-1">
        <p className="text-sm text-white/60">
          {formatCredits(pkg.credits)} credits{pkg.billing_interval !== "one_time" ? `/${pkg.billing_interval === "monthly" ? "month" : "year"}` : ""}
        </p>
        {pkg.bonus_credits > 0 && (
          <p className="text-sm text-emerald-400">
            +{formatCredits(pkg.bonus_credits)} bonus!
          </p>
        )}
      </div>
      <p className="text-xs text-white/30 mt-2">
        ~{formatPrice(Math.round(pkg.price_cents / (pkg.credits + pkg.bonus_credits)), pkg.currency)}/credit
      </p>
    </button>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Credits</h1>
        <p className="text-white/50 mt-1">Purchase credits to run scraping jobs</p>
      </div>

      {/* Current Balance */}
      <div className="glass-card p-5 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-white/50">Current Balance</p>
            <p className="text-3xl md:text-4xl font-bold gradient-text mt-1">
              {balance ? formatCredits(balance.balance) : "---"}
            </p>
            <p className="text-xs text-white/30 mt-2">
              Lifetime: {balance ? formatCredits(balance.lifetime_purchased) : "0"} purchased,{" "}
              {balance ? formatCredits(balance.lifetime_used) : "0"} used
            </p>
          </div>
          <div className="hidden sm:flex h-20 w-20 rounded-2xl bg-gradient-to-br from-primary-500/20 to-accent-purple/20 items-center justify-center shrink-0">
            <svg className="h-10 w-10 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Active Subscription */}
      {subscription?.has_subscription && subscription.status === "active" && (
        <div className="glass-card p-5 border-cyan-500/20">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium text-cyan-400 bg-cyan-400/10">
                  Active Subscription
                </span>
                {subscription.cancel_at_period_end && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium text-amber-400 bg-amber-400/10">
                    Cancelling
                  </span>
                )}
              </div>
              <p className="text-sm text-white/60 mt-2">
                {subscription.current_period_end && (
                  <>Next billing: {new Date(subscription.current_period_end * 1000).toLocaleDateString()}</>
                )}
              </p>
            </div>
            {!subscription.cancel_at_period_end && (
              <button
                onClick={handleCancelSubscription}
                disabled={cancellingSubscription}
                className="text-xs px-4 py-2 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition disabled:opacity-50"
              >
                {cancellingSubscription ? "Cancelling..." : "Cancel Subscription"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Credit Packages */}
      {showBothSections ? (
        <>
          {/* One-time packages */}
          <div>
            <h2 className="text-xl font-semibold text-white mb-4">One-time Packages</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {oneTimePackages.map((pkg, i) => renderPackageCard(pkg, i))}
            </div>
          </div>
          {/* Subscription packages */}
          <div>
            <h2 className="text-xl font-semibold text-white mb-4">Subscription Plans</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {subscriptionPackages.map((pkg, i) => renderPackageCard(pkg, i))}
            </div>
          </div>
        </>
      ) : (
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">
            {paymentModel === "subscription" ? "Subscription Plans" : "Choose a Package"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {visiblePackages.map((pkg, i) => renderPackageCard(pkg, i))}
          </div>
        </div>
      )}

      {/* Payment Method */}
      {selectedPkg && (
        <div className="space-y-4 animate-slide-up">
          {isSelectedSubscription ? (
            <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-4">
              <p className="text-sm text-cyan-300/80">
                Subscription payments are processed through Stripe. Credits will be automatically added to your account each billing cycle.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-white">Payment Method</h2>
              <div className="flex gap-3">
                {(paymentInfo?.stripe_enabled !== false) && (
                  <button
                    onClick={() => setPaymentMethod("stripe")}
                    className={`flex-1 glass-card p-4 text-center transition-all ${
                      paymentMethod === "stripe" ? "border-primary-500 bg-primary-500/10" : ""
                    }`}
                  >
                    <p className="font-medium text-white">Stripe</p>
                    <p className="text-xs text-white/40 mt-1">Credit/Debit Card</p>
                  </button>
                )}
                {(paymentInfo?.bank_transfer_enabled !== false) && (
                  <button
                    onClick={() => setPaymentMethod("bank_transfer")}
                    className={`flex-1 glass-card p-4 text-center transition-all ${
                      paymentMethod === "bank_transfer" ? "border-primary-500 bg-primary-500/10" : ""
                    }`}
                  >
                    <p className="font-medium text-white">DuitNow</p>
                    <p className="text-xs text-white/40 mt-1">Bank Transfer</p>
                  </button>
                )}
              </div>
            </>
          )}

          <button
            onClick={handlePurchase}
            disabled={loading}
            className="btn-glow w-full text-lg py-4 disabled:opacity-50"
          >
            {loading
              ? "Processing..."
              : isSelectedSubscription
              ? "Subscribe Now"
              : "Purchase Credits"}
          </button>
        </div>
      )}

      {/* Bank Transfer Modal */}
      {showBankModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card max-w-md w-full mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                Bank Transfer
              </h3>
              <button
                onClick={() => setShowBankModal(false)}
                className="text-white/40 hover:text-white text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            {/* Bank Details */}
            <div className="rounded-lg bg-white/5 border border-white/10 p-4 space-y-2">
              <p className="text-sm text-white/40">Transfer to:</p>
              <p className="text-white font-medium">{paymentInfo?.bank_account_name || "---"}</p>
              {paymentInfo?.bank_name && (
                <p className="text-white/60 text-sm">Bank: {paymentInfo.bank_name}</p>
              )}
              {paymentInfo?.bank_account_number && (
                <p className="text-white/60 text-sm">Account: {paymentInfo.bank_account_number}</p>
              )}
              {paymentInfo?.bank_duitnow_id && (
                <p className="text-white/60 text-sm">DuitNow ID: {paymentInfo.bank_duitnow_id}</p>
              )}
              <div className="mt-2 pt-2 border-t border-white/10">
                <p className="text-sm text-white/40">Amount</p>
                <p className="text-lg font-bold text-white">
                  {selectedPackage
                    ? formatPrice(
                        selectedPackage.price_cents,
                        selectedPackage.currency
                      )
                    : "---"}
                </p>
              </div>
            </div>

            {/* Reference Number */}
            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                Transaction Reference Number
              </label>
              <input
                type="text"
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                placeholder="e.g., FT2402221234567"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white placeholder-white/30 focus:border-primary-500 focus:outline-none"
              />
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                Upload Payment Proof
              </label>
              <label className="flex items-center justify-center rounded-lg border-2 border-dashed border-white/10 hover:border-primary-500/30 p-6 cursor-pointer transition">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) =>
                    setProofFile(e.target.files?.[0] || null)
                  }
                  className="hidden"
                />
                <div className="text-center">
                  {proofFile ? (
                    <p className="text-sm text-primary-400">{proofFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm text-white/40">
                        Click to upload screenshot
                      </p>
                      <p className="text-xs text-white/20 mt-1">
                        JPG, PNG, PDF (max 10MB)
                      </p>
                    </>
                  )}
                </div>
              </label>
            </div>

            {/* Submit */}
            <button
              onClick={handleBankTransferSubmit}
              disabled={uploading || !bankReference.trim() || !proofFile}
              className="btn-glow w-full py-3 disabled:opacity-50"
            >
              {uploading ? "Submitting..." : "Submit Bank Transfer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
