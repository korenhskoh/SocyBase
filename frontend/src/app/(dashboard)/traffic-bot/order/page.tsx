"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trafficBotApi } from "@/lib/api-client";
import type { TrafficBotService, TrafficBotWallet, TrafficBotPriceCalc } from "@/types";

export default function TrafficBotOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("service");

  const [services, setServices] = useState<TrafficBotService[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [wallet, setWallet] = useState<TrafficBotWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Form state
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedServiceId, setSelectedServiceId] = useState<string>(preselectedId || "");
  const [link, setLink] = useState("");
  const [quantity, setQuantity] = useState<number>(0);
  const [priceCalc, setPriceCalc] = useState<TrafficBotPriceCalc | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      trafficBotApi.getServices().then((r) => setServices(r.data)),
      trafficBotApi.getCategories().then((r) => setCategories(r.data)),
      trafficBotApi.getWallet().then((r) => setWallet(r.data)),
    ]).finally(() => setLoading(false));
  }, []);

  // Pre-select category from service
  useEffect(() => {
    if (preselectedId && services.length > 0) {
      const svc = services.find((s) => s.id === preselectedId);
      if (svc) {
        setSelectedCategory(svc.category);
        setSelectedServiceId(svc.id);
        setQuantity(svc.min_quantity);
      }
    }
  }, [preselectedId, services]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) || null,
    [services, selectedServiceId]
  );

  const categoryServices = useMemo(
    () => (selectedCategory ? services.filter((s) => s.category === selectedCategory) : []),
    [services, selectedCategory]
  );

  // Calculate price when quantity or service changes
  const calculatePrice = useCallback(async () => {
    if (!selectedServiceId || !quantity || quantity <= 0) {
      setPriceCalc(null);
      return;
    }
    setCalcLoading(true);
    try {
      const r = await trafficBotApi.calculatePrice(selectedServiceId, quantity);
      setPriceCalc(r.data);
    } catch {
      setPriceCalc(null);
    } finally {
      setCalcLoading(false);
    }
  }, [selectedServiceId, quantity]);

  useEffect(() => {
    const timer = setTimeout(calculatePrice, 300);
    return () => clearTimeout(timer);
  }, [calculatePrice]);

  async function handleSubmit() {
    if (!selectedServiceId || !link.trim() || !quantity) return;
    setSubmitting(true);
    setError("");
    try {
      await trafficBotApi.createOrder({
        service_id: selectedServiceId,
        link: link.trim(),
        quantity,
      });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create order";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <div className="glass-card p-10">
          <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Order Placed!</h2>
          <p className="text-white/50 text-sm mb-6">Your order has been submitted and is being processed.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.push("/traffic-bot/orders")}
              className="btn-glow px-5 py-2.5 rounded-xl text-sm font-semibold"
            >
              View Orders
            </button>
            <button
              onClick={() => {
                setSuccess(false);
                setLink("");
                setQuantity(selectedService?.min_quantity || 0);
                setPriceCalc(null);
              }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/5 text-white/70 hover:bg-white/10 transition border border-white/10"
            >
              New Order
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">New Order</h1>
        <p className="text-sm text-white/50 mt-1">Select a service and place your order</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-5">
          {/* Step 1: Category */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-6 w-6 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 text-xs font-bold">1</div>
              <h3 className="text-sm font-semibold text-white">Select Category</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setSelectedServiceId("");
                    setQuantity(0);
                  }}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition border ${
                    selectedCategory === cat
                      ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                      : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Service */}
          {selectedCategory && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 text-xs font-bold">2</div>
                <h3 className="text-sm font-semibold text-white">Select Service</h3>
              </div>
              <select
                value={selectedServiceId}
                onChange={(e) => {
                  setSelectedServiceId(e.target.value);
                  const svc = services.find((s) => s.id === e.target.value);
                  if (svc) setQuantity(svc.min_quantity);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="" className="bg-navy-900">Choose a service...</option>
                {categoryServices.map((svc) => (
                  <option key={svc.id} value={svc.id} className="bg-navy-900">
                    {svc.name} — ${(svc.rate * (1 + svc.fee_pct / 100)).toFixed(2)}/1K
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Step 3: Link & Quantity */}
          {selectedService && (
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-6 w-6 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 text-xs font-bold">3</div>
                <h3 className="text-sm font-semibold text-white">Order Details</h3>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Link / URL</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">
                  Quantity
                  <span className="text-white/20 ml-2">
                    (Min: {selectedService.min_quantity.toLocaleString()} — Max: {selectedService.max_quantity.toLocaleString()})
                  </span>
                </label>
                <input
                  type="number"
                  min={selectedService.min_quantity}
                  max={selectedService.max_quantity}
                  value={quantity || ""}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>

              {/* Quick quantity buttons */}
              <div className="flex flex-wrap gap-2">
                {[selectedService.min_quantity, 1000, 5000, 10000, 50000].filter(
                  (v, i, arr) => v >= selectedService.min_quantity && v <= selectedService.max_quantity && arr.indexOf(v) === i
                ).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition border ${
                      quantity === q
                        ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                        : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {q.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          {selectedService && priceCalc && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !link.trim() || !quantity || (wallet ? priceCalc.total_cost > wallet.balance : false)}
              className="btn-glow w-full px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                  Placing Order...
                </span>
              ) : (
                `Place Order — $${priceCalc.total_cost.toFixed(2)}`
              )}
            </button>
          )}
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          {/* Wallet Balance */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <svg className="h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3" />
              </svg>
              <span className="text-xs text-white/40 font-medium">Wallet Balance</span>
            </div>
            <p className="text-2xl font-bold text-white">${wallet?.balance?.toFixed(2) || "0.00"}</p>
            {priceCalc && wallet && priceCalc.total_cost > wallet.balance && (
              <p className="text-xs text-red-400 mt-2">Insufficient balance. Contact admin to top up.</p>
            )}
          </div>

          {/* Price Breakdown */}
          {priceCalc && selectedService && (
            <div className="glass-card p-5">
              <h4 className="text-xs text-white/40 font-medium mb-3">Price Breakdown</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Base cost</span>
                  <span className="text-white">${priceCalc.base_cost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Service fee ({selectedService.fee_pct}%)</span>
                  <span className="text-white">${priceCalc.fee_amount.toFixed(4)}</span>
                </div>
                <div className="border-t border-white/10 pt-2 flex justify-between font-semibold">
                  <span className="text-white/70">Total</span>
                  <span className="text-primary-400">${priceCalc.total_cost.toFixed(4)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Service Info */}
          {selectedService && (
            <div className="glass-card p-5">
              <h4 className="text-xs text-white/40 font-medium mb-3">Service Details</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Category</span>
                  <span className="text-white">{selectedService.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Type</span>
                  <span className="text-white">{selectedService.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Rate per 1K</span>
                  <span className="text-white">${(selectedService.rate * (1 + selectedService.fee_pct / 100)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Min order</span>
                  <span className="text-white">{selectedService.min_quantity.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Max order</span>
                  <span className="text-white">{selectedService.max_quantity.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
