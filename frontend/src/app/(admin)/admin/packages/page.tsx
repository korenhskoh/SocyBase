"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import type { CreditPackage } from "@/types";

interface EditValues {
  name?: string;
  credits?: number;
  price?: number;
  bonus_credits?: number;
  billing_interval?: string;
  stripe_price_id?: string;
  sort_order?: number;
  max_concurrent_jobs?: number;
  daily_job_limit?: number;
  monthly_credit_limit?: number;
}

const BILLING_OPTIONS = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

function billingLabel(interval: string) {
  return BILLING_OPTIONS.find((o) => o.value === interval)?.label || interval;
}

function billingColor(interval: string) {
  if (interval === "monthly") return "text-cyan-400 bg-cyan-400/10";
  if (interval === "annual") return "text-violet-400 bg-violet-400/10";
  return "text-white/40 bg-white/5";
}

export default function AdminPackagesPage() {
  const { user } = useAuth(true);
  const { formatPrice } = useCurrency();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [newPkg, setNewPkg] = useState({
    name: "",
    credits: 100,
    price: 9.99,
    bonus_credits: 0,
    billing_interval: "one_time",
    stripe_price_id: "",
    sort_order: 0,
    max_concurrent_jobs: 3,
    daily_job_limit: 0,
    monthly_credit_limit: 0,
  });

  const fetchPackages = () => {
    setLoading(true);
    adminApi
      .listPackages()
      .then((r) => setPackages(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (user?.role === "super_admin") fetchPackages();
  }, [user]);

  const handleCreate = async () => {
    try {
      const { price, ...rest } = newPkg;
      await adminApi.createPackage({
        ...rest,
        price_cents: Math.round(price * 100),
        stripe_price_id: newPkg.stripe_price_id || undefined,
      });
      setShowCreate(false);
      setNewPkg({ name: "", credits: 100, price: 9.99, bonus_credits: 0, billing_interval: "one_time", stripe_price_id: "", sort_order: 0, max_concurrent_jobs: 3, daily_job_limit: 0, monthly_credit_limit: 0 });
      fetchPackages();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to create package");
    }
  };

  const startEdit = (pkg: CreditPackage) => {
    setEditingId(pkg.id);
    setEditValues({
      name: pkg.name,
      credits: pkg.credits,
      price: pkg.price_cents / 100,
      bonus_credits: pkg.bonus_credits,
      billing_interval: pkg.billing_interval,
      stripe_price_id: pkg.stripe_price_id || "",
      sort_order: pkg.sort_order,
      max_concurrent_jobs: pkg.max_concurrent_jobs ?? 3,
      daily_job_limit: pkg.daily_job_limit ?? 0,
      monthly_credit_limit: pkg.monthly_credit_limit ?? 0,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const { price: editPrice, max_concurrent_jobs, daily_job_limit, monthly_credit_limit, ...editRest } = editValues;
      await adminApi.updatePackage(editingId, {
        ...editRest,
        price_cents: editPrice != null ? Math.round(editPrice * 100) : undefined,
        stripe_price_id: editValues.stripe_price_id || undefined,
        max_concurrent_jobs,
        daily_job_limit,
        monthly_credit_limit,
      });
      setEditingId(null);
      fetchPackages();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update");
    }
  };

  const handleToggleActive = async (pkg: CreditPackage) => {
    try {
      await adminApi.updatePackage(pkg.id, { is_active: !pkg.is_active });
      fetchPackages();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to toggle");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Permanently delete this package? This cannot be undone.")) return;
    try {
      await adminApi.deletePackage(id);
      fetchPackages();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to delete");
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/admin" className="text-white/40 hover:text-white transition">
              &larr;
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Package Management</h1>
          </div>
          <p className="text-white/50 mt-1 ml-7">Manage credit packages, subscriptions, and pricing</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-glow text-sm shrink-0"
        >
          {showCreate ? "Cancel" : "+ Add Package"}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">New Package</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-white/40 mb-1">Name</label>
              <input
                type="text"
                value={newPkg.name}
                onChange={(e) => setNewPkg({ ...newPkg, name: e.target.value })}
                className="input-glass text-sm"
                placeholder="e.g. Starter"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Credits</label>
              <input
                type="number"
                value={newPkg.credits}
                onChange={(e) => setNewPkg({ ...newPkg, credits: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Price (USD)</label>
              <input
                type="number"
                step="0.01"
                value={newPkg.price}
                onChange={(e) => setNewPkg({ ...newPkg, price: parseFloat(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Bonus Credits</label>
              <input
                type="number"
                value={newPkg.bonus_credits}
                onChange={(e) => setNewPkg({ ...newPkg, bonus_credits: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Billing Type</label>
              <select
                value={newPkg.billing_interval}
                onChange={(e) => setNewPkg({ ...newPkg, billing_interval: e.target.value })}
                className="input-glass text-sm"
              >
                {BILLING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Stripe Price ID</label>
              <input
                type="text"
                value={newPkg.stripe_price_id}
                onChange={(e) => setNewPkg({ ...newPkg, stripe_price_id: e.target.value })}
                className="input-glass text-sm"
                placeholder="price_..."
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Sort Order</label>
              <input
                type="number"
                value={newPkg.sort_order}
                onChange={(e) => setNewPkg({ ...newPkg, sort_order: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
          </div>
          {/* Scraping Limits */}
          <div>
            <h4 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Scraping Limits</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-white/40 mb-1">Max Concurrent Jobs</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={newPkg.max_concurrent_jobs}
                  onChange={(e) => setNewPkg({ ...newPkg, max_concurrent_jobs: parseInt(e.target.value) || 3 })}
                  className="input-glass text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Daily Job Limit</label>
                <input
                  type="number"
                  min={0}
                  value={newPkg.daily_job_limit}
                  onChange={(e) => setNewPkg({ ...newPkg, daily_job_limit: parseInt(e.target.value) || 0 })}
                  className="input-glass text-sm"
                />
                <p className="text-[10px] text-white/20 mt-0.5">0 = unlimited</p>
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Monthly Credit Limit</label>
                <input
                  type="number"
                  min={0}
                  value={newPkg.monthly_credit_limit}
                  onChange={(e) => setNewPkg({ ...newPkg, monthly_credit_limit: parseInt(e.target.value) || 0 })}
                  className="input-glass text-sm"
                />
                <p className="text-[10px] text-white/20 mt-0.5">0 = unlimited</p>
              </div>
            </div>
          </div>
          {newPkg.billing_interval !== "one_time" && (
            <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-3">
              <p className="text-xs text-cyan-300/80">
                For subscription packages, use a recurring Stripe Price ID (created with interval = {newPkg.billing_interval === "monthly" ? "month" : "year"}).
                Credits will be added automatically each billing cycle.
              </p>
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={!newPkg.name}
            className="text-sm px-4 py-2 rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition disabled:opacity-40"
          >
            Create Package
          </button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : packages.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No packages found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Credits</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Bonus</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Price</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Billing</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Limits</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Order</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {packages.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-white/[0.02] transition">
                  {editingId === pkg.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          type="text"
                          value={editValues.name ?? ""}
                          onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                          className="input-glass text-sm w-full"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          value={editValues.credits ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, credits: parseInt(e.target.value) || 0 })}
                          className="input-glass text-sm w-20"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          value={editValues.bonus_credits ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, bonus_credits: parseInt(e.target.value) || 0 })}
                          className="input-glass text-sm w-20"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          step="0.01"
                          value={editValues.price ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, price: parseFloat(e.target.value) || 0 })}
                          className="input-glass text-sm w-24"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editValues.billing_interval ?? "one_time"}
                          onChange={(e) => setEditValues({ ...editValues, billing_interval: e.target.value })}
                          className="input-glass text-sm"
                        >
                          {BILLING_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <div className="space-y-1">
                          <input type="number" min={1} max={50} value={editValues.max_concurrent_jobs ?? 3} onChange={(e) => setEditValues({ ...editValues, max_concurrent_jobs: parseInt(e.target.value) || 3 })} className="input-glass text-xs w-16" title="Concurrent" />
                          <input type="number" min={0} value={editValues.daily_job_limit ?? 0} onChange={(e) => setEditValues({ ...editValues, daily_job_limit: parseInt(e.target.value) || 0 })} className="input-glass text-xs w-16" title="Daily" />
                          <input type="number" min={0} value={editValues.monthly_credit_limit ?? 0} onChange={(e) => setEditValues({ ...editValues, monthly_credit_limit: parseInt(e.target.value) || 0 })} className="input-glass text-xs w-16" title="Monthly" />
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-xs text-white/40">-</span>
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          value={editValues.sort_order ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, sort_order: parseInt(e.target.value) || 0 })}
                          className="input-glass text-sm w-16"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium text-white/40 bg-white/5 border border-white/10 hover:text-white/80 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4 text-sm text-white/80 font-medium">{pkg.name}</td>
                      <td className="px-6 py-4 text-sm text-white/70">{pkg.credits.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-white/50">+{pkg.bonus_credits.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-white/70 font-medium">
                        {formatPrice(pkg.price_cents, pkg.currency)}
                        {pkg.billing_interval !== "one_time" && (
                          <span className="text-white/30 text-xs">/{pkg.billing_interval === "monthly" ? "mo" : "yr"}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${billingColor(pkg.billing_interval)}`}>
                          {billingLabel(pkg.billing_interval)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-0.5 text-xs text-white/50">
                          <p>{pkg.max_concurrent_jobs ?? 3} concurrent</p>
                          <p>{(pkg.daily_job_limit ?? 0) === 0 ? "Unlimited" : pkg.daily_job_limit} daily</p>
                          <p>{(pkg.monthly_credit_limit ?? 0) === 0 ? "Unlimited" : pkg.monthly_credit_limit} mo. credits</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggleActive(pkg)}
                          className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${
                            pkg.is_active
                              ? "text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20"
                              : "text-gray-400 bg-gray-400/10 hover:bg-gray-400/20"
                          }`}
                        >
                          {pkg.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm text-white/40">{pkg.sort_order}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(pkg)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium text-blue-400 bg-blue-400/10 border border-blue-400/20 hover:bg-blue-400/20 transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(pkg.id)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
