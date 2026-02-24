"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { adminApi } from "@/lib/api-client";
import { formatCurrency } from "@/lib/utils";
import type { CreditPackage } from "@/types";

interface EditValues {
  name?: string;
  credits?: number;
  price_cents?: number;
  bonus_credits?: number;
  sort_order?: number;
}

export default function AdminPackagesPage() {
  const { user } = useAuth(true);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [newPkg, setNewPkg] = useState({
    name: "",
    credits: 100,
    price_cents: 999,
    bonus_credits: 0,
    sort_order: 0,
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
      await adminApi.createPackage(newPkg);
      setShowCreate(false);
      setNewPkg({ name: "", credits: 100, price_cents: 999, bonus_credits: 0, sort_order: 0 });
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
      price_cents: pkg.price_cents,
      bonus_credits: pkg.bonus_credits,
      sort_order: pkg.sort_order,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await adminApi.updatePackage(editingId, editValues);
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
    if (!confirm("Deactivate this package?")) return;
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
          <p className="text-white/50 mt-1 ml-7">Manage credit packages and pricing</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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
              <label className="block text-xs text-white/40 mb-1">Price (cents)</label>
              <input
                type="number"
                value={newPkg.price_cents}
                onChange={(e) => setNewPkg({ ...newPkg, price_cents: parseInt(e.target.value) || 0 })}
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
              <label className="block text-xs text-white/40 mb-1">Sort Order</label>
              <input
                type="number"
                value={newPkg.sort_order}
                onChange={(e) => setNewPkg({ ...newPkg, sort_order: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
          </div>
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
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Credits</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Bonus</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Price</th>
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
                          value={editValues.price_cents ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, price_cents: parseInt(e.target.value) || 0 })}
                          className="input-glass text-sm w-24"
                        />
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
                        {formatCurrency(pkg.price_cents, pkg.currency)}
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
